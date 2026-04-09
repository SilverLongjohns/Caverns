# Lobby Room Codes Design

## Goal

Replace the single global lobby with multiple independent lobbies identified by 4-letter room codes, allowing concurrent games on the same server.

## Architecture

The server currently has one `Lobby` instance and one `GameSession`. This changes to a `Map<string, LobbyRoom>` where each `LobbyRoom` encapsulates a `Lobby` and an optional `GameSession`. All messaging (`broadcast`, `sendTo`) is scoped to the room's player set.

Room codes are 4 random uppercase letters generated server-side, with collision retry. Rooms are destroyed when all players disconnect.

## Lobby Flow

1. Player connects, enters name (unchanged)
2. Player sees two buttons: **Create Lobby** and **Join Lobby**
3. **Create Lobby**: server generates room code, player becomes host, code displayed prominently
4. **Join Lobby**: player enters a 4-letter code, server validates and adds them to that room's lobby
5. In-lobby experience is unchanged: player list, host-only difficulty picker, host starts game
6. Room code remains visible in the lobby for latecomers

## Post-Game

On victory or wipe, players return to their lobby with the same room code and party. The `GameSession` is destroyed but the `LobbyRoom` persists. Host can adjust settings and start a new game.

## Message Protocol

### Changed Messages

**`join_lobby` (client → server)**
- Add optional `roomCode?: string`
- If absent: create a new room, player becomes host
- If present: join existing room (error if code invalid or game already in progress)

**`lobby_state` (server → client)**
- Add `roomCode: string`

### No New Messages

All other messages are unchanged. The server routes them based on which room the player belongs to.

## Server Changes

### New: `LobbyRoom` concept in `index.ts`

A room tracks:
- `code: string` — the 4-letter room code
- `lobby: Lobby` — the lobby instance
- `gameSession: GameSession | null` — null until game starts, reset on game end
- `playerIds: Set<string>` — all connected players in this room

The top-level `index.ts` manages:
- `rooms: Map<string, LobbyRoom>` — all active rooms
- `playerRoom: Map<string, string>` — maps playerId → roomCode for message routing
- Room-scoped `broadcast` and `sendTo` functions passed to each Lobby/GameSession

### Code Generation

Random 4 uppercase letters (A-Z). On collision with existing room code, regenerate. 26^4 = 456,976 possible codes — collision is negligible.

### Cleanup

When a player disconnects:
- Remove from their room's player set
- Remove from lobby
- If room has zero players, destroy it (delete lobby, game session, and room entry)

### Game End Handling

When `game_over` fires:
- Destroy the `GameSession` on the room
- Players remain in the room — their connection status returns to `in_lobby`
- Server sends `lobby_state` to all players in the room so the client transitions back to the lobby screen

### Routing

All game messages (`move`, `combat_action`, `loot_choice`, etc.) look up the player's room via `playerRoom` map and forward to that room's `GameSession`.

## Client Changes

### Store (`gameStore.ts`)

- Add `roomCode: string` to state
- Set `roomCode` from `lobby_state` message
- On `game_over`: keep `connectionStatus` as `in_lobby` (not disconnected), clear game state, preserve `roomCode`

### Lobby Component (`Lobby.tsx`)

After name entry, new intermediate screen with two options:
- **Create Lobby** — sends `join_lobby` with no room code
- **Join Lobby** — shows 4-character code input, sends `join_lobby` with the entered code

Once in the lobby:
- Room code displayed prominently (styled to match CRT theme)
- Rest of lobby unchanged (player list, difficulty, start button)

### App.tsx

On `game_over`, transition to lobby screen (not game-over-only screen). Show victory/wipe result briefly, then return to lobby. The existing game-over screen can show for a few seconds before the `lobby_state` message arrives and transitions back.

## Error Cases

- **Invalid room code**: server sends `error` message "Room not found"
- **Game already in progress**: server sends `error` message "Game already in progress"
- **Room full (4 players)**: server sends `error` message "Room is full"

## What Doesn't Change

- Lobby.ts class interface (just instantiated per-room instead of globally)
- GameSession class interface
- All combat, loot, inventory, and movement systems
- CRT styling and all visual components
