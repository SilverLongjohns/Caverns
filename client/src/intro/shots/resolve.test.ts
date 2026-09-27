import { describe, it, expect } from 'vitest';
import { underlayAlpha } from './resolve.js';
import { UNDERLAY_T0, UNDERLAY_T1, DURATION } from '../timeline.js';

describe('underlayAlpha', () => {
  it('holds the frame until UNDERLAY_T0 and hands over completely by UNDERLAY_T1', () => {
    expect(underlayAlpha(UNDERLAY_T0 - 1)).toBe(1);
    expect(underlayAlpha(UNDERLAY_T0)).toBe(1);
    expect(underlayAlpha((UNDERLAY_T0 + UNDERLAY_T1) / 2)).toBeCloseTo(0.5, 9);
    expect(underlayAlpha(UNDERLAY_T1)).toBe(0);
    expect(underlayAlpha(DURATION - 0.01)).toBe(0);
  });
});
