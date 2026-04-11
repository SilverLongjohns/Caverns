import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Room, Direction, TileGrid } from '@caverns/shared';
import { generateRoom } from '@caverns/roomgrid';
import type { BiomeGenerationConfig } from '@caverns/roomgrid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let biomeConfigs: BiomeGenerationConfig[];
try {
  const configPath = resolve(__dirname, '../../roomgrid/src/data/biomeGeneration.json');
  biomeConfigs = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  throw new Error(`Failed to load biomeGeneration.json: ${(e as Error).message}`);
}

export const ROOM_DIMENSIONS: Record<string, { width: number; height: number }> = {
  tunnel:   { width: 30, height: 8 },
  chamber:  { width: 30, height: 15 },
  cavern:   { width: 40, height: 18 },
  dead_end: { width: 20, height: 12 },
  boss:     { width: 45, height: 20 },
};

const DEFAULT_DIMENSIONS = ROOM_DIMENSIONS.chamber;

export function exitPosition(dir: Direction, w: number, h: number): { x: number; y: number } {
  switch (dir) {
    case 'north': return { x: Math.floor(w / 2), y: 0 };
    case 'south': return { x: Math.floor(w / 2), y: h - 1 };
    case 'west':  return { x: 0, y: Math.floor(h / 2) };
    case 'east':  return { x: w - 1, y: Math.floor(h / 2) };
  }
}

function placeTorches(
  tiles: string[][],
  themes: (string | null)[][] | undefined,
  width: number,
  height: number,
  roomType: string
): (string | null)[][] {
  // Ensure themes array exists
  const out = themes
    ? themes.map((row) => [...row])
    : tiles.map((row) => row.map(() => null));

  // Determine torch count by room type
  const maxTorches: Record<string, number> = {
    tunnel: 1,
    chamber: 2,
    cavern: 2,
    dead_end: 1,
    boss: 3,
  };
  const count = maxTorches[roomType] ?? 1;

  // 50% chance the room has no torches at all
  if (Math.random() < 0.5) return out;

  // Find eligible wall tiles: wall tiles orthogonally adjacent to at least one floor tile
  const eligible: { x: number; y: number }[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== 'wall') continue;
      const hasFloorNeighbor =
        tiles[y - 1]?.[x] === 'floor' ||
        tiles[y + 1]?.[x] === 'floor' ||
        tiles[y][x - 1] === 'floor' ||
        tiles[y][x + 1] === 'floor';
      if (hasFloorNeighbor) eligible.push({ x, y });
    }
  }

  if (eligible.length === 0) return out;

  // Shuffle and pick up to count
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  const placed = Math.min(count, eligible.length);
  for (let i = 0; i < placed; i++) {
    const { x, y } = eligible[i];
    out[y][x] = 'torch';
  }

  return out;
}

export function buildTileGrid(room: Room, biomeId: string): TileGrid {
  const dims = ROOM_DIMENSIONS[room.type] ?? DEFAULT_DIMENSIONS;
  const { width, height } = dims;

  let biomeConfig = biomeConfigs.find(b => b.biomeId === biomeId);
  if (!biomeConfig) {
    biomeConfig = biomeConfigs.find(b => b.biomeId === 'starter')!;
  }

  // Include both regular and locked exits — locked doors still exist physically
  const allExits = { ...room.lockedExits, ...room.exits };
  const exits = Object.entries(allExits)
    .filter(([, targetId]) => targetId != null)
    .map(([dir, targetId]) => {
      const direction = dir as Direction;
      const position = exitPosition(direction, width, height);
      return {
        position,
        data: { direction, targetRoomId: targetId! },
      };
    });

  const config = generateRoom({
    width,
    height,
    exits,
    biomeConfig,
    roomType: room.type,
  });

  const tileThemes = biomeConfig.tileThemes;
  const hasThemes = Object.keys(tileThemes).length > 0;
  let themes: (string | null)[][] | undefined;

  if (hasThemes) {
    themes = config.tiles.map((row: string[]) =>
      row.map((tileType: string) => (tileThemes as Record<string, string>)[tileType] ?? null)
    );
  }

  const finalThemes = placeTorches(config.tiles as string[][], themes ?? undefined, width, height, room.type);

  return {
    width,
    height,
    tiles: config.tiles as string[][],
    themes: finalThemes,
  };
}
