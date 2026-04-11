import type { TileType } from '../types.js';
import { TILE_PROPERTIES } from '../types.js';
import type { GridPosition } from '../types.js';

interface ExitInfo {
  position: GridPosition;
  data: { direction: string };
}

/**
 * Force exit tiles and clear a corridor inward from each exit.
 * Clears a 3-wide, 3-deep area so players don't spawn trapped in walls or chasms.
 */
export function clearExits(grid: TileType[][], exits: ExitInfo[], width: number, height: number): void {
  for (const exit of exits) {
    const { x, y } = exit.position;
    grid[y][x] = 'exit';

    // Determine inward direction from border
    let dx = 0;
    let dy = 0;
    if (y === 0) dy = 1;             // north exit → clear southward
    else if (y === height - 1) dy = -1; // south exit → clear northward
    else if (x === 0) dx = 1;          // west exit → clear eastward
    else if (x === width - 1) dx = -1;  // east exit → clear westward

    // Clear a 3-deep, 3-wide corridor inward
    for (let depth = 1; depth <= 3; depth++) {
      for (let spread = -1; spread <= 1; spread++) {
        const cx = x + dx * depth + (dy !== 0 ? spread : 0);
        const cy = y + dy * depth + (dx !== 0 ? spread : 0);
        if (cx > 0 && cx < width - 1 && cy > 0 && cy < height - 1) {
          if (!TILE_PROPERTIES[grid[cy][cx]].walkable) {
            grid[cy][cx] = 'floor';
          }
        }
      }
    }
  }
}
