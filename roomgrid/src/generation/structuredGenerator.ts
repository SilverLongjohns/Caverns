import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';
import { placeWater } from './waterPlacer.js';
import { clearExits } from './exitClearance.js';

interface SubRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class StructuredGenerator implements RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig {
    const { width, height, exits, biomeConfig } = request;
    const params = biomeConfig.params;
    const subRoomCount = params.subRoomCount ?? 3;
    const corridorWidth = params.corridorWidth ?? 1;
    const featureChance = params.featureChance ?? 0.3;
    const hazardChance = params.hazardChance ?? 0;


    // 1. Fill with walls
    const grid: TileType[][] = Array.from({ length: height }, () =>
      Array<TileType>(width).fill('wall')
    );

    // 2. Place sub-rooms
    const subRooms: SubRoom[] = [];
    const minRoomW = Math.max(4, Math.floor(width / 5));
    const maxRoomW = Math.floor(width / 3);
    const minRoomH = Math.max(4, Math.floor(height / 5));
    const maxRoomH = Math.floor(height / 3);

    for (let i = 0; i < subRoomCount * 10 && subRooms.length < subRoomCount; i++) {
      const w = minRoomW + Math.floor(Math.random() * (maxRoomW - minRoomW + 1));
      const h = minRoomH + Math.floor(Math.random() * (maxRoomH - minRoomH + 1));
      const x = 1 + Math.floor(Math.random() * (width - w - 2));
      const y = 1 + Math.floor(Math.random() * (height - h - 2));

      // Check overlap with existing sub-rooms (1 tile padding)
      const overlaps = subRooms.some(r =>
        x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y
      );
      if (overlaps) continue;

      subRooms.push({ x, y, w, h });

      // Carve floor
      for (let ry = y; ry < y + h; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          grid[ry][rx] = 'floor';
        }
      }

      // Features: pillars
      if (Math.random() < featureChance && w >= 6 && h >= 6) {
        // Place 2x2 pillars at regular intervals
        for (let py = y + 2; py < y + h - 2; py += 3) {
          for (let px = x + 2; px < x + w - 2; px += 3) {
            grid[py][px] = 'wall';
            if (px + 1 < x + w - 1) grid[py][px + 1] = 'wall';
            if (py + 1 < y + h - 1) grid[py + 1][px] = 'wall';
            if (px + 1 < x + w - 1 && py + 1 < y + h - 1) grid[py + 1][px + 1] = 'wall';
          }
        }
      }
    }

    // 3. Connect sub-rooms with L-shaped corridors
    for (let i = 1; i < subRooms.length; i++) {
      const a = subRooms[i - 1];
      const b = subRooms[i];
      const ax = Math.floor(a.x + a.w / 2);
      const ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2);
      const by = Math.floor(b.y + b.h / 2);

      // Horizontal segment
      const xDir = bx > ax ? 1 : -1;
      for (let x = ax; x !== bx; x += xDir) {
        for (let cw = 0; cw < corridorWidth; cw++) {
          const cy = ay + cw;
          if (cy > 0 && cy < height - 1 && x > 0 && x < width - 1) {
            if (grid[cy][x] === 'wall') grid[cy][x] = 'floor';
          }
        }
      }

      // Vertical segment
      const yDir = by > ay ? 1 : -1;
      for (let y = ay; y !== by; y += yDir) {
        for (let cw = 0; cw < corridorWidth; cw++) {
          const cx = bx + cw;
          if (cx > 0 && cx < width - 1 && y > 0 && y < height - 1) {
            if (grid[y][cx] === 'wall') grid[y][cx] = 'floor';
          }
        }
      }
    }

    // 4. Force exit tiles and clear corridor inward from each exit
    clearExits(grid, exits, width, height);

    // 5. Connect exits to nearest sub-room, or directly to each other if no sub-rooms placed
    if (exits.length > 1 && subRooms.length === 0) {
      // No sub-rooms — carve direct L-shaped corridor between exits
      const from = exits[0].position;
      const to = exits[exits.length - 1].position;
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
    } else if (exits.length > 0 && subRooms.length > 0) {
      for (const exit of exits) {
        // Find nearest sub-room center
        let nearest = subRooms[0];
        let bestDist = Infinity;
        for (const room of subRooms) {
          const cx = room.x + Math.floor(room.w / 2);
          const cy = room.y + Math.floor(room.h / 2);
          const dist = Math.abs(cx - exit.position.x) + Math.abs(cy - exit.position.y);
          if (dist < bestDist) {
            bestDist = dist;
            nearest = room;
          }
        }

        // Carve corridor from exit to nearest room center
        const tx = Math.floor(nearest.x + nearest.w / 2);
        const ty = Math.floor(nearest.y + nearest.h / 2);
        const xDir = tx > exit.position.x ? 1 : -1;
        let cx = exit.position.x;
        while (cx !== tx) {
          cx += xDir;
          if (cx > 0 && cx < width - 1 && grid[exit.position.y][cx] === 'wall') {
            grid[exit.position.y][cx] = 'floor';
          }
        }
        const yDir = ty > exit.position.y ? 1 : -1;
        let cy = exit.position.y;
        while (cy !== ty) {
          cy += yDir;
          if (cy > 0 && cy < height - 1 && grid[cy][tx] === 'wall') {
            grid[cy][tx] = 'floor';
          }
        }
      }
    }

    // 6. Scatter hazards
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 'floor') continue;
        if (Math.random() < hazardChance) {
          grid[y][x] = 'hazard';
        }
      }
    }

    // 7. Place water features
    placeWater(grid, params);

    return {
      width,
      height,
      tiles: grid,
      exits: exits.map(e => ({ position: e.position, data: e.data })),
    };
  }
}
