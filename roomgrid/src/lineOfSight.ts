import type { GridPosition, Tile } from './types.js';
import { euclideanDistance, TILE_PROPERTIES } from './types.js';

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

export function hasLineOfSight(tiles: Tile[][], from: GridPosition, to: GridPosition): boolean {
  const line = bresenhamLine(from, to);
  // Skip start and end — only intermediate tiles block
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i];
    const row = tiles[p.y];
    if (!row) return false;
    const tile = row[p.x];
    if (!tile || TILE_PROPERTIES[tile.type].blocksLOS) return false;

    // Diagonal corner check: when both x and y changed from previous point,
    // if both orthogonal neighbors are walls, LOS is blocked (two-wall corner)
    const prev = line[i - 1];
    if (prev.x !== p.x && prev.y !== p.y) {
      const cornerA = tiles[prev.y]?.[p.x];
      const cornerB = tiles[p.y]?.[prev.x];
      const aIsWall = !cornerA || TILE_PROPERTIES[cornerA.type].blocksLOS;
      const bIsWall = !cornerB || TILE_PROPERTIES[cornerB.type].blocksLOS;
      if (aIsWall && bIsWall) return false;
    }
  }
  return true;
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
      if (euclideanDistance(from, pos) > range) continue;
      if (hasLineOfSight(tiles, from, pos)) {
        visible.push(pos);
      }
    }
  }

  return visible;
}
