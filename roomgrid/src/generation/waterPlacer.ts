import type { TileType } from '../types.js';
import type { GenerationParams } from './types.js';

type Grid = TileType[][];

/**
 * Place water features on a grid based on waterStyle param.
 * - 'scatter': random per-tile (legacy behavior)
 * - 'puddle': clustered blobs that grow outward from seed points
 * - 'stream': random-walking 3x3 brush streams
 */
export function placeWater(grid: Grid, params: GenerationParams): void {
  const waterChance = params.waterChance ?? 0;
  if (waterChance <= 0) return;

  const style = params.waterStyle ?? 'scatter';
  const width = grid[0].length;
  const height = grid.length;

  switch (style) {
    case 'puddle':
      placePuddles(grid, width, height, params.waterCount ?? 2, params.waterSize ?? 8);
      break;
    case 'stream':
      placeStreams(grid, width, height, params.waterCount ?? 1, params.waterLength ?? 15);
      break;
    case 'mixed':
      placeStreams(grid, width, height, params.streamCount ?? 1, params.waterLength ?? 15);
      placePuddles(grid, width, height, params.puddleCount ?? 2, params.waterSize ?? 8);
      break;
    default:
      scatterWater(grid, width, height, waterChance, params.hazardChance ?? 0);
      break;
  }
}

function isPlaceable(grid: Grid, x: number, y: number): boolean {
  return grid[y][x] === 'floor';
}

function scatterWater(grid: Grid, width: number, height: number, waterChance: number, hazardChance: number): void {
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
}

function placePuddles(grid: Grid, width: number, height: number, count: number, maxSize: number): void {
  for (let i = 0; i < count; i++) {
    // Find a random floor tile as seed
    const seed = findRandomFloor(grid, width, height);
    if (!seed) return;

    const placed: { x: number; y: number }[] = [seed];
    grid[seed.y][seed.x] = 'water';
    let size = 1;

    // Grow outward from placed tiles
    while (size < maxSize) {
      // Collect candidate neighbors of all placed tiles
      const candidates: { x: number; y: number }[] = [];
      for (const p of placed) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && isPlaceable(grid, nx, ny)) {
            candidates.push({ x: nx, y: ny });
          }
        }
      }
      if (candidates.length === 0) break;

      // Pick a random candidate with decreasing probability as we grow
      const growChance = 0.8 - (size / maxSize) * 0.5;
      if (Math.random() > growChance) break;

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      grid[pick.y][pick.x] = 'water';
      placed.push(pick);
      size++;
    }
  }
}

function placeStreams(grid: Grid, width: number, height: number, count: number, length: number): void {
  for (let i = 0; i < count; i++) {
    // Pick a primary axis — horizontal streams are more readable in ASCII
    const horizontal = Math.random() < 0.6;

    // Start from one edge and flow across
    let cx: number, cy: number;
    if (horizontal) {
      cx = 2;
      cy = 3 + Math.floor(Math.random() * (height - 6));
    } else {
      cx = 3 + Math.floor(Math.random() * (width - 6));
      cy = 2;
    }

    let drift = 0;

    for (let step = 0; step < length; step++) {
      // Paint 3-wide band perpendicular to flow direction
      for (let offset = -1; offset <= 1; offset++) {
        const px = horizontal ? Math.round(cx) : Math.round(cx) + offset;
        const py = horizontal ? Math.round(cy) + offset : Math.round(cy);
        if (px > 0 && px < width - 1 && py > 0 && py < height - 1) {
          const tile = grid[py][px];
          if (tile === 'floor' || tile === 'wall') {
            grid[py][px] = 'water';
          }
        }
      }

      // Advance along primary axis
      if (horizontal) {
        cx += 1;
        // Gentle drift perpendicular
        drift += (Math.random() - 0.5) * 0.6;
        drift = Math.max(-2, Math.min(2, drift));
        cy += drift * 0.3;
      } else {
        cy += 1;
        drift += (Math.random() - 0.5) * 0.6;
        drift = Math.max(-2, Math.min(2, drift));
        cx += drift * 0.3;
      }

      if (Math.round(cx) <= 1 || Math.round(cx) >= width - 2 || Math.round(cy) <= 1 || Math.round(cy) >= height - 2) {
        break;
      }
    }
  }
}

function findRandomFloor(grid: Grid, width: number, height: number): { x: number; y: number } | null {
  // Try random picks first
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = 2 + Math.floor(Math.random() * (width - 4));
    const y = 2 + Math.floor(Math.random() * (height - 4));
    if (grid[y][x] === 'floor') return { x, y };
  }
  return null;
}
