// server/src/arenaGridBuilder.ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { TileGrid } from '@caverns/shared';
import { generateRoom, TILE_PROPERTIES } from '@caverns/roomgrid';
import type { BiomeGenerationConfig, TileType } from '@caverns/roomgrid';
import { ROOM_DIMENSIONS } from './tileGridBuilder.js';
import { getMovementCost } from './arenaMovement.js';

const __filename_arena = fileURLToPath(import.meta.url);
const __dirname_arena = dirname(__filename_arena);

let biomeConfigs: BiomeGenerationConfig[];
try {
  const configPath = resolve(__dirname_arena, '../../roomgrid/src/data/biomeGeneration.json');
  biomeConfigs = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  throw new Error(`Failed to load biomeGeneration.json: ${(e as Error).message}`);
}

const DEFAULT_DIMENSIONS = ROOM_DIMENSIONS.chamber;

const MAX_ARENA_RETRIES = 10;

/**
 * Find the largest connected walkable region in the grid.
 * Returns the set of "x,y" keys in that region.
 */
function largestWalkableRegion(tiles: string[][], width: number, height: number): Set<string> {
  const visited = new Set<string>();
  let largest = new Set<string>();

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      if (getMovementCost(tiles[y][x]) === Infinity) continue;

      // Flood fill this region
      const region = new Set<string>();
      const queue = [{ x, y }];
      region.add(key);
      visited.add(key);

      while (queue.length > 0) {
        const pos = queue.shift()!;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = pos.x + dx;
          const ny = pos.y + dy;
          if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
          const nk = `${nx},${ny}`;
          if (visited.has(nk)) continue;
          if (getMovementCost(tiles[ny][nx]) === Infinity) continue;
          visited.add(nk);
          region.add(nk);
          queue.push({ x: nx, y: ny });
        }
      }

      if (region.size > largest.size) largest = region;
    }
  }
  return largest;
}

/**
 * Check whether both the player spawn zone (columns 1-3) and mob spawn zone
 * (last 3 interior columns) have walkable tiles in the largest connected region.
 */
function hasValidSpawnZones(
  largest: Set<string>,
  width: number,
  height: number,
): boolean {
  let hasPlayerSpawn = false;
  let hasMobSpawn = false;
  const mobMinX = width - 4;
  const mobMaxX = width - 2;

  for (const key of largest) {
    const [x, y] = key.split(',').map(Number);
    if (y < 1 || y >= height - 1) continue;
    if (x >= 1 && x <= 3) hasPlayerSpawn = true;
    if (x >= mobMinX && x <= mobMaxX) hasMobSpawn = true;
    if (hasPlayerSpawn && hasMobSpawn) return true;
  }
  return false;
}

export function buildArenaGrid(roomType: string, biomeId: string): TileGrid {
  const dims = ROOM_DIMENSIONS[roomType] ?? DEFAULT_DIMENSIONS;
  const { width, height } = dims;

  let biomeConfig = biomeConfigs.find(b => b.biomeId === biomeId);
  if (!biomeConfig) {
    biomeConfig = biomeConfigs.find(b => b.biomeId === 'starter')!;
  }

  let tiles: string[][] = [];

  for (let attempt = 0; attempt < MAX_ARENA_RETRIES; attempt++) {
    // No exits — arena is sealed
    const config = generateRoom({
      width,
      height,
      exits: [],
      biomeConfig,
      roomType,
    });

    // Replace any exit tiles with floor (safety net)
    tiles = config.tiles.map(row =>
      row.map(tile => tile === 'exit' ? 'floor' : tile)
    );

    // Validate: the largest walkable region must span both spawn zones
    const largest = largestWalkableRegion(tiles, width, height);
    if (hasValidSpawnZones(largest, width, height)) {
      // Convert any disconnected walkable tiles to walls so the arena looks clean
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const key = `${x},${y}`;
          if (getMovementCost(tiles[y][x]) !== Infinity && !largest.has(key)) {
            tiles[y][x] = 'wall';
          }
        }
      }
      break;
    }
  }

  // Apply biome themes
  const tileThemes = biomeConfig.tileThemes;
  const hasThemes = Object.keys(tileThemes).length > 0;
  let themes: (string | null)[][] | undefined;

  if (hasThemes) {
    themes = tiles.map(row =>
      row.map(tileType => (tileThemes as Record<string, string>)[tileType] ?? null)
    );
  }

  return { width, height, tiles, themes };
}

/**
 * BFS flood fill to find all walkable tiles reachable from a starting position.
 * Used to ensure placed positions are connected.
 */
function floodFillWalkable(grid: TileGrid, start: { x: number; y: number }): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (getMovementCost(grid.tiles[ny][nx]) === Infinity) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return visited;
}

export function placeStartingPositions(
  grid: TileGrid,
  playerIds: string[],
  mobIds: string[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const occupied = new Set<string>();
  let reachable: Set<string> | null = null;

  function findWalkable(minX: number, maxX: number, ids: string[]): void {
    const candidates: { x: number; y: number }[] = [];
    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = grid.tiles[y][x] as TileType;
        if (TILE_PROPERTIES[tile]?.walkable && tile !== 'hazard') {
          candidates.push({ x, y });
        }
      }
    }
    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const id of ids) {
      const pos = candidates.find(c => {
        const key = `${c.x},${c.y}`;
        if (occupied.has(key)) return false;
        // First placement: seed the reachable set from this position
        if (!reachable) {
          reachable = floodFillWalkable(grid, c);
          return true;
        }
        // Subsequent placements: must be in the same connected region
        return reachable.has(key);
      });
      if (pos) {
        positions[id] = pos;
        occupied.add(`${pos.x},${pos.y}`);
      }
    }
  }

  // Players: columns 1-3 (skip border wall at 0)
  findWalkable(1, 3, playerIds);
  // Mobs: last 3 interior columns
  findWalkable(grid.width - 4, grid.width - 2, mobIds);

  return positions;
}
