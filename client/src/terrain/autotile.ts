import type { SheetPos, TerrainManifest } from './terrainManifest.js';
import { fnv1a32 } from '../glyphs.js';

export type TerrainClass = 'floor' | 'rock' | 'water' | 'chasm';
type UpperClass = 'rock' | 'water' | 'chasm';

/** Stamp slots a manifest can supply (see TerrainManifest['stamps']). */
export type StampKey = 'hazard' | 'bridge_h' | 'bridge_v' | 'exit' | 'torch';

export interface Quad {
  tile: SheetPos;
  qx: 0 | 1;
  qy: 0 | 1;
}

export interface TerrainCell {
  /** NW, NE, SW, SE quadrant sources: sheet tile + which quarter of it (qx, qy ∈ {0,1}). null ⇒ no art (caller falls back to ASCII). */
  quads: [Quad | null, Quad | null, Quad | null, Quad | null];
  variant: SheetPos | null;
  stamp: SheetPos | null;
  /**
   * The stamp this cell needs (hazard/exit/bridge/torch-wall) when `stamp` is null because the
   * active manifest doesn't have that stamp yet — as opposed to this cell simply not wanting a
   * stamp at all. The base terrain (quads/variant) still renders normally either way; callers
   * use this to know when a cell needs its ASCII character drawn over the art anyway (a hazard
   * or exit with no visible marker is a gameplay problem, not a cosmetic gap), unlike a plain
   * floor/rock cell whose stamp field is simply and correctly null.
   */
  missingStamp: StampKey | null;
}

interface AutotileGrid {
  width: number;
  height: number;
  tiles: string[][];
}

interface AutotileGridWithThemes extends AutotileGrid {
  themes?: (string | null)[][];
}

const VARIANT_CHANCE_PERCENT = 15;

function tileAt(grid: AutotileGrid, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return grid.tiles[y][x];
}

/** OOB ⇒ rock; bridge ⇒ water/chasm by neighbours. */
export function classify(grid: AutotileGrid, x: number, y: number): TerrainClass {
  const t = tileAt(grid, x, y);
  if (t === null) return 'rock';
  if (t === 'wall' || t === 'pillar') return 'rock';
  if (t === 'water') return 'water';
  if (t === 'chasm') return 'chasm';
  if (t === 'bridge') {
    const neighbourIsWater =
      tileAt(grid, x - 1, y) === 'water' ||
      tileAt(grid, x + 1, y) === 'water' ||
      tileAt(grid, x, y - 1) === 'water' ||
      tileAt(grid, x, y + 1) === 'water';
    return neighbourIsWater ? 'water' : 'chasm';
  }
  return 'floor';
}

/** Priority rock > chasm > water; null when the vertex touches no upper terrain (all floor). */
function pickUpper(corners: TerrainClass[]): UpperClass | null {
  if (corners.includes('rock')) return 'rock';
  if (corners.includes('chasm')) return 'chasm';
  if (corners.includes('water')) return 'water';
  return null;
}

function vertexMaskAndSet(grid: AutotileGrid, vx: number, vy: number): { mask: number; set: UpperClass } {
  const nw = classify(grid, vx - 1, vy - 1);
  const ne = classify(grid, vx, vy - 1);
  const sw = classify(grid, vx - 1, vy);
  const se = classify(grid, vx, vy);
  const upper = pickUpper([nw, ne, sw, se]);
  if (upper === null) return { mask: 0, set: 'rock' };
  const bit = (c: TerrainClass) => (c === upper ? 1 : 0);
  const mask = (bit(nw) << 3) | (bit(ne) << 2) | (bit(sw) << 1) | bit(se);
  return { mask, set: upper };
}

/** vertex (vx,vy) ∈ [0..w]×[0..h]. */
export function vertexTile(grid: AutotileGrid, vx: number, vy: number, m: TerrainManifest): SheetPos | null {
  const { mask, set } = vertexMaskAndSet(grid, vx, vy);
  return m.sets[set]?.[String(mask)] ?? null;
}

function bridgeStampKey(grid: AutotileGrid, x: number, y: number): 'bridge_h' | 'bridge_v' {
  const left = tileAt(grid, x - 1, y);
  const right = tileAt(grid, x + 1, y);
  const isWaterOrChasm = (t: string | null) => t === 'water' || t === 'chasm';
  const horizontal = !isWaterOrChasm(left) || !isWaterOrChasm(right);
  return horizontal ? 'bridge_h' : 'bridge_v';
}

/**
 * Which stamp slot a cell wants, if any — the single source of truth for "does this cell need a
 * stamp" (used both to look the stamp up and, when it's missing from the manifest, to tell
 * callers an ASCII fallback is needed even though the base terrain rendered fine).
 */
function stampKeyFor(grid: AutotileGridWithThemes, x: number, y: number): StampKey | null {
  const t = grid.tiles[y][x];
  if (t === 'hazard') return 'hazard';
  if (t === 'exit') return 'exit';
  if (t === 'bridge') return bridgeStampKey(grid, x, y);
  if (t === 'wall' && grid.themes?.[y]?.[x] === 'torch') return 'torch';
  return null;
}

export function autotile(grid: AutotileGridWithThemes, roomId: string, m: TerrainManifest): TerrainCell[][] {
  const rows: TerrainCell[][] = [];
  for (let y = 0; y < grid.height; y++) {
    const row: TerrainCell[] = [];
    for (let x = 0; x < grid.width; x++) {
      const nw = vertexTile(grid, x, y, m);
      const ne = vertexTile(grid, x + 1, y, m);
      const sw = vertexTile(grid, x, y + 1, m);
      const se = vertexTile(grid, x + 1, y + 1, m);
      const quads: [Quad | null, Quad | null, Quad | null, Quad | null] = [
        nw ? { tile: nw, qx: 1, qy: 1 } : null,
        ne ? { tile: ne, qx: 0, qy: 1 } : null,
        sw ? { tile: sw, qx: 1, qy: 0 } : null,
        se ? { tile: se, qx: 0, qy: 0 } : null,
      ];

      let variant: SheetPos | null = null;
      if (classify(grid, x, y) === 'floor' && m.floorVariants.length > 0) {
        const v1 = vertexMaskAndSet(grid, x, y).mask === 0;
        const v2 = vertexMaskAndSet(grid, x + 1, y).mask === 0;
        const v3 = vertexMaskAndSet(grid, x, y + 1).mask === 0;
        const v4 = vertexMaskAndSet(grid, x + 1, y + 1).mask === 0;
        if (v1 && v2 && v3 && v4) {
          const hash = fnv1a32(`${roomId}:${x},${y}`);
          if (hash % 100 < VARIANT_CHANCE_PERCENT) {
            variant = m.floorVariants[hash % m.floorVariants.length];
          }
        }
      }

      const stampKey = stampKeyFor(grid, x, y);
      const stamp = stampKey ? m.stamps[stampKey] ?? null : null;
      const missingStamp = stampKey && !stamp ? stampKey : null;
      row.push({ quads, variant, stamp, missingStamp });
    }
    rows.push(row);
  }
  return rows;
}
