# Caverns Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable one-floor co-op dungeon crawler with real-time exploration, turn-based combat, loot distribution, and a boss encounter for 1-2 players.

**Architecture:** Monorepo with three packages — `shared/` (types + static content), `server/` (Node.js + ws authoritative game server), `client/` (Vite + React + Zustand). The server owns all game state; clients send actions and render state updates received via WebSocket.

**Tech Stack:** TypeScript, React, Vite, Zustand, ws, vitest

---

## File Map

### `shared/`
| File | Responsibility |
|------|---------------|
| `shared/package.json` | Package config, exports |
| `shared/tsconfig.json` | TypeScript config |
| `shared/src/types.ts` | Core game types: Room, Mob, Item, Player, Direction, Equipment, etc. |
| `shared/src/messages.ts` | Client→Server and Server→Client message type unions |
| `shared/src/content.ts` | Static "Dripping Halls" dungeon data: rooms, mobs, items, boss |

### `server/`
| File | Responsibility |
|------|---------------|
| `server/package.json` | Package config, scripts, deps (ws, vitest) |
| `server/tsconfig.json` | TypeScript config |
| `server/src/index.ts` | HTTP server, WebSocket upgrade, connection routing |
| `server/src/Lobby.ts` | Pre-game lobby: join, leave, start game |
| `server/src/GameSession.ts` | Game run state machine: room graph, fog of war, player movement, action routing |
| `server/src/CombatManager.ts` | Turn-based combat: initiative, action resolution, victory/wipe detection |
| `server/src/LootManager.ts` | Loot drops, need/greed/pass voting, distribution |
| `server/src/PlayerManager.ts` | Player state: HP, equipment, consumables, derived stats, revival |

### `client/`
| File | Responsibility |
|------|---------------|
| `client/package.json` | Package config, deps (react, zustand, vite) |
| `client/tsconfig.json` | TypeScript config |
| `client/vite.config.ts` | Vite config with WebSocket proxy |
| `client/index.html` | HTML entry point |
| `client/src/main.tsx` | React root mount |
| `client/src/App.tsx` | Top-level layout: lobby vs game screen routing |
| `client/src/store/gameStore.ts` | Zustand store: all game state + server message handler |
| `client/src/hooks/useWebSocket.ts` | WebSocket connection lifecycle, message dispatch to store |
| `client/src/hooks/useGameActions.ts` | Helper hook: sends typed actions over WebSocket |
| `client/src/components/Lobby.tsx` | Name input, player list, start button |
| `client/src/components/TextLog.tsx` | Scrolling narration/combat/loot log |
| `client/src/components/MiniMap.tsx` | SVG node-graph map with fog of war |
| `client/src/components/PlayerHUD.tsx` | HP bar, equipment slots, consumables |
| `client/src/components/PartyPanel.tsx` | Other players' status |
| `client/src/components/ActionBar.tsx` | Context-sensitive action buttons |
| `client/src/styles/index.css` | Global styles |

### Root
| File | Responsibility |
|------|---------------|
| `package.json` | Workspace root with npm workspaces + convenience scripts |
| `tsconfig.json` | Base TypeScript config (already exists, will update) |

---

## Task 1: Workspace and Package Scaffolding

**Files:**
- Modify: `package.json` (root)
- Modify: `tsconfig.json` (root)
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`

- [ ] **Step 1: Update root `package.json` for npm workspaces**

```json
{
  "name": "caverns",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev:server": "npm run dev --workspace=server",
    "dev:client": "npm run dev --workspace=client",
    "build": "npm run build --workspace=shared && npm run build --workspace=server && npm run build --workspace=client",
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Update root `tsconfig.json` as a base config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create `shared/package.json`**

```json
{
  "name": "@caverns/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.3",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 4: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `server/package.json`**

```json
{
  "name": "@caverns/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@caverns/shared": "*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "tsx": "^4.19.0",
    "typescript": "^5.5.3",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 6: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ES2022",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `client/package.json`**

```json
{
  "name": "@caverns/client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@caverns/shared": "*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zustand": "^5.0.5"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.1",
    "typescript": "^5.5.3",
    "vite": "^6.3.1",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 8: Create `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "module": "ES2022",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Create `client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 10: Create `client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Caverns</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11: Create placeholder entry files**

Create `shared/src/index.ts`:
```typescript
export * from './types.js';
export * from './messages.js';
export * from './content.js';
```

Create `client/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `client/src/App.tsx`:
```tsx
export function App() {
  return <div>Caverns</div>;
}
```

Create `client/src/styles/index.css`:
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: 'Courier New', monospace;
}
```

Delete `src/index.ts` (old placeholder).

- [ ] **Step 12: Install dependencies**

Run: `npm install`

- [ ] **Step 13: Verify client dev server starts**

Run: `npm run dev:client`
Expected: Vite dev server starts on localhost:5173, page shows "Caverns".

- [ ] **Step 14: Commit**

```
feat: scaffold monorepo with shared, server, and client packages
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/src/types.ts`
- Test: `shared/src/types.test.ts`

- [ ] **Step 1: Write test for player stat computation helper**

Create `shared/src/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computePlayerStats, createPlayer } from './types.js';

describe('computePlayerStats', () => {
  it('returns base stats with no equipment', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(0);
    expect(stats.defense).toBe(0);
    expect(stats.maxHp).toBe(50);
    expect(stats.initiative).toBe(5);
  });

  it('adds weapon damage', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1',
      name: 'Sword',
      description: '',
      rarity: 'common',
      slot: 'weapon',
      stats: { damage: 10 },
    };
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(10);
  });

  it('sums stats from all equipment slots', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1', name: 'Sword', description: '', rarity: 'common',
      slot: 'weapon', stats: { damage: 10 },
    };
    player.equipment.armor = {
      id: 'a1', name: 'Plate', description: '', rarity: 'uncommon',
      slot: 'armor', stats: { defense: 5, maxHp: 10 },
    };
    player.equipment.accessory = {
      id: 'ac1', name: 'Ring', description: '', rarity: 'rare',
      slot: 'accessory', stats: { initiative: 3 },
    };
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(10);
    expect(stats.defense).toBe(5);
    expect(stats.maxHp).toBe(60);
    expect(stats.initiative).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared && npx vitest run src/types.test.ts`
Expected: FAIL — `computePlayerStats` and `createPlayer` not found.

- [ ] **Step 3: Implement `shared/src/types.ts`**

```typescript
// === Directions ===

export type Direction = 'north' | 'south' | 'east' | 'west';

// === Items ===

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type EquipmentSlot = 'weapon' | 'offhand' | 'armor' | 'accessory';
export type ItemSlot = EquipmentSlot | 'consumable';

export interface ItemStats {
  damage?: number;
  defense?: number;
  maxHp?: number;
  initiative?: number;
  healAmount?: number;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  slot: ItemSlot;
  stats: ItemStats;
}

// === Rooms ===

export type RoomType = 'tunnel' | 'chamber' | 'cavern' | 'dead_end' | 'boss';

export interface RoomEncounter {
  mobId: string;
  skullRating: 1 | 2 | 3;
}

export interface RoomLoot {
  itemId: string;
  location: 'chest' | 'floor' | 'hidden';
}

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  encounter?: RoomEncounter;
  loot?: RoomLoot[];
}

// === Mobs ===

export interface MobTemplate {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  lootTable: string[];
}

export interface MobInstance {
  instanceId: string;
  templateId: string;
  name: string;
  maxHp: number;
  hp: number;
  damage: number;
  defense: number;
  initiative: number;
}

// === Players ===

export type PlayerStatus = 'exploring' | 'in_combat' | 'downed';

export interface Equipment {
  weapon: Item | null;
  offhand: Item | null;
  armor: Item | null;
  accessory: Item | null;
}

export const CONSUMABLE_SLOTS = 6;

export interface Player {
  id: string;
  name: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: Equipment;
  consumables: (Item | null)[];
  status: PlayerStatus;
}

export const BASE_STATS = {
  maxHp: 50,
  damage: 0,
  defense: 0,
  initiative: 5,
};

export interface ComputedStats {
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
}

export function computePlayerStats(player: Player): ComputedStats {
  const stats: ComputedStats = { ...BASE_STATS };
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (!item) continue;
    stats.damage += item.stats.damage ?? 0;
    stats.defense += item.stats.defense ?? 0;
    stats.maxHp += item.stats.maxHp ?? 0;
    stats.initiative += item.stats.initiative ?? 0;
  }
  return stats;
}

export function createPlayer(id: string, name: string, roomId: string): Player {
  return {
    id,
    name,
    maxHp: BASE_STATS.maxHp,
    hp: BASE_STATS.maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    status: 'exploring',
  };
}

// === Combat State (shared for client rendering) ===

export interface CombatParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
}

export interface CombatState {
  roomId: string;
  participants: CombatParticipant[];
  turnOrder: string[]; // participant IDs
  currentTurnId: string;
  roundNumber: number;
}

// === Loot ===

export interface LootPrompt {
  items: Item[];
  timeout: number;
  roomId: string;
}

// === Dungeon Content ===

export interface DungeonContent {
  name: string;
  theme: string;
  atmosphere: string;
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];
  bossId: string;
  entranceRoomId: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared && npx vitest run src/types.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```
feat: add shared game types with player stat computation
```

---

## Task 3: Shared Message Protocol

**Files:**
- Create: `shared/src/messages.ts`

- [ ] **Step 1: Implement `shared/src/messages.ts`**

```typescript
import type {
  Direction,
  Player,
  Room,
  Item,
  CombatState,
  CombatParticipant,
} from './types.js';

// === Client -> Server ===

export interface JoinLobbyMessage {
  type: 'join_lobby';
  playerName: string;
}

export interface StartGameMessage {
  type: 'start_game';
}

export interface MoveMessage {
  type: 'move';
  direction: Direction;
}

export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
}

export interface LootChoiceMessage {
  type: 'loot_choice';
  itemId: string;
  choice: 'need' | 'greed' | 'pass';
}

export interface ReviveMessage {
  type: 'revive';
  targetPlayerId: string;
}

export type ClientMessage =
  | JoinLobbyMessage
  | StartGameMessage
  | MoveMessage
  | CombatActionMessage
  | LootChoiceMessage
  | ReviveMessage;

// === Server -> Client ===

export interface LobbyStateMessage {
  type: 'lobby_state';
  players: { id: string; name: string }[];
  hostId: string;
  yourId: string;
}

export interface GameStartMessage {
  type: 'game_start';
  playerId: string;
  players: Record<string, Player>;
  rooms: Record<string, Room>;
  currentRoomId: string;
}

export interface RoomRevealMessage {
  type: 'room_reveal';
  room: Room;
}

export interface PlayerMovedMessage {
  type: 'player_moved';
  playerId: string;
  roomId: string;
}

export interface CombatStartMessage {
  type: 'combat_start';
  combat: CombatState;
}

export interface CombatTurnMessage {
  type: 'combat_turn';
  currentTurnId: string;
  roundNumber: number;
}

export interface CombatActionResultMessage {
  type: 'combat_action_result';
  actorId: string;
  actorName: string;
  action: 'attack' | 'defend' | 'use_item' | 'flee';
  targetId?: string;
  targetName?: string;
  damage?: number;
  healing?: number;
  actorHp?: number;
  targetHp?: number;
  targetMaxHp?: number;
  actorDowned?: boolean;
  targetDowned?: boolean;
  fled?: boolean;
  fleeDirection?: Direction;
}

export interface CombatEndMessage {
  type: 'combat_end';
  result: 'victory' | 'flee';
}

export interface LootPromptMessage {
  type: 'loot_prompt';
  items: Item[];
  timeout: number;
}

export interface LootResultMessage {
  type: 'loot_result';
  itemId: string;
  itemName: string;
  winnerId: string;
  winnerName: string;
}

export interface PlayerUpdateMessage {
  type: 'player_update';
  player: Player;
}

export interface GameOverMessage {
  type: 'game_over';
  result: 'victory' | 'wipe';
}

export interface TextLogMessage {
  type: 'text_log';
  message: string;
  logType: 'narration' | 'combat' | 'loot' | 'system';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | LobbyStateMessage
  | GameStartMessage
  | RoomRevealMessage
  | PlayerMovedMessage
  | CombatStartMessage
  | CombatTurnMessage
  | CombatActionResultMessage
  | CombatEndMessage
  | LootPromptMessage
  | LootResultMessage
  | PlayerUpdateMessage
  | GameOverMessage
  | TextLogMessage
  | ErrorMessage;
```

- [ ] **Step 2: Verify shared package compiles**

Run: `cd shared && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```
feat: add client-server message protocol types
```

---

## Task 4: Static Dungeon Content

**Files:**
- Create: `shared/src/content.ts`
- Test: `shared/src/content.test.ts`

- [ ] **Step 1: Write test for content integrity**

Create `shared/src/content.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { DRIPPING_HALLS } from './content.js';

describe('Dripping Halls dungeon content', () => {
  it('has an entrance room', () => {
    const entrance = DRIPPING_HALLS.rooms.find(
      (r) => r.id === DRIPPING_HALLS.entranceRoomId
    );
    expect(entrance).toBeDefined();
  });

  it('has a boss room with the boss mob', () => {
    const bossRoom = DRIPPING_HALLS.rooms.find((r) => r.type === 'boss');
    expect(bossRoom).toBeDefined();
    expect(bossRoom!.encounter?.mobId).toBe(DRIPPING_HALLS.bossId);
  });

  it('all room exits reference valid room IDs', () => {
    const roomIds = new Set(DRIPPING_HALLS.rooms.map((r) => r.id));
    for (const room of DRIPPING_HALLS.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        expect(roomIds.has(targetId!), `Room ${room.id} exit ${dir} -> ${targetId} is invalid`).toBe(true);
      }
    }
  });

  it('all encounter mobIds reference valid mob templates', () => {
    const mobIds = new Set(DRIPPING_HALLS.mobs.map((m) => m.id));
    for (const room of DRIPPING_HALLS.rooms) {
      if (room.encounter) {
        expect(mobIds.has(room.encounter.mobId), `Room ${room.id} references unknown mob ${room.encounter.mobId}`).toBe(true);
      }
    }
  });

  it('all room loot itemIds reference valid items', () => {
    const itemIds = new Set(DRIPPING_HALLS.items.map((i) => i.id));
    for (const room of DRIPPING_HALLS.rooms) {
      if (room.loot) {
        for (const loot of room.loot) {
          expect(itemIds.has(loot.itemId), `Room ${room.id} references unknown item ${loot.itemId}`).toBe(true);
        }
      }
    }
  });

  it('all mob loot tables reference valid items', () => {
    const itemIds = new Set(DRIPPING_HALLS.items.map((i) => i.id));
    for (const mob of DRIPPING_HALLS.mobs) {
      for (const lootId of mob.lootTable) {
        expect(itemIds.has(lootId), `Mob ${mob.id} loot table references unknown item ${lootId}`).toBe(true);
      }
    }
  });

  it('has 10 rooms', () => {
    expect(DRIPPING_HALLS.rooms.length).toBe(10);
  });

  it('has at least 15 items', () => {
    expect(DRIPPING_HALLS.items.length).toBeGreaterThanOrEqual(15);
  });

  it('room exits are bidirectional', () => {
    const opposites: Record<string, string> = {
      north: 'south', south: 'north', east: 'west', west: 'east',
    };
    for (const room of DRIPPING_HALLS.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        const target = DRIPPING_HALLS.rooms.find((r) => r.id === targetId);
        expect(
          target!.exits[opposites[dir] as keyof typeof target.exits],
          `Room ${room.id} -> ${dir} -> ${targetId} has no return path ${opposites[dir]}`
        ).toBe(room.id);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared && npx vitest run src/content.test.ts`
Expected: FAIL — `DRIPPING_HALLS` not found.

- [ ] **Step 3: Implement `shared/src/content.ts`**

```typescript
import type { DungeonContent } from './types.js';

export const STARTER_WEAPON = {
  id: 'starter_sword',
  name: 'Rusty Shortsword',
  description: 'A dull blade with flecks of rust. Better than bare fists.',
  rarity: 'common' as const,
  slot: 'weapon' as const,
  stats: { damage: 5 },
};

export const STARTER_POTION = {
  id: 'minor_hp_potion',
  name: 'Minor Health Potion',
  description: 'A small vial of red liquid. Restores a bit of health.',
  rarity: 'common' as const,
  slot: 'consumable' as const,
  stats: { healAmount: 15 },
};

export const DRIPPING_HALLS: DungeonContent = {
  name: 'The Dripping Halls',
  theme: 'A waterlogged cave system with bioluminescent fungi and ancient stonework.',
  atmosphere:
    'Water drips constantly. The air is thick and humid. Faint blue-green light pulses from fungal clusters on the walls.',
  entranceRoomId: 'entrance',
  bossId: 'mycelium_king',

  rooms: [
    {
      id: 'entrance',
      type: 'tunnel',
      name: 'Cavern Mouth',
      description:
        'A narrow opening leads into darkness. Water trickles down the moss-covered walls. The air smells of damp earth and something faintly sweet.',
      exits: { north: 'fungal_grotto', east: 'dripping_tunnel' },
    },
    {
      id: 'fungal_grotto',
      type: 'chamber',
      name: 'Fungal Grotto',
      description:
        'A low-ceilinged chamber carpeted in luminous mushrooms. Water pools in the center, reflecting the eerie glow.',
      exits: { south: 'entrance', north: 'spore_den', east: 'crystal_pool' },
      encounter: { mobId: 'fungal_crawler', skullRating: 1 },
      loot: [{ itemId: 'spore_dagger', location: 'floor' }],
    },
    {
      id: 'dripping_tunnel',
      type: 'tunnel',
      name: 'Dripping Tunnel',
      description:
        'Water streams down the walls in thin rivulets. The tunnel slopes gently downward. Glowing lichen marks the path.',
      exits: { west: 'entrance', north: 'crystal_pool', east: 'lurker_den' },
      loot: [{ itemId: 'leather_scraps', location: 'floor' }],
    },
    {
      id: 'crystal_pool',
      type: 'chamber',
      name: 'Crystal Pool',
      description:
        'A wide chamber centered around a still pool. Crystalline formations jut from the walls, refracting the bioluminescent light into rainbows.',
      exits: {
        south: 'dripping_tunnel',
        west: 'fungal_grotto',
        north: 'mushroom_cathedral',
        east: 'hidden_cache',
      },
      encounter: { mobId: 'cave_lurker', skullRating: 1 },
    },
    {
      id: 'spore_den',
      type: 'chamber',
      name: 'Spore Den',
      description:
        'Thick clouds of luminescent spores drift through the air. Massive mushroom caps form a canopy overhead. Something large shuffles in the haze.',
      exits: { south: 'fungal_grotto', east: 'mushroom_cathedral' },
      encounter: { mobId: 'fungal_crawler', skullRating: 1 },
      loot: [{ itemId: 'fungal_shield', location: 'chest' }],
    },
    {
      id: 'lurker_den',
      type: 'dead_end',
      name: "Lurker's Alcove",
      description:
        'A cramped alcove littered with bones and old equipment. Something was nesting here.',
      exits: { west: 'dripping_tunnel' },
      encounter: { mobId: 'cave_lurker', skullRating: 1 },
      loot: [
        { itemId: 'bone_amulet', location: 'hidden' },
        { itemId: 'hp_potion', location: 'floor' },
      ],
    },
    {
      id: 'mushroom_cathedral',
      type: 'cavern',
      name: 'Mushroom Cathedral',
      description:
        'An enormous cavern with towering mushroom stalks reaching up like pillars. The ceiling is lost in darkness above. A deep thrumming vibration fills the space.',
      exits: {
        south: 'crystal_pool',
        west: 'spore_den',
        north: 'throne_antechamber',
      },
      encounter: { mobId: 'sporecap_brute', skullRating: 2 },
      loot: [
        { itemId: 'mycelium_staff', location: 'chest' },
        { itemId: 'chain_vest', location: 'chest' },
      ],
    },
    {
      id: 'hidden_cache',
      type: 'dead_end',
      name: 'Hidden Cache',
      description:
        'Behind a curtain of hanging roots, a small hollow in the rock reveals a forgotten stash. Someone hid supplies here long ago.',
      exits: { west: 'crystal_pool' },
      loot: [
        { itemId: 'glowing_orb', location: 'chest' },
        { itemId: 'elixir', location: 'chest' },
        { itemId: 'throwing_spore', location: 'chest' },
      ],
    },
    {
      id: 'throne_antechamber',
      type: 'tunnel',
      name: 'Throne Antechamber',
      description:
        'The fungal growth here is unnervingly organized — mushrooms line the walls in symmetric rows as if planted deliberately. The air vibrates with a low pulse. A massive archway opens to the north.',
      exits: { south: 'mushroom_cathedral', north: 'boss_room' },
      loot: [{ itemId: 'hp_potion_large', location: 'floor' }],
    },
    {
      id: 'boss_room',
      type: 'boss',
      name: 'Throne of the Mycelium King',
      description:
        'A vast domed chamber pulsing with bioluminescence. At its center, a towering mass of interwoven fungal tendrils shaped vaguely like a seated figure on a throne of living mushroom. Spore clouds billow with each of its movements.',
      exits: { south: 'throne_antechamber' },
      encounter: { mobId: 'mycelium_king', skullRating: 3 },
    },
  ],

  mobs: [
    {
      id: 'fungal_crawler',
      name: 'Fungal Crawler',
      description: 'A dog-sized insect coated in phosphorescent spores.',
      skullRating: 1,
      maxHp: 25,
      damage: 8,
      defense: 2,
      initiative: 4,
      lootTable: ['spore_dagger', 'fungal_wrap'],
    },
    {
      id: 'cave_lurker',
      name: 'Cave Lurker',
      description:
        'A pale, eyeless humanoid that clings to the ceiling and drops on prey.',
      skullRating: 1,
      maxHp: 20,
      damage: 10,
      defense: 1,
      initiative: 6,
      lootTable: ['lurker_fang', 'shadow_cloak'],
    },
    {
      id: 'sporecap_brute',
      name: 'Sporecap Brute',
      description:
        'A hulking fungal creature with a massive mushroom cap for a head. Swings tree-trunk arms with devastating force.',
      skullRating: 2,
      maxHp: 60,
      damage: 14,
      defense: 5,
      initiative: 3,
      lootTable: ['brute_hammer', 'sporecap_plate', 'vitality_ring'],
    },
    {
      id: 'mycelium_king',
      name: 'The Mycelium King',
      description:
        'A towering mass of interwoven fungal tendrils shaped vaguely like a man. Spore clouds billow with each movement.',
      skullRating: 3,
      maxHp: 200,
      damage: 25,
      defense: 8,
      initiative: 5,
      lootTable: ['kings_crown', 'mycelium_blade', 'spore_heart'],
    },
  ],

  items: [
    // === Weapons ===
    {
      id: 'spore_dagger',
      name: 'Spore-Crusted Dagger',
      description: 'A short blade with a faintly glowing fungal growth along the edge.',
      rarity: 'common',
      slot: 'weapon',
      stats: { damage: 8 },
    },
    {
      id: 'lurker_fang',
      name: 'Lurker Fang Blade',
      description: 'A jagged blade fashioned from a Cave Lurker\'s oversized fang.',
      rarity: 'uncommon',
      slot: 'weapon',
      stats: { damage: 12 },
    },
    {
      id: 'brute_hammer',
      name: 'Sporecap War Hammer',
      description: 'A massive hammer made from a petrified mushroom stalk. Slow but devastating.',
      rarity: 'rare',
      slot: 'weapon',
      stats: { damage: 18 },
    },
    {
      id: 'mycelium_staff',
      name: 'Staff of the Deep Mycelium',
      description: 'A twisted staff of living fungal matter. It pulses with a warm, healing light.',
      rarity: 'rare',
      slot: 'weapon',
      stats: { damage: 6, maxHp: 15 },
    },
    {
      id: 'mycelium_blade',
      name: 'Blade of the Mycelium King',
      description: 'A sword formed from the King\'s own tendrils. It writhes in your grip.',
      rarity: 'legendary',
      slot: 'weapon',
      stats: { damage: 22, initiative: 2 },
    },

    // === Offhand ===
    {
      id: 'fungal_shield',
      name: 'Fungal Buckler',
      description: 'A small shield grown from hardened mushroom caps. Surprisingly tough.',
      rarity: 'uncommon',
      slot: 'offhand',
      stats: { defense: 4 },
    },
    {
      id: 'glowing_orb',
      name: 'Bioluminescent Orb',
      description: 'A glass sphere containing living fungi. Pulses with a soothing glow.',
      rarity: 'rare',
      slot: 'offhand',
      stats: { maxHp: 10, initiative: 2 },
    },

    // === Armor ===
    {
      id: 'fungal_wrap',
      name: 'Fungal Fiber Wrap',
      description: 'A crude wrapping of woven fungal fibers. Offers minimal protection.',
      rarity: 'common',
      slot: 'armor',
      stats: { defense: 2 },
    },
    {
      id: 'shadow_cloak',
      name: 'Lurker-Skin Cloak',
      description: 'A cloak made from pale lurker hide. Light and easy to move in.',
      rarity: 'uncommon',
      slot: 'armor',
      stats: { defense: 3, initiative: 2 },
    },
    {
      id: 'chain_vest',
      name: 'Rusted Chain Vest',
      description: 'Ancient chainmail found deep in the caves. Still holds together.',
      rarity: 'uncommon',
      slot: 'armor',
      stats: { defense: 5 },
    },
    {
      id: 'sporecap_plate',
      name: 'Sporecap Plate Armor',
      description: 'Armor crafted from petrified mushroom caps. Heavy but incredibly durable.',
      rarity: 'rare',
      slot: 'armor',
      stats: { defense: 8, maxHp: 10, initiative: -2 },
    },

    // === Accessories ===
    {
      id: 'bone_amulet',
      name: 'Bone Charm Amulet',
      description: 'A necklace of small bones that rattles faintly. You feel tougher wearing it.',
      rarity: 'common',
      slot: 'accessory',
      stats: { maxHp: 10 },
    },
    {
      id: 'vitality_ring',
      name: 'Ring of Vitality',
      description: 'A moss-covered ring that pulses with life energy.',
      rarity: 'rare',
      slot: 'accessory',
      stats: { maxHp: 15, defense: 2 },
    },
    {
      id: 'kings_crown',
      name: 'Crown of the Mycelium King',
      description: 'A living crown of fungal tendrils. It whispers secrets of the deep.',
      rarity: 'legendary',
      slot: 'accessory',
      stats: { maxHp: 20, defense: 3, initiative: 3 },
    },
    {
      id: 'spore_heart',
      name: 'Spore Heart',
      description: 'A pulsing organ from the Mycelium King. Warm to the touch.',
      rarity: 'legendary',
      slot: 'accessory',
      stats: { maxHp: 25, damage: 5 },
    },

    // === Consumables ===
    {
      id: 'leather_scraps',
      name: 'Leather Scrap Bandage',
      description: 'Makeshift bandages from old leather. Not great, but better than bleeding.',
      rarity: 'common',
      slot: 'consumable',
      stats: { healAmount: 10 },
    },
    {
      id: 'hp_potion',
      name: 'Health Potion',
      description: 'A standard healing draught. Tastes like mushroom soup.',
      rarity: 'uncommon',
      slot: 'consumable',
      stats: { healAmount: 25 },
    },
    {
      id: 'hp_potion_large',
      name: 'Greater Health Potion',
      description: 'A large flask of potent healing liquid. Glows faintly.',
      rarity: 'rare',
      slot: 'consumable',
      stats: { healAmount: 40 },
    },
    {
      id: 'elixir',
      name: 'Fungal Elixir',
      description: 'A shimmering elixir distilled from rare bioluminescent fungi.',
      rarity: 'rare',
      slot: 'consumable',
      stats: { healAmount: 50 },
    },
    {
      id: 'throwing_spore',
      name: 'Volatile Spore Pod',
      description: 'A bulging spore pod that explodes on impact. Handle with care.',
      rarity: 'uncommon',
      slot: 'consumable',
      stats: { damage: 20 },
    },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared && npx vitest run src/content.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```
feat: add Dripping Halls static dungeon content
```

---

## Task 5: Server PlayerManager

**Files:**
- Create: `server/src/PlayerManager.ts`
- Test: `server/src/PlayerManager.test.ts`

- [ ] **Step 1: Write failing tests for PlayerManager**

Create `server/src/PlayerManager.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PlayerManager } from './PlayerManager.js';
import { STARTER_WEAPON, STARTER_POTION } from '@caverns/shared';

describe('PlayerManager', () => {
  function createManager() {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'entrance');
    return pm;
  }

  it('creates a player with starter loadout', () => {
    const pm = createManager();
    const p = pm.getPlayer('p1')!;
    expect(p.name).toBe('Alice');
    expect(p.hp).toBe(50);
    expect(p.maxHp).toBe(50);
    expect(p.equipment.weapon?.id).toBe('starter_sword');
    expect(p.consumables.filter((c) => c !== null)).toHaveLength(2);
    expect(p.consumables[0]?.id).toBe('minor_hp_potion');
  });

  it('computes damage from equipped weapon', () => {
    const pm = createManager();
    const stats = pm.getComputedStats('p1');
    expect(stats.damage).toBe(5); // starter sword
  });

  it('equips an item to an empty slot', () => {
    const pm = createManager();
    const shield = {
      id: 's1', name: 'Shield', description: '', rarity: 'common' as const,
      slot: 'offhand' as const, stats: { defense: 3 },
    };
    const replaced = pm.equipItem('p1', shield);
    expect(replaced).toBeNull();
    expect(pm.getPlayer('p1')!.equipment.offhand?.id).toBe('s1');
  });

  it('equips an item and returns the replaced item', () => {
    const pm = createManager();
    const sword = {
      id: 'w2', name: 'Better Sword', description: '', rarity: 'uncommon' as const,
      slot: 'weapon' as const, stats: { damage: 12 },
    };
    const replaced = pm.equipItem('p1', sword);
    expect(replaced?.id).toBe('starter_sword');
    expect(pm.getPlayer('p1')!.equipment.weapon?.id).toBe('w2');
  });

  it('adds a consumable to the first empty slot', () => {
    const pm = createManager();
    const potion = {
      id: 'pot1', name: 'Potion', description: '', rarity: 'common' as const,
      slot: 'consumable' as const, stats: { healAmount: 20 },
    };
    const added = pm.addConsumable('p1', potion);
    expect(added).toBe(true);
    expect(pm.getPlayer('p1')!.consumables[2]?.id).toBe('pot1');
  });

  it('uses a consumable to heal', () => {
    const pm = createManager();
    pm.takeDamage('p1', 30);
    expect(pm.getPlayer('p1')!.hp).toBe(20);
    const result = pm.useConsumable('p1', 0); // minor hp potion
    expect(result).not.toBeNull();
    expect(result!.healing).toBe(15);
    expect(pm.getPlayer('p1')!.hp).toBe(35);
    expect(pm.getPlayer('p1')!.consumables[0]).toBeNull();
  });

  it('does not overheal past maxHp', () => {
    const pm = createManager();
    pm.takeDamage('p1', 5);
    const result = pm.useConsumable('p1', 0); // heals 15 but only 5 missing
    expect(result!.healing).toBe(5);
    expect(pm.getPlayer('p1')!.hp).toBe(50);
  });

  it('downs a player at 0 HP', () => {
    const pm = createManager();
    pm.takeDamage('p1', 999);
    expect(pm.getPlayer('p1')!.hp).toBe(0);
    expect(pm.getPlayer('p1')!.status).toBe('downed');
  });

  it('revives a downed player to 50% HP', () => {
    const pm = createManager();
    pm.takeDamage('p1', 999);
    pm.revivePlayer('p1');
    expect(pm.getPlayer('p1')!.hp).toBe(25);
    expect(pm.getPlayer('p1')!.status).toBe('exploring');
  });

  it('checks if all players are downed', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'entrance');
    pm.addPlayer('p2', 'Bob', 'entrance');
    pm.takeDamage('p1', 999);
    expect(pm.allPlayersDowned()).toBe(false);
    pm.takeDamage('p2', 999);
    expect(pm.allPlayersDowned()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: FAIL — `PlayerManager` not found.

- [ ] **Step 3: Implement `server/src/PlayerManager.ts`**

```typescript
import {
  type Player,
  type Item,
  type ComputedStats,
  type EquipmentSlot,
  createPlayer,
  computePlayerStats,
  STARTER_WEAPON,
  STARTER_POTION,
  CONSUMABLE_SLOTS,
} from '@caverns/shared';

export class PlayerManager {
  private players = new Map<string, Player>();

  addPlayer(id: string, name: string, roomId: string): Player {
    const player = createPlayer(id, name, roomId);
    player.equipment.weapon = { ...STARTER_WEAPON };
    player.consumables[0] = { ...STARTER_POTION };
    player.consumables[1] = { ...STARTER_POTION };
    this.players.set(id, player);
    return player;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getPlayersInRoom(roomId: string): Player[] {
    return this.getAllPlayers().filter((p) => p.roomId === roomId);
  }

  getComputedStats(playerId: string): ComputedStats {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    return computePlayerStats(player);
  }

  movePlayer(playerId: string, roomId: string): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.roomId = roomId;
  }

  equipItem(playerId: string, item: Item): Item | null {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const slot = item.slot as EquipmentSlot;
    const replaced = player.equipment[slot];
    player.equipment[slot] = item;
    return replaced;
  }

  addConsumable(playerId: string, item: Item): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const emptyIndex = player.consumables.indexOf(null);
    if (emptyIndex === -1) return false;
    player.consumables[emptyIndex] = item;
    return true;
  }

  useConsumable(
    playerId: string,
    index: number
  ): { healing?: number; damage?: number } | null {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const item = player.consumables[index];
    if (!item) return null;
    player.consumables[index] = null;

    const result: { healing?: number; damage?: number } = {};
    if (item.stats.healAmount) {
      const missing = player.maxHp - player.hp;
      const healed = Math.min(item.stats.healAmount, missing);
      player.hp += healed;
      result.healing = healed;
    }
    if (item.stats.damage) {
      result.damage = item.stats.damage;
    }
    return result;
  }

  takeDamage(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.hp = Math.max(0, player.hp - amount);
    if (player.hp === 0) {
      player.status = 'downed';
    }
  }

  revivePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.hp = Math.floor(player.maxHp / 2);
    player.status = 'exploring';
  }

  setStatus(playerId: string, status: Player['status']): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.status = status;
  }

  allPlayersDowned(): boolean {
    const players = this.getAllPlayers();
    return players.length > 0 && players.every((p) => p.status === 'downed');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```
feat: implement PlayerManager with equipment, consumables, and combat stats
```

---

## Task 6: Server CombatManager

**Files:**
- Create: `server/src/CombatManager.ts`
- Test: `server/src/CombatManager.test.ts`

- [ ] **Step 1: Write failing tests for CombatManager**

Create `server/src/CombatManager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CombatManager } from './CombatManager.js';
import type { MobInstance, CombatState } from '@caverns/shared';

function makeMob(overrides?: Partial<MobInstance>): MobInstance {
  return {
    instanceId: 'mob1',
    templateId: 'fungal_crawler',
    name: 'Fungal Crawler',
    maxHp: 25,
    hp: 25,
    damage: 8,
    defense: 2,
    initiative: 4,
    ...overrides,
  };
}

describe('CombatManager', () => {
  it('initializes combat with participants and turn order', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 5 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const state = cm.getState();

    expect(state.roomId).toBe('room1');
    expect(state.participants).toHaveLength(2);
    expect(state.turnOrder).toHaveLength(2);
    expect(state.roundNumber).toBe(1);
  });

  it('resolves an attack action', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);

    // Force p1 to go first by giving high initiative
    const result = cm.resolvePlayerAction('p1', {
      action: 'attack',
      targetId: 'mob1',
    });

    expect(result).not.toBeNull();
    expect(result!.action).toBe('attack');
    // damage = attacker.damage - target.defense = 10 - 2 = 8
    expect(result!.damage).toBe(8);
  });

  it('resolves a defend action (doubles defense until next turn)', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);

    cm.resolvePlayerAction('p1', { action: 'defend' });
    // Now mob attacks p1 — p1 defense should be doubled (4 * 2 = 8)
    const mobResult = cm.resolveMobTurn('mob1');
    // mob damage 8 - player defense 8 = min 1
    expect(mobResult!.damage).toBeLessThanOrEqual(8);
  });

  it('kills a mob and marks it dead', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 30, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob({ hp: 5 })];
    const cm = new CombatManager('room1', players, mobs);

    const result = cm.resolvePlayerAction('p1', {
      action: 'attack',
      targetId: 'mob1',
    });
    expect(result!.targetDowned).toBe(true);
    expect(cm.isComplete()).toBe(true);
    expect(cm.getResult()).toBe('victory');
  });

  it('returns flee result and removes player', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 5, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);

    const result = cm.resolvePlayerAction('p1', {
      action: 'flee',
      fleeDirection: 'north',
    });
    expect(result!.fled).toBe(true);
    // Opportunity attack: mob.damage / 2 = 4
    expect(result!.damage).toBe(4);
    expect(cm.isComplete()).toBe(true);
    expect(cm.getResult()).toBe('flee');
  });

  it('adds a player mid-combat', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);

    cm.addPlayer({ id: 'p2', name: 'Bob', hp: 50, maxHp: 50, damage: 8, defense: 1, initiative: 7 });
    const state = cm.getState();
    expect(state.participants).toHaveLength(3);
  });

  it('advances turns correctly', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob({ initiative: 1 })];
    const cm = new CombatManager('room1', players, mobs);

    // p1 has higher initiative, should go first
    expect(cm.getCurrentTurnId()).toBe('p1');
    cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    cm.advanceTurn();

    expect(cm.getCurrentTurnId()).toBe('mob1');
    cm.resolveMobTurn('mob1');
    cm.advanceTurn();

    // New round
    expect(cm.getState().roundNumber).toBe(2);
    expect(cm.getCurrentTurnId()).toBe('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/CombatManager.test.ts`
Expected: FAIL — `CombatManager` not found.

- [ ] **Step 3: Implement `server/src/CombatManager.ts`**

```typescript
import type {
  MobInstance,
  CombatState,
  CombatParticipant,
  CombatActionResultMessage,
  Direction,
} from '@caverns/shared';

export interface CombatPlayerInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
}

interface InternalParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  isDefending: boolean;
  alive: boolean;
}

export class CombatManager {
  private roomId: string;
  private participants: Map<string, InternalParticipant> = new Map();
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private roundNumber = 1;

  constructor(
    roomId: string,
    players: CombatPlayerInfo[],
    mobs: MobInstance[]
  ) {
    this.roomId = roomId;

    for (const p of players) {
      this.participants.set(p.id, {
        id: p.id,
        type: 'player',
        name: p.name,
        hp: p.hp,
        maxHp: p.maxHp,
        damage: p.damage,
        defense: p.defense,
        initiative: p.initiative,
        isDefending: false,
        alive: true,
      });
    }

    for (const m of mobs) {
      this.participants.set(m.instanceId, {
        id: m.instanceId,
        type: 'mob',
        name: m.name,
        hp: m.hp,
        maxHp: m.maxHp,
        damage: m.damage,
        defense: m.defense,
        initiative: m.initiative,
        isDefending: false,
        alive: true,
      });
    }

    this.rollInitiativeOrder();
  }

  private rollInitiativeOrder(): void {
    const alive = Array.from(this.participants.values()).filter((p) => p.alive);
    alive.sort(
      (a, b) =>
        b.initiative + Math.random() * 5 - (a.initiative + Math.random() * 5)
    );
    this.turnOrder = alive.map((p) => p.id);
    this.turnIndex = 0;
  }

  getCurrentTurnId(): string {
    return this.turnOrder[this.turnIndex];
  }

  advanceTurn(): void {
    this.turnIndex++;
    // Skip dead participants
    while (
      this.turnIndex < this.turnOrder.length &&
      !this.participants.get(this.turnOrder[this.turnIndex])?.alive
    ) {
      this.turnIndex++;
    }
    if (this.turnIndex >= this.turnOrder.length) {
      // New round
      this.roundNumber++;
      // Clear defend flags
      for (const p of this.participants.values()) {
        p.isDefending = false;
      }
      this.rollInitiativeOrder();
    }
  }

  addPlayer(player: CombatPlayerInfo): void {
    this.participants.set(player.id, {
      id: player.id,
      type: 'player',
      name: player.name,
      hp: player.hp,
      maxHp: player.maxHp,
      damage: player.damage,
      defense: player.defense,
      initiative: player.initiative,
      isDefending: false,
      alive: true,
    });
    // They'll be included in the next round's initiative roll
  }

  resolvePlayerAction(
    playerId: string,
    action: {
      action: 'attack' | 'defend' | 'use_item' | 'flee';
      targetId?: string;
      itemDamage?: number;
      itemHealing?: number;
      fleeDirection?: Direction;
    }
  ): Partial<CombatActionResultMessage> | null {
    const actor = this.participants.get(playerId);
    if (!actor || !actor.alive) return null;

    switch (action.action) {
      case 'attack': {
        const target = this.participants.get(action.targetId!);
        if (!target || !target.alive) return null;
        const effectiveDefense = target.isDefending
          ? target.defense * 2
          : target.defense;
        const damage = Math.max(1, actor.damage - effectiveDefense);
        target.hp = Math.max(0, target.hp - damage);
        const targetDowned = target.hp === 0;
        if (targetDowned) target.alive = false;
        return {
          actorId: playerId,
          actorName: actor.name,
          action: 'attack',
          targetId: target.id,
          targetName: target.name,
          damage,
          targetHp: target.hp,
          targetMaxHp: target.maxHp,
          targetDowned,
        };
      }

      case 'defend': {
        actor.isDefending = true;
        return {
          actorId: playerId,
          actorName: actor.name,
          action: 'defend',
        };
      }

      case 'use_item': {
        if (action.itemDamage && action.targetId) {
          const target = this.participants.get(action.targetId);
          if (!target || !target.alive) return null;
          target.hp = Math.max(0, target.hp - action.itemDamage);
          const targetDowned = target.hp === 0;
          if (targetDowned) target.alive = false;
          return {
            actorId: playerId,
            actorName: actor.name,
            action: 'use_item',
            targetId: target.id,
            targetName: target.name,
            damage: action.itemDamage,
            targetHp: target.hp,
            targetMaxHp: target.maxHp,
            targetDowned,
          };
        }
        if (action.itemHealing) {
          const healed = Math.min(action.itemHealing, actor.maxHp - actor.hp);
          actor.hp += healed;
          return {
            actorId: playerId,
            actorName: actor.name,
            action: 'use_item',
            healing: healed,
            actorHp: actor.hp,
          };
        }
        return null;
      }

      case 'flee': {
        // Opportunity attacks from all alive mobs
        let totalOpportunityDamage = 0;
        for (const p of this.participants.values()) {
          if (p.type === 'mob' && p.alive) {
            totalOpportunityDamage += Math.floor(p.damage / 2);
          }
        }
        actor.hp = Math.max(0, actor.hp - totalOpportunityDamage);
        actor.alive = false; // removed from combat (not dead — just fled)
        const actorDowned = actor.hp === 0;
        return {
          actorId: playerId,
          actorName: actor.name,
          action: 'flee',
          damage: totalOpportunityDamage,
          actorHp: actor.hp,
          actorDowned,
          fled: true,
          fleeDirection: action.fleeDirection,
        };
      }
    }
  }

  resolveMobTurn(
    mobId: string
  ): Partial<CombatActionResultMessage> | null {
    const mob = this.participants.get(mobId);
    if (!mob || !mob.alive || mob.type !== 'mob') return null;

    // Simple AI: attack a random alive player
    const alivePlayers = Array.from(this.participants.values()).filter(
      (p) => p.type === 'player' && p.alive
    );
    if (alivePlayers.length === 0) return null;

    const target =
      alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const effectiveDefense = target.isDefending
      ? target.defense * 2
      : target.defense;
    const damage = Math.max(1, mob.damage - effectiveDefense);
    target.hp = Math.max(0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;

    return {
      actorId: mobId,
      actorName: mob.name,
      action: 'attack',
      targetId: target.id,
      targetName: target.name,
      damage,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
      targetDowned,
    };
  }

  isComplete(): boolean {
    const aliveMobs = Array.from(this.participants.values()).filter(
      (p) => p.type === 'mob' && p.alive
    );
    const alivePlayers = Array.from(this.participants.values()).filter(
      (p) => p.type === 'player' && p.alive
    );
    return aliveMobs.length === 0 || alivePlayers.length === 0;
  }

  getResult(): 'victory' | 'flee' | 'ongoing' {
    const aliveMobs = Array.from(this.participants.values()).filter(
      (p) => p.type === 'mob' && p.alive
    );
    const alivePlayers = Array.from(this.participants.values()).filter(
      (p) => p.type === 'player' && p.alive
    );
    if (aliveMobs.length === 0 && alivePlayers.length === 0) return 'flee';
    if (aliveMobs.length === 0) return 'victory';
    if (alivePlayers.length === 0) return 'flee';
    return 'ongoing';
  }

  getState(): CombatState {
    const participants: CombatParticipant[] = Array.from(
      this.participants.values()
    )
      .filter((p) => p.alive)
      .map((p) => ({
        id: p.id,
        type: p.type,
        name: p.name,
        hp: p.hp,
        maxHp: p.maxHp,
        initiative: p.initiative,
      }));

    return {
      roomId: this.roomId,
      participants,
      turnOrder: this.turnOrder.filter(
        (id) => this.participants.get(id)?.alive
      ),
      currentTurnId: this.getCurrentTurnId(),
      roundNumber: this.roundNumber,
    };
  }

  getDeadMobIds(): string[] {
    return Array.from(this.participants.values())
      .filter((p) => p.type === 'mob' && !p.alive)
      .map((p) => p.id);
  }

  getAlivePlayers(): string[] {
    return Array.from(this.participants.values())
      .filter((p) => p.type === 'player' && p.alive)
      .map((p) => p.id);
  }

  getPlayerHp(playerId: string): number {
    return this.participants.get(playerId)?.hp ?? 0;
  }

  isPlayerTurn(participantId: string): boolean {
    const p = this.participants.get(participantId);
    return (
      this.getCurrentTurnId() === participantId && p?.type === 'player' && p.alive
    );
  }

  isMobTurn(participantId: string): boolean {
    const p = this.participants.get(participantId);
    return (
      this.getCurrentTurnId() === participantId && p?.type === 'mob' && p.alive
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/CombatManager.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```
feat: implement CombatManager with turn-based combat resolution
```

---

## Task 7: Server LootManager

**Files:**
- Create: `server/src/LootManager.ts`
- Test: `server/src/LootManager.test.ts`

- [ ] **Step 1: Write failing tests for LootManager**

Create `server/src/LootManager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LootManager } from './LootManager.js';
import type { Item } from '@caverns/shared';

const testItem: Item = {
  id: 'item1',
  name: 'Test Sword',
  description: '',
  rarity: 'common',
  slot: 'weapon',
  stats: { damage: 10 },
};

const testItem2: Item = {
  id: 'item2',
  name: 'Test Shield',
  description: '',
  rarity: 'uncommon',
  slot: 'offhand',
  stats: { defense: 5 },
};

describe('LootManager', () => {
  it('auto-awards loot to a solo player', () => {
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem], ['p1']);
    expect(results).toEqual([{ itemId: 'item1', winnerId: 'p1' }]);
  });

  it('need beats greed', () => {
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'greed');
    lm.submitChoice('p2', 'item1', 'need');
    expect(results).toEqual([{ itemId: 'item1', winnerId: 'p2' }]);
  });

  it('resolves ties randomly', () => {
    // Both need — one wins randomly
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    lm.submitChoice('p2', 'item1', 'need');
    expect(results).toHaveLength(1);
    expect(['p1', 'p2']).toContain(results[0].winnerId);
  });

  it('pass from all players means nobody gets the item', () => {
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'pass');
    lm.submitChoice('p2', 'item1', 'pass');
    expect(results).toEqual([]);
  });

  it('handles multiple items in one loot round', () => {
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem, testItem2], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    lm.submitChoice('p2', 'item1', 'pass');
    lm.submitChoice('p1', 'item2', 'pass');
    lm.submitChoice('p2', 'item2', 'need');
    expect(results).toHaveLength(2);
    expect(results).toContainEqual({ itemId: 'item1', winnerId: 'p1' });
    expect(results).toContainEqual({ itemId: 'item2', winnerId: 'p2' });
  });

  it('timeout defaults to pass', () => {
    vi.useFakeTimers();
    const results: { itemId: string; winnerId: string }[] = [];
    const lm = new LootManager((itemId, winnerId) => {
      results.push({ itemId, winnerId });
    });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    // p2 doesn't respond
    vi.advanceTimersByTime(15000);
    expect(results).toEqual([{ itemId: 'item1', winnerId: 'p1' }]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/LootManager.test.ts`
Expected: FAIL — `LootManager` not found.

- [ ] **Step 3: Implement `server/src/LootManager.ts`**

```typescript
import type { Item } from '@caverns/shared';

type LootChoice = 'need' | 'greed' | 'pass';

interface PendingLootRound {
  items: Item[];
  playerIds: string[];
  choices: Map<string, Map<string, LootChoice>>; // itemId -> playerId -> choice
  timer: ReturnType<typeof setTimeout> | null;
}

export class LootManager {
  private pendingRound: PendingLootRound | null = null;
  private onItemAwarded: (itemId: string, winnerId: string) => void;

  constructor(onItemAwarded: (itemId: string, winnerId: string) => void) {
    this.onItemAwarded = onItemAwarded;
  }

  startLootRound(roomId: string, items: Item[], playerIds: string[]): void {
    // Solo player auto-receives all
    if (playerIds.length === 1) {
      for (const item of items) {
        this.onItemAwarded(item.id, playerIds[0]);
      }
      return;
    }

    const choices = new Map<string, Map<string, LootChoice>>();
    for (const item of items) {
      choices.set(item.id, new Map());
    }

    this.pendingRound = {
      items,
      playerIds,
      choices,
      timer: setTimeout(() => this.resolveRound(), 15000),
    };
  }

  submitChoice(playerId: string, itemId: string, choice: LootChoice): void {
    if (!this.pendingRound) return;
    const itemChoices = this.pendingRound.choices.get(itemId);
    if (!itemChoices) return;
    itemChoices.set(playerId, choice);

    // Check if all choices are in for all items
    const allSubmitted = Array.from(this.pendingRound.choices.values()).every(
      (ic) => this.pendingRound!.playerIds.every((pid) => ic.has(pid))
    );
    if (allSubmitted) {
      if (this.pendingRound.timer) clearTimeout(this.pendingRound.timer);
      this.resolveRound();
    }
  }

  private resolveRound(): void {
    if (!this.pendingRound) return;
    const { items, playerIds, choices } = this.pendingRound;
    this.pendingRound = null;

    for (const item of items) {
      const itemChoices = choices.get(item.id)!;
      // Fill missing choices as pass
      for (const pid of playerIds) {
        if (!itemChoices.has(pid)) {
          itemChoices.set(pid, 'pass');
        }
      }

      // Collect need and greed players
      const needPlayers: string[] = [];
      const greedPlayers: string[] = [];
      for (const [pid, choice] of itemChoices) {
        if (choice === 'need') needPlayers.push(pid);
        else if (choice === 'greed') greedPlayers.push(pid);
      }

      // Need beats greed, random tiebreak
      const pool = needPlayers.length > 0 ? needPlayers : greedPlayers;
      if (pool.length > 0) {
        const winner = pool[Math.floor(Math.random() * pool.length)];
        this.onItemAwarded(item.id, winner);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/LootManager.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```
feat: implement LootManager with need/greed/pass distribution
```

---

## Task 8: Server GameSession

**Files:**
- Create: `server/src/GameSession.ts`
- Test: `server/src/GameSession.test.ts`

- [ ] **Step 1: Write failing tests for GameSession**

Create `server/src/GameSession.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { GameSession } from './GameSession.js';

describe('GameSession', () => {
  function createSession() {
    const messages: { playerId: string; msg: any }[] = [];
    const broadcast = (msg: any) => {
      messages.push({ playerId: '__broadcast__', msg });
    };
    const sendTo = (playerId: string, msg: any) => {
      messages.push({ playerId, msg });
    };
    const session = new GameSession(broadcast, sendTo);
    session.addPlayer('p1', 'Alice');
    session.addPlayer('p2', 'Bob');
    session.startGame();
    return { session, messages };
  }

  it('starts game with players in entrance room', () => {
    const { session } = createSession();
    expect(session.getPlayerRoom('p1')).toBe('entrance');
    expect(session.getPlayerRoom('p2')).toBe('entrance');
  });

  it('reveals entrance room on game start', () => {
    const { session } = createSession();
    expect(session.isRoomRevealed('entrance')).toBe(true);
  });

  it('moves a player to an adjacent room', () => {
    const { session, messages } = createSession();
    messages.length = 0; // clear start messages
    session.handleMove('p1', 'north');
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
  });

  it('rejects move to invalid direction', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    session.handleMove('p1', 'west'); // no west exit from entrance
    expect(session.getPlayerRoom('p1')).toBe('entrance');
    const errorMsg = messages.find((m) => m.msg.type === 'error');
    expect(errorMsg).toBeDefined();
  });

  it('reveals new room when a player enters it', () => {
    const { session } = createSession();
    expect(session.isRoomRevealed('fungal_grotto')).toBe(false);
    session.handleMove('p1', 'north');
    expect(session.isRoomRevealed('fungal_grotto')).toBe(true);
  });

  it('triggers combat when entering a room with mobs', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    session.handleMove('p1', 'north'); // fungal_grotto has a fungal_crawler
    const combatStart = messages.find((m) => m.msg.type === 'combat_start');
    expect(combatStart).toBeDefined();
  });

  it('does not trigger combat in a cleared room', () => {
    const { session, messages } = createSession();
    session.handleMove('p1', 'north'); // triggers combat
    // Simulate winning combat by clearing the room
    session.clearRoom('fungal_grotto');
    session.handleMove('p1', 'south'); // back to entrance
    messages.length = 0;
    session.handleMove('p1', 'north'); // re-enter — no combat
    const combatStart = messages.find((m) => m.msg.type === 'combat_start');
    expect(combatStart).toBeUndefined();
  });

  it('prevents movement while in combat', () => {
    const { session, messages } = createSession();
    session.handleMove('p1', 'north'); // triggers combat
    messages.length = 0;
    session.handleMove('p1', 'south'); // should fail — in combat
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
    const errorMsg = messages.find((m) => m.msg.type === 'error');
    expect(errorMsg).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/GameSession.test.ts`
Expected: FAIL — `GameSession` not found.

- [ ] **Step 3: Implement `server/src/GameSession.ts`**

```typescript
import {
  type Room,
  type MobTemplate,
  type MobInstance,
  type Item,
  type Direction,
  type Player,
  type ServerMessage,
  DRIPPING_HALLS,
} from '@caverns/shared';
import { PlayerManager } from './PlayerManager.js';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import { LootManager } from './LootManager.js';

export class GameSession {
  private rooms: Map<string, Room>;
  private mobs: Map<string, MobTemplate>;
  private items: Map<string, Item>;
  private revealedRooms = new Set<string>();
  private clearedRooms = new Set<string>();
  private combats = new Map<string, CombatManager>(); // roomId -> combat
  private playerManager = new PlayerManager();
  private lootManager: LootManager;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;
  private playerIds: string[] = [];
  private playerNames = new Map<string, string>();
  private started = false;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;

    const content = DRIPPING_HALLS;
    this.rooms = new Map(content.rooms.map((r) => [r.id, r]));
    this.mobs = new Map(content.mobs.map((m) => [m.id, m]));
    this.items = new Map(content.items.map((i) => [i.id, i]));

    this.lootManager = new LootManager((itemId, winnerId) => {
      this.handleLootAwarded(itemId, winnerId);
    });
  }

  addPlayer(id: string, name: string): void {
    this.playerIds.push(id);
    this.playerNames.set(id, name);
  }

  startGame(): void {
    this.started = true;
    const entranceId = DRIPPING_HALLS.entranceRoomId;

    for (const pid of this.playerIds) {
      this.playerManager.addPlayer(pid, this.playerNames.get(pid)!, entranceId);
    }

    this.revealedRooms.add(entranceId);
    const entrance = this.rooms.get(entranceId)!;

    const revealedRoomMap: Record<string, Room> = {};
    revealedRoomMap[entranceId] = entrance;

    const playerMap: Record<string, Player> = {};
    for (const p of this.playerManager.getAllPlayers()) {
      playerMap[p.id] = p;
    }

    for (const pid of this.playerIds) {
      this.sendTo(pid, {
        type: 'game_start',
        playerId: pid,
        players: playerMap,
        rooms: revealedRoomMap,
        currentRoomId: entranceId,
      });
    }

    this.broadcast({
      type: 'text_log',
      message: `--- ${entrance.name} ---\n${entrance.description}\n\nExits: ${Object.keys(entrance.exits).join(', ')}`,
      logType: 'narration',
    });
  }

  getPlayerRoom(playerId: string): string | undefined {
    return this.playerManager.getPlayer(playerId)?.roomId;
  }

  isRoomRevealed(roomId: string): boolean {
    return this.revealedRooms.has(roomId);
  }

  clearRoom(roomId: string): void {
    this.clearedRooms.add(roomId);
    this.combats.delete(roomId);
    // Set any players in combat in this room back to exploring
    for (const p of this.playerManager.getPlayersInRoom(roomId)) {
      if (p.status === 'in_combat') {
        this.playerManager.setStatus(p.id, 'exploring');
      }
    }
  }

  handleMove(playerId: string, direction: Direction): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    if (player.status === 'in_combat') {
      this.sendTo(playerId, {
        type: 'error',
        message: 'You cannot move while in combat. Use Flee to escape.',
      });
      return;
    }

    if (player.status === 'downed') {
      this.sendTo(playerId, {
        type: 'error',
        message: 'You are downed and cannot move.',
      });
      return;
    }

    const currentRoom = this.rooms.get(player.roomId);
    if (!currentRoom) return;

    const targetRoomId = currentRoom.exits[direction];
    if (!targetRoomId) {
      this.sendTo(playerId, {
        type: 'error',
        message: `There is no exit to the ${direction}.`,
      });
      return;
    }

    const targetRoom = this.rooms.get(targetRoomId);
    if (!targetRoom) return;

    this.playerManager.movePlayer(playerId, targetRoomId);

    // Reveal room if new
    const isNewRoom = !this.revealedRooms.has(targetRoomId);
    if (isNewRoom) {
      this.revealedRooms.add(targetRoomId);
      this.broadcast({ type: 'room_reveal', room: targetRoom });
    }

    this.broadcast({
      type: 'player_moved',
      playerId,
      roomId: targetRoomId,
    });

    const playersInRoom = this.playerManager.getPlayersInRoom(targetRoomId);

    this.broadcast({
      type: 'text_log',
      message: `${player.name} moves ${direction} to ${targetRoom.name}.`,
      logType: 'system',
    });

    // Send room description to the moving player
    this.sendTo(playerId, {
      type: 'text_log',
      message: `--- ${targetRoom.name} ---\n${targetRoom.description}\n\nExits: ${Object.keys(targetRoom.exits).join(', ')}`,
      logType: 'narration',
    });

    // Check for existing combat in this room
    if (this.combats.has(targetRoomId)) {
      this.joinExistingCombat(playerId, targetRoomId);
      return;
    }

    // Check for encounter in uncleared room
    if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
      this.startCombat(targetRoomId, targetRoom.encounter.mobId);
    }
  }

  private startCombat(roomId: string, mobTemplateId: string): void {
    const template = this.mobs.get(mobTemplateId);
    if (!template) return;

    const mobInstance: MobInstance = {
      instanceId: `${template.id}_${Date.now()}`,
      templateId: template.id,
      name: template.name,
      maxHp: template.maxHp,
      hp: template.maxHp,
      damage: template.damage,
      defense: template.defense,
      initiative: template.initiative,
    };

    const playersInRoom = this.playerManager.getPlayersInRoom(roomId);
    const combatPlayers: CombatPlayerInfo[] = playersInRoom.map((p) => {
      const stats = this.playerManager.getComputedStats(p.id);
      return {
        id: p.id,
        name: p.name,
        hp: p.hp,
        maxHp: stats.maxHp,
        damage: stats.damage,
        defense: stats.defense,
        initiative: stats.initiative,
      };
    });

    for (const p of playersInRoom) {
      this.playerManager.setStatus(p.id, 'in_combat');
    }

    const combat = new CombatManager(roomId, combatPlayers, [mobInstance]);
    this.combats.set(roomId, combat);

    const skulls = '☠'.repeat(template.skullRating);
    this.broadcast({
      type: 'text_log',
      message: `A ${template.name} appears! (${skulls})\n${template.description}`,
      logType: 'combat',
    });

    this.broadcast({ type: 'combat_start', combat: combat.getState() });
    this.broadcastTurnPrompt(combat);
  }

  private joinExistingCombat(playerId: string, roomId: string): void {
    const combat = this.combats.get(roomId);
    if (!combat) return;

    const player = this.playerManager.getPlayer(playerId)!;
    const stats = this.playerManager.getComputedStats(playerId);
    this.playerManager.setStatus(playerId, 'in_combat');

    combat.addPlayer({
      id: playerId,
      name: player.name,
      hp: player.hp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      defense: stats.defense,
      initiative: stats.initiative,
    });

    this.broadcast({
      type: 'text_log',
      message: `${player.name} joins the fight!`,
      logType: 'combat',
    });
    this.broadcast({ type: 'combat_start', combat: combat.getState() });
  }

  handleCombatAction(
    playerId: string,
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
    fleeDirection?: Direction
  ): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;

    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;

    let itemDamage: number | undefined;
    let itemHealing: number | undefined;

    if (action === 'use_item' && itemIndex !== undefined) {
      const consumeResult = this.playerManager.useConsumable(playerId, itemIndex);
      if (!consumeResult) {
        this.sendTo(playerId, { type: 'error', message: 'No item in that slot.' });
        return;
      }
      itemDamage = consumeResult.damage;
      itemHealing = consumeResult.healing;
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    }

    const result = combat.resolvePlayerAction(playerId, {
      action,
      targetId,
      itemDamage,
      itemHealing,
      fleeDirection,
    });

    if (result) {
      this.broadcast({ type: 'combat_action_result', ...result } as any);
      this.narrateCombatAction(result);
    }

    // Sync HP back to PlayerManager
    if (action === 'flee' && result?.fled) {
      this.playerManager.setStatus(playerId, 'exploring');
      if (result.actorDowned) {
        this.playerManager.takeDamage(playerId, 999);
      } else {
        const newHp = combat.getPlayerHp(playerId);
        const player = this.playerManager.getPlayer(playerId)!;
        player.hp = result.actorHp ?? player.hp;
        if (fleeDirection) {
          const currentRoom = this.rooms.get(player.roomId);
          const targetRoomId = currentRoom?.exits[fleeDirection];
          if (targetRoomId) {
            this.playerManager.movePlayer(playerId, targetRoomId);
            this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId });
          }
        }
      }
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    }

    if (result?.targetDowned) {
      const target = this.playerManager.getPlayer(result.targetId!);
      if (target) {
        this.playerManager.takeDamage(result.targetId!, 999);
        this.broadcast({ type: 'player_update', player: target });
      }
    }

    combat.advanceTurn();
    this.afterCombatTurn(player.roomId, combat);
  }

  private afterCombatTurn(roomId: string, combat: CombatManager): void {
    if (combat.isComplete()) {
      const result = combat.getResult();
      this.broadcast({ type: 'combat_end', result });

      if (result === 'victory') {
        this.clearRoom(roomId);
        this.broadcast({
          type: 'text_log',
          message: 'The enemies have been defeated!',
          logType: 'combat',
        });

        // Handle loot drops
        const room = this.rooms.get(roomId);
        this.dropLoot(roomId);

        // Check for boss kill
        if (room?.type === 'boss') {
          this.broadcast({ type: 'game_over', result: 'victory' });
        }
      }

      // Check wipe
      if (this.playerManager.allPlayersDowned()) {
        this.broadcast({ type: 'game_over', result: 'wipe' });
      }
      return;
    }

    // Process mob turns automatically
    const currentId = combat.getCurrentTurnId();
    if (combat.isMobTurn(currentId)) {
      this.processMobTurn(roomId, combat);
    } else {
      this.broadcastTurnPrompt(combat);
    }
  }

  private processMobTurn(roomId: string, combat: CombatManager): void {
    const mobId = combat.getCurrentTurnId();
    const result = combat.resolveMobTurn(mobId);

    if (result) {
      this.broadcast({ type: 'combat_action_result', ...result } as any);
      this.narrateCombatAction(result);

      // Sync damage to PlayerManager
      if (result.targetId && result.damage) {
        const targetPlayer = this.playerManager.getPlayer(result.targetId);
        if (targetPlayer) {
          this.playerManager.takeDamage(result.targetId, result.damage);
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(result.targetId)! });
        }
      }
    }

    combat.advanceTurn();
    this.afterCombatTurn(roomId, combat);
  }

  private broadcastTurnPrompt(combat: CombatManager): void {
    const state = combat.getState();
    this.broadcast({
      type: 'combat_turn',
      currentTurnId: state.currentTurnId,
      roundNumber: state.roundNumber,
    });
  }

  private narrateCombatAction(result: any): void {
    let message = '';
    switch (result.action) {
      case 'attack':
        message = `${result.actorName} attacks ${result.targetName} for ${result.damage} damage!`;
        if (result.targetDowned) message += ` ${result.targetName} goes down!`;
        break;
      case 'defend':
        message = `${result.actorName} takes a defensive stance.`;
        break;
      case 'use_item':
        if (result.healing) {
          message = `${result.actorName} uses an item and heals for ${result.healing} HP.`;
        } else if (result.damage) {
          message = `${result.actorName} uses an item on ${result.targetName} for ${result.damage} damage!`;
        }
        break;
      case 'flee':
        message = `${result.actorName} flees ${result.fleeDirection ?? 'away'}!`;
        if (result.damage) message += ` Takes ${result.damage} opportunity damage!`;
        break;
    }
    if (message) {
      this.broadcast({ type: 'text_log', message, logType: 'combat' });
    }
  }

  private dropLoot(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const droppedItems: Item[] = [];

    // Room loot
    if (room.loot) {
      for (const lootEntry of room.loot) {
        const item = this.items.get(lootEntry.itemId);
        if (item) droppedItems.push(item);
      }
    }

    // Mob loot (pick one random item from each defeated mob's loot table)
    if (room.encounter) {
      const template = this.mobs.get(room.encounter.mobId);
      if (template && template.lootTable.length > 0) {
        const randomId =
          template.lootTable[Math.floor(Math.random() * template.lootTable.length)];
        const item = this.items.get(randomId);
        if (item) droppedItems.push(item);
      }
    }

    if (droppedItems.length === 0) return;

    const playerIds = this.playerManager
      .getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed')
      .map((p) => p.id);

    if (playerIds.length === 0) return;

    for (const item of droppedItems) {
      this.broadcast({
        type: 'text_log',
        message: `[${item.rarity.toUpperCase()}] ${item.name} dropped!`,
        logType: 'loot',
      });
    }

    this.broadcast({
      type: 'loot_prompt',
      items: droppedItems,
      timeout: 15000,
    });

    this.lootManager.startLootRound(roomId, droppedItems, playerIds);
  }

  private handleLootAwarded(itemId: string, winnerId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;

    const winnerName = this.playerManager.getPlayer(winnerId)?.name ?? 'Unknown';

    if (item.slot === 'consumable') {
      this.playerManager.addConsumable(winnerId, { ...item });
    } else {
      const replaced = this.playerManager.equipItem(winnerId, { ...item });
      if (replaced) {
        // Could drop replaced item or discard — for now, discard
      }
    }

    this.broadcast({
      type: 'loot_result',
      itemId: item.id,
      itemName: item.name,
      winnerId,
      winnerName,
    });

    this.broadcast({
      type: 'text_log',
      message: `${winnerName} receives ${item.name}!`,
      logType: 'loot',
    });

    this.broadcast({
      type: 'player_update',
      player: this.playerManager.getPlayer(winnerId)!,
    });
  }

  handleLootChoice(
    playerId: string,
    itemId: string,
    choice: 'need' | 'greed' | 'pass'
  ): void {
    this.lootManager.submitChoice(playerId, itemId, choice);
  }

  handleRevive(playerId: string, targetPlayerId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    const target = this.playerManager.getPlayer(targetPlayerId);
    if (!player || !target) return;
    if (player.roomId !== target.roomId) {
      this.sendTo(playerId, { type: 'error', message: 'Target is not in your room.' });
      return;
    }
    if (target.status !== 'downed') {
      this.sendTo(playerId, { type: 'error', message: 'Target is not downed.' });
      return;
    }

    this.playerManager.revivePlayer(targetPlayerId);
    this.broadcast({
      type: 'text_log',
      message: `${player.name} revives ${target.name}!`,
      logType: 'system',
    });
    this.broadcast({
      type: 'player_update',
      player: this.playerManager.getPlayer(targetPlayerId)!,
    });
  }

  getState() {
    return {
      players: this.playerManager.getAllPlayers(),
      revealedRooms: Array.from(this.revealedRooms),
      clearedRooms: Array.from(this.clearedRooms),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/GameSession.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```
feat: implement GameSession with exploration, combat, and loot integration
```

---

## Task 9: Server WebSocket Entry Point and Lobby

**Files:**
- Create: `server/src/Lobby.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Implement `server/src/Lobby.ts`**

```typescript
import type { ServerMessage } from '@caverns/shared';

interface LobbyPlayer {
  id: string;
  name: string;
}

export class Lobby {
  private players: LobbyPlayer[] = [];
  private hostId: string | null = null;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;
  }

  addPlayer(id: string, name: string): void {
    this.players.push({ id, name });
    if (!this.hostId) this.hostId = id;
    this.broadcastState();
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) {
      this.hostId = this.players[0]?.id ?? null;
    }
    this.broadcastState();
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  getPlayers(): LobbyPlayer[] {
    return this.players;
  }

  private broadcastState(): void {
    for (const p of this.players) {
      this.sendTo(p.id, {
        type: 'lobby_state',
        players: this.players,
        hostId: this.hostId!,
        yourId: p.id,
      });
    }
  }
}
```

- [ ] **Step 2: Implement `server/src/index.ts`**

```typescript
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@caverns/shared';
import { Lobby } from './Lobby.js';
import { GameSession } from './GameSession.js';

const PORT = Number(process.env.PORT) || 3001;

const server = createServer();
const wss = new WebSocketServer({ server });

const clients = new Map<string, WebSocket>();
let nextId = 1;

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function sendTo(playerId: string, msg: ServerMessage): void {
  const ws = clients.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const lobby = new Lobby(broadcast, sendTo);
let gameSession: GameSession | null = null;

wss.on('connection', (ws) => {
  const playerId = `player_${nextId++}`;
  clients.set(playerId, ws);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join_lobby': {
        lobby.addPlayer(playerId, msg.playerName);
        break;
      }

      case 'start_game': {
        if (!lobby.isHost(playerId)) {
          sendTo(playerId, { type: 'error', message: 'Only the host can start the game.' });
          break;
        }
        gameSession = new GameSession(broadcast, sendTo);
        for (const p of lobby.getPlayers()) {
          gameSession.addPlayer(p.id, p.name);
        }
        gameSession.startGame();
        break;
      }

      case 'move': {
        gameSession?.handleMove(playerId, msg.direction);
        break;
      }

      case 'combat_action': {
        gameSession?.handleCombatAction(
          playerId,
          msg.action,
          msg.targetId,
          msg.itemIndex,
          msg.fleeDirection
        );
        break;
      }

      case 'loot_choice': {
        gameSession?.handleLootChoice(playerId, msg.itemId, msg.choice);
        break;
      }

      case 'revive': {
        gameSession?.handleRevive(playerId, msg.targetPlayerId);
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(playerId);
    lobby.removePlayer(playerId);
  });
});

server.listen(PORT, () => {
  console.log(`Caverns server listening on port ${PORT}`);
});
```

- [ ] **Step 3: Verify server compiles and starts**

Run: `cd server && npx tsc --noEmit`
Expected: No errors.

Run: `cd server && npx tsx src/index.ts` (stop after confirming "Caverns server listening on port 3001")

- [ ] **Step 4: Commit**

```
feat: add WebSocket server with lobby and message routing
```

---

## Task 10: Client Zustand Store and WebSocket Hook

**Files:**
- Create: `client/src/store/gameStore.ts`
- Create: `client/src/hooks/useWebSocket.ts`
- Create: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Implement `client/src/store/gameStore.ts`**

```typescript
import { create } from 'zustand';
import type {
  Player,
  Room,
  CombatState,
  Item,
  ServerMessage,
} from '@caverns/shared';

export interface TextLogEntry {
  message: string;
  logType: 'narration' | 'combat' | 'loot' | 'system';
  id: number;
}

let logIdCounter = 0;

export interface GameStore {
  // Connection
  connectionStatus: 'disconnected' | 'connected' | 'in_lobby' | 'in_game';
  setConnectionStatus: (status: GameStore['connectionStatus']) => void;

  // Lobby
  lobbyPlayers: { id: string; name: string }[];
  isHost: boolean;
  playerId: string;

  // Game state
  players: Record<string, Player>;
  rooms: Record<string, Room>;
  currentRoomId: string;
  textLog: TextLogEntry[];

  // Combat
  activeCombat: CombatState | null;
  currentTurnId: string | null;

  // Loot
  pendingLoot: { items: Item[]; timeout: number } | null;

  // Game result
  gameOver: { result: 'victory' | 'wipe' } | null;

  // Actions
  handleServerMessage: (msg: ServerMessage) => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as const,
  lobbyPlayers: [],
  isHost: false,
  playerId: '',
  players: {},
  rooms: {},
  currentRoomId: '',
  textLog: [],
  activeCombat: null,
  currentTurnId: null,
  pendingLoot: null,
  gameOver: null,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  handleServerMessage: (msg: ServerMessage) => {
    switch (msg.type) {
      case 'lobby_state':
        set({
          connectionStatus: 'in_lobby',
          lobbyPlayers: msg.players,
          isHost: msg.hostId === msg.yourId,
          playerId: msg.yourId,
        });
        break;

      case 'game_start':
        set({
          connectionStatus: 'in_game',
          playerId: msg.playerId,
          players: msg.players,
          rooms: msg.rooms,
          currentRoomId: msg.currentRoomId,
          textLog: [],
          activeCombat: null,
          pendingLoot: null,
          gameOver: null,
        });
        break;

      case 'room_reveal':
        set((state) => ({
          rooms: { ...state.rooms, [msg.room.id]: msg.room },
        }));
        break;

      case 'player_moved': {
        const { playerId } = get();
        set((state) => ({
          players: {
            ...state.players,
            [msg.playerId]: {
              ...state.players[msg.playerId],
              roomId: msg.roomId,
            },
          },
          currentRoomId:
            msg.playerId === playerId ? msg.roomId : state.currentRoomId,
        }));
        break;
      }

      case 'combat_start':
        set({ activeCombat: msg.combat, currentTurnId: msg.combat.currentTurnId });
        break;

      case 'combat_turn':
        set({ currentTurnId: msg.currentTurnId });
        break;

      case 'combat_action_result':
        // Update combat participants HP in activeCombat
        set((state) => {
          if (!state.activeCombat) return {};
          const participants = state.activeCombat.participants.map((p) => {
            if (p.id === msg.targetId && msg.targetHp !== undefined) {
              return { ...p, hp: msg.targetHp };
            }
            if (p.id === msg.actorId && msg.actorHp !== undefined) {
              return { ...p, hp: msg.actorHp };
            }
            return p;
          }).filter((p) => {
            // Remove downed mobs
            if (msg.targetDowned && p.id === msg.targetId && p.type === 'mob') return false;
            if (msg.fled && p.id === msg.actorId) return false;
            return true;
          });
          return {
            activeCombat: { ...state.activeCombat, participants },
          };
        });
        break;

      case 'combat_end':
        set({ activeCombat: null, currentTurnId: null });
        break;

      case 'loot_prompt':
        set({ pendingLoot: { items: msg.items, timeout: msg.timeout } });
        break;

      case 'loot_result':
        // Remove item from pendingLoot
        set((state) => {
          if (!state.pendingLoot) return {};
          const items = state.pendingLoot.items.filter((i) => i.id !== msg.itemId);
          return { pendingLoot: items.length > 0 ? { ...state.pendingLoot, items } : null };
        });
        break;

      case 'player_update':
        set((state) => ({
          players: { ...state.players, [msg.player.id]: msg.player },
        }));
        break;

      case 'game_over':
        set({ gameOver: { result: msg.result }, activeCombat: null });
        break;

      case 'text_log':
        set((state) => ({
          textLog: [
            ...state.textLog,
            { message: msg.message, logType: msg.logType, id: ++logIdCounter },
          ],
        }));
        break;

      case 'error':
        set((state) => ({
          textLog: [
            ...state.textLog,
            { message: msg.message, logType: 'system', id: ++logIdCounter },
          ],
        }));
        break;
    }
  },

  reset: () => set(initialState),
}));
```

- [ ] **Step 2: Implement `client/src/hooks/useWebSocket.ts`**

```typescript
import { useEffect, useRef } from 'react';
import type { ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handleServerMessage = useGameStore((s) => s.handleServerMessage);
  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    return () => {
      ws.close();
    };
  }, [handleServerMessage, setConnectionStatus]);

  return wsRef;
}
```

- [ ] **Step 3: Implement `client/src/hooks/useGameActions.ts`**

```typescript
import { useRef, useCallback } from 'react';
import type { ClientMessage, Direction } from '@caverns/shared';

export function useGameActions(wsRef: React.RefObject<WebSocket | null>) {
  const send = useCallback(
    (msg: ClientMessage) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [wsRef]
  );

  return {
    joinLobby: (playerName: string) =>
      send({ type: 'join_lobby', playerName }),

    startGame: () =>
      send({ type: 'start_game' }),

    move: (direction: Direction) =>
      send({ type: 'move', direction }),

    combatAction: (
      action: 'attack' | 'defend' | 'use_item' | 'flee',
      targetId?: string,
      itemIndex?: number,
      fleeDirection?: Direction
    ) =>
      send({ type: 'combat_action', action, targetId, itemIndex, fleeDirection }),

    lootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') =>
      send({ type: 'loot_choice', itemId, choice }),

    revive: (targetPlayerId: string) =>
      send({ type: 'revive', targetPlayerId }),
  };
}
```

- [ ] **Step 4: Verify client compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```
feat: add Zustand game store and WebSocket hooks
```

---

## Task 11: Client Lobby Component

**Files:**
- Create: `client/src/components/Lobby.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Implement `client/src/components/Lobby.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';

interface LobbyProps {
  onJoin: (name: string) => void;
  onStart: () => void;
}

export function Lobby({ onJoin, onStart }: LobbyProps) {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers);
  const isHost = useGameStore((s) => s.isHost);

  const handleJoin = () => {
    if (name.trim()) {
      onJoin(name.trim());
      setJoined(true);
    }
  };

  if (!joined) {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <div className="lobby-join">
          <input
            type="text"
            placeholder="Enter your name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            maxLength={20}
            autoFocus
          />
          <button onClick={handleJoin} disabled={!name.trim()}>
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1>Caverns</h1>
      <p className="lobby-subtitle">Waiting for players...</p>
      <div className="lobby-players">
        {lobbyPlayers.map((p) => (
          <div key={p.id} className="lobby-player">
            {p.name}
          </div>
        ))}
      </div>
      {isHost && (
        <button
          className="lobby-start"
          onClick={onStart}
          disabled={lobbyPlayers.length === 0}
        >
          Enter the Caverns
        </button>
      )}
      {!isHost && <p className="lobby-waiting">Waiting for host to start...</p>}
    </div>
  );
}
```

- [ ] **Step 2: Update `client/src/App.tsx`**

```tsx
import { useGameStore } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { Lobby } from './components/Lobby.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const gameOver = useGameStore((s) => s.gameOver);

  if (connectionStatus === 'disconnected') {
    return (
      <div className="connecting">
        <h1>Caverns</h1>
        <p>Connecting to server...</p>
      </div>
    );
  }

  if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    return <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} />;
  }

  if (gameOver) {
    return (
      <div className="game-over">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The Mycelium King has been defeated!'
            : 'Your party has fallen in the darkness...'}
        </p>
      </div>
    );
  }

  // In-game — will be built out in the next tasks
  return (
    <div className="game">
      <p>Game is running... (UI coming next)</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```
feat: add Lobby component and App routing
```

---

## Task 12: Client Game UI Components — TextLog, ActionBar, MiniMap, PlayerHUD, PartyPanel

**Files:**
- Create: `client/src/components/TextLog.tsx`
- Create: `client/src/components/ActionBar.tsx`
- Create: `client/src/components/MiniMap.tsx`
- Create: `client/src/components/PlayerHUD.tsx`
- Create: `client/src/components/PartyPanel.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Implement `client/src/components/TextLog.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';

const LOG_COLORS: Record<string, string> = {
  narration: '#e0e0e0',
  combat: '#ff6b6b',
  loot: '#ffd93d',
  system: '#888',
};

export function TextLog() {
  const textLog = useGameStore((s) => s.textLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [textLog]);

  return (
    <div className="text-log">
      {textLog.map((entry) => (
        <div
          key={entry.id}
          className="log-entry"
          style={{ color: LOG_COLORS[entry.logType] ?? '#e0e0e0' }}
        >
          {entry.message.split('\n').map((line, i) => (
            <div key={i}>{line || '\u00A0'}</div>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `client/src/components/ActionBar.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Direction } from '@caverns/shared';

interface ActionBarProps {
  onMove: (direction: Direction) => void;
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
    fleeDirection?: Direction
  ) => void;
  onLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  onRevive: (targetPlayerId: string) => void;
}

export function ActionBar({ onMove, onCombatAction, onLootChoice, onRevive }: ActionBarProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const pendingLoot = useGameStore((s) => s.pendingLoot);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);

  const player = players[playerId];
  const currentRoom = rooms[currentRoomId];

  if (!player || !currentRoom) return null;

  // Loot prompt
  if (pendingLoot && pendingLoot.items.length > 0) {
    return (
      <div className="action-bar loot-bar">
        <h3>Loot Dropped!</h3>
        {pendingLoot.items.map((item) => (
          <div key={item.id} className="loot-item">
            <span className={`item-name rarity-${item.rarity}`}>{item.name}</span>
            <span className="item-slot">[{item.slot}]</span>
            <div className="loot-buttons">
              <button onClick={() => onLootChoice(item.id, 'need')}>Need</button>
              <button onClick={() => onLootChoice(item.id, 'greed')}>Greed</button>
              <button onClick={() => onLootChoice(item.id, 'pass')}>Pass</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Downed
  if (player.status === 'downed') {
    return (
      <div className="action-bar">
        <p className="downed-text">You are downed. Waiting for revival...</p>
      </div>
    );
  }

  // Combat
  if (player.status === 'in_combat' && activeCombat) {
    const isMyTurn = currentTurnId === playerId;
    const enemies = activeCombat.participants.filter((p) => p.type === 'mob');
    const downedAllies = Object.values(players).filter(
      (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
    );

    return (
      <div className="action-bar combat-bar">
        {!isMyTurn ? (
          <p className="waiting-text">Waiting for turn...</p>
        ) : (
          <>
            <div className="combat-targets">
              <label>Target:</label>
              <select
                value={selectedTarget ?? ''}
                onChange={(e) => setSelectedTarget(e.target.value || null)}
              >
                <option value="">Select target...</option>
                {enemies.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.hp}/{e.maxHp} HP)
                  </option>
                ))}
              </select>
            </div>
            <div className="combat-actions">
              <button
                onClick={() => selectedTarget && onCombatAction('attack', selectedTarget)}
                disabled={!selectedTarget}
              >
                Attack
              </button>
              <button onClick={() => onCombatAction('defend')}>Defend</button>
              <div className="item-select">
                <select
                  value={selectedItem ?? ''}
                  onChange={(e) => setSelectedItem(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Use item...</option>
                  {player.consumables.map((item, i) =>
                    item ? (
                      <option key={i} value={i}>
                        {item.name}
                      </option>
                    ) : null
                  )}
                </select>
                <button
                  onClick={() => {
                    if (selectedItem !== null) {
                      const item = player.consumables[selectedItem];
                      if (item?.stats.damage && selectedTarget) {
                        onCombatAction('use_item', selectedTarget, selectedItem);
                      } else if (item?.stats.healAmount) {
                        onCombatAction('use_item', undefined, selectedItem);
                      }
                    }
                  }}
                  disabled={selectedItem === null}
                >
                  Use
                </button>
              </div>
              <div className="flee-select">
                {Object.keys(currentRoom.exits).map((dir) => (
                  <button
                    key={dir}
                    onClick={() => onCombatAction('flee', undefined, undefined, dir as Direction)}
                    className="flee-btn"
                  >
                    Flee {dir}
                  </button>
                ))}
              </div>
              {downedAllies.length > 0 && (
                <div className="revive-actions">
                  {downedAllies.map((ally) => (
                    <button key={ally.id} onClick={() => onRevive(ally.id)}>
                      Revive {ally.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Exploration
  const directions: Direction[] = ['north', 'south', 'east', 'west'];
  const downedInRoom = Object.values(players).filter(
    (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
  );

  return (
    <div className="action-bar explore-bar">
      <div className="move-buttons">
        {directions.map((dir) => (
          <button
            key={dir}
            onClick={() => onMove(dir)}
            disabled={!currentRoom.exits[dir]}
            className={`move-btn move-${dir}`}
          >
            {dir.charAt(0).toUpperCase() + dir.slice(1)}
          </button>
        ))}
      </div>
      {downedInRoom.length > 0 && (
        <div className="revive-actions">
          {downedInRoom.map((ally) => (
            <button key={ally.id} onClick={() => onRevive(ally.id)}>
              Revive {ally.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `client/src/components/MiniMap.tsx`**

```tsx
import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Direction } from '@caverns/shared';

const ROOM_W = 100;
const ROOM_H = 50;
const GAP_X = 140;
const GAP_Y = 80;

const PLAYER_COLORS = ['#4ecdc4', '#ff6b6b', '#ffd93d', '#a29bfe'];

const DIR_OFFSET: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

export function MiniMap() {
  const rooms = useGameStore((s) => s.rooms);
  const players = useGameStore((s) => s.players);
  const currentRoomId = useGameStore((s) => s.currentRoomId);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const roomList = Object.values(rooms);
    if (roomList.length === 0) return { positions, connections: [] };

    // BFS layout from first room
    const startId = roomList[0].id;
    const queue: { id: string; x: number; y: number }[] = [
      { id: startId, x: 0, y: 0 },
    ];
    const visited = new Set<string>();
    visited.add(startId);

    while (queue.length > 0) {
      const { id, x, y } = queue.shift()!;
      positions.set(id, { x, y });
      const room = rooms[id];
      if (!room) continue;

      for (const [dir, targetId] of Object.entries(room.exits)) {
        if (targetId && !visited.has(targetId) && rooms[targetId]) {
          visited.add(targetId);
          const offset = DIR_OFFSET[dir as Direction];
          queue.push({
            id: targetId,
            x: x + offset.dx,
            y: y + offset.dy,
          });
        }
      }
    }

    // Build connections
    const connections: { from: string; to: string }[] = [];
    const seen = new Set<string>();
    for (const room of roomList) {
      for (const targetId of Object.values(room.exits)) {
        if (targetId && positions.has(targetId)) {
          const key = [room.id, targetId].sort().join('-');
          if (!seen.has(key)) {
            seen.add(key);
            connections.push({ from: room.id, to: targetId });
          }
        }
      }
    }

    return { positions, connections };
  }, [rooms]);

  if (layout.positions.size === 0) return null;

  // Compute SVG bounds
  const allPos = Array.from(layout.positions.values());
  const minX = Math.min(...allPos.map((p) => p.x)) * GAP_X - ROOM_W;
  const maxX = Math.max(...allPos.map((p) => p.x)) * GAP_X + ROOM_W * 2;
  const minY = Math.min(...allPos.map((p) => p.y)) * GAP_Y - ROOM_H;
  const maxY = Math.max(...allPos.map((p) => p.y)) * GAP_Y + ROOM_H * 2;

  const playerList = Object.values(players);

  return (
    <div className="minimap">
      <svg
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        width="100%"
        height="100%"
      >
        {/* Connections */}
        {layout.connections.map(({ from, to }) => {
          const p1 = layout.positions.get(from)!;
          const p2 = layout.positions.get(to)!;
          return (
            <line
              key={`${from}-${to}`}
              x1={p1.x * GAP_X + ROOM_W / 2}
              y1={p1.y * GAP_Y + ROOM_H / 2}
              x2={p2.x * GAP_X + ROOM_W / 2}
              y2={p2.y * GAP_Y + ROOM_H / 2}
              stroke="#555"
              strokeWidth={2}
            />
          );
        })}

        {/* Rooms */}
        {Array.from(layout.positions.entries()).map(([roomId, pos]) => {
          const room = rooms[roomId];
          const isCurrent = roomId === currentRoomId;
          return (
            <g key={roomId}>
              <rect
                x={pos.x * GAP_X}
                y={pos.y * GAP_Y}
                width={ROOM_W}
                height={ROOM_H}
                rx={4}
                fill={isCurrent ? '#2d4a3e' : '#1e1e2e'}
                stroke={isCurrent ? '#4ecdc4' : '#444'}
                strokeWidth={isCurrent ? 2 : 1}
              />
              <text
                x={pos.x * GAP_X + ROOM_W / 2}
                y={pos.y * GAP_Y + ROOM_H / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#ccc"
                fontSize={10}
              >
                {room?.name ?? roomId}
              </text>

              {/* Unexplored exit indicators */}
              {room &&
                Object.entries(room.exits).map(([dir, targetId]) => {
                  if (targetId && !rooms[targetId]) {
                    const offset = DIR_OFFSET[dir as Direction];
                    return (
                      <text
                        key={dir}
                        x={pos.x * GAP_X + ROOM_W / 2 + offset.dx * (ROOM_W / 2 + 12)}
                        y={pos.y * GAP_Y + ROOM_H / 2 + offset.dy * (ROOM_H / 2 + 12)}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#666"
                        fontSize={14}
                      >
                        ?
                      </text>
                    );
                  }
                  return null;
                })}
            </g>
          );
        })}

        {/* Player dots */}
        {playerList.map((player, i) => {
          const pos = layout.positions.get(player.roomId);
          if (!pos) return null;
          return (
            <circle
              key={player.id}
              cx={pos.x * GAP_X + ROOM_W / 2 + (i - playerList.length / 2) * 14}
              cy={pos.y * GAP_Y + ROOM_H - 8}
              r={5}
              fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            >
              <title>{player.name}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Implement `client/src/components/PlayerHUD.tsx`**

```tsx
import { useGameStore } from '../store/gameStore.js';

export function PlayerHUD() {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const player = players[playerId];

  if (!player) return null;

  const hpPercent = (player.hp / player.maxHp) * 100;
  const hpColor = hpPercent > 50 ? '#4ecdc4' : hpPercent > 25 ? '#ffd93d' : '#ff6b6b';

  return (
    <div className="player-hud">
      <h3>{player.name}</h3>
      <div className="hp-bar-container">
        <div className="hp-bar" style={{ width: `${hpPercent}%`, backgroundColor: hpColor }} />
        <span className="hp-text">{player.hp} / {player.maxHp}</span>
      </div>

      <div className="equipment-grid">
        <div className="equip-slot">
          <span className="slot-label">Weapon</span>
          <span className={player.equipment.weapon ? `rarity-${player.equipment.weapon.rarity}` : 'empty'}>
            {player.equipment.weapon?.name ?? 'Empty'}
          </span>
        </div>
        <div className="equip-slot">
          <span className="slot-label">Off-hand</span>
          <span className={player.equipment.offhand ? `rarity-${player.equipment.offhand.rarity}` : 'empty'}>
            {player.equipment.offhand?.name ?? 'Empty'}
          </span>
        </div>
        <div className="equip-slot">
          <span className="slot-label">Armor</span>
          <span className={player.equipment.armor ? `rarity-${player.equipment.armor.rarity}` : 'empty'}>
            {player.equipment.armor?.name ?? 'Empty'}
          </span>
        </div>
        <div className="equip-slot">
          <span className="slot-label">Accessory</span>
          <span className={player.equipment.accessory ? `rarity-${player.equipment.accessory.rarity}` : 'empty'}>
            {player.equipment.accessory?.name ?? 'Empty'}
          </span>
        </div>
      </div>

      <div className="consumables">
        <span className="slot-label">Consumables</span>
        <div className="consumable-grid">
          {player.consumables.map((item, i) => (
            <div key={i} className="consumable-slot">
              {item ? (
                <span className={`rarity-${item.rarity}`} title={item.description}>
                  {item.name}
                </span>
              ) : (
                <span className="empty">-</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `client/src/components/PartyPanel.tsx`**

```tsx
import { useGameStore } from '../store/gameStore.js';

const STATUS_ICONS: Record<string, string> = {
  exploring: '🧭',
  in_combat: '⚔️',
  downed: '💀',
};

export function PartyPanel() {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);

  const otherPlayers = Object.values(players).filter((p) => p.id !== playerId);

  if (otherPlayers.length === 0) return null;

  return (
    <div className="party-panel">
      <h3>Party</h3>
      {otherPlayers.map((player) => {
        const hpPercent = (player.hp / player.maxHp) * 100;
        const hpColor = hpPercent > 50 ? '#4ecdc4' : hpPercent > 25 ? '#ffd93d' : '#ff6b6b';
        const room = rooms[player.roomId];
        return (
          <div key={player.id} className="party-member">
            <div className="party-member-header">
              <span>{STATUS_ICONS[player.status] ?? ''} {player.name}</span>
              <span className="party-room">{room?.name ?? '???'}</span>
            </div>
            <div className="hp-bar-container small">
              <div className="hp-bar" style={{ width: `${hpPercent}%`, backgroundColor: hpColor }} />
              <span className="hp-text">{player.hp}/{player.maxHp}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Update `client/src/App.tsx` with the game layout**

```tsx
import { useGameStore } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { Lobby } from './components/Lobby.js';
import { TextLog } from './components/TextLog.js';
import { MiniMap } from './components/MiniMap.js';
import { PlayerHUD } from './components/PlayerHUD.js';
import { PartyPanel } from './components/PartyPanel.js';
import { ActionBar } from './components/ActionBar.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const gameOver = useGameStore((s) => s.gameOver);

  if (connectionStatus === 'disconnected') {
    return (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p>Connecting to server...</p>
      </div>
    );
  }

  if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    return <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} />;
  }

  if (gameOver) {
    return (
      <div className="screen-center">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The Mycelium King has been defeated!'
            : 'Your party has fallen in the darkness...'}
        </p>
      </div>
    );
  }

  return (
    <div className="game-layout">
      <div className="main-column">
        <TextLog />
        <ActionBar
          onMove={actions.move}
          onCombatAction={actions.combatAction}
          onLootChoice={actions.lootChoice}
          onRevive={actions.revive}
        />
      </div>
      <div className="side-column">
        <MiniMap />
        <PartyPanel />
        <PlayerHUD />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify it compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```
feat: add game UI components — TextLog, MiniMap, PlayerHUD, PartyPanel, ActionBar
```

---

## Task 13: Client CSS Styling

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Write the full stylesheet**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: 'Courier New', Courier, monospace;
  height: 100vh;
  overflow: hidden;
}

#root {
  height: 100vh;
}

/* === Centering screens === */
.screen-center,
.connecting,
.game-over {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  text-align: center;
  gap: 1rem;
}

.screen-center h1 {
  font-size: 2.5rem;
  color: #4ecdc4;
}

/* === Lobby === */
.lobby {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 1.5rem;
}

.lobby h1 {
  font-size: 3rem;
  color: #4ecdc4;
  text-shadow: 0 0 20px rgba(78, 205, 196, 0.3);
}

.lobby-subtitle {
  color: #888;
  font-size: 1.1rem;
}

.lobby-join {
  display: flex;
  gap: 0.5rem;
}

.lobby-join input {
  background: #1a1a2e;
  border: 1px solid #333;
  color: #e0e0e0;
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: 1rem;
  border-radius: 4px;
  outline: none;
}

.lobby-join input:focus {
  border-color: #4ecdc4;
}

.lobby-players {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 200px;
}

.lobby-player {
  background: #1a1a2e;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid #333;
}

button {
  background: #2d4a3e;
  color: #4ecdc4;
  border: 1px solid #4ecdc4;
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: 0.9rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

button:hover:not(:disabled) {
  background: #3d6a5e;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.lobby-start {
  font-size: 1.1rem;
  padding: 0.75rem 2rem;
}

.lobby-waiting {
  color: #666;
}

/* === Game Layout === */
.game-layout {
  display: flex;
  height: 100vh;
  gap: 1px;
  background: #222;
}

.main-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.side-column {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #222;
}

/* === Text Log === */
.text-log {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: #0d0d1a;
  font-size: 0.9rem;
  line-height: 1.5;
}

.log-entry {
  margin-bottom: 0.5rem;
  white-space: pre-wrap;
}

/* === Action Bar === */
.action-bar {
  background: #141425;
  padding: 0.75rem 1rem;
  border-top: 1px solid #333;
  min-height: 60px;
}

.move-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.move-btn {
  min-width: 80px;
}

.combat-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.combat-targets {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.combat-targets select,
.item-select select {
  background: #1a1a2e;
  color: #e0e0e0;
  border: 1px solid #333;
  padding: 0.4rem;
  font-family: inherit;
  border-radius: 4px;
  flex: 1;
}

.combat-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.item-select {
  display: flex;
  gap: 0.25rem;
}

.flee-select {
  display: flex;
  gap: 0.25rem;
}

.flee-btn {
  font-size: 0.8rem;
  padding: 0.3rem 0.6rem;
  background: #4a2d2d;
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.loot-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.loot-bar h3 {
  color: #ffd93d;
}

.loot-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid #222;
}

.loot-item .item-slot {
  color: #888;
  font-size: 0.8rem;
}

.loot-buttons {
  display: flex;
  gap: 0.25rem;
  margin-left: auto;
}

.loot-buttons button {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
}

.downed-text,
.waiting-text {
  color: #888;
  font-style: italic;
}

.revive-actions {
  display: flex;
  gap: 0.5rem;
}

.revive-actions button {
  background: #2d3a4a;
  border-color: #6bafff;
  color: #6bafff;
}

/* === MiniMap === */
.minimap {
  background: #0d0d1a;
  padding: 0.5rem;
  height: 250px;
  border-bottom: 1px solid #222;
}

.minimap svg {
  display: block;
}

/* === Party Panel === */
.party-panel {
  background: #0d0d1a;
  padding: 0.75rem;
  border-bottom: 1px solid #222;
}

.party-panel h3 {
  color: #888;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

.party-member {
  margin-bottom: 0.5rem;
}

.party-member-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
}

.party-room {
  color: #666;
  font-size: 0.75rem;
}

/* === Player HUD === */
.player-hud {
  background: #0d0d1a;
  padding: 0.75rem;
  flex: 1;
  overflow-y: auto;
}

.player-hud h3 {
  color: #4ecdc4;
  margin-bottom: 0.5rem;
}

.hp-bar-container {
  position: relative;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
  height: 24px;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.hp-bar-container.small {
  height: 16px;
}

.hp-bar {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
  border-radius: 3px;
}

.hp-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.75rem;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}

.equipment-grid {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.equip-slot {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  padding: 0.2rem 0;
  border-bottom: 1px solid #1a1a2e;
}

.slot-label {
  color: #666;
  font-size: 0.75rem;
  text-transform: uppercase;
}

.consumable-grid {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.25rem;
}

.consumable-slot {
  font-size: 0.8rem;
}

.empty {
  color: #444;
}

/* === Rarity Colors === */
.rarity-common {
  color: #b0b0b0;
}

.rarity-uncommon {
  color: #4ecdc4;
}

.rarity-rare {
  color: #6b9bff;
}

.rarity-legendary {
  color: #ffd93d;
  text-shadow: 0 0 6px rgba(255, 217, 61, 0.3);
}

/* === Scrollbar === */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #0d0d1a;
}

::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}
```

- [ ] **Step 2: Verify the app renders**

Run: `npm run dev:server` (in one terminal) and `npm run dev:client` (in another).
Open `http://localhost:5173` — the lobby screen should render with dark theme styling.

- [ ] **Step 3: Commit**

```
feat: add game CSS styling with dark dungeon theme
```

---

## Task 14: End-to-End Smoke Test

**Files:** No new files — testing the full flow.

- [ ] **Step 1: Start both server and client**

Terminal 1: `cd server && npx tsx src/index.ts`
Terminal 2: `cd client && npx vite`

- [ ] **Step 2: Test lobby flow**

1. Open `http://localhost:5173` in a browser
2. Enter a name and click "Join"
3. Verify player appears in the lobby list
4. Click "Enter the Caverns"
5. Verify the game screen loads with the text log showing "Cavern Mouth" description

- [ ] **Step 3: Test exploration**

1. Click "North" to move to Fungal Grotto
2. Verify the text log shows movement and room description
3. Verify the minimap updates with the new room
4. Verify combat starts (Fungal Crawler encounter)

- [ ] **Step 4: Test combat**

1. Select the Fungal Crawler as target
2. Click "Attack" — verify damage appears in text log
3. Verify enemy attacks back on its turn
4. Continue attacking until the mob dies
5. Verify "The enemies have been defeated!" appears
6. Verify loot prompt appears

- [ ] **Step 5: Test loot**

1. Click "Need" or "Greed" on dropped items
2. Verify items appear in equipment/consumable slots in the HUD

- [ ] **Step 6: Test two-player (optional)**

1. Open a second browser tab to `http://localhost:5173`
2. Join with a different name
3. Verify both players appear in lobby
4. Start game and verify both players can explore independently
5. Move both players to the same room with an encounter
6. Verify loot need/greed prompts both players

- [ ] **Step 7: Fix any bugs found during smoke test**

Address any issues discovered during manual testing.

- [ ] **Step 8: Commit any fixes**

```
fix: address issues found during end-to-end smoke test
```

---

## Dependency Order

```
Task 1 (scaffold) → Task 2 (types) → Task 3 (messages) → Task 4 (content)
                                                               ↓
Task 5 (PlayerManager) → Task 6 (CombatManager) → Task 7 (LootManager)
                                                               ↓
                                                Task 8 (GameSession)
                                                               ↓
                                                Task 9 (Server WS + Lobby)
                                                               ↓
                                    Task 10 (Store + Hooks) → Task 11 (Lobby UI)
                                                               ↓
                                                Task 12 (Game UI Components)
                                                               ↓
                                                Task 13 (CSS)
                                                               ↓
                                                Task 14 (Smoke Test)
```
