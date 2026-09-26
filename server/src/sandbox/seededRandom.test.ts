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

  it('supports overlapping installs restored out of order', () => {
    const original = Math.random;

    // Reference sequence for seed 22, drawn in isolation.
    const refRestore = installSeededRandom(22);
    const reference = [Math.random(), Math.random(), Math.random()];
    refRestore();

    const restoreA = installSeededRandom(11);
    Math.random(); // A's own draw; must not affect B's sequence below

    const restoreB = installSeededRandom(22);
    const bFirst = Math.random();
    const bSecond = Math.random();
    expect(bFirst).toBe(reference[0]);
    expect(bSecond).toBe(reference[1]);

    // Closing the OLDER install (A) first must not disturb B's generator or restore
    // the real Math.random early — B is still live and still follows its own sequence.
    restoreA();
    expect(Math.random()).toBe(reference[2]);

    // Closing B (the last live install) falls all the way back to the true original.
    restoreB();
    expect(Math.random).toBe(original);
  });

  it('double restore is a no-op', () => {
    const original = Math.random;
    const restoreA = installSeededRandom(1);
    const restoreB = installSeededRandom(2);
    restoreA();
    restoreA(); // no-op; must not touch B or the stack twice
    const midway = Math.random;
    restoreB();
    expect(Math.random).toBe(original);
    // Calling A's restore again after everything is torn down is also a no-op.
    restoreA();
    expect(Math.random).toBe(original);
    void midway;
  });
});
