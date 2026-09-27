import { describe, it, expect } from 'vitest';
import { coverFit, glyphRevealTime } from './layout.js';
import { GLYPH_T0, GLYPH_T1, LR_W, LR_H } from './timeline.js';

describe('coverFit', () => {
  const sizes: [number, number][] = [[1920, 1064], [1366, 752], [3840, 2144], [2560, 1064], [800, 1200], [320, 180], [100, 50]];
  it.each(sizes)('covers %ix%i with no gaps, centred, using an integer pre-scale ≥ k', (vw, vh) => {
    const f = coverFit(vw, vh);
    expect(LR_W * f.k).toBeGreaterThanOrEqual(vw - 1e-6);
    expect(LR_H * f.k).toBeGreaterThanOrEqual(vh - 1e-6);
    expect(f.dx).toBeLessThanOrEqual(1e-6);
    expect(f.dy).toBeLessThanOrEqual(1e-6);
    expect(f.dx * 2 + LR_W * f.k).toBeCloseTo(vw, 6);
    expect(Number.isInteger(f.ps)).toBe(true);
    expect(f.ps).toBeGreaterThanOrEqual(Math.max(1, f.k - 1e-6));
    expect(f.ps).toBeLessThan(f.k + 1);
  });
  it('is exactly 6× at 1920×1080', () => {
    expect(coverFit(1920, 1080)).toEqual({ k: 6, ps: 6, dx: 0, dy: 0 });
  });
});

describe('glyphRevealTime', () => {
  it('stays within the glyph window', () => {
    for (let y = 0; y <= 1000; y += 50) for (const a of ['top', 'bottom'] as const) {
      const t = glyphRevealTime(a, y, 1000, y * 7);
      expect(t).toBeGreaterThanOrEqual(GLYPH_T0);
      expect(t).toBeLessThanOrEqual(GLYPH_T1);
    }
  });
  it('builds stalagmites bottom-up and stalactites top-down (ignoring jitter)', () => {
    expect(glyphRevealTime('bottom', 990, 1000, 0)).toBeLessThan(glyphRevealTime('bottom', 500, 1000, 0));
    expect(glyphRevealTime('top', 10, 1000, 0)).toBeLessThan(glyphRevealTime('top', 300, 1000, 0));
  });
});
