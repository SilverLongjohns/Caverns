import type { TileType, RoomGridConfig } from '../types.js';
import { TILE_PROPERTIES } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';

export class ChasmGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const chasmCount = params.chasmCount ?? 2;
    const bridgeWidth = params.bridgeWidth ?? 2;
    const hazardChance = params.hazardChance ?? 0;
    const waterChance = params.waterChance ?? 0;

    // 1. Fill with floor, border with walls
    const grid: TileType[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          return 'wall' as TileType;
        }
        return 'floor' as TileType;
      })
    );

    // 2. Carve chasm bands
    const chasmBands: { pos: number; vertical: boolean; chasmWidth: number }[] = [];
    for (let i = 0; i < chasmCount; i++) {
      const vertical = Math.random() < 0.5;
      const chasmW = 2 + Math.floor(Math.random() * 2); // width 2-3

      if (vertical) {
        // Place a vertical chasm band
        const minX = 3;
        const maxX = width - 3 - chasmW;
        if (maxX <= minX) continue;
        const x = minX + Math.floor(Math.random() * (maxX - minX));
        chasmBands.push({ pos: x, vertical: true, chasmWidth: chasmW });

        for (let y = 1; y < height - 1; y++) {
          for (let dx = 0; dx < chasmW; dx++) {
            if (x + dx > 0 && x + dx < width - 1) {
              grid[y][x + dx] = 'chasm';
            }
          }
        }
      } else {
        // Place a horizontal chasm band
        const minY = 3;
        const maxY = height - 3 - chasmW;
        if (maxY <= minY) continue;
        const y = minY + Math.floor(Math.random() * (maxY - minY));
        chasmBands.push({ pos: y, vertical: false, chasmWidth: chasmW });

        for (let x = 1; x < width - 1; x++) {
          for (let dy = 0; dy < chasmW; dy++) {
            if (y + dy > 0 && y + dy < height - 1) {
              grid[y + dy][x] = 'chasm';
            }
          }
        }
      }
    }

    // 3. Place bridges across each chasm band
    for (const band of chasmBands) {
      if (band.vertical) {
        // Bridge is horizontal across a vertical chasm
        const bridgeY = 2 + Math.floor(Math.random() * (height - 4));
        for (let bw = 0; bw < bridgeWidth; bw++) {
          const by = bridgeY + bw;
          if (by > 0 && by < height - 1) {
            for (let dx = 0; dx < band.chasmWidth; dx++) {
              if (band.pos + dx > 0 && band.pos + dx < width - 1) {
                grid[by][band.pos + dx] = 'bridge';
              }
            }
          }
        }
      } else {
        // Bridge is vertical across a horizontal chasm
        const bridgeX = 2 + Math.floor(Math.random() * (width - 4));
        for (let bw = 0; bw < bridgeWidth; bw++) {
          const bx = bridgeX + bw;
          if (bx > 0 && bx < width - 1) {
            for (let dy = 0; dy < band.chasmWidth; dy++) {
              if (band.pos + dy > 0 && band.pos + dy < height - 1) {
                grid[band.pos + dy][bx] = 'bridge';
              }
            }
          }
        }
      }
    }

    // 4. Add wall clusters on platforms for cover
    for (let i = 0; i < 3; i++) {
      const cx = 2 + Math.floor(Math.random() * (width - 4));
      const cy = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[cy][cx] === 'floor') {
        grid[cy][cx] = 'wall';
      }
    }

    // 5. Force exit tiles and clear adjacent
    for (const exit of exits) {
      grid[exit.position.y][exit.position.x] = 'exit';
      const adjacents = [
        { x: exit.position.x - 1, y: exit.position.y },
        { x: exit.position.x + 1, y: exit.position.y },
        { x: exit.position.x, y: exit.position.y - 1 },
        { x: exit.position.x, y: exit.position.y + 1 },
      ];
      for (const adj of adjacents) {
        if (adj.x > 0 && adj.x < width - 1 && adj.y > 0 && adj.y < height - 1) {
          if (!TILE_PROPERTIES[grid[adj.y][adj.x]].walkable) {
            grid[adj.y][adj.x] = 'floor';
          }
        }
      }
    }

    // 6. Ensure connectivity between exits
    if (exits.length > 1) {
      this.ensureConnectivity(grid, exits.map(e => e.position), width, height);
    }

    // 7. Scatter hazards and water on floor tiles
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
        if (!TILE_PROPERTIES[grid[ny][nx]].walkable) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }

    for (let i = 1; i < exitPositions.length; i++) {
      const key = `${exitPositions[i].x},${exitPositions[i].y}`;
      if (visited.has(key)) continue;

      // Carve bridge/floor corridor from unreachable exit to first exit
      const from = exitPositions[i];
      const to = exitPositions[0];

      const xDir = to.x > from.x ? 1 : -1;
      let cx = from.x;
      while (cx !== to.x) {
        cx += xDir;
        if (cx > 0 && cx < width - 1) {
          if (grid[from.y][cx] === 'chasm') {
            grid[from.y][cx] = 'bridge';
          } else if (grid[from.y][cx] === 'wall') {
            grid[from.y][cx] = 'floor';
          }
        }
      }
      const yDir = to.y > from.y ? 1 : -1;
      let cy = from.y;
      while (cy !== to.y) {
        cy += yDir;
        if (cy > 0 && cy < height - 1) {
          if (grid[cy][to.x] === 'chasm') {
            grid[cy][to.x] = 'bridge';
          } else if (grid[cy][to.x] === 'wall') {
            grid[cy][to.x] = 'floor';
          }
        }
      }
    }
  }
}
