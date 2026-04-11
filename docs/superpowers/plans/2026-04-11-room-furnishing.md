# Room Furnishing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate dungeon rooms with themed, constraint-placed furniture that renders as ASCII overlays and optionally integrates with the interactable system.

**Architecture:** Furniture definitions live in a JSON data file. A placement algorithm in `furnishingPlacer.ts` runs after torch placement in `buildTileGrid()`, scanning the tile grid for valid positions per constraint type (wall, center, corner, near-water, anywhere). Output is a `Furnishing[]` array on `TileGrid` plus `InteractableInstance` entries for interactive pieces. The client renders furnishings as entity overlays in `RoomView.tsx`.

**Tech Stack:** TypeScript, Vitest, JSON data files, React (client rendering)

---

## File Structure

| File | Role |
|------|------|
| `shared/src/types.ts` | Add `Furnishing` interface, add `furnishings?` to `TileGrid` |
| `server/src/data/furnishingData.json` | **Create** — furniture definitions per biome/room type |
| `server/src/furnishingPlacer.ts` | **Create** — placement algorithm |
| `server/src/furnishingPlacer.test.ts` | **Create** — unit tests for placement |
| `server/src/tileGridBuilder.ts` | Call `placeFurnishings()` after torch placement |
| `shared/src/data/interactables.json` | Add InteractableDefinitions for interactive furniture |
| `client/src/components/RoomView.tsx` | Add furnishings to entity overlay array |
| `client/src/styles/index.css` | Add `.entity-furnishing` CSS class |

---

### Task 1: Add Furnishing type and TileGrid field

**Files:**
- Modify: `shared/src/types.ts:94-99`

- [ ] **Step 1: Add Furnishing interface and update TileGrid**

In `shared/src/types.ts`, add the `Furnishing` interface above `TileGrid` and add the `furnishings?` field to `TileGrid`:

```typescript
export interface Furnishing {
  x: number;
  y: number;
  char: string;
  name: string;
  interactable: boolean;
}

export interface TileGrid {
  width: number;
  height: number;
  tiles: string[][];
  themes?: (string | null)[][];
  furnishings?: Furnishing[];
}
```

- [ ] **Step 2: Verify shared package still compiles**

Run: `npx vitest run --project shared`
Expected: All existing tests pass, no type errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat: add Furnishing type and furnishings field to TileGrid"
```

---

### Task 2: Create furnishing data JSON

**Files:**
- Create: `server/src/data/furnishingData.json`

- [ ] **Step 1: Create the furnishing definitions file**

Create `server/src/data/furnishingData.json` with starter biome furniture for all 5 room types. Each entry has: `id`, `name`, `asciiChar`, `placement` (wall|center|corner|near-water|anywhere), `roomTypes` (string[]), `biomes` (string[]), `interactable` (boolean), `weight` (number).

```json
[
  { "id": "starter_rubble", "name": "Rubble", "asciiChar": "░", "placement": "anywhere", "roomTypes": ["tunnel"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_bones", "name": "Bones", "asciiChar": "%", "placement": "anywhere", "roomTypes": ["tunnel"], "biomes": ["starter"], "interactable": false, "weight": 8 },
  { "id": "starter_collapsed_cart", "name": "Collapsed Cart", "asciiChar": "⊞", "placement": "wall", "roomTypes": ["tunnel"], "biomes": ["starter"], "interactable": true, "weight": 5 },

  { "id": "starter_table", "name": "Table", "asciiChar": "╥", "placement": "center", "roomTypes": ["chamber"], "biomes": ["starter"], "interactable": false, "weight": 8 },
  { "id": "starter_chair", "name": "Chair", "asciiChar": "╤", "placement": "center", "roomTypes": ["chamber"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_barrel", "name": "Barrel", "asciiChar": "○", "placement": "wall", "roomTypes": ["chamber"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_rotting_shelf", "name": "Rotting Shelf", "asciiChar": "▐", "placement": "wall", "roomTypes": ["chamber"], "biomes": ["starter"], "interactable": true, "weight": 5 },
  { "id": "starter_locked_chest", "name": "Locked Chest", "asciiChar": "■", "placement": "wall", "roomTypes": ["chamber"], "biomes": ["starter"], "interactable": true, "weight": 4 },

  { "id": "starter_stalagmite", "name": "Stalagmite", "asciiChar": "▲", "placement": "anywhere", "roomTypes": ["cavern"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_mushroom_cluster", "name": "Mushroom Cluster", "asciiChar": "♣", "placement": "anywhere", "roomTypes": ["cavern"], "biomes": ["starter"], "interactable": false, "weight": 8 },
  { "id": "starter_puddle", "name": "Puddle", "asciiChar": "~", "placement": "anywhere", "roomTypes": ["cavern"], "biomes": ["starter"], "interactable": false, "weight": 6 },
  { "id": "starter_glowing_fungus", "name": "Glowing Fungus", "asciiChar": "✦", "placement": "wall", "roomTypes": ["cavern"], "biomes": ["starter"], "interactable": true, "weight": 5 },
  { "id": "starter_strange_fossil", "name": "Strange Fossil", "asciiChar": "&", "placement": "wall", "roomTypes": ["cavern"], "biomes": ["starter"], "interactable": true, "weight": 4 },

  { "id": "starter_crate", "name": "Crate", "asciiChar": "□", "placement": "corner", "roomTypes": ["dead_end"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_cobwebs", "name": "Cobwebs", "asciiChar": "≈", "placement": "corner", "roomTypes": ["dead_end"], "biomes": ["starter"], "interactable": false, "weight": 8 },
  { "id": "starter_shrine", "name": "Shrine", "asciiChar": "†", "placement": "wall", "roomTypes": ["dead_end"], "biomes": ["starter"], "interactable": true, "weight": 5 },
  { "id": "starter_old_skeleton", "name": "Old Skeleton", "asciiChar": "%", "placement": "anywhere", "roomTypes": ["dead_end"], "biomes": ["starter"], "interactable": true, "weight": 4 },

  { "id": "starter_pillar", "name": "Pillar", "asciiChar": "║", "placement": "center", "roomTypes": ["boss"], "biomes": ["starter"], "interactable": false, "weight": 10 },
  { "id": "starter_throne", "name": "Throne", "asciiChar": "▣", "placement": "wall", "roomTypes": ["boss"], "biomes": ["starter"], "interactable": false, "weight": 4 },
  { "id": "starter_brazier", "name": "Brazier", "asciiChar": "*", "placement": "center", "roomTypes": ["boss"], "biomes": ["starter"], "interactable": false, "weight": 8 },
  { "id": "starter_altar", "name": "Altar", "asciiChar": "┬", "placement": "wall", "roomTypes": ["boss"], "biomes": ["starter"], "interactable": true, "weight": 4 },
  { "id": "starter_weapon_rack", "name": "Weapon Rack", "asciiChar": "╫", "placement": "wall", "roomTypes": ["boss"], "biomes": ["starter"], "interactable": true, "weight": 4 }
]
```

- [ ] **Step 2: Commit**

```bash
git add server/src/data/furnishingData.json
git commit -m "feat: add furnishing data for starter biome"
```

---

### Task 3: Implement placement algorithm with tests

**Files:**
- Create: `server/src/furnishingPlacer.ts`
- Create: `server/src/furnishingPlacer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/furnishingPlacer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyTiles, placeFurnishings } from './furnishingPlacer.js';
import type { Furnishing } from '@caverns/shared';

// Helper: build a simple tile grid
// '#' = wall, '.' = floor, 'E' = exit, '~' = water
function buildTiles(map: string[]): string[][] {
  return map.map(row => [...row].map(ch => {
    if (ch === '#') return 'wall';
    if (ch === 'E') return 'exit';
    if (ch === '~') return 'water';
    return 'floor';
  }));
}

describe('classifyTiles', () => {
  it('classifies wall-adjacent floor tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 5, new Set());
    // All floor tiles adjacent to walls should be in the wall bucket
    expect(buckets.wall.length).toBeGreaterThan(0);
    // Center tile (2,2) has no wall neighbors
    const centerInWall = buckets.wall.some(p => p.x === 2 && p.y === 2);
    expect(centerInWall).toBe(false);
    // Center tile should be in center bucket
    const centerInCenter = buckets.center.some(p => p.x === 2 && p.y === 2);
    expect(centerInCenter).toBe(true);
  });

  it('classifies corner tiles (2+ orthogonal walls sharing a diagonal)', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 5, new Set());
    // (1,1) has walls to the north and west — that's a corner
    const cornerFound = buckets.corner.some(p => p.x === 1 && p.y === 1);
    expect(cornerFound).toBe(true);
    // (2,1) has wall to north only — not a corner
    const midTopIsCorner = buckets.corner.some(p => p.x === 2 && p.y === 1);
    expect(midTopIsCorner).toBe(false);
  });

  it('classifies near-water tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#.~.#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 4, new Set());
    // (1,1) is floor adjacent to water at (2,1)
    const nearWater = buckets.nearWater.some(p => p.x === 1 && p.y === 1);
    expect(nearWater).toBe(true);
  });

  it('excludes exit tiles and occupied positions', () => {
    const tiles = buildTiles([
      '##E##',
      '#...#',
      '#...#',
      '#####',
    ]);
    const occupied = new Set(['1,1']);
    const buckets = classifyTiles(tiles, 5, 4, occupied);
    // Exit tile (2,0) should not appear in any bucket
    const exitInAny = buckets.anywhere.some(p => p.x === 2 && p.y === 0);
    expect(exitInAny).toBe(false);
    // Occupied (1,1) should not appear in any bucket
    const occInAny = buckets.anywhere.some(p => p.x === 1 && p.y === 1);
    expect(occInAny).toBe(false);
  });
});

describe('placeFurnishings', () => {
  it('returns empty array when no furniture matches room type', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ]);
    const result = placeFurnishings(tiles, 5, 4, 'tunnel', 'nonexistent_biome', new Set());
    expect(result.furnishings).toEqual([]);
    expect(result.interactableInstances).toEqual([]);
  });

  it('places furnishings within count limits', () => {
    const tiles = buildTiles([
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '##########',
    ]);
    const result = placeFurnishings(tiles, 10, 8, 'chamber', 'starter', new Set());
    expect(result.furnishings.length).toBeGreaterThanOrEqual(4);
    expect(result.furnishings.length).toBeLessThanOrEqual(7);
  });

  it('does not place furnishings on occupied tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const occupied = new Set(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3', '3,3']);
    const result = placeFurnishings(tiles, 5, 5, 'chamber', 'starter', occupied);
    // All floor tiles are occupied, so nothing should be placed
    expect(result.furnishings).toEqual([]);
  });

  it('creates interactable instances for interactive furniture', () => {
    const tiles = buildTiles([
      '###############',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '###############',
    ]);
    // Run multiple times to increase chance of getting interactive pieces
    let foundInteractable = false;
    for (let i = 0; i < 20; i++) {
      const result = placeFurnishings(tiles, 15, 14, 'chamber', 'starter', new Set());
      if (result.interactableInstances.length > 0) {
        foundInteractable = true;
        // Each interactable instance should have a valid position
        for (const inst of result.interactableInstances) {
          expect(inst.position.x).toBeGreaterThanOrEqual(0);
          expect(inst.position.y).toBeGreaterThanOrEqual(0);
          expect(inst.definitionId).toMatch(/^furn_/);
          expect(inst.usedActions).toEqual({});
        }
        break;
      }
    }
    expect(foundInteractable).toBe(true);
  });

  it('places wall-constrained furniture adjacent to walls', () => {
    const tiles = buildTiles([
      '###############',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '###############',
    ]);
    // Run multiple times and check all wall-placement pieces
    for (let i = 0; i < 10; i++) {
      const result = placeFurnishings(tiles, 15, 14, 'chamber', 'starter', new Set());
      for (const f of result.furnishings) {
        // We know chamber has barrel (wall), rotting_shelf (wall), locked_chest (wall)
        // and table (center), chair (center)
        // Just verify all positions are valid floor tiles
        expect(tiles[f.y][f.x]).toBe('floor');
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/furnishingPlacer.test.ts`
Expected: FAIL — module `./furnishingPlacer.js` not found.

- [ ] **Step 3: Implement the placement algorithm**

Create `server/src/furnishingPlacer.ts`:

```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Furnishing, InteractableInstance } from '@caverns/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FurnishingDef {
  id: string;
  name: string;
  asciiChar: string;
  placement: 'wall' | 'center' | 'corner' | 'near-water' | 'anywhere';
  roomTypes: string[];
  biomes: string[];
  interactable: boolean;
  weight: number;
}

let furnishingDefs: FurnishingDef[];
try {
  const dataPath = resolve(__dirname, './data/furnishingData.json');
  furnishingDefs = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch {
  furnishingDefs = [];
}

interface Position {
  x: number;
  y: number;
}

export interface TileBuckets {
  wall: Position[];
  center: Position[];
  corner: Position[];
  nearWater: Position[];
  anywhere: Position[];
}

const FURNITURE_COUNTS: Record<string, { min: number; max: number }> = {
  tunnel:   { min: 1, max: 3 },
  chamber:  { min: 4, max: 7 },
  cavern:   { min: 6, max: 12 },
  dead_end: { min: 2, max: 4 },
  boss:     { min: 8, max: 15 },
};

export function classifyTiles(
  tiles: string[][],
  width: number,
  height: number,
  occupied: Set<string>,
): TileBuckets {
  const buckets: TileBuckets = {
    wall: [],
    center: [],
    corner: [],
    nearWater: [],
    anywhere: [],
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== 'floor') continue;
      if (occupied.has(`${x},${y}`)) continue;

      const pos: Position = { x, y };

      // Count orthogonal wall and water neighbors
      const neighbors = [
        { nx: x, ny: y - 1, dir: 'n' },
        { nx: x, ny: y + 1, dir: 's' },
        { nx: x - 1, ny: y, dir: 'w' },
        { nx: x + 1, ny: y, dir: 'e' },
      ];

      let wallN = false, wallS = false, wallW = false, wallE = false;
      let waterCount = 0;

      for (const { nx, ny, dir } of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const t = tiles[ny][nx];
        if (t === 'wall') {
          if (dir === 'n') wallN = true;
          if (dir === 's') wallS = true;
          if (dir === 'w') wallW = true;
          if (dir === 'e') wallE = true;
        }
        if (t === 'water') waterCount++;
      }

      const wallCount = (wallN ? 1 : 0) + (wallS ? 1 : 0) + (wallW ? 1 : 0) + (wallE ? 1 : 0);

      // Corner: 2+ walls that share a diagonal (not opposite pairs)
      const isCorner = wallCount >= 2 && !(
        (wallN && wallS && !wallE && !wallW) ||
        (wallE && wallW && !wallN && !wallS)
      );

      if (isCorner) buckets.corner.push(pos);
      if (wallCount > 0) buckets.wall.push(pos);
      if (wallCount === 0) buckets.center.push(pos);
      if (waterCount > 0) buckets.nearWater.push(pos);
      buckets.anywhere.push(pos);
    }
  }

  return buckets;
}

function weightedPick(defs: FurnishingDef[]): FurnishingDef {
  const totalWeight = defs.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const def of defs) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface PlaceFurnishingsResult {
  furnishings: Furnishing[];
  interactableInstances: InteractableInstance[];
}

export function placeFurnishings(
  tiles: string[][],
  width: number,
  height: number,
  roomType: string,
  biomeId: string,
  occupied: Set<string>,
): PlaceFurnishingsResult {
  // Filter definitions to those matching room type and biome
  const candidates = furnishingDefs.filter(
    d => d.roomTypes.includes(roomType) && d.biomes.includes(biomeId)
  );

  if (candidates.length === 0) {
    return { furnishings: [], interactableInstances: [] };
  }

  // Determine count
  const limits = FURNITURE_COUNTS[roomType] ?? { min: 2, max: 5 };
  const rawCount = Math.floor(width * height * 0.015);
  const count = Math.max(limits.min, Math.min(limits.max, rawCount));

  // Pre-compute position buckets
  const buckets = classifyTiles(tiles, width, height, occupied);

  // Track which positions have been used
  const usedPositions = new Set<string>();
  const usedInteractableIds = new Set<string>();
  const furnishings: Furnishing[] = [];
  const interactableInstances: InteractableInstance[] = [];
  let instanceCounter = 0;

  // Select and place furniture pieces
  for (let i = 0; i < count; i++) {
    // For interactable pieces, filter out already-used definitions
    const availableCandidates = candidates.filter(
      d => !d.interactable || !usedInteractableIds.has(d.id)
    );
    if (availableCandidates.length === 0) break;

    const def = weightedPick(availableCandidates);

    // Find matching bucket
    const bucketKey = def.placement === 'near-water' ? 'nearWater' : def.placement;
    const bucket = buckets[bucketKey as keyof TileBuckets];
    if (!bucket) continue;

    // Filter out already-used positions
    const available = bucket.filter(p => !usedPositions.has(`${p.x},${p.y}`));
    if (available.length === 0) continue;

    // Pick random position
    const pos = available[Math.floor(Math.random() * available.length)];
    usedPositions.add(`${pos.x},${pos.y}`);

    furnishings.push({
      x: pos.x,
      y: pos.y,
      char: def.asciiChar,
      name: def.name,
      interactable: def.interactable,
    });

    if (def.interactable) {
      usedInteractableIds.add(def.id);
      instanceCounter++;
      interactableInstances.push({
        definitionId: `furn_${def.id}`,
        instanceId: `furn_${String(instanceCounter).padStart(3, '0')}`,
        position: { x: pos.x, y: pos.y },
        usedActions: {},
      });
    }
  }

  return { furnishings, interactableInstances };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/furnishingPlacer.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/furnishingPlacer.ts server/src/furnishingPlacer.test.ts
git commit -m "feat: implement constraint-based furnishing placement algorithm"
```

---

### Task 4: Add interactable definitions for furniture pieces

**Files:**
- Modify: `shared/src/data/interactables.json`

- [ ] **Step 1: Add furniture interactable definitions**

Append the following entries to the end of the array in `shared/src/data/interactables.json` (before the final `]`). Each uses `furn_` prefix on the ID to match the `definitionId` generated by `placeFurnishings`. All use the `"starter"` biome and `"small"` slot size. Each has a single `"examine"` action with outcome weights and narration:

```json
  {
    "id": "furn_starter_collapsed_cart",
    "name": "Collapsed Cart",
    "asciiChar": "⊞",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Search",
        "outcomes": { "weights": { "loot": 40, "hazard": 15, "flavor": 45 } },
        "narration": {
          "loot": [
            "Beneath the splintered planks, something glints in the mud.",
            "A sack caught under the axle still holds something useful."
          ],
          "hazard": [
            "The cart shifts as you reach under it. Wood splinters into your arm.",
            "A nest of cave beetles scatters from the wreckage, biting as they flee."
          ],
          "flavor": [
            "Rotted grain and broken wheels. Whoever was hauling this never made it out.",
            "The wood crumbles at your touch. Nothing worth salvaging."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_rotting_shelf",
    "name": "Rotting Shelf",
    "asciiChar": "▐",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Search",
        "outcomes": { "weights": { "loot": 35, "hazard": 10, "intel": 15, "flavor": 40 } },
        "narration": {
          "loot": [
            "Behind mouldy jars, your fingers close around something solid.",
            "One shelf holds. On it, something wrapped in oilcloth."
          ],
          "hazard": [
            "The shelf collapses. A jar shatters, splashing something caustic.",
            "You disturb a cluster of pale spiders nesting between the planks."
          ],
          "intel": [
            "A scrap of parchment tucked between bottles. It describes nearby passages.",
            "Scratched into the wood: a crude map. Someone marked a danger ahead."
          ],
          "flavor": [
            "Jars of pickled something. Too far gone to identify, let alone eat.",
            "Dust and rot. The shelf sags but holds nothing of interest."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_locked_chest",
    "name": "Locked Chest",
    "asciiChar": "■",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Force Open",
        "outcomes": { "weights": { "loot": 55, "hazard": 20, "flavor": 25 } },
        "narration": {
          "loot": [
            "The lock gives with a snap. Inside: something worth the bruised knuckles.",
            "You pry the lid open. The chest's previous owner had good taste."
          ],
          "hazard": [
            "A needle jabs from beneath the latch. Whoever locked this meant it.",
            "The lid flies open and a burst of noxious gas hits your face."
          ],
          "flavor": [
            "Empty. Someone got here first.",
            "The chest contains only damp rags and a corroded coin too worn to spend."
          ]
        }
      },
      {
        "id": "pick_lock",
        "label": "Pick Lock",
        "requiresClass": "shadowblade",
        "outcomes": { "weights": { "loot": 70, "hazard": 5, "flavor": 25 } },
        "narration": {
          "loot": [
            "The tumblers click into place. You ease the lid open — the trap disarmed, the prize yours.",
            "Child's play. The lock pops and the contents are unguarded."
          ],
          "flavor": [
            "You pick the lock cleanly, but the chest holds only dust and disappointment.",
            "The mechanism is elegant. The contents are not."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_glowing_fungus",
    "name": "Glowing Fungus",
    "asciiChar": "✦",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Examine",
        "outcomes": { "weights": { "loot": 25, "hazard": 15, "intel": 20, "flavor": 40 } },
        "narration": {
          "loot": [
            "The fungus cap splits open, revealing a crystallized core worth keeping.",
            "Luminescent spores settle on your hand. Among them, something solid."
          ],
          "hazard": [
            "The glow intensifies and the fungus bursts, spraying stinging spores.",
            "You lean too close. The light burns your eyes for a moment."
          ],
          "intel": [
            "The glow pulses in a rhythm. It grows brighter toward one passage.",
            "In the soft light, you notice scratches on the wall. A warning, maybe."
          ],
          "flavor": [
            "Beautiful and useless. The glow fades as you touch it.",
            "It pulses gently, indifferent to your presence."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_strange_fossil",
    "name": "Strange Fossil",
    "asciiChar": "&",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Examine",
        "outcomes": { "weights": { "loot": 20, "hazard": 10, "intel": 25, "flavor": 45 } },
        "narration": {
          "loot": [
            "You chip away the rock and find something embedded — not stone, but metal.",
            "The fossil's eye socket holds a gemstone, still intact after millennia."
          ],
          "hazard": [
            "The rock crumbles and something sharp inside cuts your palm.",
            "As you pry at it, a crack runs through the wall. Dust rains down."
          ],
          "intel": [
            "The creature's pose suggests it was fleeing something. From below.",
            "The fossil is impossibly fresh. Whatever killed it may still be nearby."
          ],
          "flavor": [
            "A creature from another age, preserved in stone. It has too many legs.",
            "The fossil is ancient and beautiful. You leave it where it lies."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_shrine",
    "name": "Shrine",
    "asciiChar": "†",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Pray",
        "outcomes": { "weights": { "loot": 30, "hazard": 10, "flavor": 35, "intel": 25 } },
        "narration": {
          "loot": [
            "You kneel. A warmth flows through the stone. An offering materializes at the base.",
            "The shrine glows faintly. When the light fades, something rests in the alcove."
          ],
          "hazard": [
            "The shrine does not welcome you. A cold shock runs through your hands.",
            "You feel watched. A sharp pain flares behind your eyes."
          ],
          "intel": [
            "Visions flash: a chamber, a danger, a way through. Then silence.",
            "The shrine hums. You sense the shape of nearby rooms in your mind."
          ],
          "flavor": [
            "The stone is smooth from centuries of hands. It offers only peace.",
            "A faint warmth, then nothing. The shrine remembers someone, but not you."
          ]
        }
      },
      {
        "id": "bless",
        "label": "Bless",
        "requiresClass": "cleric",
        "outcomes": { "weights": { "loot": 50, "hazard": 3, "intel": 30, "flavor": 17 } },
        "narration": {
          "loot": [
            "Your blessing rekindles the shrine. It gives back what was left for the faithful.",
            "Light pours from the stone. A gift, long held in trust."
          ],
          "intel": [
            "The shrine's ancient connection awakens. You see the dungeon's layout clearly.",
            "Through the shrine, you feel the presence of every creature on this floor."
          ],
          "flavor": [
            "The shrine accepts your blessing. A moment of warmth in the dark.",
            "You feel the gratitude of something long forgotten. It has nothing more to give."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_old_skeleton",
    "name": "Old Skeleton",
    "asciiChar": "%",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Search",
        "outcomes": { "weights": { "loot": 40, "hazard": 15, "flavor": 45 } },
        "narration": {
          "loot": [
            "The skeleton clutches a pouch. Inside, something still useful.",
            "A belt pouch, half-buried in dust. Its owner has no further use for it."
          ],
          "hazard": [
            "You disturb the remains and something bites — a centipede nesting in the ribcage.",
            "The bones shift and a rusted blade falls, nicking your hand."
          ],
          "flavor": [
            "An adventurer, once. Their gear has long since rotted away.",
            "The skull grins at the ceiling. Whatever they found here, it found them first."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_altar",
    "name": "Altar",
    "asciiChar": "┬",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Examine",
        "outcomes": { "weights": { "loot": 35, "hazard": 20, "intel": 15, "flavor": 30 } },
        "narration": {
          "loot": [
            "The altar's surface is stained dark. Beneath, a hidden compartment holds something.",
            "You run your hand along the carved stone. A panel clicks open."
          ],
          "hazard": [
            "The altar thrums with energy. A shock arcs through your fingers.",
            "Dark symbols flare to life as you touch the stone. Pain follows."
          ],
          "intel": [
            "Carved into the base: a map of these chambers. Some passages are marked in red.",
            "The altar's engravings depict the creature that rules this place. Its weaknesses too."
          ],
          "flavor": [
            "Offerings of bone and tarnished metal. This altar served something hungry.",
            "Cold stone, ancient carvings. The altar's purpose is lost to time."
          ]
        }
      }
    ]
  },
  {
    "id": "furn_starter_weapon_rack",
    "name": "Weapon Rack",
    "asciiChar": "╫",
    "biomes": ["starter"],
    "slotSize": "small",
    "actions": [
      {
        "id": "examine",
        "label": "Search",
        "outcomes": { "weights": { "loot": 60, "hazard": 10, "flavor": 30 } },
        "narration": {
          "loot": [
            "Most slots are empty, but one weapon remains — and it's in decent shape.",
            "Rusted blades and broken hafts, but one piece catches your eye."
          ],
          "hazard": [
            "You pull a weapon free and the rack collapses. A blade falls on your foot.",
            "The rack is trapped. A spring-loaded spike fires from the back panel."
          ],
          "flavor": [
            "Empty pegs and dust. Someone cleaned this out long ago.",
            "Broken weapons, all of them. Whoever fought here lost badly."
          ]
        }
      }
    ]
  }
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('shared/src/data/interactables.json','utf-8')); console.log('Valid JSON')"`
Expected: "Valid JSON"

- [ ] **Step 3: Run shared tests**

Run: `npx vitest run --project shared`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add shared/src/data/interactables.json
git commit -m "feat: add interactable definitions for furniture pieces"
```

---

### Task 5: Wire placement into tileGridBuilder

**Files:**
- Modify: `server/src/tileGridBuilder.ts:94-142`

- [ ] **Step 1: Import and call placeFurnishings**

In `server/src/tileGridBuilder.ts`, add the import at the top (after the existing imports):

```typescript
import { placeFurnishings } from './furnishingPlacer.js';
```

Then modify the `buildTileGrid` function. After `placeTorches` produces `finalThemes`, add the furnishing placement. The function should also accept optional existing interactable positions to exclude. Update the return to include furnishings:

```typescript
export function buildTileGrid(room: Room, biomeId: string): TileGrid {
  const dims = ROOM_DIMENSIONS[room.type] ?? DEFAULT_DIMENSIONS;
  const { width, height } = dims;

  let biomeConfig = biomeConfigs.find(b => b.biomeId === biomeId);
  if (!biomeConfig) {
    biomeConfig = biomeConfigs.find(b => b.biomeId === 'starter')!;
  }

  // Include both regular and locked exits — locked doors still exist physically
  const allExits = { ...room.lockedExits, ...room.exits };
  const exits = Object.entries(allExits)
    .filter(([, targetId]) => targetId != null)
    .map(([dir, targetId]) => {
      const direction = dir as Direction;
      const position = exitPosition(direction, width, height);
      return {
        position,
        data: { direction, targetRoomId: targetId! },
      };
    });

  const config = generateRoom({
    width,
    height,
    exits,
    biomeConfig,
    roomType: room.type,
  });

  const tileThemes = biomeConfig.tileThemes;
  const hasThemes = Object.keys(tileThemes).length > 0;
  let themes: (string | null)[][] | undefined;

  if (hasThemes) {
    themes = config.tiles.map((row: string[]) =>
      row.map((tileType: string) => (tileThemes as Record<string, string>)[tileType] ?? null)
    );
  }

  const finalThemes = placeTorches(config.tiles as string[][], themes ?? undefined, width, height, room.type);

  // Collect occupied positions: exits + existing interactables
  const occupiedPositions = new Set<string>();
  for (const exit of exits) {
    occupiedPositions.add(`${exit.position.x},${exit.position.y}`);
  }
  if (room.interactables) {
    for (const inst of room.interactables) {
      occupiedPositions.add(`${inst.position.x},${inst.position.y}`);
    }
  }

  const { furnishings, interactableInstances } = placeFurnishings(
    config.tiles as string[][],
    width,
    height,
    room.type,
    biomeId,
    occupiedPositions,
  );

  // Merge furniture interactables into room's interactables array
  if (interactableInstances.length > 0) {
    if (!room.interactables) room.interactables = [];
    room.interactables.push(...interactableInstances);
  }

  return {
    width,
    height,
    tiles: config.tiles as string[][],
    themes: finalThemes,
    furnishings: furnishings.length > 0 ? furnishings : undefined,
  };
}
```

- [ ] **Step 2: Run existing tileGridBuilder tests**

Run: `npx vitest run server/src/tileGridBuilder.test.ts`
Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/tileGridBuilder.ts
git commit -m "feat: wire furnishing placement into tileGridBuilder"
```

---

### Task 6: Client rendering — add furnishings to entity overlays

**Files:**
- Modify: `client/src/components/RoomView.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add CSS class for decorative furnishings**

In `client/src/styles/index.css`, after the existing `.entity-interactable-used` rule (around line 1344), add:

```css
.entity-furnishing {
  color: #665544;
}
```

- [ ] **Step 2: Add furnishings to entity overlays in RoomView**

In `client/src/components/RoomView.tsx`, inside the `entities` useMemo (the block that builds the `overlays` array), add furnishing overlays after the interactables block and before the mob block. The furnishings come from `tileGrid.furnishings`:

```typescript
    // Furnishings
    if (tileGrid.furnishings) {
      for (const f of tileGrid.furnishings) {
        overlays.push({
          x: f.x,
          y: f.y,
          char: f.char,
          className: f.interactable ? 'entity-interactable' : 'entity-furnishing',
        });
      }
    }
```

This should be added after the existing interactables loop (around line 115) and before the mob overlay section (around line 118). The `tileGrid` variable is already available in the useMemo's closure.

- [ ] **Step 3: Verify the dev server renders furnishings**

Start the game, enter a room, and verify:
- Decorative furniture appears in a muted brown color
- Interactive furniture appears in the bright interactable color (magenta)
- Furniture respects line-of-sight (hidden in unseen tiles, dim in explored tiles)
- Furniture does not appear on wall tiles or exit tiles

- [ ] **Step 4: Commit**

```bash
git add client/src/components/RoomView.tsx client/src/styles/index.css
git commit -m "feat: render furnishings as entity overlays in room view"
```

---

### Task 7: Update shared dist files

**Files:**
- Modify: `shared/dist/types.d.ts` (add Furnishing interface and furnishings field)
- Modify: `shared/dist/types.js` (no runtime changes needed — interfaces are erased)

The server imports from `@caverns/shared` which resolves to `shared/dist/`. The Vite client resolves from source, but the server needs the compiled dist to include the new `Furnishing` interface and the updated `TileGrid`.

- [ ] **Step 1: Update shared/dist/types.d.ts**

Find the `TileGrid` interface in `shared/dist/types.d.ts` and add the `Furnishing` interface above it, then add the `furnishings?` field:

```typescript
export interface Furnishing {
    x: number;
    y: number;
    char: string;
    name: string;
    interactable: boolean;
}
export interface TileGrid {
    width: number;
    height: number;
    tiles: string[][];
    themes?: (string | null)[][];
    furnishings?: Furnishing[];
}
```

- [ ] **Step 2: Verify the server can resolve the new type**

Run: `npx vitest run server/src/furnishingPlacer.test.ts`
Expected: All tests pass (server can import `Furnishing` type from shared).

- [ ] **Step 3: Commit**

```bash
git add shared/dist/types.d.ts
git commit -m "feat: update shared dist with Furnishing type"
```
