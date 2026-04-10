import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';

export class CavernGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const fillProb = params.fillProbability ?? 0.45;
    const passes = params.smoothingPasses ?? 4;
    const hazardChance = params.hazardChance ?? 0;
    const waterChance = params.waterChance ?? 0;

    // 1. Initialize grid — border is wall, interior is random
    let grid: TileType[][] = [];
    for (let y = 0; y < height; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < width; x++) {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          row.push('wall');
        } else {
          row.push(Math.random() < fillProb ? 'wall' : 'floor');
        }
      }
      grid.push(row);
    }

    // 2. Cellular automata smoothing
    for (let pass = 0; pass < passes; pass++) {
      const next: TileType[][] = grid.map(row => [...row]);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let wallCount = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              if (grid[y + dy][x + dx] === 'wall') wallCount++;
            }
          }
          next[y][x] = wallCount >= 5 ? 'wall' : 'floor';
        }
      }
      grid = next;
    }

    // 3. Force exit tiles and clear adjacent tiles
    for (const exit of exits) {
      grid[exit.position.y][exit.position.x] = 'exit';
      // Clear tiles adjacent to exit (within bounds and not on border exits themselves)
      const adjacents = [
        { x: exit.position.x - 1, y: exit.position.y },
        { x: exit.position.x + 1, y: exit.position.y },
        { x: exit.position.x, y: exit.position.y - 1 },
        { x: exit.position.x, y: exit.position.y + 1 },
      ];
      for (const adj of adjacents) {
        if (adj.x > 0 && adj.x < width - 1 && adj.y > 0 && adj.y < height - 1) {
          if (grid[adj.y][adj.x] === 'wall') {
            grid[adj.y][adj.x] = 'floor';
          }
        }
      }
    }

    // 4. Ensure connectivity between exits via corridor carving
    if (exits.length > 1) {
      this.ensureConnectivity(grid, exits.map(e => e.position), width, height);
    }

    // 5. Scatter hazard and water tiles on floor
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

    return {
      width,
      height,
      tiles: grid,
      exits: exits.map(e => ({ position: e.position, data: e.data })),
    };
  }

  private ensureConnectivity(
    grid: TileType[][],
    exitPositions: { x: number; y: number }[],
    width: number,
    height: number,
  ): void {
    // BFS from first exit to find connected walkable region
    const isWalkableTile = (t: TileType) => t !== 'wall' && t !== 'chasm';
    const visited = new Set<string>();
    const queue = [exitPositions[0]];
    visited.add(`${exitPositions[0].x},${exitPositions[0].y}`);

    while (queue.length > 0) {
      const pos = queue.shift()!;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (!isWalkableTile(grid[ny][nx])) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }

    // For each unreachable exit, carve a corridor to a reachable tile
    for (let i = 1; i < exitPositions.length; i++) {
      const key = `${exitPositions[i].x},${exitPositions[i].y}`;
      if (visited.has(key)) continue;

      // Carve L-shaped corridor from this exit toward the first exit
      const from = exitPositions[i];
      const to = exitPositions[0];

      // Horizontal then vertical
      const xDir = to.x > from.x ? 1 : -1;
      let cx = from.x;
      while (cx !== to.x) {
        cx += xDir;
        if (cx > 0 && cx < width - 1 && grid[from.y][cx] === 'wall') {
          grid[from.y][cx] = 'floor';
        }
      }
      const yDir = to.y > from.y ? 1 : -1;
      let cy = from.y;
      while (cy !== to.y) {
        cy += yDir;
        if (cy > 0 && cy < height - 1 && grid[cy][to.x] === 'wall') {
          grid[cy][to.x] = 'floor';
        }
      }
    }
  }
}
