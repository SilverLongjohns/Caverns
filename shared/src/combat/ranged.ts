import rangedConfig from '../data/rangedConfig.json' with { type: 'json' };

type Tile = { x: number; y: number };
export interface GunType { range: number; magazine: number; damageMult: number }
export interface RangedConfig {
  rangePerMarksmanship: number; baseHit: number; hitPerMarksmanship: number;
  falloffPerTile: number; falloffStart: number; minHit: number; maxHit: number;
  gunTypes: Record<string, GunType>;
}

export const RANGED_CONFIG: RangedConfig = rangedConfig;
export const GUN_TYPES: Record<string, GunType> = RANGED_CONFIG.gunTypes;

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function effectiveRange(weaponRange: number, marksmanship: number): number {
  return weaponRange + marksmanship * RANGED_CONFIG.rangePerMarksmanship;
}

/** Chance (0..1) that a shot at `distance` tiles lands. */
export function hitChance(distance: number, marksmanship: number): number {
  const c = RANGED_CONFIG;
  const raw = c.baseHit + c.hitPerMarksmanship * marksmanship - c.falloffPerTile * Math.max(0, distance - c.falloffStart);
  return Math.min(c.maxHit, Math.max(c.minHit, raw));
}

/**
 * Bresenham line-of-sight check, shared by server validation and client targeting.
 * True if `to` is within `maxRange` (Chebyshev) and no intermediate tile is wall or chasm. End tiles are not checked.
 */
export function hasLineOfSight(grid: { tiles: string[][] }, from: Tile, to: Tile, maxRange: number): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (Math.max(dx, dy) > maxRange) return false;
  if (dx === 0 && dy === 0) return true;
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = from.x;
  let y = from.y;
  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === to.x && y === to.y) break;
    const tile = grid.tiles[y]?.[x];
    if (!tile || tile === 'wall' || tile === 'chasm') return false;
  }
  return true;
}
