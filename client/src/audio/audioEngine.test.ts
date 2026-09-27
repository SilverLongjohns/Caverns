import { describe, it, expect } from 'vitest';
import { busGains, INTRO_BOOST } from './audioEngine.js';

describe('busGains', () => {
  it('passes the slider through as master volume', () => {
    expect(busGains(0.3, false).master).toBeCloseTo(0.3);
  });
  it('boosts the intro so it plays at INTRO_BOOST × volume, capped at unity overall', () => {
    const g = busGains(0.3, false);
    expect(g.master * g.intro).toBeCloseTo(0.3 * INTRO_BOOST);
    const loud = busGains(1, false);
    expect(loud.master * loud.intro).toBeCloseTo(1);
  });
  it('silences everything when muted or at zero', () => {
    expect(busGains(0.8, true)).toEqual({ master: 0, intro: 0 });
    expect(busGains(0, false)).toEqual({ master: 0, intro: 0 });
  });
  it('clamps out-of-range volumes', () => {
    expect(busGains(3, false).master).toBe(1);
    expect(busGains(-1, false)).toEqual({ master: 0, intro: 0 });
  });
});
