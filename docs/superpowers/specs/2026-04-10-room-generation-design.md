# Room Generation Design

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Sub-project 2 of 6 — procedural room layout generation for the roomgrid workspace

## Overview

Add procedural tile grid generation to the `roomgrid/` workspace. Given a room's dimensions, exits, biome, and type, produce a valid `RoomGridConfig` with interesting layouts. Three generation strategies (cavern, structured, chasm) cover the game's biome variety. A strategy pattern makes adding new generators trivial.

This sub-project also expands the tile type system from 3 types to 7, with a data-driven properties table.

## Expanded Tile Types

### New TileType Union

```ts
type TileType = 'floor' | 'wall' | 'exit' | 'water' | 'chasm' | 'hazard' | 'bridge';
```

### Tile Properties Table

```ts
interface TileProperties {
  walkable: boolean;
  blocksLOS: boolean;
  damageOnEntry?: number;
}

const TILE_PROPERTIES: Record<TileType, TileProperties> = {
  floor:  { walkable: true,  blocksLOS: false },
  wall:   { walkable: false, blocksLOS: true },
  exit:   { walkable: true,  blocksLOS: false },
  water:  { walkable: true,  blocksLOS: false },
  chasm:  { walkable: false, blocksLOS: false },
  hazard: { walkable: true,  blocksLOS: false, damageOnEntry: 5 },
  bridge: { walkable: true,  blocksLOS: false },
};
```

Adding a new tile type requires: adding to the union, adding one entry to `TILE_PROPERTIES`.

### Tile Theme

The `Tile` interface gains an optional `theme` string for cosmetic rendering:

```ts
interface Tile {
  type: TileType;
  exit?: ExitData;
  theme?: string;  // e.g. 'lava', 'moss', 'spore_pool'
}
```

Themes have no gameplay effect — they control how the client renders the tile (color, character).

### Grid Engine Updates

`RoomGrid.isWalkable` changes from hardcoded type checks to:

```ts
isWalkable(pos: GridPosition): boolean {
  const tile = this.getTile(pos);
  if (!tile) return false;
  return TILE_PROPERTIES[tile.type].walkable;
}
```

`hasLineOfSight` in `lineOfSight.ts` changes wall checks to:

```ts
if (!tile || TILE_PROPERTIES[tile.type].blocksLOS) return false;
```

`moveEntity` gains a `hazard` event when a player steps onto a hazard tile:

```ts
type MoveEvent =
  | { type: 'combat'; entityId: string }
  | { type: 'exit'; exit: ExitData }
  | { type: 'interact'; entityId: string }
  | { type: 'hazard'; damage: number };
```

## File Structure

```
roomgrid/src/
  types.ts                      — expanded TileType, TileProperties, TILE_PROPERTIES (modified)
  generation/
    types.ts                    — RoomGenerationRequest, BiomeGenerationConfig, RoomGenerator interface, GenerationParams
    cavernGenerator.ts          — cellular automata strategy
    structuredGenerator.ts      — rectangular rooms + corridors + features
    chasmGenerator.ts           — platforms + chasms + bridges
    factory.ts                  — createGenerator() factory, generateRoom() convenience wrapper
    validate.ts                 — flood fill connectivity, open space check
  RoomGrid.ts                   — isWalkable/LOS use TILE_PROPERTIES (modified)
  lineOfSight.ts                — wall check uses TILE_PROPERTIES (modified)
  index.ts                      — re-exports generation module (modified)
roomgrid/src/data/
  biomeGeneration.json          — biome-to-strategy mapping with params and themes
roomgrid/__tests__/
  cavernGenerator.test.ts
  structuredGenerator.test.ts
  chasmGenerator.test.ts
  validate.test.ts
  tileProperties.test.ts        — tests for expanded tile system in grid engine
```

## Generator Strategy Interface

```ts
interface RoomGenerationRequest {
  width: number;
  height: number;
  exits: { position: GridPosition; data: ExitData }[];
  biomeConfig: BiomeGenerationConfig;
  roomType: string;
  seed?: number;
}

interface RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig;
}
```

### BiomeGenerationConfig

```ts
interface BiomeGenerationConfig {
  biomeId: string;
  strategy: string;
  params: GenerationParams;
  tileThemes: {
    floor?: string;
    wall?: string;
    water?: string;
    hazard?: string;
    chasm?: string;
    bridge?: string;
  };
}
```

### GenerationParams

```ts
interface GenerationParams {
  // Cavern
  fillProbability?: number;    // 0.0-1.0, initial wall density (default 0.45)
  smoothingPasses?: number;    // cellular automata iterations (default 4)

  // Structured
  subRoomCount?: number;       // rectangular sub-rooms (default 3)
  corridorWidth?: number;      // 1 or 2 tiles (default 1)
  featureChance?: number;      // probability of pillars/alcoves (default 0.3)

  // Chasm
  chasmCount?: number;         // number of chasm bands (default 2)
  bridgeWidth?: number;        // bridge tile width (default 2)

  // Shared
  minOpenPercent?: number;     // minimum walkable area fraction (default 0.4)
  hazardChance?: number;       // probability of hazard tiles replacing floor (default 0)
  waterChance?: number;        // probability of water tiles replacing floor (default 0)
}
```

### Factory and Convenience Wrapper

```ts
function createGenerator(strategy: string): RoomGenerator;

function generateRoom(request: RoomGenerationRequest): RoomGridConfig;
```

`createGenerator` maps strategy strings to generator instances. New strategies = implement `RoomGenerator` + add one case.

`generateRoom` is the main public API. It creates the generator, runs it in a retry loop with validation, and returns the first valid result.

## Generation Strategies

### CavernGenerator (cellular automata)

1. Fill grid with walls. Carve border as walls (room boundary).
2. For each interior cell, set to wall with probability `fillProbability`, otherwise floor.
3. Run `smoothingPasses` iterations: if a cell has 5+ wall neighbors (of 8), it becomes wall; otherwise floor.
4. Apply hazard/water scatter: for each floor tile, replace with hazard (probability `hazardChance`) or water (probability `waterChance`).
5. Force exit tiles and clear adjacent tiles to floor.
6. Apply tile themes from biome config.

Produces organic, irregular cave layouts.

### StructuredGenerator (rectangular rooms + corridors)

1. Fill grid with walls.
2. Place `subRoomCount` non-overlapping rectangular sub-rooms (random size within bounds, random position). Each sub-room is carved as floor.
3. Connect sub-rooms with L-shaped corridors of `corridorWidth`.
4. With probability `featureChance`, add features to sub-rooms: pillar (2x2 wall block at regular intervals), alcove (1-tile indent in wall).
5. Apply hazard/water scatter on floor tiles.
6. Force exit tiles, ensure exits connect to nearest sub-room.
7. Apply tile themes.

Produces blocky, architectural layouts for crypts, temples, mines.

### ChasmGenerator (platforms + chasms + bridges)

1. Fill grid with floor.
2. Carve `chasmCount` bands of chasm tiles across the room (horizontal or vertical, random position, width 2-4 tiles).
3. Place bridges of `bridgeWidth` across each chasm, ensuring all platforms remain connected.
4. Apply hazard scatter on floor tiles (e.g., lava near chasms).
5. Add wall clusters on platforms for cover.
6. Force exit tiles on platforms.
7. Apply tile themes.

Produces open layouts with dramatic terrain features.

## Validation

### validate.ts

```ts
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateRoom(config: RoomGridConfig, exits: GridPosition[]): ValidationResult;
```

Checks:
1. **Connectivity** — Flood fill from first exit. All other exits must be reachable via walkable tiles.
2. **Open space** — Walkable tiles as fraction of total must meet `minOpenPercent`.
3. **Exit integrity** — All exit positions are in bounds and have type `exit`.

### Retry Loop

`generateRoom` retries up to 10 times if validation fails. On exhaustion, returns a fallback room.

### Fallback Room

The fallback is an all-floor room with exits placed, plus a **checkerboard pattern of water tiles** to make it visually obvious that generation failed. A console warning is logged:

```ts
console.warn(`[roomgrid] All generation attempts failed for biome ${biomeId}, using fallback room`);
```

This ensures the game never crashes, but the fallback is unmistakable during testing.

## Biome Generation Data

`roomgrid/src/data/biomeGeneration.json`:

```json
[
  {
    "biomeId": "starter",
    "strategy": "cavern",
    "params": { "fillProbability": 0.40, "smoothingPasses": 4 },
    "tileThemes": { "floor": "dirt", "wall": "rock" }
  },
  {
    "biomeId": "fungal",
    "strategy": "cavern",
    "params": { "fillProbability": 0.45, "smoothingPasses": 5, "waterChance": 0.1 },
    "tileThemes": { "floor": "moss", "wall": "fungal_rock", "water": "spore_pool" }
  },
  {
    "biomeId": "crypt",
    "strategy": "structured",
    "params": { "subRoomCount": 3, "featureChance": 0.4 },
    "tileThemes": { "floor": "stone_tile", "wall": "carved_stone" }
  },
  {
    "biomeId": "volcanic",
    "strategy": "chasm",
    "params": { "chasmCount": 2, "hazardChance": 0.15 },
    "tileThemes": { "floor": "basalt", "wall": "obsidian", "hazard": "lava" }
  }
]
```

Adding a new biome's generation config is a single JSON entry. No code changes needed unless a new strategy is required.

## Dependencies

The generation module stays within `roomgrid/`. It imports types from the grid engine (`RoomGridConfig`, `TileType`, `GridPosition`, `ExitData`) but does not depend on the `RoomGrid` class itself — it produces configs that the class consumes.

The `@caverns/shared` dependency (for `Direction` type) is unchanged.

## Out of Scope

- Client-side rendering of themes/colors (sub-project 3)
- Integration with GameSession (sub-project 4)
- Mob AI placement within rooms (sub-project 5)
- Room-to-room transitions (sub-project 6)
- Seeded random number generator — the `seed` field on `RoomGenerationRequest` exists for future use but generators use `Math.random()` in this sub-project
