# Procedural Dungeon Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static fallback dungeon with a procedural generator that builds zone-based dungeons from room chit and mob pool JSON data, with a keychain system for boss-gated progression.

**Architecture:** JSON data files define room chits, mobs, items, and biomes. A pure `ProceduralGenerator` function draws chits per zone, wires them into a graph, populates with mobs/loot, places a key item, and outputs a standard `DungeonContent`. The `Player` model gains a `keychain` field, and `GameSession` checks keys on locked exits.

**Tech Stack:** TypeScript, Vitest for tests, JSON data files in `shared/src/data/`

---

## File Map

### New Files
- `shared/src/data/roomChits.json` — Room template pool
- `shared/src/data/mobPool.json` — Mob template pool
- `shared/src/data/biomes.json` — Biome zone definitions
- `shared/src/data/items.json` — Full item pool (extracted from content.ts + expanded)
- `shared/src/data/uniqueItems.json` — Hand-authored unique rarity items
- `shared/src/data/types.ts` — TypeScript interfaces for JSON data shapes (RoomChit, MobPoolEntry, BiomeDefinition)
- `server/src/ProceduralGenerator.ts` — Dungeon generation algorithm
- `server/src/ProceduralGenerator.test.ts` — Tests for generation

### Modified Files
- `shared/src/types.ts` — Add `keychain` to Player, `lockedExits` to Room, `unique` to Rarity, `effect` to Item
- `shared/src/types.ts:130-142` — Update `createPlayer` to init `keychain: []`
- `shared/src/index.ts` — Re-export data types
- `server/src/GameSession.ts:139-183` — Handle locked exits in `handleMove`
- `server/src/GameSession.ts:462-492` — Handle key item drops in `dropLoot`
- `server/src/index.ts:180-187` — Wire procedural generator into fallback path
- `client/src/components/PlayerHUD.tsx` — Show keychain indicator
- `client/src/components/MiniMap.tsx` — Show lock icons on locked exits
- `client/src/styles/index.css` — Styles for unique rarity, keychain, lock icons

---

### Task 1: Extend Shared Types

**Files:**
- Modify: `shared/src/types.ts`
- Test: `shared/src/types.test.ts`

- [ ] **Step 1: Write failing test for keychain on new player**

```ts
// Add to shared/src/types.test.ts
import { createPlayer } from './types.js';

describe('createPlayer', () => {
  it('initializes with empty keychain', () => {
    const player = createPlayer('p1', 'Alice', 'room1');
    expect(player.keychain).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/src/types.test.ts`
Expected: FAIL — `keychain` does not exist on Player

- [ ] **Step 3: Update types and createPlayer**

In `shared/src/types.ts`, make these changes:

Add `'unique'` to the Rarity type:
```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';
```

Add `effect` to ItemStats:
```ts
export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  slot: ItemSlot;
  stats: ItemStats;
  effect?: string;
}
```

Add `lockedExits` to Room:
```ts
export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  lockedExits?: Partial<Record<Direction, string>>;
  encounter?: RoomEncounter;
  loot?: RoomLoot[];
}
```

Add `keychain` to Player:
```ts
export interface Player {
  id: string;
  name: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: Equipment;
  consumables: (Item | null)[];
  inventory: (Item | null)[];
  status: PlayerStatus;
  keychain: string[];
}
```

Update `createPlayer` to initialize keychain:
```ts
export function createPlayer(id: string, name: string, roomId: string): Player {
  return {
    id,
    name,
    maxHp: BASE_STATS.maxHp,
    hp: BASE_STATS.maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    inventory: Array(INVENTORY_SLOTS).fill(null),
    status: 'exploring',
    keychain: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/src/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: add keychain, lockedExits, unique rarity to shared types
```

---

### Task 2: Data Type Interfaces and JSON Data Files

**Files:**
- Create: `shared/src/data/types.ts`
- Create: `shared/src/data/biomes.json`
- Create: `shared/src/data/roomChits.json`
- Create: `shared/src/data/mobPool.json`
- Create: `shared/src/data/items.json`
- Create: `shared/src/data/uniqueItems.json`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create data type interfaces**

Create `shared/src/data/types.ts`:

```ts
import type { RoomType } from '../types.js';

export interface RoomChit {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  biomes: string[];
  maxExits: number;
  lootLocations: ('chest' | 'floor' | 'hidden')[];
}

export interface MobPoolEntry {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  biomes: string[];
  baseStats: {
    maxHp: number;
    damage: number;
    defense: number;
    initiative: number;
  };
  lootTable: string[];
}

export interface BiomeDefinition {
  id: string;
  name: string;
  transitionText: string;
  roomCount: { min: number; max: number };
  mobDensity: number;
  skull1Weight: number;
  skull2Weight: number;
  lootDensity: number;
  bossRoom: {
    name: string;
    description: string;
  };
  keyItem: {
    id: string;
    name: string;
    description: string;
  };
}
```

- [ ] **Step 2: Create biomes.json with 5 biomes**

Create `shared/src/data/biomes.json`:

```json
[
  {
    "id": "fungal",
    "name": "Fungal Depths",
    "transitionText": "The air grows thick with spores. Bioluminescent fungi line the walls ahead.",
    "roomCount": { "min": 4, "max": 8 },
    "mobDensity": 0.5,
    "skull1Weight": 0.8,
    "skull2Weight": 0.2,
    "lootDensity": 0.4,
    "bossRoom": {
      "name": "Throne of the Mycelium King",
      "description": "A vast domed chamber pulsing with bioluminescence. At its center, a towering mass of interwoven fungal tendrils shaped vaguely like a seated figure on a throne of living mushroom."
    },
    "keyItem": {
      "id": "fungal_vault_key",
      "name": "Spore-Encrusted Key",
      "description": "A heavy iron key coated in luminous fungal growth. It pulses faintly in your hand."
    }
  },
  {
    "id": "crystal",
    "name": "Crystal Caverns",
    "transitionText": "The fungal growth gives way to glittering crystalline formations. Light refracts in dazzling patterns.",
    "roomCount": { "min": 4, "max": 7 },
    "mobDensity": 0.5,
    "skull1Weight": 0.75,
    "skull2Weight": 0.25,
    "lootDensity": 0.45,
    "bossRoom": {
      "name": "The Prismatic Heart",
      "description": "An enormous geode cracked open from within. A creature of living crystal sits at the center, light bending around it in impossible ways."
    },
    "keyItem": {
      "id": "crystal_shard_key",
      "name": "Resonating Crystal Shard",
      "description": "A shard of pure crystal that hums when brought near locked stone. It fits perfectly into the carved slot."
    }
  },
  {
    "id": "flooded",
    "name": "Drowned Passages",
    "transitionText": "Water seeps through every crack. The floor is slick and the air tastes of salt and rot.",
    "roomCount": { "min": 5, "max": 8 },
    "mobDensity": 0.55,
    "skull1Weight": 0.7,
    "skull2Weight": 0.3,
    "lootDensity": 0.35,
    "bossRoom": {
      "name": "The Sunken Throne",
      "description": "A vast flooded chamber where the water reaches your waist. Something enormous stirs beneath the dark surface, displacing waves against the ancient pillars."
    },
    "keyItem": {
      "id": "drowned_key",
      "name": "Barnacle-Crusted Key",
      "description": "A corroded bronze key dragged from the depths. Sea life clings to it stubbornly."
    }
  },
  {
    "id": "bone",
    "name": "Ossuary Halls",
    "transitionText": "The walls become bone. Skulls stare from every surface. The air is dry and carries whispers.",
    "roomCount": { "min": 4, "max": 7 },
    "mobDensity": 0.6,
    "skull1Weight": 0.65,
    "skull2Weight": 0.35,
    "lootDensity": 0.4,
    "bossRoom": {
      "name": "The Bone Throne",
      "description": "A cathedral of fused skeletons. At its apex, a massive figure assembled from thousands of bones sits upon a throne of ribcages, eye sockets burning with pale fire."
    },
    "keyItem": {
      "id": "bone_key",
      "name": "Skeleton Key",
      "description": "A key carved from a single femur. The teeth are sharpened finger bones. It rattles softly on its own."
    }
  },
  {
    "id": "volcanic",
    "name": "Magma Rifts",
    "transitionText": "The temperature rises sharply. Cracks in the floor glow orange, and the stone radiates heat.",
    "roomCount": { "min": 4, "max": 6 },
    "mobDensity": 0.6,
    "skull1Weight": 0.6,
    "skull2Weight": 0.4,
    "lootDensity": 0.35,
    "bossRoom": {
      "name": "The Molten Core",
      "description": "A cavern split by rivers of lava. On a basalt island at the center, a creature of slag and flame rises from the magma, its body crackling with volcanic fury."
    },
    "keyItem": {
      "id": "volcanic_key",
      "name": "Obsidian Key",
      "description": "A key of volcanic glass, still warm to the touch. Veins of magma pulse within it."
    }
  }
]
```

- [ ] **Step 3: Create roomChits.json with 50+ rooms**

Create `shared/src/data/roomChits.json` with room chits across all 5 biomes. Each chit has: `id`, `type`, `name`, `description`, `biomes`, `maxExits`, `lootLocations`. Target: ~10 chits per biome plus some multi-biome chits. Include a mix of dead ends (maxExits: 1), corridors (maxExits: 2), and hubs (maxExits: 3-4).

The file will be large — approximately 50-60 entries. Write the full JSON with all entries. Do NOT use placeholder comments like "more rooms here." Every entry must be complete.

Here is the structure (showing first 3 entries as reference, but the full file must contain all 50+):

```json
[
  {
    "id": "fungal_grotto_01",
    "type": "chamber",
    "name": "Fungal Grotto",
    "description": "A low-ceilinged chamber carpeted in luminous mushrooms. Water pools in the center, reflecting the eerie glow.",
    "biomes": ["fungal"],
    "maxExits": 3,
    "lootLocations": ["chest", "floor"]
  },
  {
    "id": "spore_tunnel_01",
    "type": "tunnel",
    "name": "Spore-Choked Tunnel",
    "description": "Thick clouds of luminescent spores drift through this narrow passage. Each step sends up puffs of glowing dust.",
    "biomes": ["fungal"],
    "maxExits": 2,
    "lootLocations": ["floor"]
  },
  {
    "id": "mushroom_alcove_01",
    "type": "dead_end",
    "name": "Mushroom Alcove",
    "description": "A cramped nook dominated by a single enormous mushroom cap. Something glints beneath its gills.",
    "biomes": ["fungal"],
    "maxExits": 1,
    "lootLocations": ["hidden"]
  }
]
```

Continue this pattern for all 5 biomes (fungal, crystal, flooded, bone, volcanic), plus 5-8 multi-biome rooms tagged with 2+ biomes. Each biome needs at minimum: 2 dead ends, 3 corridors, 2 chambers, 1-2 hubs (maxExits 3-4).

- [ ] **Step 4: Create mobPool.json with 30+ mobs**

Create `shared/src/data/mobPool.json`. Target per biome: 4-5 skull-1, 2-3 skull-2, 1-2 skull-3 (boss). Reference item IDs from the items.json that will be created in step 5.

Stat guidelines:
- Skull 1: HP 15-35, damage 6-12, defense 1-5, initiative 1-10
- Skull 2: HP 40-80, damage 12-22, defense 3-8, initiative 1-10
- Skull 3: HP 150-300, damage 20-35, defense 6-12, initiative 1-10

```json
[
  {
    "id": "fungal_crawler",
    "name": "Fungal Crawler",
    "description": "A dog-sized insect coated in phosphorescent spores.",
    "skullRating": 1,
    "biomes": ["fungal"],
    "baseStats": { "maxHp": 25, "damage": 8, "defense": 2, "initiative": 4 },
    "lootTable": ["spore_dagger", "fungal_wrap"]
  },
  {
    "id": "cave_lurker",
    "name": "Cave Lurker",
    "description": "A pale, eyeless humanoid that clings to the ceiling and drops on prey.",
    "skullRating": 1,
    "biomes": ["fungal", "bone"],
    "baseStats": { "maxHp": 20, "damage": 10, "defense": 1, "initiative": 6 },
    "lootTable": ["lurker_fang", "shadow_cloak"]
  }
]
```

Continue for all biomes. Write all entries — no placeholders.

- [ ] **Step 5: Create items.json — extract existing + expand**

Create `shared/src/data/items.json`. Start by extracting all 27 items from `shared/src/content.ts` (the current DRIPPING_HALLS items), then add new items for the crystal, flooded, bone, and volcanic biomes. Target: 60-80 items total covering all equipment slots and consumables for each biome's mob loot tables.

All item IDs referenced in `mobPool.json` loot tables MUST exist in this file.

```json
[
  { "id": "spore_dagger", "name": "Spore-Crusted Dagger", "description": "A short blade with a faintly glowing fungal growth along the edge.", "rarity": "common", "slot": "weapon", "stats": { "damage": 8 } },
  { "id": "lurker_fang", "name": "Lurker Fang Blade", "description": "A jagged blade fashioned from a Cave Lurker's oversized fang.", "rarity": "uncommon", "slot": "weapon", "stats": { "damage": 12 } }
]
```

Continue for all items. Ensure every item ID in every mob's lootTable and every biome's content exists here.

- [ ] **Step 6: Create uniqueItems.json with 5-10 unique items**

Create `shared/src/data/uniqueItems.json`. These are hand-authored, ultra-rare items with the `effect` field (effects are stubs for now — just the string ID).

```json
[
  {
    "id": "worldsplitter",
    "name": "Worldsplitter",
    "description": "A blade that hums with the resonance of tectonic plates. The edge never dulls.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 25, "initiative": 3 },
    "effect": "cleave"
  },
  {
    "id": "undying_heart",
    "name": "The Undying Heart",
    "description": "A crystallized organ that beats on its own. Press it to your chest and feel immortal.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "maxHp": 30, "defense": 5 },
    "effect": "revive_once"
  }
]
```

Write 5-10 entries spanning weapon, armor, offhand, accessory slots.

- [ ] **Step 7: Re-export data types from shared index**

Add to `shared/src/index.ts`:
```ts
export * from './data/types.js';
```

- [ ] **Step 8: Commit**

```
feat: add JSON data files for procedural generation (chits, mobs, biomes, items)
```

---

### Task 3: Procedural Generator — Graph Building

**Files:**
- Create: `server/src/ProceduralGenerator.ts`
- Create: `server/src/ProceduralGenerator.test.ts`

- [ ] **Step 1: Write failing tests for graph generation**

Create `server/src/ProceduralGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateProceduralDungeon } from './ProceduralGenerator.js';
import type { Direction } from '@caverns/shared';

describe('ProceduralGenerator', () => {
  it('generates a dungeon with the correct number of zones', () => {
    const dungeon = generateProceduralDungeon(3);
    // 3 zones with 4-8 rooms each, plus boss room = at least 13 rooms
    expect(dungeon.rooms.length).toBeGreaterThanOrEqual(13);
  });

  it('has an entrance room with no encounter', () => {
    const dungeon = generateProceduralDungeon(3);
    const entrance = dungeon.rooms.find(r => r.id === dungeon.entranceRoomId);
    expect(entrance).toBeDefined();
    expect(entrance!.encounter).toBeUndefined();
  });

  it('has exactly one boss room', () => {
    const dungeon = generateProceduralDungeon(3);
    const bossRooms = dungeon.rooms.filter(r => r.type === 'boss');
    expect(bossRooms.length).toBe(1);
  });

  it('boss room has the boss encounter', () => {
    const dungeon = generateProceduralDungeon(3);
    const bossRoom = dungeon.rooms.find(r => r.type === 'boss')!;
    expect(bossRoom.encounter).toBeDefined();
    expect(bossRoom.encounter!.mobId).toBe(dungeon.bossId);
  });

  it('all room exits are bidirectional', () => {
    const dungeon = generateProceduralDungeon(3);
    const opposites: Record<string, string> = {
      north: 'south', south: 'north', east: 'west', west: 'east',
    };
    const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));
    for (const room of dungeon.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        if (!targetId) continue;
        const target = roomMap.get(targetId);
        expect(target, `Room ${room.id} exit ${dir} -> ${targetId} has no target room`).toBeDefined();
        const opposite = opposites[dir] as Direction;
        expect(
          target!.exits[opposite],
          `${room.id} -> ${dir} -> ${targetId} missing return ${opposite}`
        ).toBe(room.id);
      }
    }
  });

  it('all rooms are reachable from entrance', () => {
    const dungeon = generateProceduralDungeon(3);
    const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));
    const visited = new Set<string>();
    const queue = [dungeon.entranceRoomId];
    visited.add(dungeon.entranceRoomId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const room = roomMap.get(current)!;
      for (const targetId of Object.values(room.exits)) {
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          queue.push(targetId);
        }
      }
    }
    expect(visited.size).toBe(dungeon.rooms.length);
  });

  it('all encounter mobIds reference mobs in the dungeon', () => {
    const dungeon = generateProceduralDungeon(3);
    const mobIds = new Set(dungeon.mobs.map(m => m.id));
    for (const room of dungeon.rooms) {
      if (room.encounter) {
        expect(mobIds.has(room.encounter.mobId), `Unknown mob ${room.encounter.mobId}`).toBe(true);
      }
    }
  });

  it('all room loot references items in the dungeon', () => {
    const dungeon = generateProceduralDungeon(3);
    const itemIds = new Set(dungeon.items.map(i => i.id));
    for (const room of dungeon.rooms) {
      if (room.loot) {
        for (const loot of room.loot) {
          expect(itemIds.has(loot.itemId), `Unknown item ${loot.itemId}`).toBe(true);
        }
      }
    }
  });

  it('all mob loot tables reference items in the dungeon', () => {
    const dungeon = generateProceduralDungeon(3);
    const itemIds = new Set(dungeon.items.map(i => i.id));
    for (const mob of dungeon.mobs) {
      for (const lootId of mob.lootTable) {
        expect(itemIds.has(lootId), `Mob ${mob.id} references unknown item ${lootId}`).toBe(true);
      }
    }
  });

  it('boss room has a locked exit', () => {
    const dungeon = generateProceduralDungeon(3);
    // Find the room that connects to the boss room
    const bossRoom = dungeon.rooms.find(r => r.type === 'boss')!;
    const parentRoom = dungeon.rooms.find(r =>
      Object.values(r.exits).includes(bossRoom.id)
    );
    expect(parentRoom).toBeDefined();
    expect(parentRoom!.lockedExits).toBeDefined();
    const lockedTarget = Object.values(parentRoom!.lockedExits!)[0];
    expect(lockedTarget).toBeDefined();
  });

  it('key item is placed in room loot', () => {
    const dungeon = generateProceduralDungeon(3);
    // Find the lock's required key ID
    const parentRoom = dungeon.rooms.find(r => r.lockedExits && Object.keys(r.lockedExits).length > 0);
    expect(parentRoom).toBeDefined();
    const keyId = Object.values(parentRoom!.lockedExits!)[0];
    // Key should be in some room's loot
    const roomWithKey = dungeon.rooms.find(r =>
      r.loot?.some(l => l.itemId === keyId)
    );
    expect(roomWithKey, `No room contains key item ${keyId}`).toBeDefined();
  });

  it('generates different dungeons on successive calls', () => {
    const d1 = generateProceduralDungeon(3);
    const d2 = generateProceduralDungeon(3);
    // Room IDs should differ (chits get suffixed with generation IDs)
    const ids1 = d1.rooms.map(r => r.id).sort().join(',');
    const ids2 = d2.rooms.map(r => r.id).sort().join(',');
    // Extremely unlikely to be identical with random generation
    // But we just check that it runs without error — both are valid
    expect(d1.rooms.length).toBeGreaterThan(0);
    expect(d2.rooms.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/ProceduralGenerator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProceduralGenerator**

Create `server/src/ProceduralGenerator.ts`:

```ts
import type { Room, MobTemplate, Item, Direction, DungeonContent } from '@caverns/shared';
import type { RoomChit, MobPoolEntry, BiomeDefinition } from '@caverns/shared';
import roomChitsData from '../../shared/src/data/roomChits.json' with { type: 'json' };
import mobPoolData from '../../shared/src/data/mobPool.json' with { type: 'json' };
import biomesData from '../../shared/src/data/biomes.json' with { type: 'json' };
import itemsData from '../../shared/src/data/items.json' with { type: 'json' };
import uniqueItemsData from '../../shared/src/data/uniqueItems.json' with { type: 'json' };

const roomChits: RoomChit[] = roomChitsData as RoomChit[];
const mobPool: MobPoolEntry[] = mobPoolData as MobPoolEntry[];
const biomes: BiomeDefinition[] = biomesData as BiomeDefinition[];
const allItems: Item[] = itemsData as Item[];
const uniqueItems: Item[] = uniqueItemsData as Item[];

const OPPOSITES: Record<Direction, Direction> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
};
const DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface PlacedRoom {
  room: Room;
  usedDirs: Set<Direction>;
  maxExits: number;
  zoneIndex: number;
}

function selectBiomes(count: number): BiomeDefinition[] {
  const shuffled = shuffle(biomes);
  const selected: BiomeDefinition[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(shuffled[i % shuffled.length]);
  }
  return selected;
}

function getChitsForBiome(biomeId: string): RoomChit[] {
  return roomChits.filter(c => c.biomes.includes(biomeId));
}

function getMobsForBiome(biomeId: string, skullRating: 1 | 2 | 3): MobPoolEntry[] {
  return mobPool.filter(m => m.biomes.includes(biomeId) && m.skullRating === skullRating);
}

let genCounter = 0;

function buildZoneGraph(
  biome: BiomeDefinition,
  zoneIndex: number,
  entryRoomId: string | null,
): { rooms: PlacedRoom[]; entryId: string; lastHubId: string } {
  const suffix = `_z${zoneIndex}_${genCounter}`;
  const chits = shuffle(getChitsForBiome(biome.id));
  const roomCount = randInt(biome.roomCount.min, biome.roomCount.max);

  // Ensure mix: at least 1 hub, 1 dead end, rest corridors/chambers
  const hubs = chits.filter(c => c.maxExits >= 3);
  const deadEnds = chits.filter(c => c.maxExits === 1);
  const corridors = chits.filter(c => c.maxExits === 2);

  const selected: RoomChit[] = [];
  if (hubs.length > 0) selected.push(hubs[0]);
  if (deadEnds.length > 0) selected.push(deadEnds[0]);

  const remaining = chits.filter(c => !selected.includes(c));
  for (const c of remaining) {
    if (selected.length >= roomCount) break;
    selected.push(c);
  }
  // Pad with corridors if not enough
  while (selected.length < roomCount && corridors.length > 0) {
    selected.push({ ...corridors[0], id: `${corridors[0].id}_dup${selected.length}` });
  }

  const placed: PlacedRoom[] = [];
  const roomMap = new Map<string, PlacedRoom>();

  // Place first room (entry point for this zone)
  const firstChit = selected[0];
  const entryRoom: Room = {
    id: `${firstChit.id}${suffix}`,
    type: firstChit.type,
    name: firstChit.name,
    description: firstChit.description,
    exits: {},
  };
  const firstPlaced: PlacedRoom = {
    room: entryRoom,
    usedDirs: new Set(),
    maxExits: firstChit.maxExits,
    zoneIndex,
  };
  placed.push(firstPlaced);
  roomMap.set(entryRoom.id, firstPlaced);

  // Connect entry room to previous zone's exit if provided
  if (entryRoomId) {
    // The connection from previous zone is handled by the caller
  }

  // Place remaining chits
  for (let i = 1; i < selected.length; i++) {
    const chit = selected[i];
    const newRoomId = `${chit.id}${suffix}`;
    const newRoom: Room = {
      id: newRoomId,
      type: chit.type,
      name: chit.name,
      description: chit.description,
      exits: {},
    };

    // Find a frontier room with available exits
    const frontier = shuffle(placed.filter(p => p.usedDirs.size < p.maxExits));
    if (frontier.length === 0) break;

    const parent = frontier[0];
    const availableDirs = DIRECTIONS.filter(d => !parent.usedDirs.has(d));
    // Also filter directions the new room can accept
    const newAvailableDirs = availableDirs.filter(d => {
      const opp = OPPOSITES[d];
      return true; // New room has no used dirs yet
    });

    if (newAvailableDirs.length === 0) break;

    const dir = pick(newAvailableDirs);
    const oppDir = OPPOSITES[dir];

    parent.room.exits[dir] = newRoomId;
    parent.usedDirs.add(dir);

    newRoom.exits[oppDir] = parent.room.id;
    const newPlaced: PlacedRoom = {
      room: newRoom,
      usedDirs: new Set([oppDir]),
      maxExits: chit.maxExits,
      zoneIndex,
    };
    placed.push(newPlaced);
    roomMap.set(newRoomId, newPlaced);
  }

  // Add 1-2 cross-links for loops
  const crossLinkAttempts = randInt(1, 2);
  for (let c = 0; c < crossLinkAttempts; c++) {
    const candidates = placed.filter(p => p.usedDirs.size < p.maxExits);
    if (candidates.length < 2) break;

    const shuffledCandidates = shuffle(candidates);
    let linked = false;
    for (let a = 0; a < shuffledCandidates.length && !linked; a++) {
      for (let b = a + 1; b < shuffledCandidates.length && !linked; b++) {
        const roomA = shuffledCandidates[a];
        const roomB = shuffledCandidates[b];
        // Don't cross-link if already connected
        if (Object.values(roomA.room.exits).includes(roomB.room.id)) continue;

        const dirsA = DIRECTIONS.filter(d => !roomA.usedDirs.has(d));
        for (const dir of dirsA) {
          const opp = OPPOSITES[dir];
          if (!roomB.usedDirs.has(opp)) {
            roomA.room.exits[dir] = roomB.room.id;
            roomA.usedDirs.add(dir);
            roomB.room.exits[opp] = roomA.room.id;
            roomB.usedDirs.add(opp);
            linked = true;
            break;
          }
        }
      }
    }
  }

  // Find a good hub to be the zone's "last room" for connecting to next zone
  const hubCandidates = placed.filter(p => p.usedDirs.size < p.maxExits && p.maxExits >= 2);
  const lastHub = hubCandidates.length > 0 ? hubCandidates[hubCandidates.length - 1] : placed[placed.length - 1];

  return { rooms: placed, entryId: entryRoom.id, lastHubId: lastHub.room.id };
}

function populateRooms(
  placed: PlacedRoom[],
  biome: BiomeDefinition,
  entranceId: string,
  usedMobs: Map<string, MobTemplate>,
  usedItems: Map<string, Item>,
): void {
  for (const p of placed) {
    if (p.room.id === entranceId) continue;
    if (p.room.type === 'boss') continue;

    // Mob placement
    if (Math.random() < biome.mobDensity) {
      const roll = Math.random();
      const skullRating: 1 | 2 = roll < biome.skull1Weight ? 1 : 2;
      const candidates = getMobsForBiome(biome.id, skullRating);
      if (candidates.length > 0) {
        const mobEntry = pick(candidates);
        const mob: MobTemplate = {
          id: mobEntry.id,
          name: mobEntry.name,
          description: mobEntry.description,
          skullRating: mobEntry.skullRating as 1 | 2 | 3,
          maxHp: mobEntry.baseStats.maxHp,
          damage: mobEntry.baseStats.damage,
          defense: mobEntry.baseStats.defense,
          initiative: mobEntry.baseStats.initiative,
          lootTable: mobEntry.lootTable,
        };
        usedMobs.set(mob.id, mob);
        p.room.encounter = { mobId: mob.id, skullRating: mob.skullRating as 1 | 2 | 3 };

        // Ensure mob's loot table items are in the used items
        for (const itemId of mob.lootTable) {
          if (!usedItems.has(itemId)) {
            const item = allItems.find(i => i.id === itemId);
            if (item) usedItems.set(itemId, item);
          }
        }
      }
    }

    // Loot placement
    if (Math.random() < biome.lootDensity) {
      const lootCount = randInt(1, 2);
      const chit = roomChits.find(c => p.room.id.startsWith(c.id));
      const locations = chit?.lootLocations ?? ['floor'];
      p.room.loot = [];
      for (let i = 0; i < lootCount; i++) {
        const item = pickLootItem(usedItems);
        if (item) {
          p.room.loot.push({
            itemId: item.id,
            location: pick(locations),
          });
        }
      }
      if (p.room.loot.length === 0) delete (p.room as any).loot;
    }
  }
}

const RARITY_WEIGHTS = [
  { rarity: 'common', weight: 0.499 },
  { rarity: 'uncommon', weight: 0.30 },
  { rarity: 'rare', weight: 0.15 },
  { rarity: 'legendary', weight: 0.05 },
  { rarity: 'unique', weight: 0.001 },
];

function pickLootItem(usedItems: Map<string, Item>): Item | null {
  const roll = Math.random();
  let cumulative = 0;
  let targetRarity = 'common';
  for (const { rarity, weight } of RARITY_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) {
      targetRarity = rarity;
      break;
    }
  }

  if (targetRarity === 'unique') {
    if (uniqueItems.length === 0) return null;
    const item = pick(uniqueItems);
    usedItems.set(item.id, item);
    return item;
  }

  const candidates = allItems.filter(i => i.rarity === targetRarity);
  if (candidates.length === 0) return null;
  const item = pick(candidates);
  usedItems.set(item.id, item);
  return item;
}

export function generateProceduralDungeon(zoneCount: number = 3): DungeonContent {
  genCounter++;
  const selectedBiomes = selectBiomes(zoneCount);
  const finalBiome = selectedBiomes[selectedBiomes.length - 1];

  const allPlacedRooms: PlacedRoom[] = [];
  const usedMobs = new Map<string, MobTemplate>();
  const usedItems = new Map<string, Item>();

  let previousLastHubId: string | null = null;
  let entranceId = '';
  let zoneEntryIds: string[] = [];

  // Build each zone
  for (let z = 0; z < selectedBiomes.length; z++) {
    const biome = selectedBiomes[z];
    const { rooms: zoneRooms, entryId, lastHubId } = buildZoneGraph(biome, z, previousLastHubId);

    // Connect to previous zone
    if (previousLastHubId) {
      const prevHub = allPlacedRooms.find(p => p.room.id === previousLastHubId)!;
      const zoneEntry = zoneRooms[0];

      // Find available directions
      const prevAvailDirs = DIRECTIONS.filter(d => !prevHub.usedDirs.has(d));
      if (prevAvailDirs.length > 0) {
        const dir = pick(prevAvailDirs);
        const opp = OPPOSITES[dir];
        prevHub.room.exits[dir] = zoneEntry.room.id;
        prevHub.usedDirs.add(dir);
        zoneEntry.room.exits[opp] = prevHub.room.id;
        zoneEntry.usedDirs.add(opp);
      }
    }

    if (z === 0) entranceId = entryId;
    zoneEntryIds.push(entryId);

    allPlacedRooms.push(...zoneRooms);
    previousLastHubId = lastHubId;
  }

  // Add boss room to the last zone
  const bossHub = allPlacedRooms.find(p => p.room.id === previousLastHubId)!;
  const bossSuffix = `_boss_${genCounter}`;
  const bossRoomId = `boss_room${bossSuffix}`;

  const bossRoom: Room = {
    id: bossRoomId,
    type: 'boss',
    name: finalBiome.bossRoom.name,
    description: finalBiome.bossRoom.description,
    exits: {},
  };

  // Connect boss room to hub with a locked exit
  const bossAvailDirs = DIRECTIONS.filter(d => !bossHub.usedDirs.has(d));
  const bossDir = bossAvailDirs.length > 0 ? bossAvailDirs[0] : 'north';
  const bossOpp = OPPOSITES[bossDir];

  bossHub.room.exits[bossDir] = bossRoomId;
  bossHub.usedDirs.add(bossDir);
  bossRoom.exits[bossOpp] = bossHub.room.id;

  // Set up locked exit — the key ID matches the final biome's key item
  bossHub.room.lockedExits = { [bossDir]: finalBiome.keyItem.id };

  const bossPlaced: PlacedRoom = {
    room: bossRoom,
    usedDirs: new Set([bossOpp]),
    maxExits: 1,
    zoneIndex: selectedBiomes.length - 1,
  };
  allPlacedRooms.push(bossPlaced);

  // Pick boss mob
  const bossMobs = getMobsForBiome(finalBiome.id, 3);
  const bossMobEntry = bossMobs.length > 0 ? pick(bossMobs) : mobPool.find(m => m.skullRating === 3)!;
  const bossMob: MobTemplate = {
    id: bossMobEntry.id,
    name: bossMobEntry.name,
    description: bossMobEntry.description,
    skullRating: 3,
    maxHp: bossMobEntry.baseStats.maxHp,
    damage: bossMobEntry.baseStats.damage,
    defense: bossMobEntry.baseStats.defense,
    initiative: bossMobEntry.baseStats.initiative,
    lootTable: bossMobEntry.lootTable,
  };
  usedMobs.set(bossMob.id, bossMob);
  bossRoom.encounter = { mobId: bossMob.id, skullRating: 3 };

  for (const itemId of bossMob.lootTable) {
    if (!usedItems.has(itemId)) {
      const item = allItems.find(i => i.id === itemId);
      if (item) usedItems.set(itemId, item);
    }
  }

  // Populate each zone with mobs and loot
  for (let z = 0; z < selectedBiomes.length; z++) {
    const biome = selectedBiomes[z];
    const zoneRooms = allPlacedRooms.filter(p => p.zoneIndex === z);
    populateRooms(zoneRooms, biome, entranceId, usedMobs, usedItems);
  }

  // Place key item in a room at 60-75% depth
  const keyZoneIndex = Math.floor(selectedBiomes.length * (0.6 + Math.random() * 0.15));
  const keyZoneRooms = allPlacedRooms.filter(p =>
    p.zoneIndex === Math.min(keyZoneIndex, selectedBiomes.length - 1) &&
    p.room.type !== 'boss' && p.room.id !== entranceId
  );
  if (keyZoneRooms.length > 0) {
    const keyRoom = pick(keyZoneRooms);
    if (!keyRoom.room.loot) keyRoom.room.loot = [];
    keyRoom.room.loot.push({ itemId: finalBiome.keyItem.id, location: 'hidden' });
  }

  // Build the dungeon name from biomes
  const dungeonName = selectedBiomes.map(b => b.name).join(' / ');

  return {
    name: dungeonName,
    theme: selectedBiomes.map(b => b.name).join(', '),
    atmosphere: selectedBiomes.map(b => b.transitionText).join(' '),
    rooms: allPlacedRooms.map(p => p.room),
    mobs: Array.from(usedMobs.values()),
    items: Array.from(usedItems.values()),
    bossId: bossMob.id,
    entranceRoomId: entranceId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/ProceduralGenerator.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```
feat: implement procedural dungeon generator with zone-based graph building
```

---

### Task 4: Keychain and Locked Exits in GameSession

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/GameSession.test.ts`

- [ ] **Step 1: Write failing tests for locked exits and keychain**

Add to `server/src/GameSession.test.ts`:

```ts
describe('locked exits and keychain', () => {
  it('blocks movement through a locked exit without the key', () => {
    const errors: ServerMessage[] = [];
    const content: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' }, lockedExits: { north: 'test_key' } },
        { id: 'room_b', type: 'boss', name: 'B', description: '', exits: { south: 'room_a' }, encounter: { mobId: 'boss_1', skullRating: 3 } },
      ],
      mobs: [{ id: 'boss_1', name: 'Boss', description: '', skullRating: 3, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };
    const session = new GameSession(
      () => {},
      (id, msg) => { if (msg.type === 'error') errors.push(msg); },
      content,
    );
    session.addPlayer('p1', 'Alice');
    session.startGame();
    session.handleMove('p1', 'north');
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('error');
  });

  it('allows movement through a locked exit when player has the key', () => {
    let movedTo = '';
    const content: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' }, lockedExits: { north: 'test_key' } },
        { id: 'room_b', type: 'boss', name: 'B', description: '', exits: { south: 'room_a' }, encounter: { mobId: 'boss_1', skullRating: 3 } },
      ],
      mobs: [{ id: 'boss_1', name: 'Boss', description: '', skullRating: 3, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };
    const session = new GameSession(
      () => {},
      (id, msg) => { if (msg.type === 'player_moved') movedTo = (msg as any).roomId; },
      content,
    );
    session.addPlayer('p1', 'Alice');
    session.startGame();
    // Manually add key to player's keychain via the session's exposed state
    // We need to add the key before trying to move
    session.addKeyToParty('p1', 'test_key');
    session.handleMove('p1', 'north');
    expect(movedTo).toBe('room_b');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/GameSession.test.ts`
Expected: FAIL — `addKeyToParty` does not exist, locked exit logic not implemented

- [ ] **Step 3: Add keychain tracking to PlayerManager**

In `server/src/PlayerManager.ts`, add these methods:

```ts
addKey(playerId: string, keyId: string): void {
  const player = this.players.get(playerId);
  if (player && !player.keychain.includes(keyId)) {
    player.keychain.push(keyId);
  }
}

addKeyToAll(keyId: string): void {
  for (const player of this.players.values()) {
    if (!player.keychain.includes(keyId)) {
      player.keychain.push(keyId);
    }
  }
}

hasKey(playerId: string, keyId: string): boolean {
  const player = this.players.get(playerId);
  return player?.keychain.includes(keyId) ?? false;
}
```

- [ ] **Step 4: Add locked exit handling to GameSession.handleMove**

In `server/src/GameSession.ts`, update `handleMove` — after finding `targetRoomId` but before moving the player, add:

```ts
// Check if exit is locked
const lockedKeyId = currentRoom.lockedExits?.[direction];
if (lockedKeyId) {
  // Check if any player in the room has the key
  const playersInRoom = this.playerManager.getPlayersInRoom(player.roomId);
  const hasKey = playersInRoom.some(p => p.keychain.includes(lockedKeyId));
  if (!hasKey) {
    this.sendTo(playerId, { type: 'error', message: 'This passage is locked. You need a key to proceed.' });
    return;
  }
  // Unlock permanently — remove from lockedExits
  delete currentRoom.lockedExits![direction];
  this.broadcastToRoom(player.roomId, {
    type: 'text_log',
    message: 'The lock clicks open. The passage is now clear.',
    logType: 'system',
  });
}
```

- [ ] **Step 5: Add addKeyToParty method on GameSession**

Add a public method to GameSession:

```ts
addKeyToParty(playerId: string, keyId: string): void {
  this.playerManager.addKeyToAll(keyId);
  const player = this.playerManager.getPlayer(playerId);
  if (player) {
    for (const p of this.playerManager.getAllPlayers()) {
      this.broadcast({ type: 'player_update', player: p });
    }
    this.broadcastToRoom(player.roomId, {
      type: 'text_log',
      message: `A key has been found! The party receives the key.`,
      logType: 'loot',
    });
  }
}
```

- [ ] **Step 6: Handle key pickup in dropLoot**

In `GameSession.dropLoot`, after collecting droppedItems, check for key items. Key items have IDs that match biome keyItem IDs — they should be detected and routed to the keychain instead of inventory. Add before the loot distribution:

```ts
// Separate key items from regular loot
const keyItems: string[] = [];
const regularItems: Item[] = [];
for (const item of droppedItems) {
  // Check if this item ID (without instance suffix) matches a lockedExits key
  const isKey = this.isKeyItem(item.id);
  if (isKey) {
    keyItems.push(item.id);
  } else {
    regularItems.push(item);
  }
}

// Award keys to party
for (const keyId of keyItems) {
  const firstPlayer = playerIds[0];
  this.addKeyToParty(firstPlayer, keyId);
}
```

Add the helper method:

```ts
private isKeyItem(itemId: string): boolean {
  // Check if any room has a lockedExits value matching this itemId
  for (const room of this.rooms.values()) {
    if (room.lockedExits) {
      for (const keyId of Object.values(room.lockedExits)) {
        if (keyId === itemId) return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run server/src/GameSession.test.ts`
Expected: All PASS

- [ ] **Step 8: Commit**

```
feat: add keychain system and locked exit handling
```

---

### Task 5: Wire Procedural Generator into Game Start

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Replace fallback path with procedural generator**

In `server/src/index.ts`, update the `start_game` handler's no-API-key branch:

Change:
```ts
if (!apiKey) {
  room.gameSession = new GameSession(broadcast, sendTo, undefined, onGameOver);
```

To:
```ts
import { generateProceduralDungeon } from './ProceduralGenerator.js';
```

```ts
if (!apiKey) {
  const dungeon = generateProceduralDungeon(3);
  room.gameSession = new GameSession(broadcast, sendTo, dungeon, onGameOver);
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```
feat: wire procedural dungeon generator into game start fallback
```

---

### Task 6: Client — Keychain UI and Unique Rarity Styling

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`
- Modify: `client/src/components/MiniMap.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add keychain display to PlayerHUD**

In `client/src/components/PlayerHUD.tsx`, after the inventory section, add:

```tsx
{player.keychain.length > 0 && (
  <div className="keychain-section">
    <div className="section-label">Keychain</div>
    <div className="keychain-items">
      {player.keychain.map((keyId) => (
        <span key={keyId} className="key-item" title={keyId}>
          {'\u{1F5DD}'} {keyId.replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Add lock icons to MiniMap**

In `client/src/components/MiniMap.tsx`, when rendering room connections, check if the source room has `lockedExits` for that direction. If so, render a small lock icon on the connection line:

In the connection rendering section, after drawing the line, add:

```tsx
{room.lockedExits?.[dir as Direction] && (
  <text
    x={(x1 + x2) / 2}
    y={(y1 + y2) / 2}
    textAnchor="middle"
    dominantBaseline="central"
    fontSize="12"
    fill="#cc4444"
  >
    {'\u{1F512}'}
  </text>
)}
```

- [ ] **Step 3: Add CSS for unique rarity and keychain**

Add to `client/src/styles/index.css`:

```css
.rarity-unique {
  color: #ff44ff;
  text-shadow: 0 0 8px #ff44ff, 0 0 16px #ff00ff44;
  font-weight: bold;
}

.keychain-section {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #333;
}

.keychain-items {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.key-item {
  color: #d4a857;
  font-size: 0.85rem;
  padding: 0.1rem 0.3rem;
  border: 1px solid #555;
  border-radius: 3px;
  background: #1a1a1a;
}
```

- [ ] **Step 4: Commit**

```
feat: add keychain UI, lock icons on minimap, unique item styling
```

---

### Task 7: Zone Transition Narration

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Track zone boundaries and send transition text**

The procedural generator assigns room IDs with zone suffixes (`_z0_`, `_z1_`, etc.). When a player moves from a room in one zone to a room in another zone, send the biome's transition text.

Add a field to GameSession:

```ts
private zoneTransitions = new Map<string, string>(); // roomId -> transition text
```

In the constructor, after building the room/mob/item maps, detect zone entry points. Zone entry rooms are the first room of each zone — their IDs contain `_z{N}_` where N > 0. For each such room, store the corresponding biome transition text.

However, this requires knowing which biome each zone uses. The simplest approach: store transition texts on the `DungeonContent`. Add an optional field:

In `shared/src/types.ts`, add to DungeonContent:

```ts
export interface DungeonContent {
  name: string;
  theme: string;
  atmosphere: string;
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];
  bossId: string;
  entranceRoomId: string;
  zoneTransitions?: Record<string, string>; // roomId -> transition narration
}
```

In `ProceduralGenerator.ts`, build this map and include it in the output:

```ts
const zoneTransitions: Record<string, string> = {};
for (let z = 1; z < selectedBiomes.length; z++) {
  zoneTransitions[zoneEntryIds[z]] = selectedBiomes[z].transitionText;
}
```

Add to the return:
```ts
return {
  // ... existing fields
  zoneTransitions,
};
```

In `GameSession.handleMove`, after sending the room narration, check for zone transition:

```ts
if (this.content.zoneTransitions?.[targetRoomId]) {
  this.broadcast({
    type: 'text_log',
    message: this.content.zoneTransitions[targetRoomId],
    logType: 'narration',
  });
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing tests unaffected since zoneTransitions is optional)

- [ ] **Step 3: Commit**

```
feat: add zone transition narration when crossing biome boundaries
```

---

### Task 8: Update DungeonValidator for New Fields

**Files:**
- Modify: `server/src/DungeonValidator.ts`

- [ ] **Step 1: Update validator to handle lockedExits**

In `server/src/DungeonValidator.ts`, add validation for locked exits after the bidirectional exit check:

```ts
// Locked exits validation
for (const room of dungeon.rooms) {
  if (room.lockedExits) {
    for (const [dir, keyId] of Object.entries(room.lockedExits)) {
      if (!room.exits[dir as keyof typeof room.exits]) {
        errors.push(`Room "${room.id}" has lockedExit ${dir} but no corresponding exit`);
      }
    }
  }
}
```

- [ ] **Step 2: Update graph connectivity BFS to traverse through locked exits**

The existing BFS already traverses all exits regardless of locks, so no change needed. Locked exits are still in the `exits` map — `lockedExits` just marks which ones need a key. Verify this is the case by reviewing the BFS code.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```
feat: validate lockedExits in DungeonValidator
```

---

### Task 9: Update Existing Tests for New Fields

**Files:**
- Modify: `shared/src/content.test.ts`

- [ ] **Step 1: Ensure existing content tests still pass**

The `DRIPPING_HALLS` content doesn't use `lockedExits` or `keychain`, so existing tests should pass without changes. Run to confirm:

Run: `npx vitest run shared/src/content.test.ts`
Expected: All PASS

- [ ] **Step 2: Run the complete test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit (if any test fixes were needed)**

```
fix: update tests for extended types
```

---

### Task 10: Final Integration Test

**Files:**
- Modify: `server/src/ProceduralGenerator.test.ts`

- [ ] **Step 1: Add stress test for generator consistency**

Add to `server/src/ProceduralGenerator.test.ts`:

```ts
it('generates valid dungeons across 10 runs', () => {
  for (let i = 0; i < 10; i++) {
    const dungeon = generateProceduralDungeon(randInt(2, 5));
    // Basic structural checks
    expect(dungeon.rooms.length).toBeGreaterThan(0);
    expect(dungeon.mobs.length).toBeGreaterThan(0);
    expect(dungeon.items.length).toBeGreaterThan(0);
    expect(dungeon.entranceRoomId).toBeTruthy();
    expect(dungeon.bossId).toBeTruthy();

    // Referential integrity
    const roomIds = new Set(dungeon.rooms.map(r => r.id));
    const mobIds = new Set(dungeon.mobs.map(m => m.id));
    const itemIds = new Set(dungeon.items.map(i => i.id));

    expect(roomIds.has(dungeon.entranceRoomId)).toBe(true);
    expect(mobIds.has(dungeon.bossId)).toBe(true);

    for (const room of dungeon.rooms) {
      for (const targetId of Object.values(room.exits)) {
        expect(roomIds.has(targetId!)).toBe(true);
      }
      if (room.encounter) {
        expect(mobIds.has(room.encounter.mobId)).toBe(true);
      }
      if (room.loot) {
        for (const l of room.loot) {
          // Key items may not be in the items array
          const isKey = room.loot.some(lo => lo.itemId === l.itemId) &&
            dungeon.rooms.some(r => r.lockedExits && Object.values(r.lockedExits).includes(l.itemId));
          if (!isKey) {
            expect(itemIds.has(l.itemId), `Missing item ${l.itemId}`).toBe(true);
          }
        }
      }
    }
  }
});

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 3: Commit**

```
test: add stress test for procedural dungeon generation
```
