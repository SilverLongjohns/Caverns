# Arena Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-based combat screen with a turn-based tactics RPG arena where players and mobs move on an ASCII grid.

**Architecture:** `ArenaCombatManager` wraps the existing `CombatManager`, adding grid state (positions, movement, pathfinding). The client gets a new `ArenaView` component tree. Arena grids are generated using the existing `roomgrid` system. New message types (`arena_combat_start`, `arena_move`, `arena_positions_update`, `arena_end_turn`) handle the spatial layer.

**Tech Stack:** TypeScript, Vitest, React/Zustand, `@caverns/roomgrid`, `ws`

---

### Task 1: Arena Grid Generation

Build the function that generates a sealed arena grid (no exits) for combat, reusing the existing `roomgrid` generation system.

**Files:**
- Create: `server/src/arenaGridBuilder.ts`
- Create: `server/src/arenaGridBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/arenaGridBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildArenaGrid } from './arenaGridBuilder.js';
import { TILE_PROPERTIES } from '@caverns/roomgrid';

describe('buildArenaGrid', () => {
  it('generates a grid with correct dimensions for a chamber', () => {
    const result = buildArenaGrid('chamber', 'starter');
    expect(result.width).toBe(30);
    expect(result.height).toBe(15);
    expect(result.tiles.length).toBe(15);
    expect(result.tiles[0].length).toBe(30);
  });

  it('generates a grid with correct dimensions for a tunnel', () => {
    const result = buildArenaGrid('tunnel', 'starter');
    expect(result.width).toBe(30);
    expect(result.height).toBe(8);
  });

  it('generates a grid with no exit tiles', () => {
    const result = buildArenaGrid('chamber', 'starter');
    for (const row of result.tiles) {
      for (const tile of row) {
        expect(tile).not.toBe('exit');
      }
    }
  });

  it('has walkable floor tiles inside the border', () => {
    const result = buildArenaGrid('chamber', 'starter');
    let floorCount = 0;
    for (let y = 1; y < result.height - 1; y++) {
      for (let x = 1; x < result.width - 1; x++) {
        const tile = result.tiles[y][x];
        if (TILE_PROPERTIES[tile as keyof typeof TILE_PROPERTIES]?.walkable) {
          floorCount++;
        }
      }
    }
    // At least 25% of interior should be walkable
    const interior = (result.width - 2) * (result.height - 2);
    expect(floorCount / interior).toBeGreaterThan(0.25);
  });

  it('applies biome theming when available', () => {
    const result = buildArenaGrid('chamber', 'fungal');
    // Fungal biome has themes defined, so themes array should exist
    expect(result.themes).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaGridBuilder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement buildArenaGrid**

```ts
// server/src/arenaGridBuilder.ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { TileGrid } from '@caverns/shared';
import { generateRoom } from '@caverns/roomgrid';
import type { BiomeGenerationConfig } from '@caverns/roomgrid';
import { ROOM_DIMENSIONS } from './tileGridBuilder.js';

const __filename_arena = fileURLToPath(import.meta.url);
const __dirname_arena = dirname(__filename_arena);

let biomeConfigs: BiomeGenerationConfig[];
try {
  const configPath = resolve(__dirname_arena, '../../roomgrid/src/data/biomeGeneration.json');
  biomeConfigs = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  throw new Error(`Failed to load biomeGeneration.json: ${(e as Error).message}`);
}

const DEFAULT_DIMENSIONS = ROOM_DIMENSIONS.chamber;

export function buildArenaGrid(roomType: string, biomeId: string): TileGrid {
  const dims = ROOM_DIMENSIONS[roomType] ?? DEFAULT_DIMENSIONS;
  const { width, height } = dims;

  let biomeConfig = biomeConfigs.find(b => b.biomeId === biomeId);
  if (!biomeConfig) {
    biomeConfig = biomeConfigs.find(b => b.biomeId === 'starter')!;
  }

  // No exits — arena is sealed
  const config = generateRoom({
    width,
    height,
    exits: [],
    biomeConfig,
    roomType,
  });

  // Replace any exit tiles with floor (safety net)
  const tiles = config.tiles.map(row =>
    row.map(tile => tile === 'exit' ? 'floor' : tile)
  );

  // Apply biome themes
  const tileThemes = biomeConfig.tileThemes;
  const hasThemes = Object.keys(tileThemes).length > 0;
  let themes: (string | null)[][] | undefined;

  if (hasThemes) {
    themes = tiles.map(row =>
      row.map(tileType => (tileThemes as Record<string, string>)[tileType] ?? null)
    );
  }

  return { width, height, tiles, themes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaGridBuilder.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/arenaGridBuilder.ts server/src/arenaGridBuilder.test.ts
git commit -m "feat: add arena grid builder for combat arenas"
```

---

### Task 2: Starting Position Placement

Add a function that places combatants on walkable tiles — players on the left side, mobs on the right side.

**Files:**
- Modify: `server/src/arenaGridBuilder.ts`
- Modify: `server/src/arenaGridBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/src/arenaGridBuilder.test.ts`:

```ts
import { buildArenaGrid, placeStartingPositions } from './arenaGridBuilder.js';

describe('placeStartingPositions', () => {
  it('places players in the left 3 columns and mobs in the right 3 columns', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const playerIds = ['p1', 'p2'];
    const mobIds = ['m1', 'm2'];
    const positions = placeStartingPositions(grid, playerIds, mobIds);

    for (const pid of playerIds) {
      expect(positions[pid]).toBeDefined();
      expect(positions[pid].x).toBeLessThanOrEqual(3);
      expect(positions[pid].x).toBeGreaterThanOrEqual(1);
    }
    for (const mid of mobIds) {
      expect(positions[mid]).toBeDefined();
      expect(positions[mid].x).toBeGreaterThanOrEqual(grid.width - 4);
      expect(positions[mid].x).toBeLessThanOrEqual(grid.width - 2);
    }
  });

  it('no two combatants share a position', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const playerIds = ['p1', 'p2', 'p3', 'p4'];
    const mobIds = ['m1', 'm2', 'm3'];
    const positions = placeStartingPositions(grid, playerIds, mobIds);

    const posSet = new Set<string>();
    for (const pos of Object.values(positions)) {
      const key = `${pos.x},${pos.y}`;
      expect(posSet.has(key)).toBe(false);
      posSet.add(key);
    }
  });

  it('all positions are on walkable tiles', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const positions = placeStartingPositions(grid, ['p1'], ['m1']);

    for (const pos of Object.values(positions)) {
      const tile = grid.tiles[pos.y][pos.x];
      const props = TILE_PROPERTIES[tile as keyof typeof TILE_PROPERTIES];
      expect(props?.walkable).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaGridBuilder.test.ts`
Expected: FAIL — `placeStartingPositions` not exported

- [ ] **Step 3: Implement placeStartingPositions**

Add to `server/src/arenaGridBuilder.ts`:

```ts
import { TILE_PROPERTIES } from '@caverns/roomgrid';
import type { TileType } from '@caverns/roomgrid';

export function placeStartingPositions(
  grid: TileGrid,
  playerIds: string[],
  mobIds: string[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const occupied = new Set<string>();

  function findWalkable(minX: number, maxX: number, ids: string[]): void {
    const candidates: { x: number; y: number }[] = [];
    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = grid.tiles[y][x] as TileType;
        if (TILE_PROPERTIES[tile]?.walkable && tile !== 'hazard') {
          candidates.push({ x, y });
        }
      }
    }
    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const id of ids) {
      const pos = candidates.find(c => !occupied.has(`${c.x},${c.y}`));
      if (pos) {
        positions[id] = pos;
        occupied.add(`${pos.x},${pos.y}`);
      }
    }
  }

  // Players: columns 1-3 (skip border wall at 0)
  findWalkable(1, 3, playerIds);
  // Mobs: last 3 interior columns
  findWalkable(grid.width - 4, grid.width - 2, mobIds);

  return positions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaGridBuilder.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/arenaGridBuilder.ts server/src/arenaGridBuilder.test.ts
git commit -m "feat: add starting position placement for arena combatants"
```

---

### Task 3: Arena Movement & Pathfinding

Build the core spatial logic: BFS movement range calculation, path validation, and movement cost handling.

**Files:**
- Create: `server/src/arenaMovement.ts`
- Create: `server/src/arenaMovement.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/arenaMovement.test.ts
import { describe, it, expect } from 'vitest';
import { getMovementRange, findPath, getMovementCost } from './arenaMovement.js';
import type { TileGrid } from '@caverns/shared';

function makeGrid(tiles: string[][]): TileGrid {
  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
  };
}

// Simple 5x5 open grid with walls on border
const openGrid = makeGrid([
  ['wall','wall','wall','wall','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','wall','wall','wall','wall'],
]);

describe('getMovementCost', () => {
  it('returns 1 for floor tiles', () => {
    expect(getMovementCost('floor')).toBe(1);
  });

  it('returns 2 for water tiles', () => {
    expect(getMovementCost('water')).toBe(2);
  });

  it('returns 1 for bridge tiles', () => {
    expect(getMovementCost('bridge')).toBe(1);
  });

  it('returns 1 for hazard tiles', () => {
    expect(getMovementCost('hazard')).toBe(1);
  });

  it('returns Infinity for wall tiles', () => {
    expect(getMovementCost('wall')).toBe(Infinity);
  });

  it('returns Infinity for chasm tiles', () => {
    expect(getMovementCost('chasm')).toBe(Infinity);
  });
});

describe('getMovementRange', () => {
  it('returns reachable tiles within movement points', () => {
    const occupied = new Set<string>();
    const range = getMovementRange(openGrid, { x: 2, y: 2 }, 2, occupied);
    // Center (2,2) + all 8 interior floor tiles should be reachable with 2 MP
    // (only 4-directional, so corners cost 2 MP)
    expect(range.has('2,2')).toBe(true);  // self
    expect(range.has('2,1')).toBe(true);  // north
    expect(range.has('2,3')).toBe(true);  // south
    expect(range.has('1,2')).toBe(true);  // west
    expect(range.has('3,2')).toBe(true);  // east
    expect(range.has('1,1')).toBe(true);  // NW (2 steps)
    expect(range.has('3,3')).toBe(true);  // SE (2 steps)
  });

  it('does not include wall tiles', () => {
    const occupied = new Set<string>();
    const range = getMovementRange(openGrid, { x: 1, y: 1 }, 3, occupied);
    expect(range.has('0,0')).toBe(false);
    expect(range.has('0,1')).toBe(false);
  });

  it('does not include tiles occupied by other units', () => {
    const occupied = new Set<string>(['2,2']);
    const range = getMovementRange(openGrid, { x: 1, y: 2 }, 3, occupied);
    expect(range.has('2,2')).toBe(false);
    // But can still reach tiles beyond if path exists
    expect(range.has('3,2')).toBe(true); // go around via row 1 or 3
  });

  it('water costs 2 movement points', () => {
    const waterGrid = makeGrid([
      ['wall','wall','wall','wall','wall'],
      ['wall','floor','water','floor','wall'],
      ['wall','floor','floor','floor','wall'],
      ['wall','wall','wall','wall','wall'],
    ]);
    const occupied = new Set<string>();
    // From (1,1) with 2 MP: can go south (1 MP) then east (1 MP) = (2,2)
    // But going east through water costs 2 MP, leaving 0 — can't go further
    const range = getMovementRange(waterGrid, { x: 1, y: 1 }, 2, occupied);
    expect(range.has('2,1')).toBe(true);  // water tile itself (costs 2)
    expect(range.has('3,1')).toBe(false); // can't afford floor after water
  });
});

describe('findPath', () => {
  it('returns a valid path between two reachable points', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 3, y: 3 }, 4, occupied);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 3 });
  });

  it('returns null when target is out of movement range', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 3, y: 3 }, 2, occupied);
    // Manhattan distance is 4, so 2 MP is not enough
    expect(path).toBeNull();
  });

  it('returns null when target is a wall', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 0, y: 0 }, 5, occupied);
    expect(path).toBeNull();
  });

  it('paths around occupied tiles', () => {
    const occupied = new Set<string>(['2,1', '2,2', '2,3']);
    // Wall of occupied units down the middle column
    const path = findPath(openGrid, { x: 1, y: 2 }, { x: 3, y: 2 }, 10, occupied);
    // Should be null — all paths through column 2 are blocked and
    // there's no way around in a 3x3 interior
    expect(path).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaMovement.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement arena movement**

```ts
// server/src/arenaMovement.ts
import type { TileGrid } from '@caverns/shared';
import { TILE_PROPERTIES } from '@caverns/roomgrid';
import type { TileType } from '@caverns/roomgrid';

const CARDINAL_DIRS = [
  { dx: 0, dy: -1 }, // north
  { dx: 0, dy: 1 },  // south
  { dx: -1, dy: 0 }, // west
  { dx: 1, dy: 0 },  // east
];

export function getMovementCost(tileType: string): number {
  const props = TILE_PROPERTIES[tileType as TileType];
  if (!props || !props.walkable) return Infinity;
  if (tileType === 'water') return 2;
  return 1;
}

/**
 * BFS flood fill to find all tiles reachable within the given movement points.
 * Returns a Map from "x,y" string to the remaining movement points at that tile.
 */
export function getMovementRange(
  grid: TileGrid,
  start: { x: number; y: number },
  movementPoints: number,
  occupied: Set<string>,
): Map<string, number> {
  const reachable = new Map<string, number>();
  const startKey = `${start.x},${start.y}`;
  reachable.set(startKey, movementPoints);

  const queue: { x: number; y: number; mp: number }[] = [
    { x: start.x, y: start.y, mp: movementPoints },
  ];

  while (queue.length > 0) {
    const { x, y, mp } = queue.shift()!;

    for (const dir of CARDINAL_DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

      const tileType = grid.tiles[ny][nx];
      const cost = getMovementCost(tileType);
      if (cost === Infinity) continue;

      const remaining = mp - cost;
      if (remaining < 0) continue;

      const key = `${nx},${ny}`;
      if (occupied.has(key)) continue;

      const existing = reachable.get(key);
      if (existing !== undefined && existing >= remaining) continue;

      reachable.set(key, remaining);
      queue.push({ x: nx, y: ny, mp: remaining });
    }
  }

  return reachable;
}

/**
 * BFS pathfinding from start to target within movement points.
 * Returns the path (excluding start, including target) or null if unreachable.
 */
export function findPath(
  grid: TileGrid,
  start: { x: number; y: number },
  target: { x: number; y: number },
  movementPoints: number,
  occupied: Set<string>,
): { x: number; y: number }[] | null {
  const targetKey = `${target.x},${target.y}`;

  // Target must be walkable
  const targetTile = grid.tiles[target.y]?.[target.x];
  if (!targetTile || getMovementCost(targetTile) === Infinity) return null;

  // Target can't be occupied
  if (occupied.has(targetKey)) return null;

  const best = new Map<string, number>(); // key -> best remaining MP
  const parent = new Map<string, string>(); // key -> parent key
  const startKey = `${start.x},${start.y}`;
  best.set(startKey, movementPoints);

  const queue: { x: number; y: number; mp: number }[] = [
    { x: start.x, y: start.y, mp: movementPoints },
  ];

  while (queue.length > 0) {
    const { x, y, mp } = queue.shift()!;
    const currentKey = `${x},${y}`;

    if (currentKey === targetKey) continue; // found it, but keep exploring for better paths

    for (const dir of CARDINAL_DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

      const tileType = grid.tiles[ny][nx];
      const cost = getMovementCost(tileType);
      if (cost === Infinity) continue;

      const remaining = mp - cost;
      if (remaining < 0) continue;

      const key = `${nx},${ny}`;
      if (occupied.has(key) && key !== targetKey) continue;
      // Allow pathfinding TO target even though target can't be "occupied" — 
      // this is for the final step. But target was already checked above.
      if (occupied.has(key)) continue;

      const existing = best.get(key);
      if (existing !== undefined && existing >= remaining) continue;

      best.set(key, remaining);
      parent.set(key, currentKey);
      queue.push({ x: nx, y: ny, mp: remaining });
    }
  }

  if (!best.has(targetKey)) return null;

  // Reconstruct path
  const path: { x: number; y: number }[] = [];
  let current = targetKey;
  while (current !== startKey) {
    const [px, py] = current.split(',').map(Number);
    path.unshift({ x: px, y: py });
    const p = parent.get(current);
    if (!p) return null;
    current = p;
  }

  return path;
}

/**
 * Calculate total movement cost for a path.
 */
export function pathCost(grid: TileGrid, path: { x: number; y: number }[]): number {
  let total = 0;
  for (const step of path) {
    total += getMovementCost(grid.tiles[step.y][step.x]);
  }
  return total;
}

/**
 * Check if two positions are orthogonally adjacent (4-directional).
 */
export function isAdjacent(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx + dy) === 1;
}

/**
 * Check if a position is on the arena edge (adjacent to a border wall).
 */
export function isEdgeTile(grid: TileGrid, pos: { x: number; y: number }): boolean {
  for (const dir of CARDINAL_DIRS) {
    const nx = pos.x + dir.dx;
    const ny = pos.y + dir.dy;
    if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) return true;
    if (nx === 0 || nx === grid.width - 1 || ny === 0 || ny === grid.height - 1) {
      const tile = grid.tiles[ny][nx];
      if (tile === 'wall') return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/arenaMovement.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/arenaMovement.ts server/src/arenaMovement.test.ts
git commit -m "feat: add arena movement, pathfinding, and adjacency checks"
```

---

### Task 4: ArenaCombatManager

Build the server-side manager that wraps `CombatManager` with spatial state. Handles positions, movement validation, attack adjacency, mob AI turns, and turn flow.

**Files:**
- Create: `server/src/ArenaCombatManager.ts`
- Create: `server/src/ArenaCombatManager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/ArenaCombatManager.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaCombatManager } from './ArenaCombatManager.js';
import type { TileGrid } from '@caverns/shared';
import type { MobInstance } from '@caverns/shared';
import type { CombatPlayerInfo } from './CombatManager.js';

function makeGrid(): TileGrid {
  // 8x6 open arena — walls on border, floor inside
  const tiles: string[][] = [];
  for (let y = 0; y < 6; y++) {
    const row: string[] = [];
    for (let x = 0; x < 8; x++) {
      row.push(y === 0 || y === 5 || x === 0 || x === 7 ? 'wall' : 'floor');
    }
    tiles.push(row);
  }
  return { width: 8, height: 6, tiles };
}

function makePlayer(id: string = 'p1'): CombatPlayerInfo {
  return { id, name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 6 };
}

function makeMob(id: string = 'mob1'): MobInstance {
  return {
    instanceId: id, templateId: 'goblin', name: 'Goblin',
    maxHp: 20, hp: 20, damage: 8, defense: 2, initiative: 4,
  };
}

describe('ArenaCombatManager', () => {
  it('initializes with grid and positions', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    expect(arena.getPosition('p1')).toEqual({ x: 1, y: 2 });
    expect(arena.getPosition('mob1')).toEqual({ x: 6, y: 2 });
  });

  it('calculates movement points from initiative', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    // initiative 6 -> floor(6/2) + 2 = 5
    expect(arena.getMovementPoints('p1')).toBe(5);
    // initiative 4 -> floor(4/2) + 2 = 4
    expect(arena.getMovementPoints('mob1')).toBe(4);
  });

  it('validates and executes a move', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 3, y: 2 });
    expect(result.success).toBe(true);
    expect(arena.getPosition('p1')).toEqual({ x: 3, y: 2 });
    expect(result.movementRemaining).toBe(3); // 5 - 2 tiles
  });

  it('rejects move to impassable tile', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 0, y: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects move when not enough movement points', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 4 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    // Move all the way across (5 tiles right) — initiative 6 = 5 MP
    arena.handleMove('p1', { x: 6, y: 1 });
    // Now try to move further — should have 0 MP left
    const result = arena.handleMove('p1', { x: 6, y: 2 });
    expect(result.success).toBe(false);
  });

  it('validates attack requires adjacency', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    const result = arena.validateAttack('p1', 'mob1');
    expect(result).toBe(false); // not adjacent
  });

  it('allows attack when adjacent', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 5, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    const result = arena.validateAttack('p1', 'mob1');
    expect(result).toBe(true);
  });

  it('supports move-act-move pattern', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    // Move 2 tiles
    arena.handleMove('p1', { x: 3, y: 2 });
    expect(arena.getTurnState('p1')?.movementRemaining).toBe(3);
    // Mark action taken (attack would go here via CombatManager)
    arena.markActionTaken('p1');
    expect(arena.getTurnState('p1')?.actionTaken).toBe(true);
    // Move again with remaining MP
    const result = arena.handleMove('p1', { x: 4, y: 2 });
    expect(result.success).toBe(true);
    expect(result.movementRemaining).toBe(2);
  });

  it('resolves mob AI: pathfinds and attacks if adjacent', () => {
    const grid = makeGrid();
    // Place mob right next to player
    const positions = { p1: { x: 2, y: 2 }, mob1: { x: 3, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('mob1');
    const mobResult = arena.resolveMobTurn('mob1');
    expect(mobResult).not.toBeNull();
    expect(mobResult!.action).toBe('attack');
  });

  it('mob moves toward player when not adjacent', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('mob1');
    const mobResult = arena.resolveMobTurn('mob1');
    // Mob has initiative 4 -> 4 MP, distance is 5, can't reach
    expect(mobResult).toBeNull(); // no attack, just moved
    // Mob should have moved closer
    const mobPos = arena.getPosition('mob1');
    expect(mobPos!.x).toBeLessThan(6);
  });

  it('exposes all positions for broadcasting', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    const allPos = arena.getAllPositions();
    expect(allPos).toEqual(positions);
  });

  it('identifies edge tiles for fleeing', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    expect(arena.canFlee('p1')).toBe(true); // (1,1) is adjacent to border wall
  });

  it('cannot flee from interior tile', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 3, y: 3 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    expect(arena.canFlee('p1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/ArenaCombatManager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ArenaCombatManager**

```ts
// server/src/ArenaCombatManager.ts
import type { TileGrid, MobInstance, CombatState, CombatActionResultMessage } from '@caverns/shared';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import type { EquippedEffect } from '@caverns/shared';
import {
  getMovementRange,
  findPath,
  pathCost,
  isAdjacent,
  isEdgeTile,
  getMovementCost,
} from './arenaMovement.js';

interface TurnState {
  movementRemaining: number;
  actionTaken: boolean;
}

export class ArenaCombatManager {
  private grid: TileGrid;
  private positions: Map<string, { x: number; y: number }>;
  private combatManager: CombatManager;
  private turnStates: Map<string, TurnState> = new Map();

  constructor(
    roomId: string,
    grid: TileGrid,
    players: CombatPlayerInfo[],
    mobs: MobInstance[],
    initialPositions: Record<string, { x: number; y: number }>,
    playerEffects?: Map<string, EquippedEffect[]>,
    usedDungeonEffects?: Map<string, string[]>,
  ) {
    this.grid = grid;
    this.positions = new Map(Object.entries(initialPositions));
    this.combatManager = new CombatManager(roomId, players, mobs, playerEffects, usedDungeonEffects);
  }

  getCombatManager(): CombatManager {
    return this.combatManager;
  }

  getGrid(): TileGrid {
    return this.grid;
  }

  getPosition(id: string): { x: number; y: number } | undefined {
    return this.positions.get(id);
  }

  getAllPositions(): Record<string, { x: number; y: number }> {
    return Object.fromEntries(this.positions);
  }

  getMovementPoints(id: string): number {
    const participant = this.combatManager.getParticipant(id);
    if (!participant) return 0;
    return Math.floor(participant.initiative / 2) + 2;
  }

  startTurn(id: string): void {
    this.turnStates.set(id, {
      movementRemaining: this.getMovementPoints(id),
      actionTaken: false,
    });
  }

  getTurnState(id: string): TurnState | undefined {
    return this.turnStates.get(id);
  }

  markActionTaken(id: string): void {
    const state = this.turnStates.get(id);
    if (state) state.actionTaken = true;
  }

  private getOccupied(excludeId?: string): Set<string> {
    const occupied = new Set<string>();
    for (const [id, pos] of this.positions) {
      if (id === excludeId) continue;
      const participant = this.combatManager.getParticipant(id);
      if (participant?.alive) {
        occupied.add(`${pos.x},${pos.y}`);
      }
    }
    return occupied;
  }

  handleMove(
    id: string,
    target: { x: number; y: number },
  ): { success: boolean; movementRemaining: number; path?: { x: number; y: number }[] } {
    const turnState = this.turnStates.get(id);
    if (!turnState || turnState.movementRemaining <= 0) {
      return { success: false, movementRemaining: turnState?.movementRemaining ?? 0 };
    }

    const currentPos = this.positions.get(id);
    if (!currentPos) return { success: false, movementRemaining: 0 };

    const occupied = this.getOccupied(id);
    const path = findPath(this.grid, currentPos, target, turnState.movementRemaining, occupied);
    if (!path) {
      return { success: false, movementRemaining: turnState.movementRemaining };
    }

    const cost = pathCost(this.grid, path);
    turnState.movementRemaining -= cost;
    this.positions.set(id, target);

    return { success: true, movementRemaining: turnState.movementRemaining, path };
  }

  validateAttack(attackerId: string, targetId: string): boolean {
    const attackerPos = this.positions.get(attackerId);
    const targetPos = this.positions.get(targetId);
    if (!attackerPos || !targetPos) return false;
    return isAdjacent(attackerPos, targetPos);
  }

  canFlee(id: string): boolean {
    const pos = this.positions.get(id);
    if (!pos) return false;
    return isEdgeTile(this.grid, pos);
  }

  removeFromArena(id: string): void {
    this.positions.delete(id);
  }

  /**
   * Resolve a mob's turn: pathfind toward nearest player, move, attack if adjacent.
   * Returns the combat action result if an attack happened, or null if the mob only moved.
   */
  resolveMobTurn(mobId: string): Partial<CombatActionResultMessage> | null {
    const mobPos = this.positions.get(mobId);
    if (!mobPos) return null;

    const participant = this.combatManager.getParticipant(mobId);
    if (!participant || !participant.alive || participant.type !== 'mob') return null;

    this.startTurn(mobId);
    const turnState = this.turnStates.get(mobId)!;

    // Find nearest alive player by pathfinding distance
    const alivePlayers = this.combatManager.getAlivePlayers();
    let bestTarget: string | null = null;
    let bestPath: { x: number; y: number }[] | null = null;
    let bestDistance = Infinity;

    const occupied = this.getOccupied(mobId);

    for (const playerId of alivePlayers) {
      const playerPos = this.positions.get(playerId);
      if (!playerPos) continue;

      // Check if already adjacent
      if (isAdjacent(mobPos, playerPos)) {
        bestTarget = playerId;
        bestPath = [];
        bestDistance = 0;
        break;
      }

      // Find path to an adjacent tile of the player
      const adjacentTiles = [
        { x: playerPos.x - 1, y: playerPos.y },
        { x: playerPos.x + 1, y: playerPos.y },
        { x: playerPos.x, y: playerPos.y - 1 },
        { x: playerPos.x, y: playerPos.y + 1 },
      ].filter(t =>
        t.x >= 0 && t.x < this.grid.width &&
        t.y >= 0 && t.y < this.grid.height &&
        getMovementCost(this.grid.tiles[t.y][t.x]) !== Infinity &&
        !occupied.has(`${t.x},${t.y}`)
      );

      for (const adjTile of adjacentTiles) {
        const path = findPath(this.grid, mobPos, adjTile, 999, occupied);
        if (path && path.length < bestDistance) {
          bestTarget = playerId;
          bestPath = path;
          bestDistance = path.length;
        }
      }
    }

    if (!bestTarget) return null;

    // Move along path as far as movement allows
    if (bestPath && bestPath.length > 0) {
      let moved = 0;
      for (const step of bestPath) {
        const cost = getMovementCost(this.grid.tiles[step.y][step.x]);
        if (turnState.movementRemaining < cost) break;
        turnState.movementRemaining -= cost;
        this.positions.set(mobId, step);
        moved++;
      }
    }

    // Attack if now adjacent
    const finalMobPos = this.positions.get(mobId)!;
    const targetPos = this.positions.get(bestTarget);
    if (targetPos && isAdjacent(finalMobPos, targetPos)) {
      const result = this.combatManager.resolveMobTurn(mobId);
      return result;
    }

    return null; // moved but couldn't reach
  }

  // Delegate to CombatManager
  getCombatState(): CombatState { return this.combatManager.getState(); }
  getCurrentTurnId(): string { return this.combatManager.getCurrentTurnId(); }
  advanceTurn(): void { this.combatManager.advanceTurn(); }
  isComplete(): boolean { return this.combatManager.isComplete(); }
  getResult(): 'victory' | 'flee' | 'wipe' | 'ongoing' { return this.combatManager.getResult(); }
  isPlayerTurn(id: string): boolean { return this.combatManager.isPlayerTurn(id); }
  isMobTurn(id: string): boolean { return this.combatManager.isMobTurn(id); }
  getDeadMobIds(): string[] { return this.combatManager.getDeadMobIds(); }
  getAlivePlayers(): string[] { return this.combatManager.getAlivePlayers(); }
  getPlayerHp(id: string): number { return this.combatManager.getPlayerHp(id); }
  getEffectResolver() { return this.combatManager.getEffectResolver(); }
  getConsumedEffects() { return this.combatManager.getConsumedEffects(); }
  cancelAfkTimer(): void { this.combatManager.cancelAfkTimer(); }
  armAfkTimer(playerId: string, isAfk: () => boolean, onSkip: () => void, delayMs?: number): void {
    this.combatManager.armAfkTimer(playerId, isAfk, onSkip, delayMs);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/ArenaCombatManager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ArenaCombatManager.ts server/src/ArenaCombatManager.test.ts
git commit -m "feat: add ArenaCombatManager wrapping CombatManager with spatial state"
```

---

### Task 5: Message Protocol

Add the new arena message types to the shared protocol.

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add new client message types**

Add after the `DefendResultMessage` interface in `shared/src/messages.ts`:

```ts
export interface ArenaMoveMessage {
  type: 'arena_move';
  targetX: number;
  targetY: number;
}

export interface ArenaEndTurnMessage {
  type: 'arena_end_turn';
}
```

Add to the `ClientMessage` union:

```ts
  | ArenaMoveMessage
  | ArenaEndTurnMessage
```

- [ ] **Step 2: Add new server message types**

Add after the `CombatStartMessage` interface:

```ts
export interface ArenaCombatStartMessage {
  type: 'arena_combat_start';
  tileGrid: import('./types.js').TileGrid;
  positions: Record<string, { x: number; y: number }>;
  combat: CombatState;
}

export interface ArenaPositionsUpdateMessage {
  type: 'arena_positions_update';
  positions: Record<string, { x: number; y: number }>;
  movementRemaining: number;
  path?: { x: number; y: number }[];
  moverId: string;
}
```

Add to the `ServerMessage` union:

```ts
  | ArenaCombatStartMessage
  | ArenaPositionsUpdateMessage
```

- [ ] **Step 3: Verify the shared package compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p shared/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add shared/src/messages.ts
git commit -m "feat: add arena combat message types to shared protocol"
```

---

### Task 6: GameSession Integration

Wire `ArenaCombatManager` into `GameSession` — replace `CombatManager` creation with arena-based combat, handle new message types.

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/index.ts` (message routing)

- [ ] **Step 1: Import ArenaCombatManager and arena grid builder in GameSession**

At the top of `server/src/GameSession.ts`, add:

```ts
import { ArenaCombatManager } from './ArenaCombatManager.js';
import { buildArenaGrid, placeStartingPositions } from './arenaGridBuilder.js';
```

- [ ] **Step 2: Change the combats map type**

In `GameSession`, change the `combats` field from:

```ts
private combats = new Map<string, CombatManager>();
```

to:

```ts
private combats = new Map<string, ArenaCombatManager>();
```

- [ ] **Step 3: Modify startCombat to generate an arena**

Replace the `CombatManager` creation in `startCombat()`. After building `combatPlayers`, `playerEffects`, and `usedDungeonEffects` (which stay the same), replace from the `new CombatManager(...)` line through the `combat_start` broadcast:

```ts
    // Generate arena grid
    const biomeId = this.content.biomeId;
    const room = this.rooms.get(roomId)!;
    const arenaGrid = buildArenaGrid(room.type, biomeId);
    const playerIds = combatPlayers.map(p => p.id);
    const mobInstanceIds = mobInstances.map(m => m.instanceId);
    const positions = placeStartingPositions(arenaGrid, playerIds, mobInstanceIds);

    const combat = new ArenaCombatManager(
      roomId, arenaGrid, combatPlayers, mobInstances, positions,
      playerEffects, usedDungeonEffects,
    );
    this.combats.set(roomId, combat);

    // ... (encounter text stays the same) ...

    this.broadcastToRoom(roomId, {
      type: 'arena_combat_start',
      tileGrid: arenaGrid,
      positions,
      combat: combat.getCombatState(),
    } as any);
```

- [ ] **Step 4: Add handleArenaMove method**

Add to `GameSession`:

```ts
  handleArenaMove(playerId: string, targetX: number, targetY: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;

    const result = combat.handleMove(playerId, { x: targetX, y: targetY });
    if (result.success) {
      this.broadcastToRoom(player.roomId, {
        type: 'arena_positions_update',
        positions: combat.getAllPositions(),
        movementRemaining: result.movementRemaining,
        path: result.path,
        moverId: playerId,
      } as any);
    } else {
      this.sendTo(playerId, { type: 'error', message: 'Cannot move there.' });
    }
  }

  handleArenaEndTurn(playerId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;
    combat.cancelAfkTimer();
    this.afterCombatTurn(player.roomId, combat);
  }
```

- [ ] **Step 5: Modify handleCombatAction to validate adjacency for attacks**

In `handleCombatAction`, before the `resolvePlayerAction` call, add adjacency validation for attacks:

```ts
    // Validate adjacency for attack
    if (action === 'attack' && targetId) {
      if (!combat.validateAttack(playerId, targetId)) {
        this.sendTo(playerId, { type: 'error', message: 'Target is not adjacent.' });
        return;
      }
    }
    // Validate flee requires edge tile
    if (action === 'flee') {
      if (!combat.canFlee(playerId)) {
        this.sendTo(playerId, { type: 'error', message: 'Must be on an edge tile to flee.' });
        return;
      }
    }
```

After a successful attack, mark the action taken:

```ts
    combat.markActionTaken(playerId);
```

- [ ] **Step 6: Modify processMobTurn for arena AI**

Replace the mob turn resolution in `processMobTurn` to use the arena's `resolveMobTurn`. The arena manager handles pathfinding and movement internally. After the mob's turn resolves, broadcast position updates:

```ts
    // Broadcast mob position after movement
    this.broadcastToRoom(roomId, {
      type: 'arena_positions_update',
      positions: combat.getAllPositions(),
      movementRemaining: 0,
      moverId: mobId,
    } as any);
```

- [ ] **Step 7: Modify afterCombatTurn to start turns properly**

In `afterCombatTurn`, after `combat.advanceTurn()`, add:

```ts
    combat.startTurn(combat.getCurrentTurnId());
```

- [ ] **Step 8: Route new messages in index.ts**

In `server/src/index.ts`, in the message routing switch, add:

```ts
        case 'arena_move':
          session.handleArenaMove(connectionId, msg.targetX, msg.targetY);
          break;
        case 'arena_end_turn':
          session.handleArenaEndTurn(connectionId);
          break;
```

- [ ] **Step 9: Handle joinExistingCombat for arena**

Update `joinExistingCombat` to place the joining player on the arena grid and send `arena_combat_start`:

```ts
    // Find a walkable position near the left side for the joining player
    const grid = combat.getGrid();
    const occupied = new Set<string>();
    for (const pos of Object.values(combat.getAllPositions())) {
      occupied.add(`${pos.x},${pos.y}`);
    }
    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = 1; x <= 3; x++) {
        const key = `${x},${y}`;
        if (!occupied.has(key) && grid.tiles[y][x] === 'floor') {
          // Found a spot — place player here
          // (set position via combat manager method)
          break;
        }
      }
    }
```

- [ ] **Step 10: Verify server compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p server/tsconfig.json`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add server/src/GameSession.ts server/src/index.ts
git commit -m "feat: wire ArenaCombatManager into GameSession and message routing"
```

---

### Task 7: Client Store — Arena State

Add arena state to the Zustand store and handle the new server messages.

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add arena state to the store interface**

In the `GameStore` interface in `client/src/store/gameStore.ts`, add after `dyingMobIds`:

```ts
  arenaGrid: import('@caverns/shared').TileGrid | null;
  arenaPositions: Record<string, { x: number; y: number }>;
  arenaMovementRemaining: number;
  arenaActionTaken: boolean;
  arenaMovePath: { moverId: string; path: { x: number; y: number }[] } | null;
```

- [ ] **Step 2: Add to initialState**

In the `initialState` object, add:

```ts
  arenaGrid: null,
  arenaPositions: {},
  arenaMovementRemaining: 0,
  arenaActionTaken: false,
  arenaMovePath: null,
```

- [ ] **Step 3: Add imports for new message types**

Add `ArenaCombatStartMessage` and `ArenaPositionsUpdateMessage` to the ServerMessage imports (these come through the existing `ServerMessage` union — no extra import needed since the store already imports `ServerMessage`).

- [ ] **Step 4: Add message handlers in handleServerMessage**

In the `handleServerMessage` switch, add after the `combat_start` case:

```ts
      case 'arena_combat_start':
        set({
          activeCombat: msg.combat,
          currentTurnId: msg.combat.currentTurnId,
          arenaGrid: msg.tileGrid,
          arenaPositions: msg.positions,
          arenaMovementRemaining: 0,
          arenaActionTaken: false,
          arenaMovePath: null,
        });
        break;

      case 'arena_positions_update':
        set({
          arenaPositions: msg.positions,
          arenaMovementRemaining: msg.movementRemaining,
          arenaMovePath: msg.path ? { moverId: msg.moverId, path: msg.path } : null,
        });
        break;
```

- [ ] **Step 5: Clear arena state on combat_end**

Modify the `combat_end` handler to also clear arena state:

```ts
      case 'combat_end':
        set({
          activeCombat: null, currentTurnId: null,
          pendingDefendQte: null, dyingMobIds: new Set(),
          arenaGrid: null, arenaPositions: {},
          arenaMovementRemaining: 0, arenaActionTaken: false,
          arenaMovePath: null,
        });
        break;
```

- [ ] **Step 6: Verify client compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add client/src/store/gameStore.ts
git commit -m "feat: add arena combat state to client store"
```

---

### Task 8: ArenaGrid Component

Build the arena grid renderer — wraps `TileGridView` with CSS grid overlay borders, movement range highlighting, and click-to-move/target.

**Files:**
- Create: `client/src/components/ArenaGrid.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Create the ArenaGrid component**

```tsx
// client/src/components/ArenaGrid.tsx
import { useMemo, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';
import type { TileGrid, CombatParticipant } from '@caverns/shared';

interface ArenaGridProps {
  grid: TileGrid;
  positions: Record<string, { x: number; y: number }>;
  participants: CombatParticipant[];
  playerId: string;
  movementRange: Set<string> | null;
  isTargeting: boolean;
  onTileClick: (x: number, y: number) => void;
}

function getEntityChar(participant: CombatParticipant): string {
  if (participant.type === 'player') return '@';
  return participant.name.charAt(0).toUpperCase();
}

function getEntityClass(participant: CombatParticipant, isCurrentTurn: boolean): string {
  const base = participant.type === 'player' ? 'entity-player' : 'entity-mob';
  return isCurrentTurn ? `${base} entity-active-turn` : base;
}

export function ArenaGrid({
  grid, positions, participants, playerId,
  movementRange, isTargeting, onTileClick,
}: ArenaGridProps) {
  const currentTurnId = useGameStore((s) => s.currentTurnId);

  const entities: EntityOverlay[] = useMemo(() => {
    const result: EntityOverlay[] = [];
    for (const p of participants) {
      const pos = positions[p.id];
      if (!pos) continue;
      result.push({
        x: pos.x,
        y: pos.y,
        char: getEntityChar(p),
        className: getEntityClass(p, p.id === currentTurnId),
      });
    }
    return result;
  }, [participants, positions, currentTurnId]);

  // Tile class resolver for movement highlighting
  const charLookup = useCallback((tileType: string, x: number, y: number): string | null => {
    if (movementRange?.has(`${x},${y}`)) {
      // Return null to use default char, but we'll style via CSS class
      return null;
    }
    return null;
  }, [movementRange]);

  // Visible tiles: all tiles are visible in arena (no fog of war)
  const visibleTiles = useMemo(() => {
    const all = new Set<string>();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        all.add(`${x},${y}`);
      }
    }
    return all;
  }, [grid.width, grid.height]);

  return (
    <div className="arena-grid-container">
      <TileGridView
        tileGrid={grid}
        entities={entities}
        visibleTiles={visibleTiles}
        onTileClick={onTileClick}
      />
      {/* Movement range overlay rendered via CSS on the grid */}
    </div>
  );
}
```

- [ ] **Step 2: Add arena CSS styles**

Add to `client/src/styles/index.css`:

```css
/* === Arena Combat Grid === */
.arena-grid-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
}

.arena-grid-container .room-grid {
  border: 1px solid #222;
}

.arena-grid-container .room-row span {
  border: 1px solid #1a1a1a;
  display: inline-block;
  text-align: center;
  min-width: 1.1ch;
}

.entity-player {
  color: #4488ff !important;
  font-weight: bold;
}

.entity-mob {
  color: #ff4444 !important;
  font-weight: bold;
}

.entity-active-turn {
  text-shadow: 0 0 6px currentColor;
}

.arena-move-highlight {
  background: #0b1a0b !important;
}

.arena-target-highlight {
  background: #2a0b0b !important;
  cursor: crosshair !important;
}
```

- [ ] **Step 3: Verify client compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ArenaGrid.tsx client/src/styles/index.css
git commit -m "feat: add ArenaGrid component with entity rendering and grid overlay"
```

---

### Task 9: ArenaActionBar, TurnOrderBar, and ArenaUnitPanel

Build the supporting UI components for the arena view.

**Files:**
- Create: `client/src/components/ArenaActionBar.tsx`
- Create: `client/src/components/TurnOrderBar.tsx`
- Create: `client/src/components/ArenaUnitPanel.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Create TurnOrderBar**

```tsx
// client/src/components/TurnOrderBar.tsx
import type { CombatParticipant } from '@caverns/shared';

interface TurnOrderBarProps {
  participants: CombatParticipant[];
  turnOrder: string[];
  currentTurnId: string;
  roundNumber: number;
}

export function TurnOrderBar({ participants, turnOrder, currentTurnId, roundNumber }: TurnOrderBarProps) {
  const participantMap = new Map(participants.map(p => [p.id, p]));

  return (
    <div className="arena-turn-order">
      <span className="turn-round">Round {roundNumber}</span>
      <span className="turn-label">Turn:</span>
      {turnOrder.map((id, i) => {
        const p = participantMap.get(id);
        if (!p) return null;
        const isCurrent = id === currentTurnId;
        const colorClass = p.type === 'player' ? 'turn-player' : 'turn-mob';
        return (
          <span key={id}>
            <span className={`turn-name ${colorClass} ${isCurrent ? 'turn-active' : ''}`}>
              {isCurrent && '► '}{p.name}
            </span>
            {i < turnOrder.length - 1 && <span className="turn-separator">→</span>}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create ArenaUnitPanel**

```tsx
// client/src/components/ArenaUnitPanel.tsx
import type { CombatParticipant } from '@caverns/shared';

interface ArenaUnitPanelProps {
  participants: CombatParticipant[];
}

function UnitHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const blocks = 10;
  const filled = Math.round((hp / maxHp) * blocks);
  const percent = hp / maxHp;
  const colorClass = percent > 0.5 ? 'hp-green' : percent > 0.25 ? 'hp-yellow' : 'hp-red';
  return (
    <span className="arena-hp-bar">
      <span className={`arena-hp-filled ${colorClass}`}>{'█'.repeat(filled)}</span>
      <span className="arena-hp-empty">{'░'.repeat(blocks - filled)}</span>
      {' '}<span className="arena-hp-text">{hp}/{maxHp}</span>
    </span>
  );
}

export function ArenaUnitPanel({ participants }: ArenaUnitPanelProps) {
  const players = participants.filter(p => p.type === 'player');
  const mobs = participants.filter(p => p.type === 'mob');

  return (
    <div className="arena-unit-panel">
      <div className="arena-unit-section">
        <div className="arena-unit-header">Party</div>
        {players.map(p => (
          <div key={p.id} className="arena-unit-entry">
            <span className="arena-unit-name turn-player">{p.name}</span>
            {p.className && <span className="arena-unit-class">{p.className}</span>}
            <UnitHpBar hp={p.hp} maxHp={p.maxHp} />
          </div>
        ))}
      </div>
      <div className="arena-unit-section">
        <div className="arena-unit-header">Enemies</div>
        {mobs.map(p => (
          <div key={p.id} className="arena-unit-entry">
            <span className="arena-unit-name turn-mob">{p.name}</span>
            <span className="arena-skull-rating">{'☠'.repeat(Math.ceil(p.maxHp / 30))}</span>
            <UnitHpBar hp={p.hp} maxHp={p.maxHp} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ArenaActionBar**

```tsx
// client/src/components/ArenaActionBar.tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Item, ItemStats } from '@caverns/shared';

type ArenaActionMode =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'move' }
  | { mode: 'target_attack' }
  | { mode: 'items' }
  | { mode: 'target_item'; itemIndex: number };

interface ArenaActionBarProps {
  isMyTurn: boolean;
  actionTaken: boolean;
  movementRemaining: number;
  canFlee: boolean;
  onMoveMode: () => void;
  onCancelMove: () => void;
  onAttackMode: () => void;
  onCancelAttack: () => void;
  onDefend: () => void;
  onFlee: () => void;
  onEndTurn: () => void;
  onUseItem: (index: number, targetId?: string) => void;
}

function formatItemStat(stats: ItemStats): string {
  if (stats.healAmount) return `heals ${stats.healAmount}`;
  if (stats.damage) return `${stats.damage} dmg`;
  return '';
}

export function ArenaActionBar({
  isMyTurn, actionTaken, movementRemaining, canFlee,
  onMoveMode, onCancelMove, onAttackMode, onCancelAttack,
  onDefend, onFlee, onEndTurn, onUseItem,
}: ArenaActionBarProps) {
  const player = useGameStore((s) => s.players[s.playerId]);
  const [mode, setMode] = useState<ArenaActionMode>({ mode: 'idle' });

  const effectiveMode: ArenaActionMode =
    !isMyTurn ? { mode: 'idle' } :
    mode.mode === 'idle' ? { mode: 'main' } :
    mode;

  const handleMoveClick = () => {
    setMode({ mode: 'move' });
    onMoveMode();
  };

  const handleAttackClick = () => {
    setMode({ mode: 'target_attack' });
    onAttackMode();
  };

  const handleBackToMain = () => {
    setMode({ mode: 'main' });
    onCancelMove();
    onCancelAttack();
  };

  const handleDefend = () => {
    onDefend();
    setMode({ mode: 'idle' });
  };

  const handleFlee = () => {
    onFlee();
    setMode({ mode: 'idle' });
  };

  const handleEndTurn = () => {
    onEndTurn();
    setMode({ mode: 'idle' });
  };

  const handleItemClick = (index: number) => {
    const item = player?.consumables[index];
    if (!item) return;
    if (item.stats.healAmount) {
      onUseItem(index);
      setMode({ mode: 'idle' });
    } else {
      // Damage item needs target — for now treated as melee adjacency
      setMode({ mode: 'target_item', itemIndex: index });
    }
  };

  // Reset mode when turn changes
  if (!isMyTurn && mode.mode !== 'idle') {
    setMode({ mode: 'idle' });
  }

  return (
    <div className="arena-action-bar">
      {effectiveMode.mode === 'idle' && (
        <span className="waiting-text">Waiting for turn...</span>
      )}

      {effectiveMode.mode === 'main' && (
        <>
          <button className="arena-btn arena-btn-move" onClick={handleMoveClick}
            disabled={movementRemaining <= 0}>
            Move
          </button>
          <button className="arena-btn arena-btn-attack" onClick={handleAttackClick}
            disabled={actionTaken}>
            Attack
          </button>
          <button className="arena-btn arena-btn-defend" onClick={handleDefend}
            disabled={actionTaken}>
            Defend
          </button>
          <button className="arena-btn" onClick={() => setMode({ mode: 'items' })}
            disabled={actionTaken}>
            Items
          </button>
          <button className="arena-btn" onClick={handleFlee}
            disabled={!canFlee || actionTaken}>
            Flee
          </button>
          <button className="arena-btn arena-btn-end" onClick={handleEndTurn}>
            End Turn
          </button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'move' && (
        <>
          <span className="waiting-text">Click a highlighted tile to move...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'target_attack' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to attack...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'items' && (
        <>
          <div className="combat-item-list">
            {player?.consumables.map((item, i) =>
              item ? (
                <button key={i} className="combat-item-btn" onClick={() => handleItemClick(i)}>
                  {item.name}
                  <span className="combat-item-stat">{formatItemStat(item.stats)}</span>
                </button>
              ) : null
            )}
          </div>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'target_item' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to use item...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for all three components**

Add to `client/src/styles/index.css`:

```css
/* === Turn Order Bar === */
.arena-turn-order {
  background: #111;
  padding: 6px 12px;
  border-bottom: 1px solid #222;
  font-size: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: 'Courier New', monospace;
}

.turn-round { color: #666; }
.turn-label { color: #666; }
.turn-player { color: #4488ff; }
.turn-mob { color: #ff4444; }
.turn-active { text-decoration: underline; }
.turn-separator { color: #666; margin: 0 4px; }
.turn-name { white-space: nowrap; }

/* === Arena Unit Panel === */
.arena-unit-panel {
  width: 200px;
  border-left: 1px solid #222;
  padding: 8px 12px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  overflow-y: auto;
}

.arena-unit-header {
  color: #666;
  text-transform: uppercase;
  font-size: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid #222;
  padding-bottom: 4px;
}

.arena-unit-section + .arena-unit-section {
  margin-top: 12px;
}

.arena-unit-entry {
  margin-bottom: 6px;
}

.arena-unit-name { display: inline; }
.arena-unit-class { color: #666; margin-left: 6px; }
.arena-skull-rating { color: #666; margin-left: 4px; }

.arena-hp-bar { display: block; }
.arena-hp-filled.hp-green { color: #33ff33; }
.arena-hp-filled.hp-yellow { color: #ffaa00; }
.arena-hp-filled.hp-red { color: #ff4444; }
.arena-hp-empty { color: #333; }
.arena-hp-text { color: #888; }

/* === Arena Action Bar === */
.arena-action-bar {
  border-top: 1px solid #222;
  padding: 8px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  background: #0d0d0d;
  font-family: 'Courier New', monospace;
}

.arena-btn {
  background: #1a1a1a;
  border: 1px solid #666;
  color: #aaa;
  padding: 3px 10px;
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
}

.arena-btn:hover:not(:disabled) { border-color: #888; color: #fff; }
.arena-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.arena-btn-move { background: #1a2a1a; border-color: #33ff33; color: #33ff33; }
.arena-btn-attack { background: #2a1a1a; border-color: #ff4444; color: #ff4444; }
.arena-btn-defend { background: #1a1a2a; border-color: #4488ff; color: #4488ff; }
.arena-btn-end { background: #1a1a1a; border-color: #555; color: #888; }

.arena-mp-counter {
  color: #333;
  margin-left: auto;
  font-size: 11px;
}
```

- [ ] **Step 5: Verify client compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ArenaActionBar.tsx client/src/components/TurnOrderBar.tsx client/src/components/ArenaUnitPanel.tsx client/src/styles/index.css
git commit -m "feat: add ArenaActionBar, TurnOrderBar, and ArenaUnitPanel components"
```

---

### Task 10: ArenaView — Main Combat View

Assemble the arena components into the top-level `ArenaView` that replaces `CombatView` when arena combat is active.

**Files:**
- Create: `client/src/components/ArenaView.tsx`
- Modify: `client/src/hooks/useGameActions.ts`
- Modify: `client/src/components/RoomView.tsx` (or wherever CombatView is rendered)
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add arena action senders to useGameActions**

In `client/src/hooks/useGameActions.ts`, add:

```ts
  const sendArenaMove = useCallback((targetX: number, targetY: number) => {
    send({ type: 'arena_move', targetX, targetY });
  }, [send]);

  const sendArenaEndTurn = useCallback(() => {
    send({ type: 'arena_end_turn' });
  }, [send]);
```

Return them from the hook alongside existing action senders.

- [ ] **Step 2: Create ArenaView**

```tsx
// client/src/components/ArenaView.tsx
import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { ArenaGrid } from './ArenaGrid.js';
import { TurnOrderBar } from './TurnOrderBar.js';
import { ArenaUnitPanel } from './ArenaUnitPanel.js';
import { ArenaActionBar } from './ArenaActionBar.js';

interface ArenaViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
  ) => void;
  onArenaMove: (targetX: number, targetY: number) => void;
  onArenaEndTurn: () => void;
}

type InteractionMode = 'none' | 'move' | 'attack';

export function ArenaView({ onCombatAction, onArenaMove, onArenaEndTurn }: ArenaViewProps) {
  const playerId = useGameStore((s) => s.playerId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const arenaGrid = useGameStore((s) => s.arenaGrid);
  const arenaPositions = useGameStore((s) => s.arenaPositions);
  const arenaMovementRemaining = useGameStore((s) => s.arenaMovementRemaining);
  const arenaActionTaken = useGameStore((s) => s.arenaActionTaken);
  const textLog = useGameStore((s) => s.textLog);
  const currentTurnId = useGameStore((s) => s.currentTurnId);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [combatLogStart] = useState(() => textLog.length);

  const isMyTurn = currentTurnId === playerId;

  // Combat log: last 3 combat messages since combat started
  const combatLogLines = useMemo(() => {
    return textLog
      .slice(combatLogStart)
      .filter((entry) => entry.logType === 'combat')
      .slice(-3);
  }, [textLog, combatLogStart]);

  // Movement range (BFS on client for highlighting — mirrors server logic)
  const movementRange = useMemo(() => {
    if (!isMyTurn || interactionMode !== 'move' || !arenaGrid) return null;
    const myPos = arenaPositions[playerId];
    if (!myPos) return null;
    // Simple client-side BFS for display only
    const reachable = new Set<string>();
    const occupied = new Set<string>();
    for (const [id, pos] of Object.entries(arenaPositions)) {
      if (id !== playerId) occupied.add(`${pos.x},${pos.y}`);
    }
    const queue: { x: number; y: number; mp: number }[] = [
      { x: myPos.x, y: myPos.y, mp: arenaMovementRemaining },
    ];
    reachable.add(`${myPos.x},${myPos.y}`);
    const DIRS = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    const costs: Record<string, number> = { floor: 1, water: 2, hazard: 1, bridge: 1 };
    const best = new Map<string, number>();
    best.set(`${myPos.x},${myPos.y}`, arenaMovementRemaining);

    while (queue.length > 0) {
      const { x, y, mp } = queue.shift()!;
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || nx >= arenaGrid.width || ny < 0 || ny >= arenaGrid.height) continue;
        const tile = arenaGrid.tiles[ny][nx];
        const cost = costs[tile] ?? Infinity;
        if (cost === Infinity) continue;
        const remaining = mp - cost;
        if (remaining < 0) continue;
        const key = `${nx},${ny}`;
        if (occupied.has(key)) continue;
        const existing = best.get(key);
        if (existing !== undefined && existing >= remaining) continue;
        best.set(key, remaining);
        reachable.add(key);
        queue.push({ x: nx, y: ny, mp: remaining });
      }
    }
    return reachable;
  }, [isMyTurn, interactionMode, arenaGrid, arenaPositions, arenaMovementRemaining, playerId]);

  // Adjacent enemies for attack targeting
  const adjacentEnemies = useMemo(() => {
    if (!activeCombat || !arenaPositions[playerId]) return new Set<string>();
    const myPos = arenaPositions[playerId];
    const adjacent = new Set<string>();
    for (const p of activeCombat.participants) {
      if (p.type !== 'mob') continue;
      const pos = arenaPositions[p.id];
      if (!pos) continue;
      if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) === 1) {
        adjacent.add(p.id);
      }
    }
    return adjacent;
  }, [activeCombat, arenaPositions, playerId]);

  // Check if player is on edge tile for flee
  const canFlee = useMemo(() => {
    if (!arenaGrid || !arenaPositions[playerId]) return false;
    const pos = arenaPositions[playerId];
    const DIRS = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    for (const d of DIRS) {
      const nx = pos.x + d.dx;
      const ny = pos.y + d.dy;
      if (nx < 0 || nx >= arenaGrid.width || ny < 0 || ny >= arenaGrid.height) return true;
      if ((nx === 0 || nx === arenaGrid.width - 1 || ny === 0 || ny === arenaGrid.height - 1)
        && arenaGrid.tiles[ny][nx] === 'wall') return true;
    }
    return false;
  }, [arenaGrid, arenaPositions, playerId]);

  const handleTileClick = useCallback((x: number, y: number) => {
    if (!isMyTurn) return;

    if (interactionMode === 'move') {
      const key = `${x},${y}`;
      if (movementRange?.has(key)) {
        onArenaMove(x, y);
      }
      return;
    }

    if (interactionMode === 'attack') {
      // Find if any mob is at this tile
      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (pos.x === x && pos.y === y && adjacentEnemies.has(id)) {
          onCombatAction('attack', id);
          useGameStore.setState({ arenaActionTaken: true });
          setInteractionMode('none');
          return;
        }
      }
    }
  }, [isMyTurn, interactionMode, movementRange, arenaPositions, adjacentEnemies, onArenaMove, onCombatAction]);

  if (!activeCombat || !arenaGrid) return null;

  return (
    <div className="arena-view">
      <TurnOrderBar
        participants={activeCombat.participants}
        turnOrder={activeCombat.turnOrder}
        currentTurnId={activeCombat.currentTurnId}
        roundNumber={activeCombat.roundNumber}
      />
      <div className="arena-main">
        <ArenaGrid
          grid={arenaGrid}
          positions={arenaPositions}
          participants={activeCombat.participants}
          playerId={playerId}
          movementRange={interactionMode === 'move' ? movementRange : null}
          isTargeting={interactionMode === 'attack'}
          onTileClick={handleTileClick}
        />
        <ArenaUnitPanel participants={activeCombat.participants} />
      </div>
      <ArenaActionBar
        isMyTurn={isMyTurn}
        actionTaken={arenaActionTaken}
        movementRemaining={arenaMovementRemaining}
        canFlee={canFlee}
        onMoveMode={() => setInteractionMode('move')}
        onCancelMove={() => setInteractionMode('none')}
        onAttackMode={() => setInteractionMode('attack')}
        onCancelAttack={() => setInteractionMode('none')}
        onDefend={() => { onCombatAction('defend'); useGameStore.setState({ arenaActionTaken: true }); }}
        onFlee={() => onCombatAction('flee')}
        onEndTurn={onArenaEndTurn}
        onUseItem={(index, targetId) => {
          onCombatAction('use_item', targetId, index);
          useGameStore.setState({ arenaActionTaken: true });
        }}
      />
      <div className="arena-combat-log">
        {combatLogLines.map((entry) => (
          <div key={entry.id} className="combat-log-line">{entry.message}</div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add ArenaView CSS**

Add to `client/src/styles/index.css`:

```css
/* === Arena View Layout === */
.arena-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0a0a;
  font-family: 'Courier New', monospace;
  color: #33ff33;
}

.arena-main {
  display: flex;
  flex: 1;
  min-height: 0;
}

.arena-combat-log {
  border-top: 1px solid #222;
  padding: 6px 12px;
  font-size: 11px;
  color: #666;
  background: #080808;
}
```

- [ ] **Step 4: Wire ArenaView into the rendering tree**

In the component that renders `CombatView` (find where `<CombatView` is used), add a conditional: if `arenaGrid` is present in the store, render `ArenaView` instead of `CombatView`:

```tsx
const arenaGrid = useGameStore((s) => s.arenaGrid);

// In the render:
{activeCombat && arenaGrid ? (
  <ArenaView
    onCombatAction={handleCombatAction}
    onArenaMove={sendArenaMove}
    onArenaEndTurn={sendArenaEndTurn}
  />
) : activeCombat ? (
  <CombatView ... />
) : (
  // exploration view
)}
```

- [ ] **Step 5: Verify client compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ArenaView.tsx client/src/hooks/useGameActions.ts client/src/styles/index.css
git commit -m "feat: add ArenaView and wire into rendering tree"
```

---

### Task 11: Integration Testing & Polish

Start the dev servers, trigger combat, and verify the full flow works end-to-end. Fix any issues.

**Files:**
- Potentially any file from Tasks 1–10

- [ ] **Step 1: Start the dev servers**

From a Windows terminal or PowerShell:
```bash
npm run dev:server
npm run dev:client
```

- [ ] **Step 2: Test the happy path**

1. Open the client in a browser
2. Log in, select character, enter a dungeon
3. Walk into a room with mobs
4. Verify the arena combat screen appears with the ASCII grid, turn order bar, unit panel, and action bar
5. On your turn, click Move, verify movement range highlights
6. Click a highlighted tile, verify your `@` moves and movement counter decreases
7. Click Attack, click an adjacent enemy, verify damage resolves and combat log updates
8. Click End Turn, verify mob takes its turn (moves toward you, attacks if adjacent)
9. Continue until combat ends — verify victory screen / loot flow works

- [ ] **Step 3: Test edge cases**

1. Try attacking a non-adjacent enemy — should show error or not be clickable
2. Try fleeing from the center — should not be allowed
3. Move to an edge tile and flee — should work with opportunity damage
4. Try moving through water — should cost 2 MP
5. Verify defend works (click Defend, see mob attack on next turn)
6. Verify items work (use a healing potion mid-combat)
7. Test with multiple players if possible — verify positions sync

- [ ] **Step 4: Fix any issues found**

Address rendering bugs, movement edge cases, animation timing, and CSS tweaks as needed.

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: arena combat integration fixes and polish"
```

---

### Task 12: Hazard Damage on Movement

When a unit moves onto a hazard tile, apply the damage. This ties into the existing `TILE_PROPERTIES.hazard.damageOnEntry = 5`.

**Files:**
- Modify: `server/src/ArenaCombatManager.ts`
- Modify: `server/src/ArenaCombatManager.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/ArenaCombatManager.test.ts`:

```ts
  it('applies hazard damage when moving onto a hazard tile', () => {
    const tiles: string[][] = [];
    for (let y = 0; y < 6; y++) {
      const row: string[] = [];
      for (let x = 0; x < 8; x++) {
        row.push(y === 0 || y === 5 || x === 0 || x === 7 ? 'wall' : 'floor');
      }
      tiles.push(row);
    }
    // Place hazard at (3,2)
    tiles[2][3] = 'hazard';
    const grid: TileGrid = { width: 8, height: 6, tiles };

    const positions = { p1: { x: 2, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager(
      'room1', grid, [makePlayer()], [makeMob()], positions,
    );
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 3, y: 2 });
    expect(result.success).toBe(true);
    expect(result.hazardDamage).toBe(5);
    // Player HP should be reduced
    expect(arena.getCombatManager().getPlayerHp('p1')).toBe(45);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/ArenaCombatManager.test.ts -t "hazard"`
Expected: FAIL

- [ ] **Step 3: Add hazard damage to handleMove**

In `ArenaCombatManager.handleMove`, after updating the position, check if the destination is a hazard tile:

```ts
    // Check for hazard damage at destination
    let hazardDamage = 0;
    const destTile = this.grid.tiles[target.y][target.x];
    if (destTile === 'hazard') {
      hazardDamage = 5; // TILE_PROPERTIES.hazard.damageOnEntry
      this.combatManager.applyDamage(id, hazardDamage);
    }

    return { success: true, movementRemaining: turnState.movementRemaining, path, hazardDamage };
```

Update the return type to include `hazardDamage?: number`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/ArenaCombatManager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ArenaCombatManager.ts server/src/ArenaCombatManager.test.ts
git commit -m "feat: apply hazard tile damage during arena movement"
```
