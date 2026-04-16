# Arena Combat Design

Replaces the text-based combat screen with a turn-based tactics RPG arena. Players and mobs move on an ASCII grid, take positional actions, and fight spatially.

## Goals

- Combat feels like part of the game world, not a separate screen
- Positioning and movement create tactical decisions
- Leverages existing room generation, combat math, and CRT aesthetic
- Ships as a playable core loop (move, melee attack, defend, items, flee) with hooks for future depth (ranged, abilities, zone effects)

## Architecture: Spatial Wrapper

`ArenaCombatManager` wraps the existing `CombatManager`. The wrapper owns grid state (positions, movement, pathfinding, adjacency checks) and delegates damage resolution to `CombatManager`. This preserves all existing combat math — item effects, buffs, death prevention, cleave, vampiric, siphon armor, etc. — while adding spatial logic cleanly.

Long-term, the two layers can be folded into a single rewritten CombatManager once the spatial system is proven and QTEs are removed.

## Arena Generation

Arenas are generated using the existing `roomgrid` system (`generateRoom()`).

- **Dimensions match the room type** — tunnels get narrow arenas, caverns get wide open ones, boss rooms get large arenas. Same dimension table as exploration grids (e.g. tunnel: 30×8, chamber: 30×15, cavern: 40×18, boss: 45×20).
- **Biome config** from the current dungeon is passed through, so arenas get the same terrain variety (walls, water, chasms, hazards, pillars) and theming as exploration.
- **No exits** are generated — the arena is sealed. Edge tiles serve as flee points.
- **Validation** uses the existing retry/connectivity logic to ensure a playable arena.

### Starting Positions

- Players are placed on walkable floor tiles within the first 3 columns of the arena, picked randomly from available positions.
- Mobs are placed on walkable floor tiles within the last 3 columns.
- Positions must not overlap.

## Combat Trigger Flow

1. Player enters a room with mobs (same trigger as current system).
2. Server generates an arena `TileGrid` using the room's type and dungeon biome.
3. Server assigns starting positions for all combatants.
4. Server creates `ArenaCombatManager` (which internally creates a `CombatManager`).
5. Server sends `arena_combat_start` to all players in the room.
6. Client plays a transition effect (screen flash) and swaps to `ArenaView`.

## Movement

### Movement Points

Each combatant gets movement points per turn: `Math.floor(initiative / 2) + 2`. This gives a range of roughly 3–5 tiles for most units. Initiative already exists on gear and class base stats, so it now serves double duty (turn order + mobility).

### Movement Rules

- **4-directional** movement only (no diagonal). Keeps distance counting simple.
- Floor tiles cost **1 movement point**.
- Water tiles cost **2 movement points**.
- Walls and chasms are **impassable**.
- Hazard tiles are walkable but deal **5 damage on entry** (existing `TILE_PROPERTIES`).
- **Can't move through occupied tiles** (players or mobs).
- Movement range is displayed as highlighted tiles using BFS flood fill from the unit's position.

### Turn Structure

- On your turn you get movement + one action, **in any order**.
- **Move-act-move** is allowed (move partway, take action, move remaining points).
- Unused movement is forfeited at end of turn.
- An **End Turn** button allows passing without acting.

### Pathfinding

BFS on the grid. Arena sizes are small enough that A* is unnecessary. When a player clicks a tile in their movement range, client sends `arena_move` with target `{x, y}`. Server validates the path exists within remaining movement points, updates position, and broadcasts.

## Combat Actions

### Attack (Melee)

Click Attack, then click an adjacent enemy (4-directional adjacency). Server validates adjacency, then delegates to `CombatManager.resolvePlayerAction()`. All existing damage math applies unchanged.

### Defend

No spatial requirement. Click Defend, turn ends. Defense bonus applies until next turn. Same behavior as current system.

### Use Item

Click Items, pick a consumable. Healing items are self-targeted (immediate). Damage items require adjacency (same as melee). Future work can add ranged/AoE item targeting.

### Flee

Must be standing on an **edge tile** — defined as any walkable floor tile that has at least one orthogonally adjacent wall tile on the arena border. Click Flee, opportunity damage is calculated from all alive mobs (same formula: `mob.damage / fleeDamageDivisor`). Player is removed from the arena.

### End Turn

Explicitly pass remaining movement and action.

## Mob AI

### Simple Chase (Initial Implementation)

On a mob's turn:

1. Pick target — taunted player if one exists, otherwise the **nearest player by pathfinding distance** (not Euclidean, so walls matter).
2. Pathfind toward target using BFS.
3. Move as many tiles as movement points allow along the path.
4. If adjacent to target after moving, attack (using `CombatManager.resolveMobTurn()`).
5. If can't reach anyone, move as close as possible and end turn.

### Future AI Hook

Mob templates can later gain an `aiType` field (`melee_chase`, `ranged_kite`, `brute_aggro`) for role-based behavior. The strategy pattern slots into the mob turn resolution. For this build, all mobs use `melee_chase`.

### Mob Turn Visualization

Client receives position updates and action results for mob turns. Mob movement is shown tile-by-tile with a short animation delay (~100–150ms per tile) so the player can track where mobs went before attacks resolve.

## Message Protocol

### New Messages (Client → Server)

| Message | Payload | Description |
|---------|---------|-------------|
| `arena_move` | `{ targetX, targetY }` | Request to move to a tile |
| `arena_end_turn` | `{}` | Pass remaining movement/action |

### Modified Messages

| Message | Change |
|---------|--------|
| `combat_action` (attack) | Server validates adjacency before resolving |

### New Messages (Server → Client)

| Message | Payload | Description |
|---------|---------|-------------|
| `arena_combat_start` | `{ tileGrid, positions, combatState }` | Replaces `combat_start` for arena combat |
| `arena_positions_update` | `{ positions, movementRemaining }` | Broadcast after any movement |

### Unchanged Messages

`combat_action_result`, `combat_end`, `combat_turn`, `text_log`, `loot_prompt`, `loot_result`, `player_update` — all unchanged.

## Client Components

### New Components

- **`ArenaView`** — top-level combat view, replaces `CombatView` when arena combat is active
- **`ArenaGrid`** — wraps `TileGridView` with CSS grid overlay borders, click handlers for movement/targeting, and highlighted movement range
- **`ArenaActionBar`** — Move / Attack / Defend / Items / Flee / End Turn buttons, movement point counter
- **`TurnOrderBar`** — horizontal bar showing initiative sequence with active unit highlighted
- **`ArenaUnitPanel`** — right sidebar with party and enemy HP bars, class info, skull ratings

### UI Layout

```
┌─────────────────────────────────────────────┐
│ Turn Order: ► Aldric → Goblin → Brynn → ... │
├──────────────────────────────┬──────────────┤
│                              │ Party        │
│                              │  Aldric 42/50│
│      ASCII Arena Grid        │  Brynn  30/50│
│    (with grid cell borders)  │              │
│                              │ Enemies      │
│                              │  Goblin  8/20│
│                              │  Spider 18/30│
├──────────────────────────────┴──────────────┤
│ [Move] [Attack] [Defend] [Items] [Flee]     │
├─────────────────────────────────────────────┤
│ Combat log (last 3 messages)                │
└─────────────────────────────────────────────┘
```

### Store Changes

`gameStore` gains: `arenaGrid` (TileGrid | null), `arenaPositions` (Record<string, {x,y}>), `arenaMovementRemaining` (number), `arenaActionTaken` (boolean). `handleServerMessage` gets handlers for `arena_combat_start` and `arena_positions_update`.

## Server Architecture

### ArenaCombatManager

New class in `server/src/ArenaCombatManager.ts`. Responsibilities:

- Owns the arena `TileGrid` and combatant positions
- Validates movement (BFS pathfinding, movement point costs, tile walkability, occupancy)
- Validates attack adjacency
- Delegates damage resolution to the wrapped `CombatManager`
- Runs mob AI (pathfind + chase)
- Generates starting positions
- Exposes arena state for `arena_combat_start` message

### GameSession Integration

`GameSession.startCombat()` changes to:
1. Generate arena grid via `buildTileGrid()` (or a variant without exits)
2. Create `ArenaCombatManager` with the grid, players, and mobs
3. Send `arena_combat_start` instead of `combat_start`
4. Route `arena_move` and `arena_end_turn` messages to the arena manager

## Deferred Features

These are explicitly out of scope for this build, but the spatial system supports adding them later:

- **Class abilities** (energy system, targeted/AoE abilities)
- **Activated item effects** (overcharge, rally, revive_once)
- **QTEs** (attack crit, defense reduction) — planned for removal
- **Ranged attacks and zone targeting**
- **Role-based mob AI** (ranged kiting, brute aggro)
- **Buff/debuff spatial interactions** (taunt radius, aura effects)
- **Terrain effects** beyond movement cost (cover bonuses, elevation)

## Rendering

Arena uses the existing `TileGridView` component with additions:

- **CSS grid overlay** — subtle cell borders on every tile for tactical readability
- **Movement range highlighting** — BFS flood fill from active unit, highlighted in green
- **Entity rendering** — players as `@` (blue), mobs as first letter of name (red), using the existing `EntityOverlay` system
- **Mob animation** — tile-by-tile movement with ~100–150ms delay per step
- **Biome theming** — same tile themes as exploration (fungal, crystal, volcanic, etc.)
