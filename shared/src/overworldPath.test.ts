import { describe, it, expect } from 'vitest';
import { findOverworldPath } from './overworldPath.js';
import type { OverworldMap, TileKind } from './overworld.js';

function makeMap(rows: string[]): OverworldMap {
  const legend: Record<string, TileKind> = {
    '.': 'grass',
    '#': 'wall',
    '~': 'water',
  };
  const tiles = rows.map((r) => [...r].map((c) => legend[c]));
  return {
    id: 'test',
    name: 'test',
    width: rows[0].length,
    height: rows.length,
    tiles,
    spawnTile: { x: 0, y: 0 },
    regions: [],
    portals: [],
    interactables: [],
  };
}

describe('findOverworldPath', () => {
  it('returns [] when start === end', () => {
    const map = makeMap(['...', '...', '...']);
    expect(findOverworldPath(map, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it('returns a straight-line path across open tiles', () => {
    const map = makeMap(['.....']);
    const path = findOverworldPath(map, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('routes around a wall', () => {
    const map = makeMap([
      '.....',
      '.###.',
      '.....',
    ]);
    const path = findOverworldPath(map, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(4);
    // Verify it never steps on a wall.
    for (const step of path!) {
      expect(map.tiles[step.y][step.x]).not.toBe('wall');
    }
    // Verify contiguity.
    let prev = { x: 0, y: 1 };
    for (const step of path!) {
      const dx = Math.abs(step.x - prev.x);
      const dy = Math.abs(step.y - prev.y);
      expect(dx + dy).toBe(1);
      prev = step;
    }
    expect(prev).toEqual({ x: 4, y: 1 });
  });

  it('returns null when the target is fully enclosed', () => {
    const map = makeMap([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    expect(findOverworldPath(map, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null for out-of-bounds target', () => {
    const map = makeMap(['...', '...', '...']);
    expect(findOverworldPath(map, { x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull();
    expect(findOverworldPath(map, { x: 0, y: 0 }, { x: -1, y: 0 })).toBeNull();
  });

  it('returns null when target is a wall', () => {
    const map = makeMap(['.#.', '.#.', '.#.']);
    expect(findOverworldPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('returns null when target is water', () => {
    const map = makeMap(['.~.', '...', '...']);
    expect(findOverworldPath(map, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});
