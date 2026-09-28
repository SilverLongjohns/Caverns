import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getFurnishingGlyph, fnv1a32 } from './glyphs.js';
import { FURNISHING_GLYPHS } from './glyphManifest.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

describe('fnv1a32', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a32('room1:3,4')).toBe(fnv1a32('room1:3,4'));
  });
  it('differs (in general) for different input', () => {
    expect(fnv1a32('room1:3,4')).not.toBe(fnv1a32('room1:3,5'));
  });
  it('returns a non-negative 32-bit integer', () => {
    const h = fnv1a32('some seed key');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('getFurnishingGlyph', () => {
  it('null for missing or unknown ids', () => {
    expect(getFurnishingGlyph(undefined)).toBeNull();
    expect(getFurnishingGlyph('__not_a_furnishing__')).toBeNull();
    expect(getFurnishingGlyph('__not_a_furnishing__', 'some-seed')).toBeNull();
  });

  it('same seed always yields the same path', () => {
    for (const id of Object.keys(FURNISHING_GLYPHS)) {
      const seed = `roomA:${id}`;
      expect(getFurnishingGlyph(id, seed)).toBe(getFurnishingGlyph(id, seed));
    }
  });

  it('for every manifest id, every seed maps to one of the installed variant paths', () => {
    const seeds = Array.from({ length: 50 }, (_, i) => `room${i % 5}:${i},${i * 2}`);
    for (const [id, count] of Object.entries(FURNISHING_GLYPHS)) {
      for (const seed of seeds) {
        const path = getFurnishingGlyph(id, seed);
        expect(path).toMatch(/^\/sprites\/glyphs\/furnishings\/[^/]+-\d+\.png$/);
        const n = Number(path!.match(/-(\d+)\.png$/)![1]);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(count);
      }
    }
  });

  it('across ~50 seeds, an id with count > 1 yields more than one distinct variant', () => {
    const seeds = Array.from({ length: 50 }, (_, i) => `room${i}:${i},${i + 7}`);
    for (const [id, count] of Object.entries(FURNISHING_GLYPHS)) {
      if (count <= 1) continue;
      const variants = new Set(seeds.map((seed) => getFurnishingGlyph(id, seed)));
      expect(variants.size).toBeGreaterThan(1);
    }
  });

  it('every manifest id/variant has an installed file on disk', () => {
    for (const [id, count] of Object.entries(FURNISHING_GLYPHS)) {
      for (let n = 0; n < count; n++) {
        const file = `${PUBLIC_DIR}/sprites/glyphs/furnishings/${id}-${n}.png`;
        expect(existsSync(file), `missing installed file: ${file}`).toBe(true);
      }
    }
  });
});
