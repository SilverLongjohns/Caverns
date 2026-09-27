import { describe, it, expect } from 'vitest';
import { fallDepth, stratumTop, stratumAtDepth, FIG_Y, DESCENT_T0 } from './descent.js';
import { STRATA } from '../timeline.js';

describe('descent depth model', () => {
  it('falls monotonically and accelerates', () => {
    expect(fallDepth(0)).toBe(0);
    expect(fallDepth(2) - fallDepth(1)).toBeLessThan(fallDepth(8) - fallDepth(7));
  });
  it('each stratum boundary passes the figure exactly on its braam mark', () => {
    for (let i = 1; i < STRATA.length; i++) {
      const u = STRATA[i].t0 - DESCENT_T0;
      expect(stratumAtDepth(fallDepth(u - 0.01) + FIG_Y)).toBe(i - 1);
      expect(stratumAtDepth(fallDepth(u + 0.01) + FIG_Y)).toBe(i);
      expect(stratumTop(i)).toBeCloseTo(fallDepth(u) + FIG_Y);
    }
  });
  it('the whole column fits the 256px strips (no stratum taller than 256)', () => {
    for (let i = 0; i < STRATA.length; i++) {
      const top = i === 0 ? 0 : stratumTop(i);
      const bottom = i + 1 < STRATA.length ? stratumTop(i + 1) : fallDepth(9) + 180;
      expect(bottom - top).toBeLessThanOrEqual(256);
    }
  });
});
