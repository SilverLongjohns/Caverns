import { describe, it, expect } from 'vitest';
import { bresenhamLine, hasLineOfSight, getVisibleTiles } from '../src/lineOfSight.js';
import type { Tile } from '../src/types.js';

// Helper: build a tile grid from a string map
// '.' = floor, '#' = wall, 'E' = exit
function buildTiles(map: string[]): Tile[][] {
  return map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return { type: 'wall' as const };
      if (ch === 'E') return { type: 'exit' as const };
      return { type: 'floor' as const };
    })
  );
}

describe('bresenhamLine', () => {
  it('returns single point for same start and end', () => {
    const line = bresenhamLine({ x: 3, y: 3 }, { x: 3, y: 3 });
    expect(line).toEqual([{ x: 3, y: 3 }]);
  });

  it('traces a horizontal line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 4, y: 0 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('traces a vertical line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 0, y: 3 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
  });

  it('traces a diagonal line', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('traces a steep line (dy > dx)', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 1, y: 3 });
    expect(line).toHaveLength(4);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 1, y: 3 });
  });

  it('traces a line in negative direction', () => {
    const line = bresenhamLine({ x: 3, y: 3 }, { x: 0, y: 0 });
    expect(line[0]).toEqual({ x: 3, y: 3 });
    expect(line[line.length - 1]).toEqual({ x: 0, y: 0 });
    expect(line).toHaveLength(4);
  });
});

describe('hasLineOfSight', () => {
  it('returns true with clear line of sight', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
  });

  it('returns false when wall blocks line of sight', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it('returns true for adjacent tiles even near walls', () => {
    const tiles = buildTiles([
      '.....',
      '.#...',
      '.....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(true);
  });

  it('returns true for same position', () => {
    const tiles = buildTiles(['.']);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it('blocks LOS through diagonal wall corner', () => {
    const tiles = buildTiles([
      '...',
      '.#.',
      '...',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it('blocks LOS through diagonal gap between two walls', () => {
    // Walls at (1,0) and (0,1) form a diagonal corner
    // LOS from (0,0) to (2,2) should be blocked even though (1,1) is floor
    const tiles = buildTiles([
      '.#..',
      '#...',
      '....',
      '....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it('allows LOS through diagonal when only one adjacent wall', () => {
    // Wall at (1,0) only — not a full corner
    const tiles = buildTiles([
      '.#..',
      '....',
      '....',
      '....',
    ]);
    expect(hasLineOfSight(tiles, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });
});

describe('getVisibleTiles', () => {
  it('returns all tiles in range in an open room', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    const visible = getVisibleTiles(tiles, { x: 2, y: 2 }, 1);
    // Euclidean distance range 1 = center + 4 cardinal (diagonals are ~1.41, excluded)
    expect(visible).toHaveLength(5);
  });

  it('excludes tiles behind walls', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.###.',
      '.....',
      '.....',
    ]);
    const visible = getVisibleTiles(tiles, { x: 2, y: 0 }, 4);
    const belowWall = visible.filter(p => p.y > 2);
    expect(belowWall).toHaveLength(0);
  });

  it('does not include out-of-bounds tiles', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const visible = getVisibleTiles(tiles, { x: 0, y: 0 }, 5);
    for (const p of visible) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(3);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(3);
    }
  });

  it('uses Euclidean distance for range (circular shape)', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    const visible = getVisibleTiles(tiles, { x: 2, y: 2 }, 2);
    // Euclidean range 2: diagonal (1,1) = ~1.41, included
    const hasDiagonal = visible.some(p => p.x === 3 && p.y === 3);
    expect(hasDiagonal).toBe(true);
    // But (2,2) away = ~2.83, excluded
    const hasFarCorner = visible.some(p => p.x === 4 && p.y === 4);
    expect(hasFarCorner).toBe(false);
  });
});
