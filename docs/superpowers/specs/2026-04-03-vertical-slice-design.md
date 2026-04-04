# Caverns: Vertical Slice Design Spec

## Goal

Build a playable vertical slice of Caverns: one dungeon floor with 1-2 players, full combat, loot, and a boss encounter. This proves out every core system end-to-end with minimal scope per feature.

---

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Content generation | Static hand-authored JSON | Isolates gameplay dev from API dependency; becomes the fallback content from the design doc |
| WebSocket library | `ws` | Lightweight, full control over message protocol |
| Frontend framework | Vite + React + TypeScript | Fast dev server, standard tooling |
| State management | Zustand | Clean per-panel subscriptions without Context boilerplate |
| Repo structure | Monorepo with `client/`, `server/`, `shared/` | Clean separation, independent deps, shared types |

---

## Project Structure

```
Caverns/
├── client/                  # Vite + React + Zustand
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── store/
│       │   └── gameStore.ts       # Zustand store — all game state from server
│       ├── hooks/
│       │   ├── useWebSocket.ts    # WS connection lifecycle
│       │   └── useGameActions.ts  # Send player actions (move, attack, loot, etc.)
│       ├── components/
│       │   ├── Lobby.tsx          # Create/join game, player list, start button
│       │   ├── TextLog.tsx        # Scrolling narration panel
│       │   ├── MiniMap.tsx        # Node-graph room map with fog of war
│       │   ├── PlayerHUD.tsx      # HP, equipment, consumables, status
│       │   ├── PartyPanel.tsx     # Other players' status bars
│       │   └── ActionBar.tsx      # Context-sensitive actions (move/combat)
│       └── styles/
│           └── index.css
├── server/                  # Node.js + ws
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               # HTTP + WS server, connection handling
│       ├── Lobby.ts               # Pre-game lobby management
│       ├── GameSession.ts         # One game run: state machine, room graph, player tracking
│       ├── CombatManager.ts       # Turn-based combat: initiative, actions, resolution
│       ├── LootManager.ts         # Drop resolution, need/greed/pass timer
│       └── PlayerManager.ts       # Player state: HP, inventory, equipment, status
├── shared/                  # Types + protocol
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts               # Core game types (Room, Mob, Item, Player, etc.)
│       ├── messages.ts            # Client<->Server message type definitions
│       └── content.ts             # Static dungeon data (hand-authored JSON)
└── package.json             # Workspace root with scripts
```

---

## Shared Types (`shared/src/types.ts`)

### Room

```typescript
interface Room {
  id: string;
  type: 'tunnel' | 'chamber' | 'cavern' | 'dead_end' | 'boss';
  name: string;
  description: string;
  exits: Partial<Record<'north' | 'south' | 'east' | 'west', string>>; // direction -> room ID
  encounter?: { mobId: string; skullRating: 1 | 2 | 3 };
  loot?: { itemId: string; location: 'chest' | 'floor' | 'hidden' }[];
}
```

### Mob

```typescript
interface Mob {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  hp: number;
  damage: number;
  defense: number;
  initiative: number;
  lootTable: string[]; // item IDs
}
```

### Item

```typescript
interface Item {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  slot: 'weapon' | 'offhand' | 'armor' | 'accessory' | 'consumable';
  stats: {
    damage?: number;
    defense?: number;
    maxHp?: number;
    initiative?: number;
    healAmount?: number; // for consumables
  };
}
```

### Player

```typescript
interface Player {
  id: string;
  name: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: {
    weapon: Item | null;
    offhand: Item | null;
    armor: Item | null;
    accessory: Item | null;
  };
  consumables: (Item | null)[]; // 4-6 slots
  status: 'exploring' | 'in_combat' | 'downed';
  initiative: number; // base + gear modifiers
  damage: number;     // base + weapon
  defense: number;    // base + armor/shield
}
```

---

## Message Protocol (`shared/src/messages.ts`)

### Client -> Server

| Message | Fields | When |
|---------|--------|------|
| `join_lobby` | `playerName` | Player connects |
| `start_game` | — | Host starts the game |
| `move` | `direction: 'north' \| 'south' \| 'east' \| 'west'` | Player moves between rooms |
| `combat_action` | `action: 'attack' \| 'defend' \| 'use_item' \| 'flee'`, `targetId?`, `itemIndex?` | Player's combat turn |
| `loot_choice` | `itemId`, `choice: 'need' \| 'greed' \| 'pass'` | Loot distribution vote |
| `revive` | `targetPlayerId` | Revive a downed player in same room |

### Server -> Client

| Message | Fields | When |
|---------|--------|------|
| `lobby_state` | `players[]`, `hostId` | Lobby updates |
| `game_start` | `initialState` (full game state for this player) | Game begins |
| `room_enter` | `room`, `playerId`, `players_in_room` | A player enters a room |
| `room_reveal` | `room` | Fog of war lift — new room data |
| `combat_start` | `combatState` (participants, turn order) | Combat initiated |
| `combat_turn` | `currentTurnPlayerId \| mobId`, `roundNumber` | Whose turn it is |
| `combat_action_result` | `action`, `result` (damage dealt, HP changes, status) | Action resolved |
| `combat_end` | `result: 'victory' \| 'flee'`, `lootDrops?` | Combat over |
| `loot_prompt` | `items[]`, `timeout` | Need/greed choice |
| `loot_result` | `itemId`, `winnerId` | Who got the item |
| `player_update` | `player` (HP, status, inventory changes) | State change |
| `game_over` | `result: 'victory' \| 'wipe'` | Game ends |
| `text_log` | `message`, `type: 'narration' \| 'combat' \| 'loot' \| 'system'` | Text for the log panel |

---

## Server Architecture

### State Machine

The server manages a per-session state machine:

```
LOBBY -> IN_GAME -> GAME_OVER
```

Within `IN_GAME`, each player independently has a status: `exploring`, `in_combat`, or `downed`.

### GameSession

- Holds the full room graph, mob instances, and loot pool for the run
- Tracks which rooms are revealed (shared fog of war)
- Tracks which rooms have been cleared (mobs defeated)
- Routes player actions to the appropriate manager

### CombatManager

- One CombatManager instance per active combat (per room)
- Manages turn order: `initiative = base + gear + random(1-5)`
- Resolves actions:
  - **Attack**: `damage = attacker.damage - target.defense` (min 1)
  - **Defend**: `defense *= 2` until next turn
  - **Use Item**: apply consumable effect (heal, damage, etc.)
  - **Flee**: exit combat, move to an adjacent room; each enemy gets an opportunity attack (`damage / 2`)
- When a mob dies, remove from combat and queue loot drops
- When all mobs die, end combat with victory
- When a player hits 0 HP, set status to `downed`
- When all players in combat are downed, check if all players globally are downed → wipe
- A player entering a room with active combat joins at the start of the next round

### LootManager

- When loot drops, send `loot_prompt` to all players in the room
- 15-second timer for responses (default to `pass` on timeout)
- Resolution: `need` beats `greed`; ties broken by random roll
- Solo player auto-receives all drops

### PlayerManager

- Manages HP, equipment, consumables
- Computes derived stats from equipment: `damage = baseDamage + weapon.stats.damage`, etc.
- Handles equip/unequip (auto-equip if slot is empty, otherwise hold for manual swap)
- Handles revival: costs one turn action from the reviving player, restores downed player to 50% HP

---

## Client Architecture

### Zustand Store (`gameStore.ts`)

Single store with slices:

```typescript
interface GameStore {
  // Connection
  connectionStatus: 'disconnected' | 'connected' | 'in_lobby' | 'in_game';

  // Lobby
  lobbyPlayers: { id: string; name: string }[];
  isHost: boolean;

  // Game state (updated by server messages)
  playerId: string;
  players: Record<string, Player>;
  rooms: Record<string, Room>;          // only revealed rooms
  currentRoomId: string;
  textLog: { message: string; type: string }[];

  // Combat
  activeCombat: CombatState | null;     // null when not in combat
  isMyTurn: boolean;

  // Loot
  pendingLoot: LootPrompt | null;

  // Game result
  gameOver: { result: 'victory' | 'wipe' } | null;
}
```

All mutations come from server messages processed by a single `handleServerMessage` function that updates the store.

### Components

**Lobby** — Player name input, player list, "Start Game" button (host only). Simple pre-game screen.

**TextLog** — Scrolling div. Receives `text_log` messages and appends them. Color-coded by type (narration = white, combat = red, loot = gold, system = gray). This is the primary gameplay panel.

**MiniMap** — Renders revealed rooms as rectangles/circles connected by lines. Highlights current room. Shows player position dots (color-coded per player). Unexplored exits shown as `?`. Uses SVG or Canvas — SVG is simpler for a node graph.

**PlayerHUD** — Shows own HP bar, equipped items (4 slots), consumable pouch (4-6 slots), status effects. Compact panel.

**PartyPanel** — For each other player: name, HP bar, current room name, status icon (exploring/combat/downed).

**ActionBar** — Context-sensitive:
- **Exploring**: directional buttons for available exits (N/S/E/W), grayed out if no exit in that direction
- **In combat**: Attack (+ target selector), Defend, Use Item (+ item selector), Flee (+ direction selector)
- **Downed**: "Waiting for revival..." (no actions)
- **Loot prompt**: Need / Greed / Pass buttons per item, with countdown timer

### Layout

```
┌─────────────────────────────────────────────┐
│  ┌──────────────────────┐  ┌─────────────┐  │
│  │                      │  │  MiniMap     │  │
│  │     Text Log         │  │             │  │
│  │     (scrolling)      │  ├─────────────┤  │
│  │                      │  │ Party Panel  │  │
│  │                      │  │             │  │
│  ├──────────────────────┤  ├─────────────┤  │
│  │     Action Bar       │  │ Player HUD  │  │
│  └──────────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────┘
```

Text log takes ~65% width. Right sidebar has map, party, and HUD stacked.

---

## Static Content (Vertical Slice Dungeon)

One hand-authored floor with ~10 rooms:

- **Entrance**: Tunnel (empty, starting room)
- **3 Chambers**: Each with a 1-skull mob encounter
- **1 Cavern**: 2-skull elite encounter
- **2 Tunnels**: Connecting passages, one with minor loot
- **2 Dead Ends**: One with a loot chest, one with an ambush (1-skull)
- **1 Boss Room**: 3-skull boss encounter

Theme: "The Dripping Halls" (from the design doc example) — fungal/waterlogged cave.

Mob roster:
- **Fungal Crawler** (1-skull): 25 HP, 8 dmg, 2 def
- **Cave Lurker** (1-skull): 20 HP, 10 dmg, 1 def
- **Sporecap Brute** (2-skull): 60 HP, 14 dmg, 5 def
- **The Mycelium King** (3-skull, boss): 200 HP, 25 dmg, 8 def

Loot pool: ~15 items across all rarities and slots, themed to the dungeon.

Starter loadout per player:
- Rusty Shortsword (weapon, 5 dmg)
- 2x Minor Health Potion (consumable, heals 15 HP)
- Base stats: 50 HP, 0 defense, 5 initiative

---

## Scope Boundaries

### In Scope
- 1 floor, ~10 rooms, 1 boss
- 1-2 player multiplayer via WebSocket
- Real-time exploration with shared fog of war
- Turn-based combat (attack, defend, use item, flee)
- 4 mob types + 1 boss
- Loot with need/greed distribution
- 4 equipment slots + consumable pouch
- Downed/revive, wipe condition, victory condition
- All 5 UI panels (text log, minimap, HUD, party, action bar)

### Out of Scope (Deferred)
- Multi-floor / staircase descent
- Claude API content generation
- Gear-granted active abilities (just stat bonuses for now)
- Interactive events / choice encounters
- Difficulty settings
- Meta-progression
- Mobile/responsive layout
