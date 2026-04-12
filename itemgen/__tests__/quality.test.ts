import { describe, it, expect } from 'vitest';
import { rollQuality, QUALITY_TIERS } from '../src/quality.js';
import { createRng } from '../src/rng.js';

describe('rollQuality', () => {
  it('returns a valid quality tier', () => {
    const rng = createRng(42);
    const quality = rollQuality(rng);
    const validQualities = QUALITY_TIERS.map(t => t.quality);
    expect(validQualities).toContain(quality);
  });

  it('returns deterministic results with same seed', () => {
    const results1 = Array.from({ length: 20 }, () => rollQuality(createRng(99)));
    const results2 = Array.from({ length: 20 }, () => rollQuality(createRng(99)));
    expect(results1).toEqual(results2);
  });

  it('returns the correct multiplier for each quality', () => {
    expect(QUALITY_TIERS.find(t => t.quality === 'crude')!.multiplier).toBe(0.8);
    expect(QUALITY_TIERS.find(t => t.quality === 'standard')!.multiplier).toBe(1.0);
    expect(QUALITY_TIERS.find(t => t.quality === 'fine')!.multiplier).toBe(1.15);
    expect(QUALITY_TIERS.find(t => t.quality === 'superior')!.multiplier).toBe(1.3);
    expect(QUALITY_TIERS.find(t => t.quality === 'masterwork')!.multiplier).toBe(1.5);
  });

  it('distributes roughly according to weights over many rolls', () => {
    const rng = createRng(12345);
    const counts: Record<string, number> = {};
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const q = rollQuality(rng);
      counts[q] = (counts[q] ?? 0) + 1;
    }
    expect(counts['standard']).toBeGreaterThan(counts['crude']);
    expect(counts['crude']).toBeGreaterThan(counts['superior']);
    expect(counts['superior']).toBeGreaterThan(counts['masterwork']);
  });
});
