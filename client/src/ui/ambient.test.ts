import { describe, it, expect } from 'vitest';
import { nextGlitchDelay } from './ambient.js';

describe('nextGlitchDelay', () => {
  it('stays within 8-15 seconds', () => {
    expect(nextGlitchDelay(() => 0)).toBe(8000);
    expect(nextGlitchDelay(() => 0.999999)).toBeLessThanOrEqual(15000);
    expect(nextGlitchDelay(() => 0.5)).toBe(11500);
  });
  it('clamps a misbehaving random source', () => {
    expect(nextGlitchDelay(() => -3)).toBe(8000);
    expect(nextGlitchDelay(() => 7)).toBe(15000);
    expect(nextGlitchDelay(() => Number.NaN)).toBe(8000);
  });
});
