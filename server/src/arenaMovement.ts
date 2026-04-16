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

  // Track best movement points for traversal (including through occupied tiles)
  const bestTraversal = new Map<string, number>();
  bestTraversal.set(startKey, movementPoints);

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

      // Check if we've already visited this tile with equal or better MP via traversal
      const existingTraversal = bestTraversal.get(key);
      if (existingTraversal !== undefined && existingTraversal >= remaining) continue;

      bestTraversal.set(key, remaining);

      // Only add to reachable (landable) set if not occupied
      if (!occupied.has(key)) {
        const existing = reachable.get(key);
        if (existing === undefined || existing < remaining) {
          reachable.set(key, remaining);
        }
      }

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

  const best = new Map<string, number>();
  const parent = new Map<string, string>();
  const startKey = `${start.x},${start.y}`;
  best.set(startKey, movementPoints);

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

      const existing = best.get(key);
      if (existing !== undefined && existing >= remaining) continue;

      best.set(key, remaining);
      parent.set(key, `${x},${y}`);
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

/**
 * Bresenham line-of-sight check.
 * Returns true if there is a clear line from `from` to `to` within `maxRange` (Chebyshev distance).
 * Intermediate tiles that are wall or chasm block LoS. Start and end tiles are not checked.
 */
export function hasLineOfSight(
  grid: TileGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
  maxRange: number,
): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);

  // Chebyshev distance check
  if (Math.max(dx, dy) > maxRange) return false;

  // Same tile
  if (dx === 0 && dy === 0) return true;

  // Bresenham line walk — check intermediate tiles
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = from.x;
  let y = from.y;

  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }

    // Reached destination — don't check end tile
    if (x === to.x && y === to.y) break;

    // Check intermediate tile
    const tile = grid.tiles[y]?.[x];
    if (!tile || tile === 'wall' || tile === 'chasm') return false;
  }

  return true;
}
