import { describe, it, expect } from 'vitest';
import { pickTake, SfxLimiter } from './sfxRules.js';

describe('pickTake', () => {
  it('returns 0 for a single take', () => {
    expect(pickTake(1, 0)).toBe(0);
    expect(pickTake(1, undefined)).toBe(0);
  });
  it('never repeats the previous take', () => {
    for (let last = 0; last < 4; last++) {
      for (const r of [0, 0.3, 0.6, 0.999]) {
        const i = pickTake(4, last, () => r);
        expect(i).not.toBe(last);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(4);
      }
    }
  });
  it('can pick any take on the first play', () => {
    expect(pickTake(4, undefined, () => 0)).toBe(0);
    expect(pickTake(4, undefined, () => 0.999)).toBe(3);
  });
});

describe('SfxLimiter', () => {
  it('enforces the minimum gap per id', () => {
    const l = new SfxLimiter();
    expect(l.tryStart('step', 0, 100, 3)).toBe(true);
    expect(l.tryStart('step', 50, 100, 3)).toBe(false);
    expect(l.tryStart('gold', 50, 100, 3)).toBe(true);
    expect(l.tryStart('step', 100, 100, 3)).toBe(true);
  });
  it('caps concurrent voices and frees them on end', () => {
    const l = new SfxLimiter();
    expect(l.tryStart('hit', 0, 0, 2)).toBe(true);
    expect(l.tryStart('hit', 1, 0, 2)).toBe(true);
    expect(l.tryStart('hit', 2, 0, 2)).toBe(false);
    l.end('hit');
    expect(l.tryStart('hit', 3, 0, 2)).toBe(true);
  });
  it('never goes below zero voices', () => {
    const l = new SfxLimiter();
    l.end('x'); l.end('x');
    expect(l.tryStart('x', 0, 0, 1)).toBe(true);
    expect(l.tryStart('x', 1, 0, 1)).toBe(false);
  });
});
