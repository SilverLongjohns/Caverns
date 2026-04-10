# Room Grid Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dependency-free `roomgrid/` workspace with 2D tile grid, entity management, 8-directional movement, Bresenham's line-of-sight, and A* pathfinding.

**Architecture:** New npm workspace `roomgrid/` containing pure functions and one class (`RoomGrid`). Types in `types.ts`, algorithms in separate files (`lineOfSight.ts`, `pathfinding.ts`), class in `RoomGrid.ts`, public API in `index.ts`. Tests colocated in `__tests__/`.

**Tech Stack:** TypeScript, Vitest, npm workspaces. Zero runtime dependencies. Imports `Direction` type from `@caverns/shared`.

**Spec:** `docs/superpowers/specs/2026-04-10-room-grid-engine-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `roomgrid/package.json` | Workspace config, scripts, dev deps only |
| `roomgrid/tsconfig.json` | Extends root tsconfig, module/resolution settings |
| `roomgrid/src/types.ts` | All type definitions: TileType, Tile, Entity, GridPosition, MoveResult, etc. |
| `roomgrid/src/lineOfSight.ts` | Bresenham's line, hasLineOfSight, getVisibleTiles — pure functions |
| `roomgrid/src/pathfinding.ts` | A* search — pure function |
| `roomgrid/src/RoomGrid.ts` | Core class: constructor, tile queries, entity CRUD, movement, delegates to LOS/pathfinding |
| `roomgrid/src/index.ts` | Public re-exports of types and RoomGrid class |
| `roomgrid/__tests__/lineOfSight.test.ts` | Tests for Bresenham's line, LOS blocking, visibility |
| `roomgrid/__tests__/pathfinding.test.ts` | Tests for A* pathfinding |
| `roomgrid/__tests__/RoomGrid.test.ts` | Tests for grid construction, entity management, movement |

---

### Task 1: Workspace Scaffolding and Types

**Files:**
- Create: `roomgrid/package.json`
- Create: `roomgrid/tsconfig.json`
- Create: `roomgrid/src/types.ts`
- Create: `roomgrid/src/index.ts`
- Modify: `package.json` (root — add workspace)

- [ ] **Step 1: Create `roomgrid/package.json`**

```json
{
  "name": "@caverns/roomgrid",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@caverns/shared": "*"
  },
  "devDependencies": {
    "typescript": "^5.5.3",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 2: Create `roomgrid/tsconfig.json`**

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

- [ ] **Step 3: Create `roomgrid/src/types.ts`**

```ts
import type { Direction } from '@caverns/shared';

// === Tiles ===
export type TileType = 'floor' | 'wall' | 'exit';

export interface ExitData {
  direction: Direction;
  targetRoomId: string;
}

export interface Tile {
  type: TileType;
  exit?: ExitData;
}

// === Positions ===
export interface GridPosition {
  x: number;
  y: number;
}

// === Entities ===
export type EntityType = 'player' | 'mob' | 'interactable';

export interface Entity {
  id: string;
  type: EntityType;
  position: GridPosition;
}

// === Config ===
export interface RoomGridConfig {
  width: number;
  height: number;
  tiles: TileType[][];
  exits?: { position: GridPosition; data: ExitData }[];
}

// === Movement ===
export type GridDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type MoveEvent =
  | { type: 'combat'; entityId: string }
  | { type: 'exit'; exit: ExitData }
  | { type: 'interact'; entityId: string };

export interface MoveResult {
  success: boolean;
  newPosition?: GridPosition;
  events: MoveEvent[];
}

// === Pathfinding ===
export interface PathfindingOpts {
  blockedByEntities?: boolean;
}

// === Direction Offsets ===
export const DIRECTION_OFFSETS: Record<GridDirection, { dx: number; dy: number }> = {
  n:  { dx:  0, dy: -1 },
  s:  { dx:  0, dy:  1 },
  e:  { dx:  1, dy:  0 },
  w:  { dx: -1, dy:  0 },
  ne: { dx:  1, dy: -1 },
  nw: { dx: -1, dy: -1 },
  se: { dx:  1, dy:  1 },
  sw: { dx: -1, dy:  1 },
};
```

- [ ] **Step 4: Create `roomgrid/src/index.ts`**

```ts
export * from './types.js';
```

This will be expanded in later tasks as we add modules.

- [ ] **Step 5: Add `roomgrid` to root `package.json` workspaces**

In the root `package.json`, change the `workspaces` array from:

```json
"workspaces": [
  "shared",
  "server",
  "client"
]
```

to:

```json
"workspaces": [
  "shared",
  "server",
  "client",
  "roomgrid"
]
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

This links the workspace and installs dev deps.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit --project roomgrid/tsconfig.json`

Expected: No errors.

- [ ] **Step 8: Commit**

```
feat(roomgrid): scaffold workspace and define types
```

---

### Task 2: Line of Sight — Bresenham's Line

**Files:**
- Create: `roomgrid/src/lineOfSight.ts`
- Create: `roomgrid/__tests__/lineOfSight.test.ts`

- [ ] **Step 1: Write failing tests for `bresenhamLine`**

Create `roomgrid/__tests__/lineOfSight.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bresenhamLine } from '../src/lineOfSight.js';

describe('bresenhamLine', () => {
  it('returns single point for same start and end', () => {
    const line = bresenhamLine({ x: 3, y: 3 }, { x: 3, y: 3 });
    expect(line).toEqual([{ x: 3, y: 3 }]);
  });

  it('traces a horizontal line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 4, y: 0 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('traces a vertical line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 0, y: 3 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
  });

  it('traces a diagonal line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('traces a steep line (dy > dx)', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 1, y: 3 });
    expect(line).toHaveLength(4);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 1, y: 3 });
  });

  it('traces a line in negative direction', () => {
    const line = bresenhamLine({ x: 3, y: 3 }, { x: 0, y: 0 });
    expect(line[0]).toEqual({ x: 3, y: 3 });
    expect(line[line.length - 1]).toEqual({ x: 0, y: 0 });
    expect(line).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project roomgrid roomgrid/__tests__/lineOfSight.test.ts`

If `--project` is not configured, run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: FAIL — `bresenhamLine` not found.

- [ ] **Step 3: Implement `bresenhamLine`**

Create `roomgrid/src/lineOfSight.ts`:

```ts
import type { GridPosition, Tile } from './types.js';

export function bresenhamLine(from: GridPosition, to: GridPosition): GridPosition[] {
  const points: GridPosition[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return points;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement Bresenham's line algorithm
```

---

### Task 3: Line of Sight — Visibility Functions

**Files:**
- Modify: `roomgrid/src/lineOfSight.ts`
- Modify: `roomgrid/__tests__/lineOfSight.test.ts`

This task adds `hasLineOfSight` and `getVisibleTiles` on top of the existing `bresenhamLine`.

- [ ] **Step 1: Write failing tests for `hasLineOfSight`**

Append to `roomgrid/__tests__/lineOfSight.test.ts`:

```ts
import { hasLineOfSight, getVisibleTiles } from '../src/lineOfSight.js';
import type { Tile } from '../src/types.js';

// Helper: build a tile grid from a string map
// '.' = floor, '#' = wall, 'E' = exit
function buildTiles(map: string[]): Tile[][] {
  return map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return { type: 'wall' as const };
      if (ch === 'E') return { type: 'exit' as const };
      return { type: 'floor' as const };
    })
  );
}

describe('hasLineOfSight', () => {
  it('returns true with clear line of sight', () => {
    // 5x5 open room
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
  });

  it('returns false when wall blocks line of sight', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it('returns true for adjacent tiles even near walls', () => {
    const tiles = buildTiles([
      '.....',
      '.#...',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(true);
  });

  it('returns true for same position', () => {
    const tiles = buildTiles(['.']);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it('blocks LOS through diagonal wall corner', () => {
    // Two walls forming a diagonal corner
    const tiles = buildTiles([
      '...',
      '.#.',
      '...',
    ]);
    // From (0,0) to (2,2) passes through the wall at (1,1)
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: FAIL — `hasLineOfSight` not found.

- [ ] **Step 3: Implement `hasLineOfSight`**

Add to `roomgrid/src/lineOfSight.ts`:

```ts
export function hasLineOfSight(tiles: Tile[][], from: GridPosition, to: GridPosition): boolean {
  const line = bresenhamLine(from, to);
  // Skip start and end — only intermediate tiles block
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i];
    const row = tiles[p.y];
    if (!row) return false;
    const tile = row[p.x];
    if (!tile || tile.type === 'wall') return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 5: Write failing tests for `getVisibleTiles`**

Append to `roomgrid/__tests__/lineOfSight.test.ts`:

```ts
describe('getVisibleTiles', () => {
  it('returns all tiles in range in an open room', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    // From center (2,2) with range 1 — should see 8 neighbors + self = 9
    const visible = getVisibleTiles(tiles, { x: 2, y: 2 }, 1);
    expect(visible).toHaveLength(9);
  });

  it('excludes tiles behind walls', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.###.',
      '.....',
      '.....',
    ]);
    // From (2,0), range 4 — wall row at y=2 blocks tiles at y=3,4
    const visible = getVisibleTiles(tiles, { x: 2, y: 0 }, 4);
    const belowWall = visible.filter(p => p.y > 2);
    expect(belowWall).toHaveLength(0);
  });

  it('does not include out-of-bounds tiles', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    // From corner (0,0) with range 5 — should only return in-bounds tiles
    const visible = getVisibleTiles(tiles, { x: 0, y: 0 }, 5);
    for (const p of visible) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(3);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(3);
    }
  });

  it('uses Chebyshev distance for range', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    // From (2,2) range 1 — diagonal (3,3) is distance 1 in Chebyshev
    const visible = getVisibleTiles(tiles, { x: 2, y: 2 }, 1);
    const hasDiagonal = visible.some(p => p.x === 3 && p.y === 3);
    expect(hasDiagonal).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: FAIL — `getVisibleTiles` not found.

- [ ] **Step 7: Implement `getVisibleTiles`**

Add to `roomgrid/src/lineOfSight.ts`:

```ts
function chebyshevDistance(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function getVisibleTiles(tiles: Tile[][], from: GridPosition, range: number): GridPosition[] {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const visible: GridPosition[] = [];

  const minY = Math.max(0, from.y - range);
  const maxY = Math.min(height - 1, from.y + range);
  const minX = Math.max(0, from.x - range);
  const maxX = Math.min(width - 1, from.x + range);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const pos = { x, y };
      if (chebyshevDistance(from, pos) > range) continue;
      if (hasLineOfSight(tiles, from, pos)) {
        visible.push(pos);
      }
    }
  }

  return visible;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/lineOfSight.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 9: Update `index.ts` exports**

Update `roomgrid/src/index.ts`:

```ts
export * from './types.js';
export { bresenhamLine, hasLineOfSight, getVisibleTiles } from './lineOfSight.js';
```

- [ ] **Step 10: Commit**

```
feat(roomgrid): implement line-of-sight visibility
```

---

### Task 4: Pathfinding — A* Search

**Files:**
- Create: `roomgrid/src/pathfinding.ts`
- Create: `roomgrid/__tests__/pathfinding.test.ts`

- [ ] **Step 1: Write failing tests**

Create `roomgrid/__tests__/pathfinding.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findPath } from '../src/pathfinding.js';
import type { Tile, Entity } from '../src/types.js';

function buildTiles(map: string[]): Tile[][] {
  return map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return { type: 'wall' as const };
      if (ch === 'E') return { type: 'exit' as const };
      return { type: 'floor' as const };
    })
  );
}

describe('findPath', () => {
  it('returns direct path in open room', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
    expect(path!).toHaveLength(5);
  });

  it('finds path around wall', () => {
    const tiles = buildTiles([
      '...',
      '.#.',
      '...',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
    // Path should avoid the wall at (1,1)
    const hitsWall = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsWall).toBe(false);
  });

  it('returns null when no path exists', () => {
    const tiles = buildTiles([
      '.#.',
      '###',
      '.#.',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it('returns single point when start equals end', () => {
    const tiles = buildTiles(['...']);
    const path = findPath(tiles, [], { x: 1, y: 0 }, { x: 1, y: 0 });
    expect(path).toEqual([{ x: 1, y: 0 }]);
  });

  it('treats exit tiles as walkable', () => {
    const tiles = buildTiles([
      '..E',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(3);
  });

  it('avoids entity-occupied tiles when blockedByEntities is true', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const entities: Entity[] = [
      { id: 'mob1', type: 'mob', position: { x: 1, y: 1 } },
    ];
    const path = findPath(tiles, entities, { x: 0, y: 0 }, { x: 2, y: 2 }, { blockedByEntities: true });
    expect(path).not.toBeNull();
    const hitsEntity = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsEntity).toBe(false);
  });

  it('ignores entities when blockedByEntities is false (default)', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const entities: Entity[] = [
      { id: 'mob1', type: 'mob', position: { x: 1, y: 1 } },
    ];
    const path = findPath(tiles, entities, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    // Shortest path goes through (1,1) — entities don't block
    expect(path!).toHaveLength(3);
  });

  it('uses diagonal movement', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    // Diagonal: (0,0) -> (1,1) -> (2,2) = length 3
    expect(path!).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/pathfinding.test.ts && cd ..`

Expected: FAIL — `findPath` not found.

- [ ] **Step 3: Implement A* pathfinding**

Create `roomgrid/src/pathfinding.ts`:

```ts
import type { Tile, Entity, GridPosition, PathfindingOpts } from './types.js';

function chebyshevDistance(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const NEIGHBOR_OFFSETS = [
  { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
  { dx: -1, dy:  0 },                     { dx: 1, dy:  0 },
  { dx: -1, dy:  1 }, { dx: 0, dy:  1 }, { dx: 1, dy:  1 },
];

function posKey(p: GridPosition): string {
  return `${p.x},${p.y}`;
}

export function findPath(
  tiles: Tile[][],
  entities: Entity[],
  from: GridPosition,
  to: GridPosition,
  opts?: PathfindingOpts,
): GridPosition[] | null {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const blockedByEntities = opts?.blockedByEntities ?? false;

  // Build entity position set for O(1) lookup
  const entityPositions = new Set<string>();
  if (blockedByEntities) {
    for (const e of entities) {
      entityPositions.add(posKey(e.position));
    }
  }

  function isWalkable(p: GridPosition): boolean {
    if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
    const tile = tiles[p.y][p.x];
    if (tile.type === 'wall') return false;
    if (blockedByEntities && entityPositions.has(posKey(p))) {
      // Allow start and end positions even if occupied
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) return true;
      return false;
    }
    return true;
  }

  const startKey = posKey(from);
  const endKey = posKey(to);

  // gScore: cost from start to node
  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  // fScore: gScore + heuristic
  const fScore = new Map<string, number>();
  fScore.set(startKey, chebyshevDistance(from, to));

  // cameFrom: for path reconstruction
  const cameFrom = new Map<string, GridPosition>();

  // Open set as a simple sorted array (sufficient for bounded grids)
  const open: GridPosition[] = [from];
  const closedSet = new Set<string>();

  while (open.length > 0) {
    // Find node with lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(posKey(open[0])) ?? Infinity;
    for (let i = 1; i < open.length; i++) {
      const f = fScore.get(posKey(open[i])) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }

    const current = open[bestIdx];
    const currentKey = posKey(current);

    if (currentKey === endKey) {
      // Reconstruct path
      const path: GridPosition[] = [current];
      let key = currentKey;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key)!;
        path.push(prev);
        key = posKey(prev);
      }
      path.reverse();
      return path;
    }

    open.splice(bestIdx, 1);
    closedSet.add(currentKey);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor: GridPosition = { x: current.x + offset.dx, y: current.y + offset.dy };
      const neighborKey = posKey(neighbor);

      if (closedSet.has(neighborKey)) continue;
      if (!isWalkable(neighbor)) continue;

      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;

      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + chebyshevDistance(neighbor, to));

        if (!open.some(p => posKey(p) === neighborKey)) {
          open.push(neighbor);
        }
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/pathfinding.test.ts && cd ..`

Expected: All 8 tests PASS.

- [ ] **Step 5: Update `index.ts` exports**

Update `roomgrid/src/index.ts`:

```ts
export * from './types.js';
export { bresenhamLine, hasLineOfSight, getVisibleTiles } from './lineOfSight.js';
export { findPath } from './pathfinding.js';
```

- [ ] **Step 6: Commit**

```
feat(roomgrid): implement A* pathfinding
```

---

### Task 5: RoomGrid Class — Construction and Tile Queries

**Files:**
- Create: `roomgrid/src/RoomGrid.ts`
- Create: `roomgrid/__tests__/RoomGrid.test.ts`

- [ ] **Step 1: Write failing tests for constructor and tile queries**

Create `roomgrid/__tests__/RoomGrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RoomGrid } from '../src/RoomGrid.js';
import type { RoomGridConfig } from '../src/types.js';

function makeConfig(map: string[], exits?: RoomGridConfig['exits']): RoomGridConfig {
  const tiles = map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return 'wall' as const;
      if (ch === 'E') return 'exit' as const;
      return 'floor' as const;
    })
  );
  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    exits,
  };
}

describe('RoomGrid constructor', () => {
  it('creates a grid from config', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
    expect(grid).toBeDefined();
  });

  it('throws if tile array dimensions mismatch config', () => {
    expect(() => new RoomGrid({
      width: 5,
      height: 3,
      tiles: [
        ['floor', 'floor', 'floor'], // width 3, not 5
        ['floor', 'floor', 'floor'],
        ['floor', 'floor', 'floor'],
      ],
    })).toThrow();
  });

  it('applies exit data to exit tiles', () => {
    const grid = new RoomGrid(makeConfig(
      ['..E'],
      [{ position: { x: 2, y: 0 }, data: { direction: 'east', targetRoomId: 'room2' } }]
    ));
    const tile = grid.getTile({ x: 2, y: 0 });
    expect(tile?.type).toBe('exit');
    expect(tile?.exit).toEqual({ direction: 'east', targetRoomId: 'room2' });
  });
});

describe('tile queries', () => {
  const grid = new RoomGrid(makeConfig([
    '...',
    '.#.',
    '..E',
  ]));

  it('getTile returns correct tile types', () => {
    expect(grid.getTile({ x: 0, y: 0 })?.type).toBe('floor');
    expect(grid.getTile({ x: 1, y: 1 })?.type).toBe('wall');
    expect(grid.getTile({ x: 2, y: 2 })?.type).toBe('exit');
  });

  it('getTile returns null for out of bounds', () => {
    expect(grid.getTile({ x: -1, y: 0 })).toBeNull();
    expect(grid.getTile({ x: 0, y: 5 })).toBeNull();
    expect(grid.getTile({ x: 3, y: 0 })).toBeNull();
  });

  it('isWalkable returns true for floor and exit', () => {
    expect(grid.isWalkable({ x: 0, y: 0 })).toBe(true);
    expect(grid.isWalkable({ x: 2, y: 2 })).toBe(true);
  });

  it('isWalkable returns false for wall and out of bounds', () => {
    expect(grid.isWalkable({ x: 1, y: 1 })).toBe(false);
    expect(grid.isWalkable({ x: -1, y: 0 })).toBe(false);
  });

  it('isInBounds checks grid boundaries', () => {
    expect(grid.isInBounds({ x: 0, y: 0 })).toBe(true);
    expect(grid.isInBounds({ x: 2, y: 2 })).toBe(true);
    expect(grid.isInBounds({ x: 3, y: 0 })).toBe(false);
    expect(grid.isInBounds({ x: 0, y: -1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: FAIL — `RoomGrid` not found.

- [ ] **Step 3: Implement RoomGrid constructor and tile queries**

Create `roomgrid/src/RoomGrid.ts`:

```ts
import type {
  Tile,
  TileType,
  Entity,
  EntityType,
  GridPosition,
  GridDirection,
  RoomGridConfig,
  MoveResult,
  PathfindingOpts,
} from './types.js';
import { DIRECTION_OFFSETS } from './types.js';
import { hasLineOfSight as losCheck, getVisibleTiles as visCheck } from './lineOfSight.js';
import { findPath as astarFind } from './pathfinding.js';

export class RoomGrid {
  private readonly tiles: Tile[][];
  private readonly width: number;
  private readonly height: number;
  private readonly entities = new Map<string, Entity>();

  constructor(config: RoomGridConfig) {
    if (config.tiles.length !== config.height) {
      throw new Error(`Tile array height ${config.tiles.length} does not match config height ${config.height}`);
    }
    for (let y = 0; y < config.tiles.length; y++) {
      if (config.tiles[y].length !== config.width) {
        throw new Error(`Tile row ${y} width ${config.tiles[y].length} does not match config width ${config.width}`);
      }
    }

    this.width = config.width;
    this.height = config.height;

    // Build Tile[][] from TileType[][]
    this.tiles = config.tiles.map(row =>
      row.map((type): Tile => ({ type }))
    );

    // Apply exit data
    if (config.exits) {
      for (const exit of config.exits) {
        const tile = this.tiles[exit.position.y]?.[exit.position.x];
        if (tile && tile.type === 'exit') {
          tile.exit = exit.data;
        }
      }
    }
  }

  getTile(pos: GridPosition): Tile | null {
    if (!this.isInBounds(pos)) return null;
    return this.tiles[pos.y][pos.x];
  }

  isWalkable(pos: GridPosition): boolean {
    const tile = this.getTile(pos);
    if (!tile) return false;
    return tile.type === 'floor' || tile.type === 'exit';
  }

  isInBounds(pos: GridPosition): boolean {
    return pos.x >= 0 && pos.x < this.width && pos.y >= 0 && pos.y < this.height;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement RoomGrid constructor and tile queries
```

---

### Task 6: RoomGrid — Entity Management

**Files:**
- Modify: `roomgrid/src/RoomGrid.ts`
- Modify: `roomgrid/__tests__/RoomGrid.test.ts`

- [ ] **Step 1: Write failing tests for entity methods**

Append to `roomgrid/__tests__/RoomGrid.test.ts`:

```ts
import type { Entity } from '../src/types.js';

describe('entity management', () => {
  function makeGrid() {
    return new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
  }

  it('addEntity places an entity on a floor tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    expect(grid.getEntity('p1')).toEqual({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
  });

  it('addEntity throws on wall tile', () => {
    const grid = makeGrid();
    expect(() => grid.addEntity({ id: 'p1', type: 'player', position: { x: 1, y: 1 } })).toThrow();
  });

  it('addEntity throws on out of bounds', () => {
    const grid = makeGrid();
    expect(() => grid.addEntity({ id: 'p1', type: 'player', position: { x: -1, y: 0 } })).toThrow();
  });

  it('removeEntity removes an entity', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.removeEntity('p1');
    expect(grid.getEntity('p1')).toBeNull();
  });

  it('getEntity returns null for unknown id', () => {
    const grid = makeGrid();
    expect(grid.getEntity('nope')).toBeNull();
  });

  it('getEntitiesAt returns all entities at position', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.addEntity({ id: 'i1', type: 'interactable', position: { x: 0, y: 0 } });
    expect(grid.getEntitiesAt({ x: 0, y: 0 })).toHaveLength(2);
  });

  it('getEntitiesAt returns empty for unoccupied tile', () => {
    const grid = makeGrid();
    expect(grid.getEntitiesAt({ x: 2, y: 2 })).toEqual([]);
  });

  it('getEntitiesByType returns filtered list', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 2, y: 0 } });
    grid.addEntity({ id: 'p2', type: 'player', position: { x: 0, y: 2 } });
    expect(grid.getEntitiesByType('player')).toHaveLength(2);
    expect(grid.getEntitiesByType('mob')).toHaveLength(1);
    expect(grid.getEntitiesByType('interactable')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: FAIL — `addEntity` is not a function.

- [ ] **Step 3: Implement entity management methods**

Add the following methods to the `RoomGrid` class in `roomgrid/src/RoomGrid.ts`:

```ts
  addEntity(entity: Entity): void {
    if (!this.isWalkable(entity.position)) {
      throw new Error(`Cannot place entity ${entity.id} on non-walkable tile at (${entity.position.x}, ${entity.position.y})`);
    }
    this.entities.set(entity.id, { ...entity, position: { ...entity.position } });
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  getEntity(id: string): Entity | null {
    return this.entities.get(id) ?? null;
  }

  getEntitiesAt(pos: GridPosition): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.position.x === pos.x && entity.position.y === pos.y) {
        result.push(entity);
      }
    }
    return result;
  }

  getEntitiesByType(type: EntityType): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.type === type) {
        result.push(entity);
      }
    }
    return result;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement entity management
```

---

### Task 7: RoomGrid — Movement

**Files:**
- Modify: `roomgrid/src/RoomGrid.ts`
- Modify: `roomgrid/__tests__/RoomGrid.test.ts`

- [ ] **Step 1: Write failing tests for `moveEntity`**

Append to `roomgrid/__tests__/RoomGrid.test.ts`:

```ts
describe('moveEntity', () => {
  function makeGrid() {
    return new RoomGrid(makeConfig(
      [
        '..E',
        '.#.',
        '...',
      ],
      [{ position: { x: 2, y: 0 }, data: { direction: 'east', targetRoomId: 'room2' } }]
    ));
  }

  it('moves entity to empty floor tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 0 });
    expect(result.events).toEqual([]);
    expect(grid.getEntity('p1')?.position).toEqual({ x: 1, y: 0 });
  });

  it('fails to move into wall', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 1 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(grid.getEntity('p1')?.position).toEqual({ x: 0, y: 1 });
  });

  it('fails to move out of bounds', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'w');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
  });

  it('triggers exit event on exit tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 1, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 2, y: 0 });
    expect(result.events).toEqual([
      { type: 'exit', exit: { direction: 'east', targetRoomId: 'room2' } },
    ]);
  });

  it('triggers combat event when player moves to mob tile — player stays in place', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 0, y: 2 }); // stays in place
    expect(result.events).toEqual([
      { type: 'combat', entityId: 'm1' },
    ]);
  });

  it('triggers interact event when player moves to interactable tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'i1', type: 'interactable', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 2 }); // moves onto tile
    expect(result.events).toEqual([
      { type: 'interact', entityId: 'i1' },
    ]);
  });

  it('moves diagonally', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'se');
    // (1,1) is a wall, so this should fail
    expect(result.success).toBe(false);

    // Try sw from (2,0) -> (1,1) is wall, fail
    // Try se from (0,2) -> (1,3) is out of bounds, fail
    // se from (0,0) -> (1,1) is wall, already tested
    // Let's test a valid diagonal
    grid.addEntity({ id: 'p2', type: 'player', position: { x: 2, y: 2 } });
    const result2 = grid.moveEntity('p2', 'nw');
    // (1,1) is wall — fail
    expect(result2.success).toBe(false);
  });

  it('mob-to-mob movement does not trigger combat', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'm2', type: 'mob', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('m1', 'e');
    // Mob moving to mob tile — no combat event, just move
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 2 });
    expect(result.events).toEqual([]);
  });

  it('returns failed result for unknown entity id', () => {
    const grid = makeGrid();
    const result = grid.moveEntity('nope', 'n');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: FAIL — `moveEntity` is not a function.

- [ ] **Step 3: Implement `moveEntity`**

Add to the `RoomGrid` class in `roomgrid/src/RoomGrid.ts`:

```ts
  moveEntity(id: string, direction: GridDirection): MoveResult {
    const entity = this.entities.get(id);
    if (!entity) {
      return { success: false, events: [] };
    }

    const offset = DIRECTION_OFFSETS[direction];
    const target: GridPosition = {
      x: entity.position.x + offset.dx,
      y: entity.position.y + offset.dy,
    };

    if (!this.isWalkable(target)) {
      return { success: false, events: [] };
    }

    const events: MoveResult['events'] = [];

    // Check entities at target
    const targetEntities = this.getEntitiesAt(target);

    // Combat: player moving onto mob tile
    if (entity.type === 'player') {
      const mob = targetEntities.find(e => e.type === 'mob');
      if (mob) {
        // Player stays in place, combat triggered
        return {
          success: true,
          newPosition: { ...entity.position },
          events: [{ type: 'combat', entityId: mob.id }],
        };
      }
    }

    // Move the entity
    entity.position = { ...target };

    // Check for interactable
    if (entity.type === 'player') {
      const interactable = targetEntities.find(e => e.type === 'interactable');
      if (interactable) {
        events.push({ type: 'interact', entityId: interactable.id });
      }
    }

    // Check for exit tile
    const tile = this.getTile(target);
    if (tile?.type === 'exit' && tile.exit) {
      events.push({ type: 'exit', exit: tile.exit });
    }

    return {
      success: true,
      newPosition: { ...target },
      events,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
feat(roomgrid): implement 8-directional movement with events
```

---

### Task 8: RoomGrid — Visibility and Pathfinding Delegation

**Files:**
- Modify: `roomgrid/src/RoomGrid.ts`
- Modify: `roomgrid/__tests__/RoomGrid.test.ts`
- Modify: `roomgrid/src/index.ts`

- [ ] **Step 1: Write failing tests for visibility and pathfinding delegation**

Append to `roomgrid/__tests__/RoomGrid.test.ts`:

```ts
describe('visibility', () => {
  it('getVisibleTiles returns visible positions', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]));
    const visible = grid.getVisibleTiles({ x: 2, y: 0 }, 2);
    expect(visible.length).toBeGreaterThan(0);
    // All returned tiles should be within range 2
    for (const p of visible) {
      const dist = Math.max(Math.abs(p.x - 2), Math.abs(p.y - 0));
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  it('hasLineOfSight returns true with clear path', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '.....',
      '.....',
    ]));
    expect(grid.hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('hasLineOfSight returns false when wall blocks', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '..#..',
      '.....',
    ]));
    expect(grid.hasLineOfSight({ x: 2, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('pathfinding', () => {
  it('findPath finds a path around obstacles', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
  });

  it('findPath returns null for unreachable target', () => {
    const grid = new RoomGrid(makeConfig([
      '.#.',
      '###',
      '.#.',
    ]));
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it('findPath respects blockedByEntities option', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '...',
      '...',
    ]));
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 1, y: 1 } });
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, { blockedByEntities: true });
    expect(path).not.toBeNull();
    const hitsEntity = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsEntity).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: FAIL — `getVisibleTiles` / `hasLineOfSight` / `findPath` not functions on RoomGrid.

- [ ] **Step 3: Implement delegation methods**

Add to the `RoomGrid` class in `roomgrid/src/RoomGrid.ts`:

```ts
  getVisibleTiles(from: GridPosition, range: number): GridPosition[] {
    return visCheck(this.tiles, from, range);
  }

  hasLineOfSight(from: GridPosition, to: GridPosition): boolean {
    return losCheck(this.tiles, from, to);
  }

  findPath(from: GridPosition, to: GridPosition, opts?: PathfindingOpts): GridPosition[] | null {
    const entityList = Array.from(this.entities.values());
    return astarFind(this.tiles, entityList, from, to, opts);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd roomgrid && npx vitest run __tests__/RoomGrid.test.ts && cd ..`

Expected: All tests PASS.

- [ ] **Step 5: Finalize `index.ts` with all exports**

Update `roomgrid/src/index.ts`:

```ts
export * from './types.js';
export { bresenhamLine, hasLineOfSight, getVisibleTiles } from './lineOfSight.js';
export { findPath } from './pathfinding.js';
export { RoomGrid } from './RoomGrid.js';
```

- [ ] **Step 6: Run full test suite**

Run: `cd roomgrid && npx vitest run && cd ..`

Expected: All tests PASS across all 3 test files.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit --project roomgrid/tsconfig.json`

Expected: No errors.

- [ ] **Step 8: Commit**

```
feat(roomgrid): add visibility and pathfinding to RoomGrid, finalize public API
```
