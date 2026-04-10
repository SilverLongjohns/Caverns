# Mob AI & Grid Movement Design

## Goal

Make dungeon rooms feel alive by giving mobs physical presence on the tile grid. Mobs wander randomly within rooms, players move tile-by-tile through rooms, and combat triggers when a player gets within detection range of a mob. Combat itself stays abstract (no positional mechanics).

## Architecture

A `MobAIManager` on the server manages mob entities within `RoomGrid` instances. Each room with an encounter gets a `RoomGrid` when first revealed. A server-side tick loop (setInterval) drives mob wandering. Players send `grid_move` messages to move tile-by-tile, replacing the old room-level `move` message. When Chebyshev distance between a mob and player drops to 3 or fewer tiles, combat triggers via the existing `startCombat()` flow.

## Scope

- **New:** `server/src/MobAIManager.ts`, `client/src/hooks/useGridMovement.ts`, new message types in `shared/src/messages.ts`
- **Modified:** `server/src/GameSession.ts` (RoomGrid lifecycle, grid_move handler, detection), `client/src/store/gameStore.ts` (mob/player positions), `client/src/components/RoomView.tsx` (real positions, remove fallback), `shared/src/content.ts` (DRIPPING_HALLS tile grids)
- **Removed:** `buildFallbackGrid` in RoomView, `MoveMessage` / `move` handler (replaced by `grid_move`)

---

## 1. RoomGrid Lifecycle

Each room gets a `RoomGrid` instance when first revealed by a player. The room's `TileGrid` (generated server-side in sub-project 4, or newly generated for DRIPPING_HALLS) is converted to a `RoomGridConfig` by casting `string[][]` tiles to `TileType[][]`.

**Creation:** When `room_reveal` fires. GameSession builds a `RoomGrid` from the room's `tileGrid` and stores it in a `Map<string, RoomGrid>` keyed by room ID.

**Mob entity:** If the room has an uncleared encounter, a mob entity is placed at a random walkable tile at least 5 tiles (Chebyshev) from any exit. The mob entity uses `type: 'mob'` and `id: mobInstanceId`.

**Player entities:** When a player enters a room, they're added to that room's RoomGrid as a `type: 'player'` entity at the exit tile they entered from. When they leave, they're removed. On game start, players spawn at the center of the entrance room.

**Destruction:** RoomGrid instances persist for the session lifetime. They're lightweight and don't need cleanup.

---

## 2. DRIPPING_HALLS Tile Grids

DRIPPING_HALLS rooms currently have no `tileGrid`. Rather than maintaining the client-side fallback, GameSession will generate tile grids for static dungeon rooms at game start using `buildTileGrid()`.

When `initGame()` processes DRIPPING_HALLS, iterate all rooms and call `buildTileGrid(room, 'starter')` for each one. The `starter` biome config provides a reasonable default for the hand-authored dungeon.

The client's `buildFallbackGrid()` function and related constants in `RoomView.tsx` are deleted.

---

## 3. Mob Spawning & Wandering

### Spawning

When a RoomGrid is created for a room with an uncleared encounter, `MobAIManager` creates a `MobInstance` and places it as an entity on the RoomGrid. The spawn position is a random walkable tile at least 5 tiles from every exit tile.

If no valid spawn position exists (very small room), fall back to any walkable tile that isn't an exit.

### Wander Tick

A single `setInterval` in `MobAIManager` runs every 1500ms. Each tick, for each active mob:

1. 30% chance to idle (skip movement this tick)
2. Otherwise, collect all walkable cardinal/diagonal neighbor tiles
3. Pick one at random
4. Move the mob via `RoomGrid.moveEntity()`
5. Broadcast `mob_position` to players in that room
6. Check detection against all players in the room

### MobAIManager Interface

```ts
class MobAIManager {
  constructor(broadcastToRoom: (roomId: string, msg: ServerMessage) => void)

  // Called when a room with an encounter is revealed
  registerRoom(roomId: string, grid: RoomGrid, mob: MobInstance): void

  // Called when combat ends with 'victory' — removes mob permanently
  removeMob(roomId: string): void

  // Called when combat ends with 'flee' — re-adds mob at its last position
  reactivateMob(roomId: string): void

  // Called when player enters/leaves a room
  addPlayer(roomId: string, playerId: string, position: GridPosition): void
  removePlayer(roomId: string, playerId: string): void

  // Returns mob position for a room (for initial state sync)
  getMobPosition(roomId: string): GridPosition | null

  // Detection callback — GameSession provides this
  onDetection: (roomId: string, mobId: string) => void

  // Cleanup
  destroy(): void  // clears the interval
}
```

---

## 4. Detection & Combat Trigger

### Detection Check

After each mob movement tick AND after each player grid movement, check Chebyshev distance between the mob and every player in the same room. If distance <= 3, fire the `onDetection` callback.

### Combat Trigger Flow

1. `onDetection` fires → `MobAIManager` pauses wandering for that room's mob (removes from tick loop, but keeps position stored)
2. GameSession calls `startCombat()` as before
3. Mob entity is removed from the RoomGrid (no longer visible on grid)
4. Client receives `combat_start`, combat plays out abstractly

### Post-Combat

- **Victory:** `MobAIManager.removeMob(roomId)` — mob gone permanently, room marked cleared
- **Flee:** `MobAIManager.reactivateMob(roomId)` — mob entity re-added to RoomGrid at its stored position, wandering resumes. Fleeing players are already in the adjacent room.
- **Wipe:** Game over, no cleanup needed

---

## 5. Player Grid Movement

### Replacing Room-Level Movement

The current `MoveMessage` (`{ type: 'move', direction: Direction }`) moves players between rooms. This is replaced by `GridMoveMessage`:

```ts
interface GridMoveMessage {
  type: 'grid_move';
  direction: GridDirection;  // 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
}
```

The old `move` message type and its handler are removed.

### Server Handling

When GameSession receives `grid_move`:

1. Look up the player's current room and its RoomGrid
2. Call `RoomGrid.moveEntity(playerId, direction)`
3. Handle `MoveResult.events`:
   - `exit` → trigger room transition (reveal adjacent room, move player, broadcast `player_moved`)
   - `interact` → no-op (player walks onto interactable tile, they still need to click it)
   - `hazard` → apply damage to player, broadcast `player_update`
   - `combat` → this won't fire (we handle detection via distance check, not entity collision)
4. Broadcast `player_position` to all players in the room
5. Check mob detection (distance check)

### Player Spawn Position

- **Entering via exit:** Player spawns at the exit tile corresponding to the direction they came from. E.g., entering from the south means they appear at the south exit tile of the new room.
- **Game start:** Players spawn at the center of the entrance room.

### Movement Cooldown

The server enforces a minimum interval between `grid_move` messages per player (~150ms). Messages arriving too fast are silently dropped.

---

## 6. Message Protocol

### New Client → Server

```ts
// GridDirection defined in shared/src/types.ts (not imported from roomgrid — shared has no roomgrid dependency)
type GridDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface GridMoveMessage {
  type: 'grid_move';
  direction: GridDirection;
}
```

### New Server → Client

```ts
interface MobPositionMessage {
  type: 'mob_position';
  roomId: string;
  mobId: string;
  x: number;
  y: number;
}

interface PlayerPositionMessage {
  type: 'player_position';
  playerId: string;
  roomId: string;
  x: number;
  y: number;
}

interface MobSpawnMessage {
  type: 'mob_spawn';
  roomId: string;
  mobId: string;
  mobName: string;
  x: number;
  y: number;
}

interface MobDespawnMessage {
  type: 'mob_despawn';
  roomId: string;
  mobId: string;
}
```

### Removed

`MoveMessage` (`{ type: 'move', direction: Direction }`) — replaced by `GridMoveMessage`.

### Modified

`GameStartMessage` — add `playerPositions: Record<string, { x: number, y: number }>` so the client knows where players are on the grid initially.

`PlayerMovedMessage` — add `x` and `y` fields for the player's grid position in the new room.

---

## 7. Client Changes

### Game Store

New state fields:

```ts
mobPositions: Record<string, { mobId: string; mobName: string; x: number; y: number }>;  // keyed by roomId
playerPositions: Record<string, { x: number; y: number }>;  // keyed by playerId
```

New message handlers:
- `mob_position` → update `mobPositions[roomId]`
- `mob_spawn` → set `mobPositions[roomId]`
- `mob_despawn` → delete `mobPositions[roomId]`
- `player_position` → update `playerPositions[playerId]`
- `game_start` → initialize `playerPositions` from message data
- `player_moved` → update `playerPositions[playerId]` with new room's grid position

### RoomView Changes

Entity overlay construction changes from computed offsets to real positions:

- **Players:** read from `playerPositions[playerId]` instead of calculating from index
- **Mobs (pre-combat):** read from `mobPositions[currentRoomId]` instead of combat participant data
- **Mobs (in combat):** continue using combat participant list (but these are no longer rendered on the grid since combat is abstract)
- **Interactables:** unchanged (already positioned from instance data)

Remove `buildFallbackGrid()` and `FALLBACK_WIDTH`/`FALLBACK_HEIGHT` constants.

### useGridMovement Hook

Replaces `useKeyboardMovement`. Maps WASD and arrow keys to `GridDirection` values ('n', 's', 'e', 'w'). Sends `grid_move` messages with a 150ms client-side cooldown to prevent key-repeat spam.

The existing `useKeyboardMovement` hook is deleted.

### Compass

The compass component currently sends `move` messages for room transitions. Since room transitions are now handled by walking onto exit tiles, the compass becomes a display-only element (shows which exits exist). Its click handlers are removed.

---

## 8. What Doesn't Change

- **Combat system** — abstract, no positional mechanics. CombatManager unchanged.
- **Loot system** — unchanged.
- **Interactable system** — interactables are already positioned on the grid. Players walk to them and click. No mechanical change.
- **MiniMap** — shows room-level navigation, unaffected.
- **ProceduralGenerator** — already generates tile grids (sub-project 4).
- **roomgrid package** — used as-is. No changes to RoomGrid, findPath, Entity types, etc.
