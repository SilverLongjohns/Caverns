import { describe, it, expect } from 'vitest';
import { getFurnishingGlyph } from './glyphs.js';
import { FURNISHING_GLYPHS } from './glyphManifest.js';

describe('getFurnishingGlyph', () => {
  it('null for missing or unknown ids', () => {
    expect(getFurnishingGlyph(undefined)).toBeNull();
    expect(getFurnishingGlyph('__not_a_furnishing__')).toBeNull();
  });
  it('a sprite path for every manifest id', () => {
    for (const id of FURNISHING_GLYPHS) expect(getFurnishingGlyph(id)).toBe(`/sprites/glyphs/furnishings/${id}.png`);
  });
});
