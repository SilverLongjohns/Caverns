import { describe, it, expect } from 'vitest';
import { hitChance } from '@caverns/shared';
import { shotTargets, shotRangeTiles } from './shotTargets.js';

const grid = { width: 8, height: 3, tiles: Array.from({ length: 3 }, () => Array(8).fill('floor')) };
describe('shotTargets', () => {
  it('maps in-range, in-LoS enemies to their hit chance', () => {
    const m = shotTargets(grid, { x: 0, y: 1 }, 3, 2, [{ id: 'a', pos: { x: 3, y: 1 } }, { id: 'b', pos: { x: 6, y: 1 } }]);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toBeCloseTo(hitChance(3, 2));
  });
  it('excludes blocked targets', () => {
    const g = { ...grid, tiles: grid.tiles.map((r) => [...r]) }; g.tiles[1][1] = 'wall';
    expect(shotTargets(g, { x: 0, y: 1 }, 5, 2, [{ id: 'a', pos: { x: 3, y: 1 } }]).size).toBe(0);
  });
});

describe('shotRangeTiles', () => {
  it('includes floor tiles within range and excludes the shooter\'s own tile', () => {
    const s = shotRangeTiles(grid, { x: 0, y: 1 }, 3);
    expect(s.has('0,1')).toBe(false); // own tile
    expect(s.has('3,1')).toBe(true); // exactly at range, same row
    expect(s.has('1,0')).toBe(true); // within range, diagonal-ish
  });
  it('excludes tiles beyond range', () => {
    const s = shotRangeTiles(grid, { x: 0, y: 1 }, 3);
    expect(s.has('4,1')).toBe(false);
  });
  it('excludes tiles blocked by a wall (no line of sight)', () => {
    const g = { ...grid, tiles: grid.tiles.map((r) => [...r]) }; g.tiles[1][1] = 'wall';
    const s = shotRangeTiles(g, { x: 0, y: 1 }, 5);
    expect(s.has('3,1')).toBe(false); // behind the wall on the same row
  });
  it('excludes wall and chasm tiles themselves even when reachable', () => {
    const g = { ...grid, tiles: grid.tiles.map((r) => [...r]) };
    g.tiles[1][2] = 'wall';
    g.tiles[1][3] = 'chasm';
    const s = shotRangeTiles(g, { x: 0, y: 1 }, 5);
    expect(s.has('2,1')).toBe(false);
    expect(s.has('3,1')).toBe(false);
  });
});
