import { describe, it, expect } from 'vitest';
import { classifyTiles, placeFurnishings } from './furnishingPlacer.js';
import type { Furnishing } from '@caverns/shared';

// Helper: build a simple tile grid
// '#' = wall, '.' = floor, 'E' = exit, '~' = water
function buildTiles(map: string[]): string[][] {
  return map.map(row => [...row].map(ch => {
    if (ch === '#') return 'wall';
    if (ch === 'E') return 'exit';
    if (ch === '~') return 'water';
    return 'floor';
  }));
}

describe('classifyTiles', () => {
  it('classifies wall-adjacent floor tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 5, new Set());
    expect(buckets.wall.length).toBeGreaterThan(0);
    const centerInWall = buckets.wall.some(p => p.x === 2 && p.y === 2);
    expect(centerInWall).toBe(false);
    const centerInCenter = buckets.center.some(p => p.x === 2 && p.y === 2);
    expect(centerInCenter).toBe(true);
  });

  it('classifies corner tiles (2+ orthogonal walls sharing a diagonal)', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 5, new Set());
    const cornerFound = buckets.corner.some(p => p.x === 1 && p.y === 1);
    expect(cornerFound).toBe(true);
    const midTopIsCorner = buckets.corner.some(p => p.x === 2 && p.y === 1);
    expect(midTopIsCorner).toBe(false);
  });

  it('classifies near-water tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#.~.#',
      '#...#',
      '#####',
    ]);
    const buckets = classifyTiles(tiles, 5, 4, new Set());
    const nearWater = buckets.nearWater.some(p => p.x === 1 && p.y === 1);
    expect(nearWater).toBe(true);
  });

  it('excludes exit tiles and occupied positions', () => {
    const tiles = buildTiles([
      '##E##',
      '#...#',
      '#...#',
      '#####',
    ]);
    const occupied = new Set(['1,1']);
    const buckets = classifyTiles(tiles, 5, 4, occupied);
    const exitInAny = buckets.anywhere.some(p => p.x === 2 && p.y === 0);
    expect(exitInAny).toBe(false);
    const occInAny = buckets.anywhere.some(p => p.x === 1 && p.y === 1);
    expect(occInAny).toBe(false);
  });
});

describe('placeFurnishings', () => {
  it('returns empty array when no furniture matches room type', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ]);
    const result = placeFurnishings(tiles, 5, 4, 'tunnel', 'nonexistent_biome', new Set());
    expect(result.furnishings).toEqual([]);
    expect(result.interactableInstances).toEqual([]);
  });

  it('places furnishings within count limits', () => {
    const tiles = buildTiles([
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '##########',
    ]);
    const result = placeFurnishings(tiles, 10, 8, 'chamber', 'starter', new Set());
    expect(result.furnishings.length).toBeGreaterThanOrEqual(4);
    expect(result.furnishings.length).toBeLessThanOrEqual(7);
  });

  it('does not place furnishings on occupied tiles', () => {
    const tiles = buildTiles([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const occupied = new Set(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3', '3,3']);
    const result = placeFurnishings(tiles, 5, 5, 'chamber', 'starter', occupied);
    expect(result.furnishings).toEqual([]);
  });

  it('creates interactable instances for interactive furniture', () => {
    const tiles = buildTiles([
      '###############',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '###############',
    ]);
    let foundInteractable = false;
    for (let i = 0; i < 20; i++) {
      const result = placeFurnishings(tiles, 15, 14, 'chamber', 'starter', new Set());
      if (result.interactableInstances.length > 0) {
        foundInteractable = true;
        for (const inst of result.interactableInstances) {
          expect(inst.position.x).toBeGreaterThanOrEqual(0);
          expect(inst.position.y).toBeGreaterThanOrEqual(0);
          expect(inst.definitionId).toMatch(/^furn_/);
          expect(inst.usedActions).toEqual({});
        }
        break;
      }
    }
    expect(foundInteractable).toBe(true);
  });

  it('places wall-constrained furniture adjacent to walls', () => {
    const tiles = buildTiles([
      '###############',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '#.............#',
      '###############',
    ]);
    for (let i = 0; i < 10; i++) {
      const result = placeFurnishings(tiles, 15, 14, 'chamber', 'starter', new Set());
      for (const f of result.furnishings) {
        expect(tiles[f.y][f.x]).toBe('floor');
      }
    }
  });
});
