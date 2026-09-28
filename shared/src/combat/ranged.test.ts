import { describe, it, expect } from 'vitest';
import { RANGED_CONFIG, GUN_TYPES, chebyshev, effectiveRange, hitChance, hasLineOfSight } from './ranged.js';

const open = (w: number, h: number) => ({ width: w, height: h, tiles: Array.from({ length: h }, () => Array(w).fill('floor')) });

describe('ranged maths', () => {
  it('chebyshev distance', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
  it('effective range adds rangePerMarksmanship per point', () => {
    expect(effectiveRange(2, 0)).toBe(2);
    expect(effectiveRange(2, 3)).toBe(2 + 3 * RANGED_CONFIG.rangePerMarksmanship);
  });
  it('hit chance: base + marksmanship, falloff only beyond falloffStart', () => {
    const c = RANGED_CONFIG;
    expect(hitChance(c.falloffStart, 0)).toBeCloseTo(c.baseHit);
    expect(hitChance(1, 0)).toBeCloseTo(c.baseHit);
    expect(hitChance(c.falloffStart + 2, 1)).toBeCloseTo(c.baseHit + c.hitPerMarksmanship - 2 * c.falloffPerTile);
  });
  it('hit chance is clamped to [minHit, maxHit]', () => {
    expect(hitChance(1, 100)).toBe(RANGED_CONFIG.maxHit);
    expect(hitChance(100, 0)).toBe(RANGED_CONFIG.minHit);
  });
  it('every gun type has positive range, magazine and damageMult', () => {
    expect(Object.keys(GUN_TYPES).length).toBeGreaterThan(0);
    for (const [id, g] of Object.entries(GUN_TYPES)) {
      expect(g.range, id).toBeGreaterThan(0);
      expect(g.magazine, id).toBeGreaterThan(0);
      expect(g.damageMult, id).toBeGreaterThan(0);
    }
  });
});

describe('hasLineOfSight', () => {
  it('clear line within range', () => {
    expect(hasLineOfSight(open(8, 8), { x: 1, y: 1 }, { x: 5, y: 3 }, 4)).toBe(true);
  });
  it('out of range (chebyshev)', () => {
    expect(hasLineOfSight(open(8, 8), { x: 1, y: 1 }, { x: 6, y: 1 }, 4)).toBe(false);
  });
  it('wall and chasm block, but end tiles are not checked', () => {
    const g = open(8, 3);
    g.tiles[1][3] = 'wall';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
    g.tiles[1][3] = 'chasm';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
    g.tiles[1][3] = 'floor'; g.tiles[1][5] = 'wall';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(true);
  });
});
