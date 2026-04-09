# Procedural Dungeon Generation — Design Spec

## Overview

Replace the static fallback dungeon (The Dripping Halls) with a procedural generator that builds dungeons from a pool of room "chits," populates them with mobs from an expanded mob pool, and organizes them into themed biome zones. The boss room is gated behind a key item found during exploration. A party-shared keychain system supports this and future locked-door mechanics.

## Data Files

### Room Chits — `shared/src/data/roomChits.json`

Large array of room templates. Each chit defines the room's flavor but not its connections, encounters, or loot — those are assigned at generation time.

```ts
interface RoomChit {
  id: string;            // unique snake_case, e.g. "fungal_grotto_01"
  type: RoomType;        // tunnel | chamber | cavern | dead_end
  name: string;
  description: string;   // 2-3 evocative sentences
  biomes: string[];      // which biomes this chit can appear in
  maxExits: number;      // 1 = dead end, 2 = corridor, 3-4 = hub
  lootLocations: ('chest' | 'floor' | 'hidden')[];
}
```

- Boss rooms are NOT in the chit pool — the generator creates them from the biome's boss definition.
- Aim for 50+ chits at launch across all biomes, expandable over time.

### Mob Pool — `shared/src/data/mobPool.json`

Large array of mob templates tagged by skull rating and biome.

```ts
interface MobPoolEntry {
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
  lootTable: string[];   // references item IDs
}
```

- Skull 3 mobs are bosses — one per biome minimum.
- Aim for 30+ mobs at launch (roughly 4-6 skull-1, 2-3 skull-2, and 1-2 skull-3 per biome).

### Biome Definitions — `shared/src/data/biomes.json`

```ts
interface BiomeDefinition {
  id: string;              // e.g. "fungal", "crystal", "flooded"
  name: string;            // e.g. "Fungal Depths"
  transitionText: string;  // narration when entering this zone
  roomCount: { min: number; max: number };
  mobDensity: number;      // 0-1, fraction of eligible rooms that get encounters
  skull1Weight: number;    // probability of skull-1 mob when placing
  skull2Weight: number;    // probability of skull-2 mob when placing
  lootDensity: number;     // 0-1, fraction of rooms that get loot
}
```

- Start with 4-5 biomes. More can be added by dropping entries into the JSON.

### Items

The existing item definitions in `shared/src/content.ts` expand to cover all items referenced by mob loot tables and room loot. Items are not biome-tagged — any item can appear anywhere. The item pool grows alongside the mob pool.

A new `unique` rarity tier is added above legendary. Unique items have an `effect` field referencing a named effect (the effects list is future work — for now the field exists but effects are not implemented).

```ts
// Addition to Rarity type
type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';

// Addition to Item interface
interface Item {
  // ... existing fields
  effect?: string;  // named effect ID, only used by unique items
}
```

Unique items are hand-authored (not randomly generated) and live in a separate pool. They are not biome-restricted.

A new key item type is added:

```ts
interface KeyItem {
  id: string;
  name: string;
  description: string;
}
```

Key items are defined per-biome for the boss gate (e.g. "Rusted Vault Key" for fungal, "Crystal Shard Key" for crystal). They live alongside the biome definitions.

## Generation Algorithm

### Input

- `zoneCount: number` — how many biome zones to generate (default 3-5, the dungeon size knob)

### Steps

1. **Select biomes** — Pick `zoneCount` biomes from the pool without replacement (or with replacement if pool is smaller than zoneCount).

2. **For each zone, build a room sub-graph:**
   a. Draw `roomCount` chits (randomly within the biome's min/max) from chits matching this biome.
   b. Ensure a mix of maxExits values: at least one hub (3-4), a couple dead ends (1), rest corridors (2).
   c. Start from an entry node (dungeon entrance for zone 1, transition room for subsequent zones).
   d. Grow the graph:
      - Maintain a frontier of rooms with unused exit capacity.
      - Pick a frontier room, pick an unused direction (north/south/east/west), connect to the next unplaced chit.
      - Assign bidirectional exits (north↔south, east↔west).
      - If a chit can't be placed (no valid direction on any frontier room), skip and draw a replacement.
   e. Add 1-2 cross-links between rooms with unused exit capacity to create loops.

3. **Connect zones** — The last hub-like room in zone N gets an exit leading to zone N+1's entry point. A transition text log is sent when players cross zone boundaries.

4. **Place boss room** — In the final zone, create a boss room (type: `boss`) as a dead end connected to a hub. The exit to the boss room is **locked** — requires the zone's key item.

5. **Place key** — The key item is placed as loot in a room at 60-75% dungeon depth (measured by zone index, so in a 4-zone dungeon, the key appears in zone 3).

6. **Populate mobs:**
   - Exclude entrance, transition rooms, and boss room from general population.
   - For each eligible room, roll against `mobDensity`.
   - If placing a mob: roll against skull1Weight/skull2Weight to pick tier, then randomly select from mobs matching that tier and biome.
   - Boss room gets a random skull-3 mob from the final zone's biome.

7. **Distribute loot:**
   - For each non-boss room, roll against `lootDensity`.
   - If placing loot: pick 1-2 items from the full item pool, weighted by rarity (common 49.9%, uncommon 30%, rare 15%, legendary 5%, unique 0.1%). Items are not biome-restricted — any item can appear in any zone. Unique items are pulled from their own hand-authored pool.
   - Use the chit's `lootLocations` to assign where items are found.

### Output

A `DungeonContent` object matching the existing interface, ready to pass into `GameSession`. The generator produces the same shape the Claude generator and static dungeon produce.

## Keychain System

### Player Model Change

Add to the `Player` interface:

```ts
interface Player {
  // ... existing fields
  keychain: string[];  // array of key IDs collected
}
```

Initialize as empty array in `createPlayer`.

### Key Pickup

When a player picks up a key item (from loot):
- The key is added to **all players' keychains** (party-shared).
- The key does NOT consume an inventory or consumable slot.
- A text log announces the key pickup to the room.

### Locked Exits

A room exit can be marked as locked:

```ts
interface Room {
  // ... existing fields
  exits: Partial<Record<Direction, string>>;
  lockedExits?: Partial<Record<Direction, string>>;  // direction -> required key ID
}
```

When a player tries to move through a locked exit:
- Server checks if any player in the room has the required key in their keychain.
- If yes: the exit unlocks permanently (for all players) and movement proceeds.
- If no: send an error message ("This passage is locked. You need [key name] to proceed.").

### Client UI

- Show a small keychain indicator in the PlayerHUD (key icon + count, or list of key names).
- Locked exits show a lock icon on the MiniMap.
- When an exit is unlocked, the lock icon is removed and a narration log plays.

## Integration Points

### Where the generator lives

`server/src/ProceduralGenerator.ts` — a pure function that takes `zoneCount` and returns `DungeonContent`.

### How it's called

In `server/src/index.ts`, the `start_game` handler currently falls back to `DRIPPING_HALLS` when no API key is provided. Replace that with a call to the procedural generator:

```ts
if (!apiKey) {
  const dungeon = generateProceduralDungeon(zoneCount);
  room.gameSession = new GameSession(broadcast, sendTo, dungeon, onGameOver);
}
```

The `zoneCount` can be derived from difficulty or default to 3.

### What stays the same

- `DungeonContent` interface is unchanged — the procedural generator outputs the same shape.
- `GameSession`, `CombatManager`, `LootManager`, `PlayerManager` all work as-is.
- Claude-generated dungeons still work when an API key is provided.
- The existing item/mob/room types are unchanged.

## Scope

### In scope
- Room chit JSON with 50+ rooms across 4-5 biomes
- Mob pool JSON with 30+ mobs across 4-5 biomes
- Biome definitions JSON
- Procedural graph generation algorithm
- Mob and loot population logic
- Key item and keychain system (player model, pickup, locked exits)
- Client UI for keychain and locked exits
- Integration into the game start flow as the new fallback

### Out of scope (future work)
- Puzzle rooms
- Floor/level progression
- Difficulty scaling of procedural dungeons
- Persistence or seeds for reproducible dungeons
- Unique item effects implementation (the `effect` field and rarity tier are wired up, but actual effect logic is deferred)
