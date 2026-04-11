import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Furnishing, InteractableInstance } from '@caverns/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FurnishingDef {
  id: string;
  name: string;
  asciiChar: string;
  placement: 'wall' | 'center' | 'corner' | 'near-water' | 'anywhere';
  roomTypes: string[];
  biomes: string[];
  interactable: boolean;
  weight: number;
}

let furnishingDefs: FurnishingDef[];
try {
  const dataPath = resolve(__dirname, './data/furnishingData.json');
  furnishingDefs = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch {
  furnishingDefs = [];
}

interface Position {
  x: number;
  y: number;
}

export interface TileBuckets {
  wall: Position[];
  center: Position[];
  corner: Position[];
  nearWater: Position[];
  anywhere: Position[];
}

const FURNITURE_COUNTS: Record<string, { min: number; max: number }> = {
  tunnel:   { min: 1, max: 3 },
  chamber:  { min: 4, max: 7 },
  cavern:   { min: 6, max: 12 },
  dead_end: { min: 2, max: 4 },
  boss:     { min: 8, max: 15 },
};

export function classifyTiles(
  tiles: string[][],
  width: number,
  height: number,
  occupied: Set<string>,
): TileBuckets {
  const buckets: TileBuckets = {
    wall: [],
    center: [],
    corner: [],
    nearWater: [],
    anywhere: [],
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== 'floor') continue;
      if (occupied.has(`${x},${y}`)) continue;

      const pos: Position = { x, y };

      const neighbors = [
        { nx: x, ny: y - 1, dir: 'n' },
        { nx: x, ny: y + 1, dir: 's' },
        { nx: x - 1, ny: y, dir: 'w' },
        { nx: x + 1, ny: y, dir: 'e' },
      ];

      let wallN = false, wallS = false, wallW = false, wallE = false;
      let waterCount = 0;

      for (const { nx, ny, dir } of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const t = tiles[ny][nx];
        if (t === 'wall') {
          if (dir === 'n') wallN = true;
          if (dir === 's') wallS = true;
          if (dir === 'w') wallW = true;
          if (dir === 'e') wallE = true;
        }
        if (t === 'water') waterCount++;
      }

      const wallCount = (wallN ? 1 : 0) + (wallS ? 1 : 0) + (wallW ? 1 : 0) + (wallE ? 1 : 0);

      // Corner: 2+ walls that share a diagonal (not opposite pairs like N+S or E+W)
      const isCorner = wallCount >= 2 && !(
        (wallN && wallS && !wallE && !wallW) ||
        (wallE && wallW && !wallN && !wallS)
      );

      if (isCorner) buckets.corner.push(pos);
      if (wallCount > 0) buckets.wall.push(pos);
      if (wallCount === 0) buckets.center.push(pos);
      if (waterCount > 0) buckets.nearWater.push(pos);
      buckets.anywhere.push(pos);
    }
  }

  return buckets;
}

function weightedPick(defs: FurnishingDef[]): FurnishingDef {
  const totalWeight = defs.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const def of defs) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1];
}

export interface PlaceFurnishingsResult {
  furnishings: Furnishing[];
  interactableInstances: InteractableInstance[];
}

export function placeFurnishings(
  tiles: string[][],
  width: number,
  height: number,
  roomType: string,
  biomeId: string,
  occupied: Set<string>,
): PlaceFurnishingsResult {
  // Filter definitions to those matching room type and biome
  const candidates = furnishingDefs.filter(
    d => d.roomTypes.includes(roomType) && d.biomes.includes(biomeId)
  );

  if (candidates.length === 0) {
    return { furnishings: [], interactableInstances: [] };
  }

  // Determine count
  const limits = FURNITURE_COUNTS[roomType] ?? { min: 2, max: 5 };
  const rawCount = Math.floor(width * height * 0.015);
  const count = Math.max(limits.min, Math.min(limits.max, rawCount));

  // Pre-compute position buckets
  const buckets = classifyTiles(tiles, width, height, occupied);

  // Track which positions have been used
  const usedPositions = new Set<string>();
  const usedInteractableIds = new Set<string>();
  const furnishings: Furnishing[] = [];
  const interactableInstances: InteractableInstance[] = [];
  let instanceCounter = 0;

  // Select and place furniture pieces
  for (let i = 0; i < count; i++) {
    // For interactable pieces, filter out already-used definitions
    const availableCandidates = candidates.filter(
      d => !d.interactable || !usedInteractableIds.has(d.id)
    );
    if (availableCandidates.length === 0) break;

    const def = weightedPick(availableCandidates);

    // Find matching bucket
    const bucketKey = def.placement === 'near-water' ? 'nearWater' : def.placement;
    const bucket = buckets[bucketKey as keyof TileBuckets];
    if (!bucket) continue;

    // Filter out already-used positions
    const available = bucket.filter(p => !usedPositions.has(`${p.x},${p.y}`));
    if (available.length === 0) continue;

    // Pick random position
    const pos = available[Math.floor(Math.random() * available.length)];
    usedPositions.add(`${pos.x},${pos.y}`);

    furnishings.push({
      x: pos.x,
      y: pos.y,
      char: def.asciiChar,
      name: def.name,
      interactable: def.interactable,
    });

    if (def.interactable) {
      usedInteractableIds.add(def.id);
      instanceCounter++;
      interactableInstances.push({
        definitionId: `furn_${def.id}`,
        instanceId: `furn_${String(instanceCounter).padStart(3, '0')}`,
        position: { x: pos.x, y: pos.y },
        usedActions: {},
      });
    }
  }

  return { furnishings, interactableInstances };
}
