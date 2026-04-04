# Caverns

Cooperative text-based dungeon crawler for 1-4 players, played in a web browser.

## Project Status

**Milestone: Vertical Slice** — One dungeon floor ("The Dripping Halls"), 1-4 players, with combat, loot, inventory, and a boss encounter. All core systems are implemented and functional.

### What's Working
- Lobby: join with name, host starts game
- Exploration: move between 10 rooms, shared fog of war, room narration
- Combat: turn-based (initiative ordering), attack/defend/use item/flee, mob AI auto-resolves
- Loot: need/greed/pass distribution (multiplayer), auto-award (solo), items go to inventory
- Inventory: 7 slots, equip/drop from inventory, swaps old equipment back to inventory
- Equipment: weapon/offhand/armor/accessory slots, stats displayed inline
- Consumables: 6 pouch slots, usable in combat (healing potions)
- Boss: The Mycelium King in the final room, victory screen on defeat
- Wipe detection: game over when all players downed
- CRT-styled dark UI with scanlines, vignette, phosphor glow, and flicker

### What's Not Built Yet
- No procedural generation (hand-authored static dungeon)
- No persistence or accounts
- No reconnection handling
- No AI/Claude API integration
- Revive mechanic exists but is lightly tested
- No unit tests for client components

## Architecture

Monorepo with npm workspaces: `shared/`, `server/`, `client/`.

### Tech Stack
- **Server**: Node.js, `ws` library for WebSocket, TypeScript
- **Client**: Vite + React + Zustand, TypeScript
- **Shared**: Types, message protocol, static content
- **Tests**: Vitest (43 tests across 6 files)

### Running

Node.js is installed on Windows, not WSL. Use `node.exe` directly or run from a Windows terminal:

```bash
# From project root (Windows terminal or PowerShell)
npm run dev:server   # starts server on port 3001
npm run dev:client   # starts Vite dev server with WS proxy
```

### Key Design Decisions
- **Player base stats**: 50 HP, 5 damage, 2 defense, 5 initiative (equipment adds to these)
- **Combat scoping**: combat/loot messages use `broadcastToRoom()`, not global broadcast — supports simultaneous combats in different rooms
- **Loot flow**: items go to inventory (not auto-equipped). Players equip manually outside combat. Equipping swaps old gear into the inventory slot.
- **Solo loot**: auto-awarded without showing need/greed/pass prompt
- **Session cleanup**: game session is cleared when all clients disconnect
- **No git commands**: user manages git themselves

## Project Structure

```
shared/src/
  types.ts          — Player, Item, Room, MobTemplate, Equipment, ComputedStats, etc.
  messages.ts       — ClientMessage / ServerMessage union types (full protocol)
  content.ts        — Static dungeon: DRIPPING_HALLS, STARTER_WEAPON, STARTER_POTION
  index.ts          — Re-exports all shared modules
  *.test.ts         — Type and content integrity tests

server/src/
  index.ts          — HTTP + WebSocket server, message routing
  Lobby.ts          — Pre-game lobby, host assignment
  GameSession.ts    — Central orchestrator: rooms, movement, combat triggers, loot drops
  PlayerManager.ts  — Player state: HP, equipment, inventory, consumables, status
  CombatManager.ts  — Turn-based combat: initiative, actions, mob AI, victory/wipe detection
  LootManager.ts    — Need/greed/pass with 15s timeout, auto-award for solo
  *.test.ts         — Unit tests for each manager

client/src/
  App.tsx           — Route between lobby, game, game-over screens
  store/gameStore.ts — Zustand store, handleServerMessage dispatches all 14 message types
  hooks/
    useWebSocket.ts   — Connection lifecycle, dispatches to store
    useGameActions.ts — Typed action senders (move, attack, lootChoice, equipItem, etc.)
  components/
    Lobby.tsx         — Name input, player list, host start button
    TextLog.tsx       — Auto-scrolling log with color-coded entries
    ActionBar.tsx     — Context-sensitive: exploration/combat/loot/downed modes
    MiniMap.tsx       — SVG node-graph with BFS layout, fog of war
    PlayerHUD.tsx     — HP bar, equipment (with stats), consumables, inventory with equip/drop
    PartyPanel.tsx    — Other players' status and HP
  styles/index.css  — CRT-themed dark UI

docs/superpowers/
  specs/2026-04-03-vertical-slice-design.md  — Full design spec
  plans/2026-04-03-vertical-slice.md         — 14-task implementation plan
```

## Message Protocol

### Client → Server
`join_lobby`, `start_game`, `move`, `combat_action`, `loot_choice`, `revive`, `equip_item`, `drop_item`

### Server → Client
`lobby_state`, `game_start`, `room_reveal`, `player_moved`, `combat_start`, `combat_turn`, `combat_action_result`, `combat_end`, `loot_prompt`, `loot_result`, `player_update`, `game_over`, `text_log`, `error`

## Known Issues / Rough Edges
- `combat_end` result uses `'flee'` for actual flee and `'wipe'` for party wipe, but the client doesn't visually distinguish between them (both just clear combat state)
- `handleLootAwarded` uses a type assertion (`as any`) when spreading combat action results
- Initiative has a random component (`Math.random() * 5`), so turn order varies between rounds
- Loot drops are partially random (one random item from mob loot table + all room loot)
