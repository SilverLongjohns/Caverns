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
    errors.push(`Not enough open space (${(openPercent * 100).toFixed(1)}%) below minimum ${(minOpenPercent * 100).toFixed(1)}%`);
  }

  // 3. Check exit tiles are walkable
  for (const exit of exits) {
    if (!TILE_PROPERTIES[tiles[exit.y][exit.x]].walkable) {
      errors.push(`Exit at (${exit.x}, ${exit.y}) is not on a walkable tile`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 4. Connectivity: flood fill from first exit, check all exits reachable
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
