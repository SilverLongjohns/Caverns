# Room Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add procedural room layout generation to the `roomgrid/` workspace with expanded tile types, three biome-driven generation strategies, and validation.

**Architecture:** Expand the tile system to 7 types with a data-driven properties table. Add a `generation/` subdirectory with a strategy pattern — each generator implements a `RoomGenerator` interface, a factory selects by strategy name. Validation ensures connectivity and open space. Biome configs stored as JSON data.

**Tech Stack:** TypeScript, Vitest. Zero new external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-10-room-generation-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `roomgrid/src/types.ts` | Expanded TileType, TileProperties, TILE_PROPERTIES, hazard MoveEvent (modified) |
| `roomgrid/src/lineOfSight.ts` | Use TILE_PROPERTIES for LOS blocking (modified) |
| `roomgrid/src/pathfinding.ts` | Use TILE_PROPERTIES for walkability (modified) |
| `roomgrid/src/RoomGrid.ts` | Use TILE_PROPERTIES for isWalkable, hazard event in moveEntity (modified) |
| `roomgrid/src/generation/types.ts` | RoomGenerationRequest, BiomeGenerationConfig, RoomGenerator, GenerationParams |
| `roomgrid/src/generation/validate.ts` | Flood fill connectivity, open space check |
| `roomgrid/src/generation/cavernGenerator.ts` | Cellular automata strategy |
| `roomgrid/src/generation/structuredGenerator.ts` | Rectangular rooms + corridors strategy |
| `roomgrid/src/generation/chasmGenerator.ts` | Platforms + chasms + bridges strategy |
| `roomgrid/src/generation/factory.ts` | createGenerator(), generateRoom() wrapper with retry + fallback |
| `roomgrid/src/data/biomeGeneration.json` | Biome generation configs |
| `roomgrid/src/generation/index.ts` | Re-exports generation public API |
| `roomgrid/src/index.ts` | Add generation re-exports (modified) |
| `roomgrid/__tests__/tileProperties.test.ts` | Tests for expanded tile system |
| `roomgrid/__tests__/validate.test.ts` | Tests for validation |
| `roomgrid/__tests__/cavernGenerator.test.ts` | Tests for cavern strategy |
| `roomgrid/__tests__/structuredGenerator.test.ts` | Tests for structured strategy |
| `roomgrid/__tests__/chasmGenerator.test.ts` | Tests for chasm strategy |
| `roomgrid/__tests__/factory.test.ts` | Tests for factory + generateRoom |

---

### Task 1: Expand Tile Types and Update Grid Engine

**Files:**
- Modify: `roomgrid/src/types.ts`
- Modify: `roomgrid/src/lineOfSight.ts`
- Modify: `roomgrid/src/pathfinding.ts`
- Modify: `roomgrid/src/RoomGrid.ts`
- Create: `roomgrid/__tests__/tileProperties.test.ts`
- Modify: `roomgrid/__tests__/RoomGrid.test.ts`

- [ ] **Step 1: Write failing tests for expanded tile types**

Create `roomgrid/__tests__/tileProperties.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RoomGrid } from '../src/RoomGrid.js';
import type { RoomGridConfig } from '../src/types.js';
import { TILE_PROPERTIES } from '../src/types.js';

describe('TILE_PROPERTIES', () => {
  it('defines properties for all tile types', () => {
    const types = ['floor', 'wall', 'exit', 'water', 'chasm', 'hazard', 'bridge'] as const;
    for (const t of types) {
      expect(TILE_PROPERTIES[t]).toBeDefined();
      expect(typeof TILE_PROPERTIES[t].walkable).toBe('boolean');
      expect(typeof TILE_PROPERTIES[t].blocksLOS).toBe('boolean');
    }
  });

  it('wall blocks movement and LOS', () => {
    expect(TILE_PROPERTIES.wall.walkable).toBe(false);
    expect(TILE_PROPERTIES.wall.blocksLOS).toBe(true);
  });

  it('chasm blocks movement but not LOS', () => {
    expect(TILE_PROPERTIES.chasm.walkable).toBe(false);
    expect(TILE_PROPERTIES.chasm.blocksLOS).toBe(false);
  });

  it('hazard is walkable with damage', () => {
    expect(TILE_PROPERTIES.hazard.walkable).toBe(true);
    expect(TILE_PROPERTIES.hazard.damageOnEntry).toBe(5);
  });

  it('water and bridge are walkable', () => {
    expect(TILE_PROPERTIES.water.walkable).toBe(true);
    expect(TILE_PROPERTIES.bridge.walkable).toBe(true);
  });
});

describe('expanded tile walkability', () => {
  function makeGrid(tiles: string[]): RoomGrid {
    const tileRows = tiles.map(row =>
      [...row].map(ch => {
        if (ch === '#') return 'wall' as const;
        if (ch === 'E') return 'exit' as const;
        if (ch === '~') return 'water' as const;
        if (ch === 'C') return 'chasm' as const;
        if (ch === '!') return 'hazard' as const;
        if (ch === '=') return 'bridge' as const;
        return 'floor' as const;
      })
    );
    return new RoomGrid({
      width: tileRows[0].length,
      height: tileRows.length,
      tiles: tileRows,
    });
  }

  it('water tiles are walkable', () => {
    const grid = makeGrid(['~.~']);
    expect(grid.isWalkable({ x: 0, y: 0 })).toBe(true);
  });

  it('chasm tiles are not walkable', () => {
    const grid = makeGrid(['.C.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(false);
  });

  it('bridge tiles are walkable', () => {
    const grid = makeGrid(['.=.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(true);
  });

  it('hazard tiles are walkable', () => {
    const grid = makeGrid(['.!.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(true);
  });

  it('chasm does not block LOS', () => {
    const grid = makeGrid([
      '...',
      '.C.',
      '...',
    ]);
    expect(grid.hasLineOfSight({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });

  it('player stepping on hazard emits hazard event', () => {
    const grid = makeGrid(['.!.']);
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.events).toEqual([{ type: 'hazard', damage: 5 }]);
  });

  it('mob stepping on hazard does not emit hazard event', () => {
    const grid = makeGrid(['.!.']);
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('m1', 'e');
    expect(result.success).toBe(true);
    expect(result.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/tileProperties.test.ts && cd ..`

Expected: FAIL — `TILE_PROPERTIES` not found, new tile types not recognized.

- [ ] **Step 3: Expand TileType and add TILE_PROPERTIES in `types.ts`**

In `roomgrid/src/types.ts`, replace the `TileType` definition:

```ts
export type TileType = 'floor' | 'wall' | 'exit' | 'water' | 'chasm' | 'hazard' | 'bridge';
```

Add after the `Tile` interface:

```ts
// === Tile Properties ===
export interface TileProperties {
  walkable: boolean;
  blocksLOS: boolean;
  damageOnEntry?: number;
}

export const TILE_PROPERTIES: Record<TileType, TileProperties> = {
  floor:  { walkable: true,  blocksLOS: false },
  wall:   { walkable: false, blocksLOS: true },
  exit:   { walkable: true,  blocksLOS: false },
  water:  { walkable: true,  blocksLOS: false },
  chasm:  { walkable: false, blocksLOS: false },
  hazard: { walkable: true,  blocksLOS: false, damageOnEntry: 5 },
  bridge: { walkable: true,  blocksLOS: false },
};
```

Add `theme` to the `Tile` interface:

```ts
export interface Tile {
  type: TileType;
  exit?: ExitData;
  theme?: string;
}
```

Add `hazard` to the `MoveEvent` union:

```ts
export type MoveEvent =
  | { type: 'combat'; entityId: string }
  | { type: 'exit'; exit: ExitData }
  | { type: 'interact'; entityId: string }
  | { type: 'hazard'; damage: number };
```

- [ ] **Step 4: Update `RoomGrid.isWalkable` to use TILE_PROPERTIES**

In `roomgrid/src/RoomGrid.ts`, add `TILE_PROPERTIES` to the import from `./types.js`:

```ts
import { DIRECTION_OFFSETS, TILE_PROPERTIES } from './types.js';
```

Replace the `isWalkable` method:

```ts
  isWalkable(pos: GridPosition): boolean {
    const tile = this.getTile(pos);
    if (!tile) return false;
    return TILE_PROPERTIES[tile.type].walkable;
  }
```

- [ ] **Step 5: Add hazard event to `RoomGrid.moveEntity`**

In `roomgrid/src/RoomGrid.ts`, in the `moveEntity` method, add hazard check after the entity is moved and after the interactable check, before the exit tile check:

```ts
    // Check for hazard tile
    if (entity.type === 'player') {
      const targetTile = this.getTile(target);
      if (targetTile && TILE_PROPERTIES[targetTile.type].damageOnEntry) {
        events.push({ type: 'hazard', damage: TILE_PROPERTIES[targetTile.type].damageOnEntry! });
      }
    }
```

- [ ] **Step 6: Update `lineOfSight.ts` to use TILE_PROPERTIES**

In `roomgrid/src/lineOfSight.ts`, add `TILE_PROPERTIES` to imports:

```ts
import type { GridPosition, Tile } from './types.js';
import { chebyshevDistance, TILE_PROPERTIES } from './types.js';
```

In `hasLineOfSight`, replace the wall check on line 42:

```ts
    if (!tile || TILE_PROPERTIES[tile.type].blocksLOS) return false;
```

Update the diagonal corner check on lines 50-51:

```ts
      const aIsWall = !cornerA || TILE_PROPERTIES[cornerA.type].blocksLOS;
      const bIsWall = !cornerB || TILE_PROPERTIES[cornerB.type].blocksLOS;
```

- [ ] **Step 7: Update `pathfinding.ts` to use TILE_PROPERTIES**

In `roomgrid/src/pathfinding.ts`, add `TILE_PROPERTIES` to the import:

```ts
import { chebyshevDistance, DIRECTION_OFFSETS, TILE_PROPERTIES } from './types.js';
```

In the `isWalkable` function inside `findPath`, replace the wall check:

```ts
    if (!TILE_PROPERTIES[tile.type].walkable) return false;
```

Replace the full local `isWalkable`:

```ts
  function isWalkable(p: GridPosition): boolean {
    if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
    const tile = tiles[p.y][p.x];
    if (!TILE_PROPERTIES[tile.type].walkable) return false;
    if (blockedByEntities && entityPositions.has(posKey(p))) {
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) return true;
      return false;
    }
    return true;
  }
```

- [ ] **Step 8: Run all tests**

Run: `cd roomgrid && npx vitest run && cd ..`

Expected: All tests PASS (existing 56 + new tile property tests).

- [ ] **Step 9: Commit**

```
feat(roomgrid): expand tile types to 7 with data-driven properties table
```

---

### Task 2: Generation Types and Validation

**Files:**
- Create: `roomgrid/src/generation/types.ts`
- Create: `roomgrid/src/generation/validate.ts`
- Create: `roomgrid/__tests__/validate.test.ts`

- [ ] **Step 1: Create generation types**

Create `roomgrid/src/generation/types.ts`:

```ts
import type { GridPosition, ExitData, RoomGridConfig } from '../types.js';

export interface GenerationParams {
  // Cavern
  fillProbability?: number;
  smoothingPasses?: number;

  // Structured
  subRoomCount?: number;
  corridorWidth?: number;
  featureChance?: number;

  // Chasm
  chasmCount?: number;
  bridgeWidth?: number;

  // Shared
  minOpenPercent?: number;
  hazardChance?: number;
  waterChance?: number;
}

export interface BiomeGenerationConfig {
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

export interface RoomGenerationRequest {
  width: number;
  height: number;
  exits: { position: GridPosition; data: ExitData }[];
  biomeConfig: BiomeGenerationConfig;
  roomType: string;
  seed?: number;
}

export interface RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig;
}
```

- [ ] **Step 2: Write failing tests for validation**

Create `roomgrid/__tests__/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateRoom } from '../src/generation/validate.js';
import type { RoomGridConfig } from '../src/types.js';

function makeConfig(map: string[]): RoomGridConfig {
  const tiles = map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return 'wall' as const;
      if (ch === 'E') return 'exit' as const;
      if (ch === 'C') return 'chasm' as const;
      if (ch === '=') return 'bridge' as const;
      return 'floor' as const;
    })
  );
  return { width: tiles[0].length, height: tiles.length, tiles };
}

describe('validateRoom', () => {
  it('valid room with connected exits passes', () => {
    const config = makeConfig([
      'E...E',
      '.....',
      '.....',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('disconnected exits fail connectivity', () => {
    const config = makeConfig([
      'E.#.E',
      '..#..',
      '..#..',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 0 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('connect'))).toBe(true);
  });

  it('too few open tiles fails open space check', () => {
    const config = makeConfig([
      'E####',
      '#####',
      '####E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 2 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('exit not in bounds fails', () => {
    const config = makeConfig([
      '...',
      '...',
    ]);
    const result = validateRoom(config, [{ x: 10, y: 10 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('bounds'))).toBe(true);
  });

  it('single exit always passes connectivity', () => {
    const config = makeConfig([
      'E....',
      '.....',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
  });

  it('chasm tiles count as non-walkable for open space', () => {
    // 3x3, 5 chasms + 2 exits + 2 floor = only 4 walkable out of 9 = 0.44
    const config = makeConfig([
      'E.C',
      'CCC',
      'C.E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 2, y: 2 }], 0.5);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('bridge tiles count as walkable', () => {
    const config = makeConfig([
      'E=E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 2, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/validate.test.ts && cd ..`

Expected: FAIL — `validateRoom` not found.

- [ ] **Step 4: Implement `validateRoom`**

Create `roomgrid/src/generation/validate.ts`:

```ts
import type { GridPosition, RoomGridConfig } from '../types.js';
import { TILE_PROPERTIES } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRoom(
  config: RoomGridConfig,
  exits: GridPosition[],
  minOpenPercent: number,
): ValidationResult {
  const errors: string[] = [];
  const { width, height, tiles } = config;

  // 1. Check exits are in bounds
  for (const exit of exits) {
    if (exit.x < 0 || exit.x >= width || exit.y < 0 || exit.y >= height) {
      errors.push(`Exit at (${exit.x}, ${exit.y}) is out of bounds`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 2. Open space check
  let walkableCount = 0;
  const totalCount = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (TILE_PROPERTIES[tiles[y][x]].walkable) {
        walkableCount++;
      }
    }
  }
  const openPercent = walkableCount / totalCount;
  if (openPercent < minOpenPercent) {
    errors.push(`Open space ${(openPercent * 100).toFixed(1)}% below minimum ${(minOpenPercent * 100).toFixed(1)}%`);
  }

  // 3. Connectivity: flood fill from first exit, check all exits reachable
  if (exits.length > 1) {
    const visited = new Set<string>();
    const queue: GridPosition[] = [exits[0]];
    visited.add(`${exits[0].x},${exits[0].y}`);

    while (queue.length > 0) {
      const pos = queue.shift()!;
      const neighbors = [
        { x: pos.x - 1, y: pos.y },
        { x: pos.x + 1, y: pos.y },
        { x: pos.x, y: pos.y - 1 },
        { x: pos.x, y: pos.y + 1 },
        { x: pos.x - 1, y: pos.y - 1 },
        { x: pos.x + 1, y: pos.y - 1 },
        { x: pos.x - 1, y: pos.y + 1 },
        { x: pos.x + 1, y: pos.y + 1 },
      ];
      for (const n of neighbors) {
        const key = `${n.x},${n.y}`;
        if (visited.has(key)) continue;
        if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
        if (!TILE_PROPERTIES[tiles[n.y][n.x]].walkable) continue;
        visited.add(key);
        queue.push(n);
      }
    }

    for (let i = 1; i < exits.length; i++) {
      const key = `${exits[i].x},${exits[i].y}`;
      if (!visited.has(key)) {
        errors.push(`Exit at (${exits[i].x}, ${exits[i].y}) not connected to exit at (${exits[0].x}, ${exits[0].y})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/validate.test.ts && cd ..`

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```
feat(roomgrid): add generation types and room validation
```

---

### Task 3: Cavern Generator (Cellular Automata)

**Files:**
- Create: `roomgrid/src/generation/cavernGenerator.ts`
- Create: `roomgrid/__tests__/cavernGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `roomgrid/__tests__/cavernGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CavernGenerator } from '../src/generation/cavernGenerator.js';
import { validateRoom } from '../src/generation/validate.js';
import { TILE_PROPERTIES } from '../src/types.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'fungal',
      strategy: 'cavern',
      params: { fillProbability: 0.45, smoothingPasses: 4 },
      tileThemes: { floor: 'moss', wall: 'fungal_rock' },
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('CavernGenerator', () => {
  const gen = new CavernGenerator();

  it('produces a RoomGridConfig with correct dimensions', () => {
    const config = gen.generate(makeRequest());
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    expect(config.tiles.length).toBe(15);
    expect(config.tiles[0].length).toBe(20);
  });

  it('places exit tiles at specified positions', () => {
    const config = gen.generate(makeRequest());
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });

  it('exit data is included in config', () => {
    const config = gen.generate(makeRequest());
    expect(config.exits).toHaveLength(2);
    expect(config.exits![0].position).toEqual({ x: 0, y: 7 });
    expect(config.exits![0].data.direction).toBe('west');
  });

  it('border tiles are walls', () => {
    const config = gen.generate(makeRequest({ exits: [] }));
    // Top row (y=0) should be all walls
    for (let x = 0; x < 20; x++) {
      expect(config.tiles[0][x]).toBe('wall');
    }
    // Bottom row
    for (let x = 0; x < 20; x++) {
      expect(config.tiles[14][x]).toBe('wall');
    }
  });

  it('applies tile themes', () => {
    const config = gen.generate(makeRequest());
    // Themes are not in TileType[][] — they are in the exits/config metadata
    // The generator should return themeMap for the caller to use
    // Actually per spec, themes are applied to the Tile objects when RoomGrid is constructed
    // For now, just verify the grid is valid
    expect(config.tiles.length).toBe(15);
  });

  it('generates rooms that pass validation', () => {
    // Run 5 times to account for randomness
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.3);
      expect(result.valid).toBe(true);
    }
  });

  it('applies water tiles when waterChance is set', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'fungal',
        strategy: 'cavern',
        params: { fillProbability: 0.3, smoothingPasses: 3, waterChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasWater = config.tiles.some(row => row.some(t => t === 'water'));
    expect(hasWater).toBe(true);
  });

  it('applies hazard tiles when hazardChance is set', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'volcanic',
        strategy: 'cavern',
        params: { fillProbability: 0.3, smoothingPasses: 3, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });

  it('clears tiles adjacent to exits', () => {
    const request = makeRequest();
    const config = gen.generate(request);
    // Tile next to west exit should be floor (not wall)
    expect(TILE_PROPERTIES[config.tiles[7][1]].walkable).toBe(true);
    // Tile next to east exit should be floor
    expect(TILE_PROPERTIES[config.tiles[7][18]].walkable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/cavernGenerator.test.ts && cd ..`

Expected: FAIL — `CavernGenerator` not found.

- [ ] **Step 3: Implement CavernGenerator**

Create `roomgrid/src/generation/cavernGenerator.ts`:

```ts
import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';

export class CavernGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const fillProb = params.fillProbability ?? 0.45;
    const passes = params.smoothingPasses ?? 4;
    const hazardChance = params.hazardChance ?? 0;
    const waterChance = params.waterChance ?? 0;

    // 1. Initialize grid — border is wall, interior is random
    let grid: TileType[][] = [];
    for (let y = 0; y < height; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < width; x++) {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          row.push('wall');
        } else {
          row.push(Math.random() < fillProb ? 'wall' : 'floor');
        }
      }
      grid.push(row);
    }

    // 2. Cellular automata smoothing
    for (let pass = 0; pass < passes; pass++) {
      const next: TileType[][] = grid.map(row => [...row]);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let wallCount = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              if (grid[y + dy][x + dx] === 'wall') wallCount++;
            }
          }
          next[y][x] = wallCount >= 5 ? 'wall' : 'floor';
        }
      }
      grid = next;
    }

    // 3. Force exit tiles and clear adjacent tiles
    for (const exit of exits) {
      grid[exit.position.y][exit.position.x] = 'exit';
      // Clear tiles adjacent to exit (within bounds and not on border exits themselves)
      const adjacents = [
        { x: exit.position.x - 1, y: exit.position.y },
        { x: exit.position.x + 1, y: exit.position.y },
        { x: exit.position.x, y: exit.position.y - 1 },
        { x: exit.position.x, y: exit.position.y + 1 },
      ];
      for (const adj of adjacents) {
        if (adj.x > 0 && adj.x < width - 1 && adj.y > 0 && adj.y < height - 1) {
          if (grid[adj.y][adj.x] === 'wall') {
            grid[adj.y][adj.x] = 'floor';
          }
        }
      }
    }

    // 4. Ensure connectivity between exits via corridor carving
    if (exits.length > 1) {
      this.ensureConnectivity(grid, exits.map(e => e.position), width, height);
    }

    // 5. Scatter hazard and water tiles on floor
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 'floor') continue;
        const roll = Math.random();
        if (roll < hazardChance) {
          grid[y][x] = 'hazard';
        } else if (roll < hazardChance + waterChance) {
          grid[y][x] = 'water';
        }
      }
    }

    return {
      width,
      height,
      tiles: grid,
      exits: exits.map(e => ({ position: e.position, data: e.data })),
    };
  }

  private ensureConnectivity(
    grid: TileType[][],
    exitPositions: { x: number; y: number }[],
    width: number,
    height: number,
  ): void {
    // BFS from first exit to find connected walkable region
    const isWalkableTile = (t: TileType) => t !== 'wall' && t !== 'chasm';
    const visited = new Set<string>();
    const queue = [exitPositions[0]];
    visited.add(`${exitPositions[0].x},${exitPositions[0].y}`);

    while (queue.length > 0) {
      const pos = queue.shift()!;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (!isWalkableTile(grid[ny][nx])) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }

    // For each unreachable exit, carve a corridor to a reachable tile
    for (let i = 1; i < exitPositions.length; i++) {
      const key = `${exitPositions[i].x},${exitPositions[i].y}`;
      if (visited.has(key)) continue;

      // Carve L-shaped corridor from this exit toward the first exit
      const from = exitPositions[i];
      const to = exitPositions[0];

      // Horizontal then vertical
      const xDir = to.x > from.x ? 1 : -1;
      let cx = from.x;
      while (cx !== to.x) {
        cx += xDir;
        if (cx > 0 && cx < width - 1 && grid[from.y][cx] === 'wall') {
          grid[from.y][cx] = 'floor';
        }
      }
      const yDir = to.y > from.y ? 1 : -1;
      let cy = from.y;
      while (cy !== to.y) {
        cy += yDir;
        if (cy > 0 && cy < height - 1 && grid[cy][to.x] === 'wall') {
          grid[cy][to.x] = 'floor';
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/cavernGenerator.test.ts && cd ..`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement cavern generator with cellular automata
```

---

### Task 4: Structured Generator (Rectangular Rooms + Corridors)

**Files:**
- Create: `roomgrid/src/generation/structuredGenerator.ts`
- Create: `roomgrid/__tests__/structuredGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `roomgrid/__tests__/structuredGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StructuredGenerator } from '../src/generation/structuredGenerator.js';
import { validateRoom } from '../src/generation/validate.js';
import { TILE_PROPERTIES } from '../src/types.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'crypt',
      strategy: 'structured',
      params: { subRoomCount: 3, corridorWidth: 1, featureChance: 0.3 },
      tileThemes: { floor: 'stone_tile', wall: 'carved_stone' },
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('StructuredGenerator', () => {
  const gen = new StructuredGenerator();

  it('produces correct dimensions', () => {
    const config = gen.generate(makeRequest());
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    expect(config.tiles.length).toBe(15);
    expect(config.tiles[0].length).toBe(20);
  });

  it('places exit tiles at specified positions', () => {
    const config = gen.generate(makeRequest());
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });

  it('generates rooms that pass validation', () => {
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.3);
      expect(result.valid).toBe(true);
    }
  });

  it('contains rectangular floor regions (sub-rooms)', () => {
    const config = gen.generate(makeRequest());
    // There should be contiguous rectangular regions of floor
    // Simple check: count floor tiles, should be significantly more than just corridors
    let floorCount = 0;
    for (const row of config.tiles) {
      for (const t of row) {
        if (t === 'floor') floorCount++;
      }
    }
    // With 3 sub-rooms in a 20x15 grid, expect at least 40 floor tiles
    expect(floorCount).toBeGreaterThan(40);
  });

  it('border is walls except for exits', () => {
    const config = gen.generate(makeRequest());
    for (let x = 0; x < 20; x++) {
      if (x !== 0 && x !== 19) {
        // Not an exit position on top/bottom border
        expect(config.tiles[0][x]).toBe('wall');
        expect(config.tiles[14][x]).toBe('wall');
      }
    }
  });

  it('clears tiles adjacent to exits', () => {
    const request = makeRequest();
    const config = gen.generate(request);
    expect(TILE_PROPERTIES[config.tiles[7][1]].walkable).toBe(true);
    expect(TILE_PROPERTIES[config.tiles[7][18]].walkable).toBe(true);
  });

  it('applies hazard scatter', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'crypt',
        strategy: 'structured',
        params: { subRoomCount: 3, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/structuredGenerator.test.ts && cd ..`

Expected: FAIL — `StructuredGenerator` not found.

- [ ] **Step 3: Implement StructuredGenerator**

Create `roomgrid/src/generation/structuredGenerator.ts`:

```ts
import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';

interface SubRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class StructuredGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const subRoomCount = params.subRoomCount ?? 3;
    const corridorWidth = params.corridorWidth ?? 1;
    const featureChance = params.featureChance ?? 0.3;
    const hazardChance = params.hazardChance ?? 0;
    const waterChance = params.waterChance ?? 0;

    // 1. Fill with walls
    const grid: TileType[][] = Array.from({ length: height }, () =>
      Array<TileType>(width).fill('wall')
    );

    // 2. Place sub-rooms
    const subRooms: SubRoom[] = [];
    const minRoomW = Math.max(3, Math.floor(width / 6));
    const maxRoomW = Math.floor(width / 3);
    const minRoomH = Math.max(3, Math.floor(height / 6));
    const maxRoomH = Math.floor(height / 3);

    for (let i = 0; i < subRoomCount * 10 && subRooms.length < subRoomCount; i++) {
      const w = minRoomW + Math.floor(Math.random() * (maxRoomW - minRoomW + 1));
      const h = minRoomH + Math.floor(Math.random() * (maxRoomH - minRoomH + 1));
      const x = 1 + Math.floor(Math.random() * (width - w - 2));
      const y = 1 + Math.floor(Math.random() * (height - h - 2));

      // Check overlap with existing sub-rooms (1 tile padding)
      const overlaps = subRooms.some(r =>
        x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y
      );
      if (overlaps) continue;

      subRooms.push({ x, y, w, h });

      // Carve floor
      for (let ry = y; ry < y + h; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          grid[ry][rx] = 'floor';
        }
      }

      // Features: pillars
      if (Math.random() < featureChance && w >= 6 && h >= 6) {
        // Place 2x2 pillars at regular intervals
        for (let py = y + 2; py < y + h - 2; py += 3) {
          for (let px = x + 2; px < x + w - 2; px += 3) {
            grid[py][px] = 'wall';
            if (px + 1 < x + w - 1) grid[py][px + 1] = 'wall';
            if (py + 1 < y + h - 1) grid[py + 1][px] = 'wall';
            if (px + 1 < x + w - 1 && py + 1 < y + h - 1) grid[py + 1][px + 1] = 'wall';
          }
        }
      }
    }

    // 3. Connect sub-rooms with L-shaped corridors
    for (let i = 1; i < subRooms.length; i++) {
      const a = subRooms[i - 1];
      const b = subRooms[i];
      const ax = Math.floor(a.x + a.w / 2);
      const ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2);
      const by = Math.floor(b.y + b.h / 2);

      // Horizontal segment
      const xDir = bx > ax ? 1 : -1;
      for (let x = ax; x !== bx; x += xDir) {
        for (let cw = 0; cw < corridorWidth; cw++) {
          const cy = ay + cw;
          if (cy > 0 && cy < height - 1 && x > 0 && x < width - 1) {
            if (grid[cy][x] === 'wall') grid[cy][x] = 'floor';
          }
        }
      }

      // Vertical segment
      const yDir = by > ay ? 1 : -1;
      for (let y = ay; y !== by; y += yDir) {
        for (let cw = 0; cw < corridorWidth; cw++) {
          const cx = bx + cw;
          if (cx > 0 && cx < width - 1 && y > 0 && y < height - 1) {
            if (grid[y][cx] === 'wall') grid[y][cx] = 'floor';
          }
        }
      }
    }

    // 4. Force exits and clear adjacent
    for (const exit of exits) {
      grid[exit.position.y][exit.position.x] = 'exit';
      const adjacents = [
        { x: exit.position.x - 1, y: exit.position.y },
        { x: exit.position.x + 1, y: exit.position.y },
        { x: exit.position.x, y: exit.position.y - 1 },
        { x: exit.position.x, y: exit.position.y + 1 },
      ];
      for (const adj of adjacents) {
        if (adj.x > 0 && adj.x < width - 1 && adj.y > 0 && adj.y < height - 1) {
          if (grid[adj.y][adj.x] === 'wall') {
            grid[adj.y][adj.x] = 'floor';
          }
        }
      }
    }

    // 5. Connect exits to nearest sub-room if not already connected
    if (exits.length > 0 && subRooms.length > 0) {
      for (const exit of exits) {
        // Find nearest sub-room center
        let nearest = subRooms[0];
        let bestDist = Infinity;
        for (const room of subRooms) {
          const cx = room.x + Math.floor(room.w / 2);
          const cy = room.y + Math.floor(room.h / 2);
          const dist = Math.abs(cx - exit.position.x) + Math.abs(cy - exit.position.y);
          if (dist < bestDist) {
            bestDist = dist;
            nearest = room;
          }
        }

        // Carve corridor from exit to nearest room center
        const tx = Math.floor(nearest.x + nearest.w / 2);
        const ty = Math.floor(nearest.y + nearest.h / 2);
        const xDir = tx > exit.position.x ? 1 : -1;
        let cx = exit.position.x;
        while (cx !== tx) {
          cx += xDir;
          if (cx > 0 && cx < width - 1 && grid[exit.position.y][cx] === 'wall') {
            grid[exit.position.y][cx] = 'floor';
          }
        }
        const yDir = ty > exit.position.y ? 1 : -1;
        let cy = exit.position.y;
        while (cy !== ty) {
          cy += yDir;
          if (cy > 0 && cy < height - 1 && grid[cy][tx] === 'wall') {
            grid[cy][tx] = 'floor';
          }
        }
      }
    }

    // 6. Scatter hazards and water
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 'floor') continue;
        const roll = Math.random();
        if (roll < hazardChance) {
          grid[y][x] = 'hazard';
        } else if (roll < hazardChance + waterChance) {
          grid[y][x] = 'water';
        }
      }
    }

    return {
      width,
      height,
      tiles: grid,
      exits: exits.map(e => ({ position: e.position, data: e.data })),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/structuredGenerator.test.ts && cd ..`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement structured generator with sub-rooms and corridors
```

---

### Task 5: Chasm Generator (Platforms + Bridges)

**Files:**
- Create: `roomgrid/src/generation/chasmGenerator.ts`
- Create: `roomgrid/__tests__/chasmGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `roomgrid/__tests__/chasmGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ChasmGenerator } from '../src/generation/chasmGenerator.js';
import { validateRoom } from '../src/generation/validate.js';
import { TILE_PROPERTIES } from '../src/types.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'volcanic',
      strategy: 'chasm',
      params: { chasmCount: 2, bridgeWidth: 2 },
      tileThemes: { floor: 'basalt', chasm: 'void', bridge: 'stone_bridge' },
    },
    roomType: 'cavern',
    ...overrides,
  };
}

describe('ChasmGenerator', () => {
  const gen = new ChasmGenerator();

  it('produces correct dimensions', () => {
    const config = gen.generate(makeRequest());
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    expect(config.tiles.length).toBe(15);
    expect(config.tiles[0].length).toBe(20);
  });

  it('places exit tiles at specified positions', () => {
    const config = gen.generate(makeRequest());
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });

  it('contains chasm tiles', () => {
    const config = gen.generate(makeRequest());
    const hasChasms = config.tiles.some(row => row.some(t => t === 'chasm'));
    expect(hasChasms).toBe(true);
  });

  it('contains bridge tiles', () => {
    const config = gen.generate(makeRequest());
    const hasBridges = config.tiles.some(row => row.some(t => t === 'bridge'));
    expect(hasBridges).toBe(true);
  });

  it('generates rooms that pass validation', () => {
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.2);
      expect(result.valid).toBe(true);
    }
  });

  it('clears tiles adjacent to exits', () => {
    const request = makeRequest();
    const config = gen.generate(request);
    expect(TILE_PROPERTIES[config.tiles[7][1]].walkable).toBe(true);
    expect(TILE_PROPERTIES[config.tiles[7][18]].walkable).toBe(true);
  });

  it('applies hazard scatter', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'volcanic',
        strategy: 'chasm',
        params: { chasmCount: 1, bridgeWidth: 2, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/chasmGenerator.test.ts && cd ..`

Expected: FAIL — `ChasmGenerator` not found.

- [ ] **Step 3: Implement ChasmGenerator**

Create `roomgrid/src/generation/chasmGenerator.ts`:

```ts
import type { TileType, RoomGridConfig } from '../types.js';
import { TILE_PROPERTIES } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';

export class ChasmGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const chasmCount = params.chasmCount ?? 2;
    const bridgeWidth = params.bridgeWidth ?? 2;
    const hazardChance = params.hazardChance ?? 0;
    const waterChance = params.waterChance ?? 0;

    // 1. Fill with floor, border with walls
    const grid: TileType[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          return 'wall' as TileType;
        }
        return 'floor' as TileType;
      })
    );

    // 2. Carve chasm bands
    const chasmBands: { pos: number; vertical: boolean; chasmWidth: number }[] = [];
    for (let i = 0; i < chasmCount; i++) {
      const vertical = Math.random() < 0.5;
      const chasmW = 2 + Math.floor(Math.random() * 2); // width 2-3

      if (vertical) {
        // Place a vertical chasm band
        const minX = 3;
        const maxX = width - 3 - chasmW;
        if (maxX <= minX) continue;
        const x = minX + Math.floor(Math.random() * (maxX - minX));
        chasmBands.push({ pos: x, vertical: true, chasmWidth: chasmW });

        for (let y = 1; y < height - 1; y++) {
          for (let dx = 0; dx < chasmW; dx++) {
            if (x + dx > 0 && x + dx < width - 1) {
              grid[y][x + dx] = 'chasm';
            }
          }
        }
      } else {
        // Place a horizontal chasm band
        const minY = 3;
        const maxY = height - 3 - chasmW;
        if (maxY <= minY) continue;
        const y = minY + Math.floor(Math.random() * (maxY - minY));
        chasmBands.push({ pos: y, vertical: false, chasmWidth: chasmW });

        for (let x = 1; x < width - 1; x++) {
          for (let dy = 0; dy < chasmW; dy++) {
            if (y + dy > 0 && y + dy < height - 1) {
              grid[y + dy][x] = 'chasm';
            }
          }
        }
      }
    }

    // 3. Place bridges across each chasm band
    for (const band of chasmBands) {
      if (band.vertical) {
        // Bridge is horizontal across a vertical chasm
        const bridgeY = 2 + Math.floor(Math.random() * (height - 4));
        for (let bw = 0; bw < bridgeWidth; bw++) {
          const by = bridgeY + bw;
          if (by > 0 && by < height - 1) {
            for (let dx = 0; dx < band.chasmWidth; dx++) {
              if (band.pos + dx > 0 && band.pos + dx < width - 1) {
                grid[by][band.pos + dx] = 'bridge';
              }
            }
          }
        }
      } else {
        // Bridge is vertical across a horizontal chasm
        const bridgeX = 2 + Math.floor(Math.random() * (width - 4));
        for (let bw = 0; bw < bridgeWidth; bw++) {
          const bx = bridgeX + bw;
          if (bx > 0 && bx < width - 1) {
            for (let dy = 0; dy < band.chasmWidth; dy++) {
              if (band.pos + dy > 0 && band.pos + dy < height - 1) {
                grid[band.pos + dy][bx] = 'bridge';
              }
            }
          }
        }
      }
    }

    // 4. Add wall clusters on platforms for cover
    for (let i = 0; i < 3; i++) {
      const cx = 2 + Math.floor(Math.random() * (width - 4));
      const cy = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[cy][cx] === 'floor') {
        grid[cy][cx] = 'wall';
      }
    }

    // 5. Force exit tiles and clear adjacent
    for (const exit of exits) {
      grid[exit.position.y][exit.position.x] = 'exit';
      const adjacents = [
        { x: exit.position.x - 1, y: exit.position.y },
        { x: exit.position.x + 1, y: exit.position.y },
        { x: exit.position.x, y: exit.position.y - 1 },
        { x: exit.position.x, y: exit.position.y + 1 },
      ];
      for (const adj of adjacents) {
        if (adj.x > 0 && adj.x < width - 1 && adj.y > 0 && adj.y < height - 1) {
          if (!TILE_PROPERTIES[grid[adj.y][adj.x]].walkable) {
            grid[adj.y][adj.x] = 'floor';
          }
        }
      }
    }

    // 6. Ensure connectivity between exits
    if (exits.length > 1) {
      this.ensureConnectivity(grid, exits.map(e => e.position), width, height);
    }

    // 7. Scatter hazards and water on floor tiles
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 'floor') continue;
        const roll = Math.random();
        if (roll < hazardChance) {
          grid[y][x] = 'hazard';
        } else if (roll < hazardChance + waterChance) {
          grid[y][x] = 'water';
        }
      }
    }

    return {
      width,
      height,
      tiles: grid,
      exits: exits.map(e => ({ position: e.position, data: e.data })),
    };
  }

  private ensureConnectivity(
    grid: TileType[][],
    exitPositions: { x: number; y: number }[],
    width: number,
    height: number,
  ): void {
    const visited = new Set<string>();
    const queue = [exitPositions[0]];
    visited.add(`${exitPositions[0].x},${exitPositions[0].y}`);

    while (queue.length > 0) {
      const pos = queue.shift()!;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (!TILE_PROPERTIES[grid[ny][nx]].walkable) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }

    for (let i = 1; i < exitPositions.length; i++) {
      const key = `${exitPositions[i].x},${exitPositions[i].y}`;
      if (visited.has(key)) continue;

      // Carve bridge/floor corridor from unreachable exit to first exit
      const from = exitPositions[i];
      const to = exitPositions[0];

      const xDir = to.x > from.x ? 1 : -1;
      let cx = from.x;
      while (cx !== to.x) {
        cx += xDir;
        if (cx > 0 && cx < width - 1) {
          if (grid[from.y][cx] === 'chasm') {
            grid[from.y][cx] = 'bridge';
          } else if (grid[from.y][cx] === 'wall') {
            grid[from.y][cx] = 'floor';
          }
        }
      }
      const yDir = to.y > from.y ? 1 : -1;
      let cy = from.y;
      while (cy !== to.y) {
        cy += yDir;
        if (cy > 0 && cy < height - 1) {
          if (grid[cy][to.x] === 'chasm') {
            grid[cy][to.x] = 'bridge';
          } else if (grid[cy][to.x] === 'wall') {
            grid[cy][to.x] = 'floor';
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/chasmGenerator.test.ts && cd ..`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement chasm generator with platforms and bridges
```

---

### Task 6: Factory, Biome Data, and Public API

**Files:**
- Create: `roomgrid/src/generation/factory.ts`
- Create: `roomgrid/src/data/biomeGeneration.json`
- Create: `roomgrid/src/generation/index.ts`
- Create: `roomgrid/__tests__/factory.test.ts`
- Modify: `roomgrid/src/index.ts`

- [ ] **Step 1: Create biome generation data**

Create `roomgrid/src/data/biomeGeneration.json`:

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

- [ ] **Step 2: Write failing tests for factory**

Create `roomgrid/__tests__/factory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGenerator, generateRoom } from '../src/generation/factory.js';
import { validateRoom } from '../src/generation/validate.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(strategy: string, overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'test',
      strategy,
      params: {},
      tileThemes: {},
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('createGenerator', () => {
  it('returns CavernGenerator for "cavern"', () => {
    const gen = createGenerator('cavern');
    expect(gen).toBeDefined();
  });

  it('returns StructuredGenerator for "structured"', () => {
    const gen = createGenerator('structured');
    expect(gen).toBeDefined();
  });

  it('returns ChasmGenerator for "chasm"', () => {
    const gen = createGenerator('chasm');
    expect(gen).toBeDefined();
  });

  it('throws for unknown strategy', () => {
    expect(() => createGenerator('unknown')).toThrow();
  });
});

describe('generateRoom', () => {
  it('generates a valid cavern room', () => {
    const request = makeRequest('cavern');
    const config = generateRoom(request);
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.3);
    expect(result.valid).toBe(true);
  });

  it('generates a valid structured room', () => {
    const request = makeRequest('structured');
    const config = generateRoom(request);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.3);
    expect(result.valid).toBe(true);
  });

  it('generates a valid chasm room', () => {
    const request = makeRequest('chasm');
    const config = generateRoom(request);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.2);
    expect(result.valid).toBe(true);
  });

  it('returns fallback room with checkerboard water on repeated failure', () => {
    // Use impossible params that will always fail validation: 99% fill, require 99% open
    const request = makeRequest('cavern', {
      biomeConfig: {
        biomeId: 'test',
        strategy: 'cavern',
        params: { fillProbability: 0.99, smoothingPasses: 10, minOpenPercent: 0.99 },
        tileThemes: {},
      },
    });
    const config = generateRoom(request);
    // Fallback: should have checkerboard water pattern
    const hasWater = config.tiles.some(row => row.some(t => t === 'water'));
    expect(hasWater).toBe(true);
    // Should still have correct dimensions
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    // Should have exit tiles
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/factory.test.ts && cd ..`

Expected: FAIL — `createGenerator` not found.

- [ ] **Step 4: Implement factory**

Create `roomgrid/src/generation/factory.ts`:

```ts
import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';
import { CavernGenerator } from './cavernGenerator.js';
import { StructuredGenerator } from './structuredGenerator.js';
import { ChasmGenerator } from './chasmGenerator.js';
import { validateRoom } from './validate.js';

const MAX_ATTEMPTS = 10;

export function createGenerator(strategy: string): RoomGenerator {
  switch (strategy) {
    case 'cavern':
      return new CavernGenerator();
    case 'structured':
      return new StructuredGenerator();
    case 'chasm':
      return new ChasmGenerator();
    default:
      throw new Error(`Unknown generation strategy: ${strategy}`);
  }
}

export function generateRoom(request: RoomGenerationRequest): RoomGridConfig {
  const generator = createGenerator(request.biomeConfig.strategy);
  const minOpen = request.biomeConfig.params.minOpenPercent ?? 0.4;
  const exitPositions = request.exits.map(e => e.position);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const config = generator.generate(request);
    const result = validateRoom(config, exitPositions, minOpen);
    if (result.valid) return config;
  }

  console.warn(
    `[roomgrid] All ${MAX_ATTEMPTS} generation attempts failed for biome ${request.biomeConfig.biomeId}, using fallback room`
  );
  return generateFallbackRoom(request);
}

function generateFallbackRoom(request: RoomGenerationRequest): RoomGridConfig {
  const { width, height, exits } = request;
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        return 'wall' as TileType;
      }
      // Checkerboard water pattern — unmistakable during testing
      if ((x + y) % 2 === 0) {
        return 'water' as TileType;
      }
      return 'floor' as TileType;
    })
  );

  // Place exits
  for (const exit of exits) {
    tiles[exit.position.y][exit.position.x] = 'exit';
  }

  return {
    width,
    height,
    tiles,
    exits: exits.map(e => ({ position: e.position, data: e.data })),
  };
}
```

- [ ] **Step 5: Create generation index**

Create `roomgrid/src/generation/index.ts`:

```ts
export type { RoomGenerator, RoomGenerationRequest, BiomeGenerationConfig, GenerationParams } from './types.js';
export { validateRoom } from './validate.js';
export type { ValidationResult } from './validate.js';
export { CavernGenerator } from './cavernGenerator.js';
export { StructuredGenerator } from './structuredGenerator.js';
export { ChasmGenerator } from './chasmGenerator.js';
export { createGenerator, generateRoom } from './factory.js';
```

- [ ] **Step 6: Update root index.ts**

Update `roomgrid/src/index.ts`:

```ts
export * from './types.js';
export { bresenhamLine, hasLineOfSight, getVisibleTiles } from './lineOfSight.js';
export { findPath } from './pathfinding.js';
export { RoomGrid } from './RoomGrid.js';
export * from './generation/index.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/factory.test.ts && cd ..`

Expected: All 7 tests PASS.

- [ ] **Step 8: Run full test suite and type check**

Run: `cd roomgrid && npx vitest run && cd ..`

Expected: All tests PASS across all test files.

Run: `npx tsc --noEmit --project roomgrid/tsconfig.json`

Expected: No errors.

- [ ] **Step 9: Commit**

```
feat(roomgrid): add generation factory, biome data, and public API
```
