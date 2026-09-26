import { describe, it, expect } from 'vitest';
import { installSeededRandom } from './seededRandom.js';

describe('installSeededRandom', () => {
  it('produces the same sequence for the same seed and restores the original', () => {
    const original = Math.random;
    const restoreA = installSeededRandom(42);
    const a = [Math.random(), Math.random(), Math.random()];
    restoreA();
    expect(Math.random).toBe(original);

    const restoreB = installSeededRandom(42);
    const b = [Math.random(), Math.random(), Math.random()];
    restoreB();
    expect(b).toEqual(a);
  });

  it('gives different sequences for different seeds and stays in [0, 1)', () => {
    const r1 = installSeededRandom(1);
    const a = Array.from({ length: 100 }, () => Math.random());
    r1();
    const r2 = installSeededRandom(2);
    const b = Array.from({ length: 100 }, () => Math.random());
    r2();
    expect(a).not.toEqual(b);
    expect(a.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
