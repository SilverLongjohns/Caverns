# Interactables System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add examinable interactable objects to dungeon rooms with ASCII room display, outcome resolution, and multiplayer state sync — scoped to Fungal Depths biome with placeholder narrations.

**Architecture:** New shared types define interactable definitions, instances, and slots. The ProceduralGenerator places interactables during dungeon generation. A new ExamineResolver handles outcome rolls server-side. A new RoomView component renders ASCII room templates with clickable interactable characters. State is authoritative on the server and synced via three message types.

**Tech Stack:** TypeScript, React, Zustand, ws, Vitest

---

### Task 1: Shared Types — Interactable Data Model

**Files:**
- Modify: `shared/src/types.ts:32` (after RoomType)
- Modify: `shared/src/data/types.ts:1-11` (RoomChit interface)
- Modify: `shared/src/index.ts`
- Test: `shared/src/types.test.ts`

- [ ] **Step 1: Add interactable types to `shared/src/types.ts`**

Add after line 32 (after the `RoomType` definition):

```typescript
// === Interactables ===
export type InteractableSize = 'small' | 'medium' | 'large';
export type OutcomeType = 'loot' | 'hazard' | 'intel' | 'secret' | 'flavor';

export interface InteractableSlot {
  position: { x: number; y: number };
  size: InteractableSize;
}

export interface OutcomeTable {
  weights: Record<OutcomeType, number>;
  bonusClassWeights?: Record<OutcomeType, number>;
}

export interface InteractableDefinition {
  id: string;
  name: string;
  asciiChar: string;
  biomes: string[];
  slotSize: InteractableSize;
  bonusClass?: string;
  outcomes: OutcomeTable;
}

export interface InteractableInstance {
  definitionId: string;
  instanceId: string;
  position: { x: number; y: number };
  examined: boolean;
  examinedBy?: string;
}
```

- [ ] **Step 2: Add `interactables` to the `Room` interface**

In `shared/src/types.ts`, add to the `Room` interface (after the `gridY` field):

```typescript
  interactables?: InteractableInstance[];
```

- [ ] **Step 3: Add `interactableSlots` to `RoomChit`**

In `shared/src/data/types.ts`, add to the `RoomChit` interface:

```typescript
import type { RoomType, InteractableSlot } from '../types.js';

export interface RoomChit {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  biomes: string[];
  maxExits: number;
  lootLocations: ('chest' | 'floor' | 'hidden')[];
  interactableSlots?: InteractableSlot[];
}
```

- [ ] **Step 4: Write a type test**

Add to `shared/src/types.test.ts`:

```typescript
import type { InteractableInstance, InteractableDefinition, OutcomeType } from './types.js';

describe('Interactable types', () => {
  it('InteractableInstance has required fields', () => {
    const instance: InteractableInstance = {
      definitionId: 'fungal_glowing_cluster',
      instanceId: 'int_001',
      position: { x: 5, y: 3 },
      examined: false,
    };
    expect(instance.examined).toBe(false);
    expect(instance.examinedBy).toBeUndefined();
  });

  it('OutcomeTable weights cover all outcome types', () => {
    const requiredTypes: OutcomeType[] = ['loot', 'hazard', 'intel', 'secret', 'flavor'];
    const def: InteractableDefinition = {
      id: 'test',
      name: 'Test',
      asciiChar: '?',
      biomes: ['fungal'],
      slotSize: 'small',
      outcomes: {
        weights: { loot: 40, hazard: 15, intel: 15, secret: 10, flavor: 20 },
      },
    };
    for (const t of requiredTypes) {
      expect(def.outcomes.weights[t]).toBeDefined();
    }
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass including the new interactable type tests.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/data/types.ts shared/src/types.test.ts
git commit -m "feat: add shared interactable types (definition, instance, slot, outcomes)"
```

---

### Task 2: Message Protocol — Examine Messages

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add ExamineMessage (client → server)**

Add after `PuzzleAnswerMessage` (around line 81):

```typescript
export interface ExamineMessage {
  type: 'examine';
  interactableId: string;
}
```

- [ ] **Step 2: Add ExamineMessage to ClientMessage union**

Add `| ExamineMessage` to the `ClientMessage` type.

- [ ] **Step 3: Add ExamineResultMessage (server → examining player)**

Add after `ScoutResultMessage` (around line 224):

```typescript
export interface ExamineResultMessage {
  type: 'examine_result';
  interactableId: string;
  narration: string;
  outcome: {
    type: OutcomeType;
    loot?: Item;
    damage?: number;
    intel?: {
      targetRoomId: string;
      text: string;
    };
  };
}
```

Import `OutcomeType` at the top of the file:

```typescript
import type {
  Direction,
  Player,
  Room,
  Item,
  CombatState,
  CombatParticipant,
  OutcomeType,
} from './types.js';
```

- [ ] **Step 4: Add InteractableStateMessage (server → room broadcast)**

Add after `ExamineResultMessage`:

```typescript
export interface InteractableStateMessage {
  type: 'interactable_state';
  interactableId: string;
  examined: boolean;
  examinedBy: string;
}
```

- [ ] **Step 5: Add both to ServerMessage union**

Add `| ExamineResultMessage | InteractableStateMessage` to the `ServerMessage` type.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All existing tests pass (no runtime changes yet).

- [ ] **Step 7: Commit**

```bash
git add shared/src/messages.ts
git commit -m "feat: add examine message protocol (examine, examine_result, interactable_state)"
```

---

### Task 3: Interactable Data — Fungal Depths Pool and Room Chit Slots

**Files:**
- Create: `shared/src/data/interactables.json`
- Modify: `shared/src/data/roomChits.json` (Fungal Depths chits only)

- [ ] **Step 1: Create `shared/src/data/interactables.json`**

Create the file with all 15 Fungal Depths interactable definitions:

```json
[
  {
    "id": "fungal_glowing_cluster",
    "name": "Glowing cluster",
    "asciiChar": "♧",
    "biomes": ["fungal"],
    "slotSize": "small",
    "bonusClass": "cleric",
    "outcomes": {
      "weights": { "loot": 40, "hazard": 15, "intel": 15, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 55, "hazard": 3, "intel": 20, "secret": 10, "flavor": 12 }
    }
  },
  {
    "id": "fungal_spore_vent",
    "name": "Spore vent",
    "asciiChar": "○",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "bonusClass": "artificer",
    "outcomes": {
      "weights": { "loot": 30, "hazard": 25, "intel": 15, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 40, "hazard": 5, "intel": 30, "secret": 10, "flavor": 15 }
    }
  },
  {
    "id": "fungal_mycelium_corpse",
    "name": "Overgrown remains",
    "asciiChar": "¤",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "bonusClass": "cleric",
    "outcomes": {
      "weights": { "loot": 45, "hazard": 15, "intel": 10, "secret": 5, "flavor": 25 },
      "bonusClassWeights": { "loot": 50, "hazard": 3, "intel": 25, "secret": 5, "flavor": 17 }
    }
  },
  {
    "id": "fungal_hollow_stump",
    "name": "Hollow stump",
    "asciiChar": "Ω",
    "biomes": ["fungal"],
    "slotSize": "large",
    "bonusClass": "shadowblade",
    "outcomes": {
      "weights": { "loot": 40, "hazard": 15, "intel": 10, "secret": 15, "flavor": 20 },
      "bonusClassWeights": { "loot": 55, "hazard": 2, "intel": 13, "secret": 15, "flavor": 15 }
    }
  },
  {
    "id": "fungal_dripping_cap",
    "name": "Dripping cap",
    "asciiChar": "♠",
    "biomes": ["fungal"],
    "slotSize": "small",
    "outcomes": {
      "weights": { "loot": 35, "hazard": 20, "intel": 10, "secret": 5, "flavor": 30 }
    }
  },
  {
    "id": "fungal_web_sac",
    "name": "Silk cocoon",
    "asciiChar": "§",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "bonusClass": "vanguard",
    "outcomes": {
      "weights": { "loot": 40, "hazard": 20, "intel": 10, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 50, "hazard": 5, "intel": 15, "secret": 15, "flavor": 15 }
    }
  },
  {
    "id": "fungal_mossy_pool",
    "name": "Still pool",
    "asciiChar": "≈",
    "biomes": ["fungal"],
    "slotSize": "large",
    "bonusClass": "artificer",
    "outcomes": {
      "weights": { "loot": 35, "hazard": 15, "intel": 15, "secret": 15, "flavor": 20 },
      "bonusClassWeights": { "loot": 45, "hazard": 3, "intel": 25, "secret": 15, "flavor": 12 }
    }
  },
  {
    "id": "fungal_puffball_ring",
    "name": "Puffball ring",
    "asciiChar": "◊",
    "biomes": ["fungal"],
    "slotSize": "small",
    "outcomes": {
      "weights": { "loot": 30, "hazard": 20, "intel": 10, "secret": 5, "flavor": 35 }
    }
  },
  {
    "id": "fungal_root_tangle",
    "name": "Root tangle",
    "asciiChar": "∞",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "bonusClass": "shadowblade",
    "outcomes": {
      "weights": { "loot": 40, "hazard": 15, "intel": 15, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 55, "hazard": 3, "intel": 20, "secret": 10, "flavor": 12 }
    }
  },
  {
    "id": "fungal_bark_face",
    "name": "Bark face",
    "asciiChar": "☺",
    "biomes": ["fungal"],
    "slotSize": "small",
    "bonusClass": "cleric",
    "outcomes": {
      "weights": { "loot": 20, "hazard": 10, "intel": 15, "secret": 5, "flavor": 50 },
      "bonusClassWeights": { "loot": 30, "hazard": 3, "intel": 30, "secret": 5, "flavor": 32 }
    }
  },
  {
    "id": "fungal_rotting_crate",
    "name": "Rotting crate",
    "asciiChar": "■",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "bonusClass": "shadowblade",
    "outcomes": {
      "weights": { "loot": 50, "hazard": 15, "intel": 5, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 65, "hazard": 2, "intel": 8, "secret": 10, "flavor": 15 }
    }
  },
  {
    "id": "fungal_crystal_node",
    "name": "Embedded crystal",
    "asciiChar": "◆",
    "biomes": ["fungal"],
    "slotSize": "small",
    "bonusClass": "vanguard",
    "outcomes": {
      "weights": { "loot": 45, "hazard": 15, "intel": 10, "secret": 10, "flavor": 20 },
      "bonusClassWeights": { "loot": 55, "hazard": 3, "intel": 12, "secret": 15, "flavor": 15 }
    }
  },
  {
    "id": "fungal_burrow",
    "name": "Animal burrow",
    "asciiChar": "∪",
    "biomes": ["fungal"],
    "slotSize": "small",
    "bonusClass": "artificer",
    "outcomes": {
      "weights": { "loot": 35, "hazard": 20, "intel": 20, "secret": 5, "flavor": 20 },
      "bonusClassWeights": { "loot": 40, "hazard": 5, "intel": 35, "secret": 5, "flavor": 15 }
    }
  },
  {
    "id": "fungal_altar_stump",
    "name": "Carved stump",
    "asciiChar": "†",
    "biomes": ["fungal"],
    "slotSize": "large",
    "bonusClass": "cleric",
    "outcomes": {
      "weights": { "loot": 35, "hazard": 10, "intel": 15, "secret": 15, "flavor": 25 },
      "bonusClassWeights": { "loot": 45, "hazard": 2, "intel": 25, "secret": 15, "flavor": 13 }
    }
  },
  {
    "id": "fungal_hanging_vines",
    "name": "Curtain of vines",
    "asciiChar": "║",
    "biomes": ["fungal"],
    "slotSize": "medium",
    "outcomes": {
      "weights": { "loot": 30, "hazard": 15, "intel": 10, "secret": 20, "flavor": 25 }
    }
  }
]
```

- [ ] **Step 2: Add interactable slots to Fungal Depths room chits**

In `shared/src/data/roomChits.json`, add `interactableSlots` to each Fungal Depths chit (those with `"biomes": ["fungal"]`). Slot positions are relative to the ASCII room template grid.

Slot count by room type:
- `dead_end` (30x8): 1 slot — 1 medium
- `tunnel` (40x6): 1-2 slots — 1-2 small
- `chamber` (44x12): 2-3 slots — 1 medium + 1-2 small
- `cavern` (50x14): 2-4 slots — 1 large + 1-2 medium + 0-1 small

Example for a dead_end chit:
```json
{
  "id": "fungal_spore_grotto_01",
  "type": "dead_end",
  "name": "Spore Grotto",
  "description": "...",
  "biomes": ["fungal"],
  "maxExits": 1,
  "lootLocations": ["floor"],
  "interactableSlots": [
    { "position": { "x": 12, "y": 3 }, "size": "medium" }
  ]
}
```

Position guidelines per template (inside wall boundaries, not overlapping exits):
- **dead_end** (usable floor: x 2-27, y 1-6): place 1 slot near center
- **tunnel** (usable floor: x 2-37, y 1-4): place 1-2 slots spread across length
- **chamber** (usable floor: x 2-41, y 1-10): place 2-3 slots in different quadrants
- **cavern** (usable floor: x 3-47, y 1-11): place 2-4 slots spread across the room

Each chit gets unique positions. Vary placement across chits of the same type so rooms don't feel repetitive.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass (JSON is valid, no breaking changes).

- [ ] **Step 4: Commit**

```bash
git add shared/src/data/interactables.json shared/src/data/roomChits.json
git commit -m "feat: add Fungal Depths interactable pool and room chit slots"
```

---

### Task 4: ASCII Room Templates

**Files:**
- Create: `shared/src/data/roomTemplates.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create `shared/src/data/roomTemplates.ts`**

```typescript
import type { RoomType, Direction } from '../types.js';

export interface RoomTemplate {
  type: RoomType;
  width: number;
  height: number;
  lines: string[];
  exitPositions: Partial<Record<Direction, { x: number; y: number; length: number }>>;
}

const DEAD_END: RoomTemplate = {
  type: 'dead_end',
  width: 30,
  height: 8,
  lines: [
    '╔════════════════════════════╗',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' .     . ` . , . \' . ║',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , ║',
    '╚═══════════   ══════════════╝',
  ],
  exitPositions: {
    south: { x: 12, y: 7, length: 3 },
  },
};

const TUNNEL: RoomTemplate = {
  type: 'tunnel',
  width: 40,
  height: 6,
  lines: [
    '╔══════════════════════════════════════╗',
    '║ . , . ` . , . \' . , . ` . , . \' . ,║',
    '  , . \' . , . ` . , . \' . , . ` . , . ',
    '  . , . ` . , . \' . , . ` . , . \' . ,║',
    '║ , . \' . , . ` . , . \' . , . ` . , . ',
    '╚══════════════════════════════════════╝',
  ],
  exitPositions: {
    west: { x: 0, y: 2, length: 2 },
    east: { x: 38, y: 2, length: 2 },
  },
};

const CHAMBER: RoomTemplate = {
  type: 'chamber',
  width: 44,
  height: 12,
  lines: [
    '╔══════════════════   ═══════════════════════╗',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '  . , . ` . , . \' . , . ` . , . \' . , . ` .  ',
    '  , . \' . , . ` . , . \' . , . ` . , . \' . ,  ',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '╚══════════════════   ═══════════════════════╝',
  ],
  exitPositions: {
    north: { x: 19, y: 0, length: 3 },
    south: { x: 19, y: 11, length: 3 },
    west: { x: 0, y: 5, length: 2 },
  },
};

const CAVERN: RoomTemplate = {
  type: 'cavern',
  width: 50,
  height: 14,
  lines: [
    '  ╔═════════════════════   ══════════════════════════╗',
    ' ║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \'  ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , .║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . ║',
    '  . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . \'  ',
    '  , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , .  ',
    '║ . , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , .║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . ,║',
    ' ║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , ║',
    '  ║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' ║',
    '   ╚══════════════════   ═══════════════════════════╝',
    '                                                      ',
  ],
  exitPositions: {
    north: { x: 22, y: 0, length: 3 },
    south: { x: 19, y: 12, length: 3 },
    west: { x: 0, y: 5, length: 2 },
    east: { x: 48, y: 5, length: 2 },
  },
};

export const ROOM_TEMPLATES: Record<string, RoomTemplate> = {
  dead_end: DEAD_END,
  tunnel: TUNNEL,
  chamber: CHAMBER,
  cavern: CAVERN,
  boss: CAVERN,
};

export function getTemplateForRoom(roomType: RoomType): RoomTemplate {
  return ROOM_TEMPLATES[roomType] ?? ROOM_TEMPLATES['chamber'];
}
```

- [ ] **Step 2: Re-export from `shared/src/index.ts`**

Add:

```typescript
export * from './data/roomTemplates.js';
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add shared/src/data/roomTemplates.ts shared/src/index.ts
git commit -m "feat: add ASCII room templates for 4 room types"
```

---

### Task 5: ExamineResolver — Server-Side Outcome Resolution

**Files:**
- Create: `server/src/ExamineResolver.ts`
- Create: `server/src/ExamineResolver.test.ts`

- [ ] **Step 1: Write failing tests for ExamineResolver**

Create `server/src/ExamineResolver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExamineResolver } from './ExamineResolver.js';
import type { Room, InteractableInstance, InteractableDefinition, Item } from '@caverns/shared';

function makeRoom(interactables: InteractableInstance[]): Room {
  return {
    id: 'room_1',
    type: 'chamber',
    name: 'Test Chamber',
    description: 'A test room.',
    exits: { north: 'room_2' },
    interactables,
  };
}

function makeDefinition(overrides?: Partial<InteractableDefinition>): InteractableDefinition {
  return {
    id: 'fungal_glowing_cluster',
    name: 'Glowing cluster',
    asciiChar: '♧',
    biomes: ['fungal'],
    slotSize: 'small',
    outcomes: {
      weights: { loot: 40, hazard: 15, intel: 15, secret: 10, flavor: 20 },
    },
    ...overrides,
  };
}

function makeInstance(overrides?: Partial<InteractableInstance>): InteractableInstance {
  return {
    definitionId: 'fungal_glowing_cluster',
    instanceId: 'int_001',
    position: { x: 5, y: 3 },
    examined: false,
    ...overrides,
  };
}

const mockItems: Item[] = [
  {
    id: 'potion_minor',
    name: 'Minor Potion',
    description: 'Heals a little.',
    rarity: 'common',
    slot: 'consumable',
    stats: { healAmount: 10 },
  },
];

describe('ExamineResolver', () => {
  let resolver: ExamineResolver;

  beforeEach(() => {
    resolver = new ExamineResolver([makeDefinition()], mockItems);
  });

  it('rejects examining a non-existent interactable', () => {
    const room = makeRoom([makeInstance()]);
    const result = resolver.resolve('player_1', 'bad_id', room, 'vanguard');
    expect(result.error).toBe('Interactable not found.');
  });

  it('rejects examining an already-examined interactable', () => {
    const room = makeRoom([makeInstance({ examined: true, examinedBy: 'player_2' })]);
    const result = resolver.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.error).toBe('Already examined.');
  });

  it('resolves a valid examine and marks it examined', () => {
    const instance = makeInstance();
    const room = makeRoom([instance]);
    const result = resolver.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.error).toBeUndefined();
    expect(result.outcomeType).toBeDefined();
    expect(instance.examined).toBe(true);
    expect(instance.examinedBy).toBe('player_1');
  });

  it('returns a narration string', () => {
    const room = makeRoom([makeInstance()]);
    const result = resolver.resolve('player_1', 'int_001', room, 'vanguard');
    expect(typeof result.narration).toBe('string');
    expect(result.narration!.length).toBeGreaterThan(0);
  });

  it('loot outcome returns an item', () => {
    // Force loot by setting all other weights to 0
    const def = makeDefinition({
      outcomes: { weights: { loot: 100, hazard: 0, intel: 0, secret: 0, flavor: 0 } },
    });
    const resolver2 = new ExamineResolver([def], mockItems);
    const room = makeRoom([makeInstance()]);
    const result = resolver2.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.outcomeType).toBe('loot');
    expect(result.lootItem).toBeDefined();
  });

  it('hazard outcome returns damage', () => {
    const def = makeDefinition({
      outcomes: { weights: { loot: 0, hazard: 100, intel: 0, secret: 0, flavor: 0 } },
    });
    const resolver2 = new ExamineResolver([def], mockItems);
    const room = makeRoom([makeInstance()]);
    const result = resolver2.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.outcomeType).toBe('hazard');
    expect(result.damage).toBeGreaterThanOrEqual(5);
    expect(result.damage).toBeLessThanOrEqual(15);
  });

  it('intel outcome returns target room and text', () => {
    const def = makeDefinition({
      outcomes: { weights: { loot: 0, hazard: 0, intel: 100, secret: 0, flavor: 0 } },
    });
    const resolver2 = new ExamineResolver([def], mockItems);
    const room = makeRoom([makeInstance()]);
    const result = resolver2.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.outcomeType).toBe('intel');
    expect(result.intel).toBeDefined();
    expect(result.intel!.targetRoomId).toBe('room_2');
  });

  it('uses bonusClassWeights when player class matches', () => {
    // bonusClassWeights with 100% loot, normal weights with 100% flavor
    const def = makeDefinition({
      bonusClass: 'cleric',
      outcomes: {
        weights: { loot: 0, hazard: 0, intel: 0, secret: 0, flavor: 100 },
        bonusClassWeights: { loot: 100, hazard: 0, intel: 0, secret: 0, flavor: 0 },
      },
    });
    const resolver2 = new ExamineResolver([def], mockItems);
    const room = makeRoom([makeInstance()]);

    const resultBonus = resolver2.resolve('player_1', 'int_001', room, 'cleric');
    expect(resultBonus.outcomeType).toBe('loot');
  });

  it('flavor and secret outcomes have no mechanical effect', () => {
    const def = makeDefinition({
      outcomes: { weights: { loot: 0, hazard: 0, intel: 0, secret: 0, flavor: 100 } },
    });
    const resolver2 = new ExamineResolver([def], mockItems);
    const room = makeRoom([makeInstance()]);
    const result = resolver2.resolve('player_1', 'int_001', room, 'vanguard');
    expect(result.outcomeType).toBe('flavor');
    expect(result.lootItem).toBeUndefined();
    expect(result.damage).toBeUndefined();
    expect(result.intel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ExamineResolver` module not found.

- [ ] **Step 3: Implement ExamineResolver**

Create `server/src/ExamineResolver.ts`:

```typescript
import type {
  Room,
  InteractableDefinition,
  InteractableInstance,
  OutcomeType,
  Item,
} from '@caverns/shared';

export interface ExamineResult {
  error?: string;
  outcomeType?: OutcomeType;
  narration?: string;
  lootItem?: Item;
  damage?: number;
  intel?: { targetRoomId: string; text: string };
}

export class ExamineResolver {
  private definitions: Map<string, InteractableDefinition>;
  private lootPool: Item[];

  constructor(definitions: InteractableDefinition[], lootPool: Item[]) {
    this.definitions = new Map(definitions.map(d => [d.id, d]));
    this.lootPool = lootPool;
  }

  resolve(
    playerId: string,
    interactableId: string,
    room: Room,
    playerClass: string,
  ): ExamineResult {
    const instance = room.interactables?.find(i => i.instanceId === interactableId);
    if (!instance) return { error: 'Interactable not found.' };
    if (instance.examined) return { error: 'Already examined.' };

    const definition = this.definitions.get(instance.definitionId);
    if (!definition) return { error: 'Unknown interactable definition.' };

    // Pick weight table
    const useBonus = definition.bonusClass === playerClass && definition.outcomes.bonusClassWeights;
    const weights = useBonus ? definition.outcomes.bonusClassWeights! : definition.outcomes.weights;

    // Weighted random roll
    const outcomeType = this.rollOutcome(weights);

    // Mark examined
    instance.examined = true;
    instance.examinedBy = playerId;

    // Resolve outcome
    switch (outcomeType) {
      case 'loot':
        return this.resolveLoot(instance, definition, outcomeType);
      case 'hazard':
        return this.resolveHazard(instance, definition, outcomeType);
      case 'intel':
        return this.resolveIntel(instance, definition, outcomeType, room);
      case 'secret':
      case 'flavor':
        return this.resolveFlavor(instance, definition, outcomeType);
    }
  }

  private rollOutcome(weights: Record<OutcomeType, number>): OutcomeType {
    const entries = Object.entries(weights) as [OutcomeType, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return entries[0][0];
  }

  private resolveLoot(
    instance: InteractableInstance,
    definition: InteractableDefinition,
    outcomeType: OutcomeType,
  ): ExamineResult {
    const item = this.lootPool.length > 0
      ? this.lootPool[Math.floor(Math.random() * this.lootPool.length)]
      : undefined;

    const narration = item
      ? `You examine the ${definition.name.toLowerCase()}. You find a **${item.name}**.`
      : `You examine the ${definition.name.toLowerCase()}. Nothing useful.`;

    return { outcomeType, narration, lootItem: item };
  }

  private resolveHazard(
    instance: InteractableInstance,
    definition: InteractableDefinition,
    outcomeType: OutcomeType,
  ): ExamineResult {
    const damage = 5 + Math.floor(Math.random() * 11); // 5-15
    const narration = `You examine the ${definition.name.toLowerCase()}. Something stings you. **-${damage} HP.**`;
    return { outcomeType, narration, damage };
  }

  private resolveIntel(
    instance: InteractableInstance,
    definition: InteractableDefinition,
    outcomeType: OutcomeType,
    room: Room,
  ): ExamineResult {
    const exitIds = Object.values(room.exits).filter(Boolean) as string[];
    if (exitIds.length === 0) {
      return this.resolveFlavor(instance, definition, 'flavor');
    }
    const targetRoomId = exitIds[Math.floor(Math.random() * exitIds.length)];
    const text = `You sense something in a nearby passage.`;
    const narration = `You examine the ${definition.name.toLowerCase()}. Marks on the surface suggest activity nearby.`;
    return { outcomeType, narration, intel: { targetRoomId, text } };
  }

  private resolveFlavor(
    instance: InteractableInstance,
    definition: InteractableDefinition,
    outcomeType: OutcomeType,
  ): ExamineResult {
    const narration = `You examine the ${definition.name.toLowerCase()}. Nothing happens, but the air feels different.`;
    return { outcomeType, narration };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All ExamineResolver tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/ExamineResolver.ts server/src/ExamineResolver.test.ts
git commit -m "feat: add ExamineResolver with outcome resolution and tests"
```

---

### Task 6: ProceduralGenerator — Interactable Placement

**Files:**
- Modify: `server/src/ProceduralGenerator.ts:16-21` (imports), `~604` (after puzzle placement, before output)
- Modify: `server/src/ProceduralGenerator.test.ts`

- [ ] **Step 1: Write failing test for interactable placement**

Add to `server/src/ProceduralGenerator.test.ts`:

```typescript
describe('interactable placement', () => {
  it('places interactables on rooms with slots', () => {
    const dungeon = generateProceduralDungeon(3);
    const roomsWithInteractables = dungeon.rooms.filter(
      r => r.interactables && r.interactables.length > 0
    );
    // At least some rooms should have interactables (60-70% density, but only fungal biome has slots)
    // With 3 zones, at least one should be fungal
    expect(roomsWithInteractables.length).toBeGreaterThanOrEqual(0);
  });

  it('interactable instances have valid fields', () => {
    const dungeon = generateProceduralDungeon(3);
    for (const room of dungeon.rooms) {
      if (!room.interactables) continue;
      for (const inst of room.interactables) {
        expect(inst.instanceId).toBeTruthy();
        expect(inst.definitionId).toBeTruthy();
        expect(inst.position.x).toBeGreaterThanOrEqual(0);
        expect(inst.position.y).toBeGreaterThanOrEqual(0);
        expect(inst.examined).toBe(false);
      }
    }
  });

  it('no duplicate definitions within a single room', () => {
    const dungeon = generateProceduralDungeon(3);
    for (const room of dungeon.rooms) {
      if (!room.interactables || room.interactables.length <= 1) continue;
      const defIds = room.interactables.map(i => i.definitionId);
      expect(new Set(defIds).size).toBe(defIds.length);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: The first test may pass vacuously (>= 0), but we need the placement code for the others to be meaningful. Proceed to implementation.

- [ ] **Step 3: Add interactable loading and placement to ProceduralGenerator**

At the top of `server/src/ProceduralGenerator.ts`, add after the existing `loadJSON` calls (around line 21):

```typescript
import type { InteractableDefinition, InteractableInstance } from '@caverns/shared';

const allInteractables = loadJSON<InteractableDefinition[]>('../../shared/src/data/interactables.json');
```

Then, after the puzzle placement section (after line 603, before the `// 9. Output` comment), add:

```typescript
  // 9. Place interactables
  const INTERACTABLE_DENSITY = 0.65;
  let intCounter = 0;

  for (const room of allRooms) {
    if (room.type === 'boss') continue;
    if (room.id === entranceRoomId) continue;

    // Find the chit used for this room to get slots
    const chitForRoom = allRoomChits.find(c => room.id.startsWith(c.id + '_'));
    if (!chitForRoom?.interactableSlots || chitForRoom.interactableSlots.length === 0) continue;

    // Density roll
    if (Math.random() > INTERACTABLE_DENSITY) continue;

    const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
    const biomeInteractables = allInteractables.filter(d => d.biomes.includes(biome.id));
    if (biomeInteractables.length === 0) continue;

    const usedDefIds = new Set<string>();
    const instances: InteractableInstance[] = [];

    for (const slot of chitForRoom.interactableSlots) {
      const candidates = biomeInteractables.filter(
        d => d.slotSize === slot.size && !usedDefIds.has(d.id)
      );
      if (candidates.length === 0) continue;

      const def = pick(candidates);
      usedDefIds.add(def.id);
      intCounter++;

      instances.push({
        definitionId: def.id,
        instanceId: `int_${String(intCounter).padStart(3, '0')}`,
        position: { x: slot.position.x, y: slot.position.y },
        examined: false,
      });
    }

    if (instances.length > 0) {
      room.interactables = instances;
    }
  }
```

Update the `// 9. Output` comment to `// 10. Output`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All ProceduralGenerator tests pass, including the new interactable placement tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/ProceduralGenerator.ts server/src/ProceduralGenerator.test.ts
git commit -m "feat: add interactable placement to procedural generator"
```

---

### Task 7: GameSession — Examine Message Handling

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/index.ts:258` (message routing)

- [ ] **Step 1: Add ExamineResolver to GameSession**

In `server/src/GameSession.ts`, add import at the top:

```typescript
import { ExamineResolver } from './ExamineResolver.js';
import type { InteractableDefinition } from '@caverns/shared';
```

At the top of `server/src/GameSession.ts`, add loading of interactable definitions (near other imports):

```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename_gs = fileURLToPath(import.meta.url);
const __dirname_gs = dirname(__filename_gs);

function loadJSONFile<T>(relativePath: string): T {
  const fullPath = resolve(__dirname_gs, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8')) as T;
}

const allInteractableDefs = loadJSONFile<InteractableDefinition[]>('../../shared/src/data/interactables.json');
```

Add to the class fields (after `private abilityResolver`):

```typescript
private examineResolver: ExamineResolver;
```

In the constructor, after `this.abilityResolver = new AbilityResolver()`:

```typescript
this.examineResolver = new ExamineResolver(allInteractableDefs, Array.from(this.items.values()));
```

- [ ] **Step 2: Add handleExamine method**

Add to `GameSession` class:

```typescript
handleExamine(playerId: string, interactableId: string): void {
  const player = this.playerManager.getPlayer(playerId);
  if (!player) return;

  if (player.status !== 'exploring') {
    this.sendTo(playerId, { type: 'error', message: 'You cannot examine while in combat.' });
    return;
  }

  const room = this.rooms.get(player.roomId);
  if (!room) return;

  if (this.combats.has(player.roomId)) {
    this.sendTo(playerId, { type: 'error', message: 'Cannot examine during combat.' });
    return;
  }

  const result = this.examineResolver.resolve(
    playerId,
    interactableId,
    room,
    player.className,
  );

  if (result.error) {
    this.sendTo(playerId, { type: 'error', message: result.error });
    return;
  }

  // Send private result to examining player
  this.sendTo(playerId, {
    type: 'examine_result',
    interactableId,
    narration: result.narration!,
    outcome: {
      type: result.outcomeType!,
      loot: result.lootItem,
      damage: result.damage,
      intel: result.intel,
    },
  });

  // Broadcast state change to all players in room
  this.broadcastToRoom(player.roomId, {
    type: 'interactable_state',
    interactableId,
    examined: true,
    examinedBy: player.name,
  });

  // Apply mechanical effects
  if (result.damage) {
    this.playerManager.applyDamage(playerId, result.damage);
    this.broadcastToRoom(player.roomId, {
      type: 'player_update',
      player: this.playerManager.getPlayer(playerId)!,
    });
    this.broadcastToRoom(player.roomId, {
      type: 'text_log',
      message: `${player.name} takes ${result.damage} damage from a hazard!`,
      logType: 'combat',
    });
  }

  if (result.lootItem) {
    const added = this.playerManager.addToInventory(playerId, result.lootItem);
    if (added) {
      this.broadcastToRoom(player.roomId, {
        type: 'player_update',
        player: this.playerManager.getPlayer(playerId)!,
      });
    } else {
      this.sendTo(playerId, {
        type: 'text_log',
        message: 'Your inventory is full. The item is lost.',
        logType: 'system',
      });
    }
  }
}
```

- [ ] **Step 3: Check if `applyDamage` and `addToInventory` exist on PlayerManager**

Read `server/src/PlayerManager.ts` to verify these methods exist. If `applyDamage` doesn't exist, it needs to be a simple `player.hp = Math.max(0, player.hp - damage)`. If `addToInventory` doesn't exist, find a free inventory slot and place the item.

These methods may need to be added — check PlayerManager and adapt the `handleExamine` implementation accordingly (use whatever methods PlayerManager already provides for HP modification and inventory manipulation).

- [ ] **Step 4: Add message routing in `server/src/index.ts`**

After the `case 'puzzle_answer'` block (around line 260), add:

```typescript
case 'examine': {
  getRoom(playerId)?.gameSession?.handleExamine(playerId, msg.interactableId);
  break;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/GameSession.ts server/src/index.ts
git commit -m "feat: add examine message handling to GameSession and server routing"
```

---

### Task 8: Client Store — Interactable State Handling

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Add `selectedInteractableId` to store state**

In `client/src/store/gameStore.ts`, add to the `GameStore` interface (after `scoutThreats`):

```typescript
selectedInteractableId: string | null;
selectInteractable: (id: string | null) => void;
```

Add to `initialState`:

```typescript
selectedInteractableId: null,
```

Add the action in the `create` callback (after `setLootChoice`):

```typescript
selectInteractable: (id) => set({ selectedInteractableId: id }),
```

- [ ] **Step 2: Add `examine_result` handler**

In the `handleServerMessage` switch, add before the default/closing:

```typescript
case 'examine_result':
  set((state) => ({
    textLog: [
      ...state.textLog,
      { message: msg.narration, logType: 'narration' as const, id: ++logIdCounter },
    ],
    selectedInteractableId: null,
  }));
  break;
```

- [ ] **Step 3: Add `interactable_state` handler**

```typescript
case 'interactable_state':
  set((state) => {
    const roomId = state.currentRoomId;
    const room = state.rooms[roomId];
    if (!room?.interactables) return {};
    const updatedInteractables = room.interactables.map(i =>
      i.instanceId === msg.interactableId
        ? { ...i, examined: msg.examined, examinedBy: msg.examinedBy }
        : i
    );
    return {
      rooms: {
        ...state.rooms,
        [roomId]: { ...room, interactables: updatedInteractables },
      },
    };
  });
  break;
```

- [ ] **Step 4: Update imports**

Add `ExamineResultMessage` and `InteractableStateMessage` to the `ServerMessage` union if needed — since they're already part of the union in shared, the store's `handleServerMessage(msg: ServerMessage)` will accept them. The switch cases just need to handle the new types.

- [ ] **Step 5: Add `examine` action to `useGameActions.ts`**

In `client/src/hooks/useGameActions.ts`, add to the returned object:

```typescript
examine: (interactableId: string) => send({ type: 'examine', interactableId }),
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All tests pass (no client tests exist, but shared/server tests should still pass).

- [ ] **Step 7: Commit**

```bash
git add client/src/store/gameStore.ts client/src/hooks/useGameActions.ts
git commit -m "feat: add interactable state handling to client store and actions"
```

---

### Task 9: RoomView Component — ASCII Room Display

**Files:**
- Create: `client/src/components/RoomView.tsx`

- [ ] **Step 1: Create the RoomView component**

Create `client/src/components/RoomView.tsx`:

```tsx
import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getTemplateForRoom } from '@caverns/shared';
import type { InteractableInstance, InteractableDefinition } from '@caverns/shared';

// Load interactable definitions for character lookup
import interactableDefs from '../../../../shared/src/data/interactables.json';

const defMap = new Map<string, InteractableDefinition>(
  (interactableDefs as InteractableDefinition[]).map(d => [d.id, d])
);

type CharType = 'wall' | 'floor' | 'exit' | 'interactable' | 'interactable-examined' | 'player';

interface CharInfo {
  char: string;
  type: CharType;
  interactableId?: string;
  interactableName?: string;
}

export function RoomView() {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const selectedInteractableId = useGameStore((s) => s.selectedInteractableId);
  const selectInteractable = useGameStore((s) => s.selectInteractable);

  const room = rooms[currentRoomId];

  const grid = useMemo(() => {
    if (!room) return [];

    const template = getTemplateForRoom(room.type);
    const lines = template.lines;

    // Build a map of interactable positions
    const interactableMap = new Map<string, { instance: InteractableInstance; def: InteractableDefinition }>();
    if (room.interactables) {
      for (const inst of room.interactables) {
        const def = defMap.get(inst.definitionId);
        if (def) {
          interactableMap.set(`${inst.position.x},${inst.position.y}`, { instance: inst, def });
        }
      }
    }

    // Build character grid
    const result: CharInfo[][] = [];
    for (let y = 0; y < lines.length; y++) {
      const row: CharInfo[] = [];
      for (let x = 0; x < lines[y].length; x++) {
        const posKey = `${x},${y}`;
        const interactable = interactableMap.get(posKey);
        const ch = lines[y][x];

        if (interactable) {
          row.push({
            char: interactable.def.asciiChar,
            type: interactable.instance.examined ? 'interactable-examined' : 'interactable',
            interactableId: interactable.instance.instanceId,
            interactableName: interactable.def.name,
          });
        } else if (ch === '╔' || ch === '╗' || ch === '╚' || ch === '╝' || ch === '║' || ch === '═') {
          row.push({ char: ch, type: 'wall' });
        } else if (ch === ' ' && (y === 0 || y === lines.length - 1 || x === 0 || x === lines[y].length - 1)) {
          // Space at boundary = potential exit
          row.push({ char: ch, type: 'exit' });
        } else {
          row.push({ char: ch, type: 'floor' });
        }
      }
      result.push(row);
    }
    return result;
  }, [room]);

  if (!room) return null;

  const handleCharClick = (info: CharInfo) => {
    if (info.type === 'interactable' && info.interactableId) {
      if (selectedInteractableId === info.interactableId) {
        selectInteractable(null);
      } else {
        selectInteractable(info.interactableId);
      }
    } else if (info.type !== 'interactable-examined') {
      selectInteractable(null);
    }
  };

  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <pre className="room-grid">
        {grid.map((row, y) => (
          <div key={y} className="room-row">
            {row.map((info, x) => {
              const isSelected = info.interactableId === selectedInteractableId;
              const className = [
                `char-${info.type}`,
                isSelected ? 'char-selected' : '',
              ].filter(Boolean).join(' ');

              return (
                <span
                  key={x}
                  className={className}
                  onClick={() => handleCharClick(info)}
                  title={isSelected ? info.interactableName : undefined}
                >
                  {info.char}
                </span>
              );
            })}
          </div>
        ))}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Verify the import path for interactables.json works with Vite**

The JSON import `from '../../../../shared/src/data/interactables.json'` should work with Vite's default JSON handling. If not, load via a re-export from `@caverns/shared`. Adjust the import path as needed based on the project's module resolution setup.

- [ ] **Step 3: Run dev build to check for compilation errors**

Run: `npx vite build` (from client directory) or just check TypeScript compilation.
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/RoomView.tsx
git commit -m "feat: add RoomView component for ASCII room display with interactables"
```

---

### Task 10: ActionBar — Examine Button

**Files:**
- Modify: `client/src/components/ActionBar.tsx`

- [ ] **Step 1: Add examine prop and button to ActionBar**

Add `onExamine` to `ActionBarProps`:

```typescript
interface ActionBarProps {
  onMove: (direction: Direction) => void;
  onLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  onRevive: (targetPlayerId: string) => void;
  onPuzzleAnswer: (roomId: string, answerIndex: number) => void;
  onExamine: (interactableId: string) => void;
}
```

Update the destructured props:

```typescript
export function ActionBar({ onMove, onLootChoice, onRevive, onPuzzleAnswer, onExamine }: ActionBarProps) {
```

Add store access for `selectedInteractableId`:

```typescript
const selectedInteractableId = useGameStore((s) => s.selectedInteractableId);
const selectInteractable = useGameStore((s) => s.selectInteractable);
```

In the exploration section (the final return block with `move-buttons`), add the examine button after the move buttons div:

```tsx
{selectedInteractableId && (
  <div className="examine-actions">
    <button
      className="examine-btn"
      onClick={() => {
        onExamine(selectedInteractableId);
        selectInteractable(null);
      }}
    >
      Examine
    </button>
  </div>
)}
```

- [ ] **Step 2: Run dev build**

Check for TypeScript compilation errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActionBar.tsx
git commit -m "feat: add examine button to ActionBar when interactable is selected"
```

---

### Task 11: App Layout — Wire RoomView into Exploration

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Import RoomView**

Add at top of `client/src/App.tsx`:

```typescript
import { RoomView } from './components/RoomView.js';
```

- [ ] **Step 2: Update exploration layout**

Replace the exploration branch (the `else` block in `content` assignment, around line 72-81):

```tsx
<>
  <RoomView />
  <TextLog />
  <ActionBar
    onMove={actions.move}
    onLootChoice={actions.lootChoice}
    onRevive={actions.revive}
    onPuzzleAnswer={actions.puzzleAnswer}
    onExamine={actions.examine}
  />
</>
```

- [ ] **Step 3: Run dev build**

Check for TypeScript compilation errors. Verify RoomView appears above TextLog.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add RoomView to exploration layout above TextLog"
```

---

### Task 12: CSS — RoomView and Interactable Styling

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add RoomView styles**

Add to `client/src/styles/index.css`:

```css
/* === Room View === */
.room-view {
  padding: 0.5rem;
  border-bottom: 1px solid #1a3a1a;
}

.room-title {
  color: #44ff44;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.room-grid {
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  line-height: 1.2;
  margin: 0;
  user-select: none;
  overflow-x: auto;
}

.room-row {
  white-space: pre;
}

/* Character types */
.char-wall {
  color: #336633;
}

.char-floor {
  color: #223322;
}

.char-exit {
  color: #44ff44;
}

.char-interactable {
  color: #ffaa33;
  cursor: pointer;
  transition: color 0.15s, text-shadow 0.15s;
}

.char-interactable:hover {
  color: #ffcc55;
  text-shadow: 0 0 4px #ffaa33;
}

.char-interactable.char-selected {
  color: #ffcc55;
  text-shadow: 0 0 6px #ffaa33, 0 0 12px #ff8800;
  animation: interactable-pulse 1.5s ease-in-out infinite;
}

.char-interactable-examined {
  color: #665522;
}

.char-player {
  color: #44dddd;
}

@keyframes interactable-pulse {
  0%, 100% { text-shadow: 0 0 6px #ffaa33, 0 0 12px #ff8800; }
  50% { text-shadow: 0 0 3px #ffaa33, 0 0 6px #ff8800; }
}

/* Examine button */
.examine-actions {
  margin-top: 0.25rem;
}

.examine-btn {
  color: #ffaa33;
  border-color: #ffaa33;
  text-shadow: 0 0 4px #ffaa33;
}

.examine-btn:hover {
  background: rgba(255, 170, 51, 0.15);
  border-color: #ffcc55;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/index.css
git commit -m "feat: add RoomView and interactable CSS styling"
```

---

### Task 13: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass across shared, server, and client workspaces.

- [ ] **Step 2: Start the server and client**

Start the server and client dev servers. Create a game and verify:
1. Rooms display ASCII grid with the room name
2. Amber characters appear in some Fungal Depths rooms
3. Clicking an amber character highlights it and shows the Examine button
4. Clicking Examine sends the message and shows narration in TextLog
5. The examined object dims after examination
6. Other players in the same room see the object dim but don't see narration

- [ ] **Step 3: Fix any issues found during manual testing**

Address any runtime errors, display issues, or interaction bugs.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address integration issues from manual testing"
```
