# Generative Dungeon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static hand-authored dungeon with a Claude API-generated dungeon at game start, with difficulty selection, validation, and fallback to static content on failure.

**Architecture:** The server gains a `DungeonGenerator` module that calls the Claude API with a structured prompt and validates the response against the `DungeonContent` schema. The lobby adds difficulty selection and an API key field (host only). A new `generation_status` message type lets clients show a loading screen during generation. `GameSession` accepts a `DungeonContent` parameter instead of hardcoding `DRIPPING_HALLS`.

**Tech Stack:** Anthropic SDK (`@anthropic-ai/sdk`), existing shared types, Vitest for tests.

---

### Task 1: Install Anthropic SDK

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add the Anthropic SDK dependency**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm install @anthropic-ai/sdk --workspace=server
```

- [ ] **Step 2: Verify installation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe -e "require('@anthropic-ai/sdk')" --prefix server
```

Expected: No error output.

---

### Task 2: Update Message Protocol

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add new message types**

Add these interfaces and update the union types in `shared/src/messages.ts`:

```typescript
// Add to Client -> Server section:

export interface SetDifficultyMessage {
  type: 'set_difficulty';
  difficulty: 'easy' | 'medium' | 'hard';
}

// Update StartGameMessage:
export interface StartGameMessage {
  type: 'start_game';
  apiKey?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

// Add to Server -> Client section:

export interface GenerationStatusMessage {
  type: 'generation_status';
  status: 'generating' | 'failed';
  reason?: string;
}

// Update LobbyStateMessage:
export interface LobbyStateMessage {
  type: 'lobby_state';
  players: { id: string; name: string }[];
  hostId: string;
  yourId: string;
  difficulty: 'easy' | 'medium' | 'hard';
}
```

- [ ] **Step 2: Update the ClientMessage union**

Add `SetDifficultyMessage` to the `ClientMessage` union:

```typescript
export type ClientMessage =
  | JoinLobbyMessage
  | StartGameMessage
  | SetDifficultyMessage
  | MoveMessage
  | CombatActionMessage
  | LootChoiceMessage
  | ReviveMessage
  | EquipItemMessage
  | DropItemMessage
  | UseConsumableMessage;
```

- [ ] **Step 3: Update the ServerMessage union**

Add `GenerationStatusMessage` to the `ServerMessage` union:

```typescript
export type ServerMessage =
  | LobbyStateMessage
  | GameStartMessage
  | GenerationStatusMessage
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

- [ ] **Step 4: Build shared to verify types compile**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared
```

Expected: Clean compilation, no errors.

---

### Task 3: Add Difficulty to Lobby (Server)

**Files:**
- Modify: `server/src/Lobby.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add difficulty state to Lobby**

In `server/src/Lobby.ts`, add a `difficulty` field and a setter:

```typescript
import type { ServerMessage } from '@caverns/shared';

interface LobbyPlayer {
  id: string;
  name: string;
}

export class Lobby {
  private players: LobbyPlayer[] = [];
  private hostId: string | null = null;
  private difficulty: 'easy' | 'medium' | 'hard' = 'medium';
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

  getDifficulty(): 'easy' | 'medium' | 'hard' {
    return this.difficulty;
  }

  setDifficulty(playerId: string, difficulty: 'easy' | 'medium' | 'hard'): void {
    if (this.hostId !== playerId) return;
    this.difficulty = difficulty;
    this.broadcastState();
  }

  private broadcastState(): void {
    for (const p of this.players) {
      this.sendTo(p.id, {
        type: 'lobby_state',
        players: this.players,
        hostId: this.hostId!,
        yourId: p.id,
        difficulty: this.difficulty,
      });
    }
  }
}
```

- [ ] **Step 2: Add `set_difficulty` handler to server index**

In `server/src/index.ts`, add a case in the message switch:

```typescript
      case 'set_difficulty': {
        lobby.setDifficulty(playerId, msg.difficulty);
        break;
      }
```

Add this case after the `join_lobby` case in the switch statement.

- [ ] **Step 3: Build server to verify compilation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared && npm run build --workspace=server
```

Expected: Clean compilation.

---

### Task 4: Build Dungeon Validator

**Files:**
- Create: `server/src/DungeonValidator.ts`
- Create: `server/src/DungeonValidator.test.ts`

- [ ] **Step 1: Write tests for the validator**

Create `server/src/DungeonValidator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateDungeon } from './DungeonValidator.js';
import { DRIPPING_HALLS } from '@caverns/shared';

describe('DungeonValidator', () => {
  it('accepts a valid dungeon (DRIPPING_HALLS)', () => {
    const errors = validateDungeon(DRIPPING_HALLS, { minRooms: 6, maxRooms: 16 });
    expect(errors).toEqual([]);
  });

  it('rejects missing entranceRoomId reference', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      entranceRoomId: 'nonexistent_room',
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('entranceRoomId'));
  });

  it('rejects missing bossId reference', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      bossId: 'nonexistent_mob',
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('bossId'));
  });

  it('rejects room encounter referencing nonexistent mob', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'fungal_grotto'
          ? { ...r, encounter: { mobId: 'fake_mob', skullRating: 1 as const } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('fake_mob'));
  });

  it('rejects room loot referencing nonexistent item', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'fungal_grotto'
          ? { ...r, loot: [{ itemId: 'fake_item', location: 'chest' as const }] }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('fake_item'));
  });

  it('rejects mob lootTable referencing nonexistent item', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      mobs: DRIPPING_HALLS.mobs.map((m) =>
        m.id === 'fungal_crawler'
          ? { ...m, lootTable: ['nonexistent_weapon'] }
          : m
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('nonexistent_weapon'));
  });

  it('rejects non-bidirectional exits', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'entrance'
          ? { ...r, exits: { north: 'fungal_grotto', east: 'dripping_tunnel', west: 'boss_room' } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('bidirectional'));
  });

  it('rejects disconnected rooms', () => {
    const orphanRoom = {
      id: 'orphan',
      type: 'tunnel' as const,
      name: 'Orphan Room',
      description: 'Unreachable.',
      exits: {},
    };
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: [...DRIPPING_HALLS.rooms, orphanRoom],
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 20 });
    expect(errors).toContainEqual(expect.stringContaining('unreachable'));
  });

  it('rejects duplicate room IDs', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: [...DRIPPING_HALLS.rooms, DRIPPING_HALLS.rooms[0]],
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 20 });
    expect(errors).toContainEqual(expect.stringContaining('Duplicate'));
  });

  it('rejects room count outside range', () => {
    const errors = validateDungeon(DRIPPING_HALLS, { minRooms: 20, maxRooms: 30 });
    expect(errors).toContainEqual(expect.stringContaining('Room count'));
  });

  it('rejects entrance room with encounter', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'entrance'
          ? { ...r, encounter: { mobId: 'fungal_crawler', skullRating: 1 as const } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('Entrance room'));
  });

  it('rejects dungeon with no boss room', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.type === 'boss' ? { ...r, type: 'chamber' as const } : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('boss room'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/DungeonValidator.test.ts
```

Expected: FAIL — `DungeonValidator` module not found.

- [ ] **Step 3: Implement the validator**

Create `server/src/DungeonValidator.ts`:

```typescript
import type { DungeonContent } from '@caverns/shared';

export interface ValidationConstraints {
  minRooms: number;
  maxRooms: number;
}

export function validateDungeon(dungeon: DungeonContent, constraints: ValidationConstraints): string[] {
  const errors: string[] = [];

  // Build lookup sets
  const roomIds = new Set<string>();
  const mobIds = new Set<string>();
  const itemIds = new Set<string>();

  // Check for duplicate IDs
  for (const room of dungeon.rooms) {
    if (roomIds.has(room.id)) errors.push(`Duplicate room ID: "${room.id}"`);
    roomIds.add(room.id);
  }
  for (const mob of dungeon.mobs) {
    if (mobIds.has(mob.id)) errors.push(`Duplicate mob ID: "${mob.id}"`);
    mobIds.add(mob.id);
  }
  for (const item of dungeon.items) {
    if (itemIds.has(item.id)) errors.push(`Duplicate item ID: "${item.id}"`);
    itemIds.add(item.id);
  }

  // Referential integrity
  if (!roomIds.has(dungeon.entranceRoomId)) {
    errors.push(`entranceRoomId "${dungeon.entranceRoomId}" does not match any room`);
  }
  if (!mobIds.has(dungeon.bossId)) {
    errors.push(`bossId "${dungeon.bossId}" does not match any mob`);
  }

  for (const room of dungeon.rooms) {
    if (room.encounter && !mobIds.has(room.encounter.mobId)) {
      errors.push(`Room "${room.id}" encounter references nonexistent mob "${room.encounter.mobId}"`);
    }
    if (room.loot) {
      for (const loot of room.loot) {
        if (!itemIds.has(loot.itemId)) {
          errors.push(`Room "${room.id}" loot references nonexistent item "${loot.itemId}"`);
        }
      }
    }
  }

  for (const mob of dungeon.mobs) {
    for (const lootItemId of mob.lootTable) {
      if (!itemIds.has(lootItemId)) {
        errors.push(`Mob "${mob.id}" lootTable references nonexistent item "${lootItemId}"`);
      }
    }
  }

  // Bidirectional exits
  const roomMap = new Map(dungeon.rooms.map((r) => [r.id, r]));
  const opposites: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };

  for (const room of dungeon.rooms) {
    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (!targetId) continue;
      const target = roomMap.get(targetId);
      if (!target) {
        errors.push(`Room "${room.id}" exit ${dir} points to nonexistent room "${targetId}"`);
        continue;
      }
      const oppositeDir = opposites[dir];
      if (target.exits[oppositeDir as keyof typeof target.exits] !== room.id) {
        errors.push(`Exit not bidirectional: "${room.id}" -> ${dir} -> "${targetId}" but "${targetId}" does not exit ${oppositeDir} to "${room.id}"`);
      }
    }
  }

  // Graph connectivity (BFS from entrance)
  if (roomIds.has(dungeon.entranceRoomId)) {
    const visited = new Set<string>();
    const queue = [dungeon.entranceRoomId];
    visited.add(dungeon.entranceRoomId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const room = roomMap.get(current);
      if (!room) continue;
      for (const targetId of Object.values(room.exits)) {
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          queue.push(targetId);
        }
      }
    }
    for (const roomId of roomIds) {
      if (!visited.has(roomId)) {
        errors.push(`Room "${roomId}" is unreachable from entrance`);
      }
    }
  }

  // Constraint checks
  if (dungeon.rooms.length < constraints.minRooms || dungeon.rooms.length > constraints.maxRooms) {
    errors.push(`Room count ${dungeon.rooms.length} outside range [${constraints.minRooms}, ${constraints.maxRooms}]`);
  }

  const entranceRoom = roomMap.get(dungeon.entranceRoomId);
  if (entranceRoom?.encounter) {
    errors.push(`Entrance room must not have an encounter`);
  }

  const bossRooms = dungeon.rooms.filter((r) => r.type === 'boss');
  if (bossRooms.length !== 1) {
    errors.push(`Expected exactly 1 boss room, found ${bossRooms.length}`);
  }

  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/DungeonValidator.test.ts
```

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/DungeonValidator.ts server/src/DungeonValidator.test.ts
git commit -m "feat: add DungeonValidator with referential integrity and graph checks"
```

---

### Task 5: Build Dungeon Generator

**Files:**
- Create: `server/src/DungeonGenerator.ts`
- Create: `server/src/DungeonGenerator.test.ts`

- [ ] **Step 1: Write tests for the generator**

Create `server/src/DungeonGenerator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseDungeonResponse, DIFFICULTY_CONSTRAINTS } from './DungeonGenerator.js';

describe('buildSystemPrompt', () => {
  it('includes the DungeonContent schema', () => {
    const prompt = buildSystemPrompt('medium');
    expect(prompt).toContain('DungeonContent');
    expect(prompt).toContain('Room');
    expect(prompt).toContain('MobTemplate');
    expect(prompt).toContain('Item');
  });

  it('includes difficulty constraints for the selected tier', () => {
    const prompt = buildSystemPrompt('hard');
    const constraints = DIFFICULTY_CONSTRAINTS['hard'];
    expect(prompt).toContain(String(constraints.minRooms));
    expect(prompt).toContain(String(constraints.maxRooms));
  });

  it('includes design rules', () => {
    const prompt = buildSystemPrompt('easy');
    expect(prompt).toContain('bidirectional');
    expect(prompt).toContain('boss');
    expect(prompt).toContain('entranceRoomId');
  });
});

describe('parseDungeonResponse', () => {
  it('parses valid JSON from a clean response', () => {
    const json = JSON.stringify({ name: 'Test', theme: 'test', atmosphere: 'test', rooms: [], mobs: [], items: [], bossId: 'b', entranceRoomId: 'e' });
    const result = parseDungeonResponse(json);
    expect(result.name).toBe('Test');
  });

  it('extracts JSON from markdown code fences', () => {
    const response = '```json\n{"name":"Test","theme":"t","atmosphere":"a","rooms":[],"mobs":[],"items":[],"bossId":"b","entranceRoomId":"e"}\n```';
    const result = parseDungeonResponse(response);
    expect(result.name).toBe('Test');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDungeonResponse('not json at all')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/DungeonGenerator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generator**

Create `server/src/DungeonGenerator.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { DungeonContent } from '@caverns/shared';
import { DRIPPING_HALLS } from '@caverns/shared';
import { validateDungeon } from './DungeonValidator.js';

export const DIFFICULTY_CONSTRAINTS = {
  easy: {
    minRooms: 6, maxRooms: 8,
    skull1Mobs: '2-3', skull2Mobs: '0-1',
    bossHp: '100-150', bossDmg: '15-20', bossDef: '4-6',
    consumableDrops: '4-6', equipmentDrops: '4-6',
    skull1Hp: '15-25', skull1Dmg: '6-10',
    skull2Hp: '40-60', skull2Dmg: '10-16',
  },
  medium: {
    minRooms: 9, maxRooms: 12,
    skull1Mobs: '3-4', skull2Mobs: '1-2',
    bossHp: '150-250', bossDmg: '20-30', bossDef: '6-10',
    consumableDrops: '3-5', equipmentDrops: '5-8',
    skull1Hp: '20-35', skull1Dmg: '8-12',
    skull2Hp: '50-80', skull2Dmg: '14-22',
  },
  hard: {
    minRooms: 12, maxRooms: 16,
    skull1Mobs: '3-5', skull2Mobs: '2-3',
    bossHp: '250-400', bossDmg: '28-40', bossDef: '9-14',
    consumableDrops: '2-4', equipmentDrops: '6-10',
    skull1Hp: '30-50', skull1Dmg: '10-16',
    skull2Hp: '70-110', skull2Dmg: '18-28',
  },
} as const;

export type Difficulty = keyof typeof DIFFICULTY_CONSTRAINTS;

export function buildSystemPrompt(difficulty: Difficulty): string {
  const c = DIFFICULTY_CONSTRAINTS[difficulty];
  return `You are a dungeon designer for a cooperative dungeon crawler called Caverns.

Return ONLY valid JSON matching this TypeScript interface (no markdown, no explanation):

interface DungeonContent {
  name: string;           // dungeon name
  theme: string;          // short theme description
  atmosphere: string;     // atmospheric description
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];
  bossId: string;         // must match a mob id
  entranceRoomId: string; // must match a room id
}

interface Room {
  id: string;             // unique snake_case
  type: 'tunnel' | 'chamber' | 'cavern' | 'dead_end' | 'boss';
  name: string;
  description: string;    // 2-3 evocative sentences
  exits: Partial<Record<'north' | 'south' | 'east' | 'west', string>>; // direction -> room id
  encounter?: { mobId: string; skullRating: 1 | 2 | 3 };
  loot?: { itemId: string; location: 'chest' | 'floor' | 'hidden' }[];
}

interface MobTemplate {
  id: string;             // unique snake_case
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;     // 1-10
  lootTable: string[];    // item ids
}

interface Item {
  id: string;             // unique snake_case
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  slot: 'weapon' | 'offhand' | 'armor' | 'accessory' | 'consumable';
  stats: {
    damage?: number;
    defense?: number;
    maxHp?: number;
    initiative?: number;
    healAmount?: number;  // only for consumables
  };
}

DIFFICULTY: ${difficulty.toUpperCase()}

CONSTRAINTS:
- Room count: ${c.minRooms}-${c.maxRooms}
- 1-skull mobs (encounters): ${c.skull1Mobs}
- 2-skull mobs (encounters): ${c.skull2Mobs}
- 1-skull mob stats: HP ${c.skull1Hp}, damage ${c.skull1Dmg}, defense 1-5, initiative 1-10
- 2-skull mob stats: HP ${c.skull2Hp}, damage ${c.skull2Dmg}, defense 3-8, initiative 1-10
- Boss (3-skull): HP ${c.bossHp}, damage ${c.bossDmg}, defense ${c.bossDef}, initiative 1-10
- Consumable items (healing potions, etc.): ${c.consumableDrops} total across room loot and mob loot tables
- Equipment items (weapons, armor, etc.): ${c.equipmentDrops} total across room loot and mob loot tables
- Loot should be generous — a good run should feel like a power fantasy

DESIGN RULES:
- Exactly one boss room with type 'boss'
- All rooms must be reachable from the entrance room (no orphans)
- Room exits MUST be bidirectional: if room A exits north to room B, room B MUST exit south to room A
- Each mobId in room encounters must exist in the mobs array
- Each itemId in room loot and mob lootTable must exist in the items array
- bossId must match the boss mob's id
- entranceRoomId must match the entrance room's id
- Entrance room must have no encounter
- All IDs must be unique snake_case strings within their category
- Be creative with the theme, names, and descriptions — make each dungeon unique and atmospheric`;
}

export function parseDungeonResponse(response: string): DungeonContent {
  let text = response.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return JSON.parse(text) as DungeonContent;
}

export interface GenerationResult {
  success: boolean;
  dungeon: DungeonContent;
  generated: boolean;
  error?: string;
}

export async function generateDungeon(
  apiKey: string,
  difficulty: Difficulty
): Promise<GenerationResult> {
  const constraints = DIFFICULTY_CONSTRAINTS[difficulty];
  const systemPrompt = buildSystemPrompt(difficulty);

  const client = new Anthropic({ apiKey });

  let lastErrors: string[] | undefined;
  let lastResponse: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: `Generate a ${difficulty} dungeon.` },
      ];

      if (attempt === 1 && lastErrors) {
        messages.push(
          { role: 'assistant', content: lastResponse! },
          { role: 'user', content: `Your previous response had these errors:\n${lastErrors.join('\n')}\n\nFix them and return the complete corrected JSON.` },
        );
      }

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      lastResponse = text;

      const dungeon = parseDungeonResponse(text);
      const errors = validateDungeon(dungeon, { minRooms: constraints.minRooms, maxRooms: constraints.maxRooms });

      if (errors.length === 0) {
        return { success: true, dungeon, generated: true };
      }

      lastErrors = errors;
      console.log(`Generation attempt ${attempt + 1} validation failed:`, errors);
    } catch (err) {
      console.error(`Generation attempt ${attempt + 1} error:`, err);
      lastErrors = [(err as Error).message];
      lastResponse = undefined;
    }
  }

  // Fallback
  return {
    success: false,
    dungeon: DRIPPING_HALLS,
    generated: false,
    error: lastErrors ? lastErrors.join('; ') : 'Unknown generation error',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/DungeonGenerator.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/DungeonGenerator.ts server/src/DungeonGenerator.test.ts
git commit -m "feat: add DungeonGenerator with prompt builder, parser, and API integration"
```

---

### Task 6: Wire GameSession to Accept DungeonContent

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/GameSession.test.ts`

- [ ] **Step 1: Write a test for GameSession with custom DungeonContent**

Add this test to `server/src/GameSession.test.ts`:

```typescript
  it('accepts custom DungeonContent', () => {
    const messages: { playerId: string; msg: any }[] = [];
    const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
    const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };

    const customDungeon = {
      name: 'Test Dungeon',
      theme: 'test',
      atmosphere: 'test',
      entranceRoomId: 'start',
      bossId: 'test_boss',
      rooms: [
        { id: 'start', type: 'tunnel' as const, name: 'Start', description: 'The beginning.', exits: { north: 'boss' } },
        { id: 'boss', type: 'boss' as const, name: 'Boss Room', description: 'The end.', exits: { south: 'start' }, encounter: { mobId: 'test_boss', skullRating: 3 as const } },
      ],
      mobs: [{ id: 'test_boss', name: 'Test Boss', description: 'A test.', skullRating: 3 as const, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };

    const session = new GameSession(broadcast, sendTo, customDungeon);
    session.addPlayer('p1', 'Alice');
    session.startGame();
    expect(session.getPlayerRoom('p1')).toBe('start');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/GameSession.test.ts
```

Expected: FAIL — `GameSession` constructor does not accept a third argument.

- [ ] **Step 3: Update GameSession constructor**

Modify `server/src/GameSession.ts`. Change the constructor to accept an optional `DungeonContent` parameter:

Replace the constructor and the `startGame` method's hardcoded `DRIPPING_HALLS` reference:

```typescript
import {
  type Room,
  type MobTemplate,
  type MobInstance,
  type Item,
  type Direction,
  type Player,
  type DungeonContent,
  type ServerMessage,
  DRIPPING_HALLS,
  MOB_ASCII_ART,
} from '@caverns/shared';
```

Update the constructor:

```typescript
  private content: DungeonContent;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void,
    content?: DungeonContent
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;
    this.broadcastToRoom = (roomId: string, msg: ServerMessage) => {
      for (const p of this.playerManager.getPlayersInRoom(roomId)) {
        this.sendTo(p.id, msg);
      }
    };
    this.content = content ?? DRIPPING_HALLS;
    this.rooms = new Map(this.content.rooms.map((r) => [r.id, r]));
    this.mobs = new Map(this.content.mobs.map((m) => [m.id, m]));
    this.items = new Map(this.content.items.map((i) => [i.id, i]));
    this.lootManager = new LootManager((itemId, winnerId) => {
      this.handleLootAwarded(itemId, winnerId);
    });
  }
```

Update `startGame()` to use `this.content.entranceRoomId` instead of `DRIPPING_HALLS.entranceRoomId`:

```typescript
  startGame(): void {
    this.started = true;
    const entranceId = this.content.entranceRoomId;
```

- [ ] **Step 4: Run all GameSession tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/GameSession.test.ts
```

Expected: All tests PASS (existing tests still work because `content` defaults to `DRIPPING_HALLS`).

- [ ] **Step 5: Commit**

```bash
git add server/src/GameSession.ts server/src/GameSession.test.ts
git commit -m "feat: GameSession accepts optional DungeonContent parameter"
```

---

### Task 7: Wire Server Index for Generation Flow

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update the start_game handler**

Replace the `start_game` case in `server/src/index.ts` with the generation flow:

```typescript
      case 'start_game': {
        if (!lobby.isHost(playerId)) {
          sendTo(playerId, { type: 'error', message: 'Only the host can start the game.' });
          break;
        }

        const difficulty = msg.difficulty ?? lobby.getDifficulty();
        const apiKey = msg.apiKey;

        if (!apiKey) {
          // No API key — use static dungeon immediately
          gameSession = new GameSession(broadcast, sendTo);
          for (const p of lobby.getPlayers()) {
            gameSession.addPlayer(p.id, p.name);
          }
          gameSession.startGame();
          break;
        }

        // Start generation
        broadcast({ type: 'generation_status', status: 'generating' });

        generateDungeon(apiKey, difficulty).then((result) => {
          if (!result.generated) {
            broadcast({
              type: 'generation_status',
              status: 'failed',
              reason: result.error ?? 'Generation failed',
            });
          }

          gameSession = new GameSession(broadcast, sendTo, result.dungeon);
          for (const p of lobby.getPlayers()) {
            gameSession.addPlayer(p.id, p.name);
          }
          gameSession.startGame();

          if (!result.generated) {
            broadcast({
              type: 'text_log',
              message: 'Dungeon generation failed \u2014 playing The Dripping Halls instead.',
              logType: 'system',
            });
          }
        });

        break;
      }
```

- [ ] **Step 2: Add the import**

Add this import at the top of `server/src/index.ts`:

```typescript
import { generateDungeon } from './DungeonGenerator.js';
```

- [ ] **Step 3: Build server to verify compilation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared && npm run build --workspace=server
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire generation flow into start_game with fallback"
```

---

### Task 8: Update Client Store for Generation Status

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add generation state and handler**

In `client/src/store/gameStore.ts`, add to the `GameStore` interface:

```typescript
  generationStatus: 'idle' | 'generating' | 'failed';
  generationError: string | null;
  lobbyDifficulty: 'easy' | 'medium' | 'hard';
```

Add to `initialState`:

```typescript
  generationStatus: 'idle' as const,
  generationError: null,
  lobbyDifficulty: 'medium' as const,
```

Add the `generation_status` case to `handleServerMessage`:

```typescript
      case 'generation_status':
        set({
          generationStatus: msg.status,
          generationError: msg.reason ?? null,
        });
        break;
```

Update the `lobby_state` case to include difficulty:

```typescript
      case 'lobby_state':
        set({
          connectionStatus: 'in_lobby',
          lobbyPlayers: msg.players,
          isHost: msg.hostId === msg.yourId,
          playerId: msg.yourId,
          lobbyDifficulty: msg.difficulty,
        });
        break;
```

Update the `game_start` case to reset generation status:

```typescript
      case 'game_start':
        set({
          connectionStatus: 'in_game',
          generationStatus: 'idle',
          generationError: null,
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
```

- [ ] **Step 2: Build client to verify compilation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared && npm run build --workspace=client
```

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add client/src/store/gameStore.ts
git commit -m "feat: add generation status and difficulty to client store"
```

---

### Task 9: Update Lobby UI with Difficulty and API Key

**Files:**
- Modify: `client/src/components/Lobby.tsx`
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Update useGameActions**

In `client/src/hooks/useGameActions.ts`, update the `startGame` and add `setDifficulty`:

```typescript
    startGame: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') =>
      send({ type: 'start_game', apiKey, difficulty }),
    setDifficulty: (difficulty: 'easy' | 'medium' | 'hard') =>
      send({ type: 'set_difficulty', difficulty }),
```

- [ ] **Step 2: Update Lobby props and App.tsx**

In `client/src/components/Lobby.tsx`, update the props:

```typescript
interface LobbyProps {
  onJoin: (name: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}
```

In `client/src/App.tsx`, update the `Lobby` usage:

```typescript
    content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} />;
```

- [ ] **Step 3: Update Lobby component with API key and difficulty UI**

Replace the joined/waiting section of `client/src/components/Lobby.tsx`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';

interface LobbyProps {
  onJoin: (name: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}

export function Lobby({ onJoin, onStart, onSetDifficulty }: LobbyProps) {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers);
  const isHost = useGameStore((s) => s.isHost);
  const difficulty = useGameStore((s) => s.lobbyDifficulty);
  const inputRef = useRef<HTMLDivElement>(null);

  const handleJoin = useCallback(() => {
    if (name.trim()) {
      onJoin(name.trim());
      setJoined(true);
    }
  }, [name, onJoin]);

  useEffect(() => {
    if (joined) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleJoin();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 20 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [joined, handleJoin]);

  if (!joined) {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label">&gt; ENTER YOUR NAME_</p>
        <div className="dos-input" ref={inputRef}>
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        <button onClick={handleJoin} disabled={!name.trim()}>
          Join
        </button>
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

      <div className="lobby-difficulty">
        <span className="lobby-label">Difficulty:</span>
        <div className="difficulty-buttons">
          {(['easy', 'medium', 'hard'] as const).map((d) => (
            <button
              key={d}
              className={`difficulty-btn ${d === difficulty ? 'active' : ''}`}
              onClick={() => onSetDifficulty(d)}
              disabled={!isHost}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isHost && (
        <div className="lobby-apikey">
          <label className="lobby-label" htmlFor="apikey-input">
            API Key (optional):
          </label>
          <input
            id="apikey-input"
            type="password"
            className="apikey-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
          />
          <p className="apikey-hint">Leave empty to play the static dungeon</p>
        </div>
      )}

      {isHost && (
        <button
          className="lobby-start"
          onClick={() => onStart(apiKey || undefined, difficulty)}
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

- [ ] **Step 4: Build client to verify compilation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared && npm run build --workspace=client
```

Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Lobby.tsx client/src/hooks/useGameActions.ts client/src/App.tsx
git commit -m "feat: add difficulty selector and API key input to lobby"
```

---

### Task 10: Add Loading Screen

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add loading screen to App.tsx**

In `client/src/App.tsx`, add the generation status check. Update the imports and add the generation state:

```typescript
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
  const generationStatus = useGameStore((s) => s.generationStatus);
  const generationError = useGameStore((s) => s.generationError);

  let content;

  if (connectionStatus === 'disconnected') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p>Connecting to server...</p>
      </div>
    );
  } else if (generationStatus === 'generating') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p className="generation-text">The caverns shift and groan...</p>
        <div className="generation-spinner" />
      </div>
    );
  } else if (generationStatus === 'failed') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p className="generation-text generation-failed">
          The darkness resists... falling back to The Dripping Halls
        </p>
      </div>
    );
  } else if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} />;
  } else if (gameOver) {
    content = (
      <div className="screen-center">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The dungeon has been conquered!'
            : 'Your party has fallen in the darkness...'}
        </p>
      </div>
    );
  } else {
    content = (
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
          <PlayerHUD onEquipItem={actions.equipItem} onDropItem={actions.dropItem} onUseConsumable={actions.useConsumable} />
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      <div className="crt-overlay" />
    </>
  );
}
```

Note: The victory text now says "The dungeon has been conquered!" instead of referencing the Mycelium King specifically, since the dungeon may be generated.

- [ ] **Step 2: Add loading screen CSS**

Add these styles to `client/src/styles/index.css`:

```css
/* Generation loading screen */
.generation-text {
  font-size: 1.2rem;
  animation: pulse-glow 2s ease-in-out infinite;
}

.generation-failed {
  color: #ff6b6b;
}

.generation-spinner {
  width: 20px;
  height: 20px;
  margin: 1rem auto;
  border: 2px solid var(--color-dim);
  border-top-color: var(--color-text);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Lobby difficulty and API key */
.lobby-difficulty {
  margin: 1rem 0;
  text-align: center;
}

.lobby-label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--color-dim);
  font-size: 0.85rem;
  text-transform: uppercase;
}

.difficulty-buttons {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.difficulty-btn {
  padding: 0.3rem 0.8rem;
  font-size: 0.85rem;
  opacity: 0.5;
}

.difficulty-btn.active {
  opacity: 1;
  border-color: var(--color-text);
}

.difficulty-btn:disabled {
  cursor: default;
}

.lobby-apikey {
  margin: 1rem 0;
  text-align: center;
}

.apikey-input {
  background: var(--color-bg);
  border: 1px solid var(--color-dim);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.85rem;
  padding: 0.4rem 0.6rem;
  width: 280px;
  max-width: 100%;
}

.apikey-input::placeholder {
  color: var(--color-dim);
  opacity: 0.5;
}

.apikey-hint {
  font-size: 0.7rem;
  color: var(--color-dim);
  margin-top: 0.3rem;
  opacity: 0.6;
}
```

- [ ] **Step 3: Build client to verify compilation**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace=shared && npm run build --workspace=client
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/styles/index.css
git commit -m "feat: add loading screen and lobby styling for generation"
```

---

### Task 11: Run Full Test Suite and Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test
```

Expected: All tests pass (existing + new DungeonValidator + DungeonGenerator tests).

- [ ] **Step 2: Build everything**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build
```

Expected: Clean compilation across all workspaces.

- [ ] **Step 3: Manual smoke test — static fallback**

Start the dev servers and verify:
1. Join lobby, do NOT enter an API key
2. Click "Enter the Caverns"
3. Game should start immediately with The Dripping Halls (same as before)

- [ ] **Step 4: Manual smoke test — generation**

1. Join lobby, enter a valid Anthropic API key
2. Select a difficulty
3. Click "Enter the Caverns"
4. Loading screen should appear: "The caverns shift and groan..."
5. After generation completes, game should start with a unique dungeon
6. Verify rooms, mobs, and items work correctly (move around, trigger combat, collect loot)

- [ ] **Step 5: Manual smoke test — failed generation**

1. Join lobby, enter an invalid API key (e.g., "sk-ant-invalid")
2. Click "Enter the Caverns"
3. Loading screen should appear, then show failure message
4. Game should start with The Dripping Halls
5. Text log should show "Dungeon generation failed" message
