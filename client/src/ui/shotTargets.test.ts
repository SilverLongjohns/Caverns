import { describe, it, expect } from 'vitest';
import { hitChance } from '@caverns/shared';
import { shotTargets } from './shotTargets.js';

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
