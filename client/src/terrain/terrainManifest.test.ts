import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTerrainManifest } from './terrainManifest.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const pub = resolve(here, '../../public/tiles');

function pngSize(file: string) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('parseTerrainManifest', () => {
  it('rejects junk', () => {
    expect(parseTerrainManifest(null)).toBeNull();
    expect(parseTerrainManifest({ tileSize: 24 })).toBeNull();
    expect(parseTerrainManifest({ tileSize: 24, sets: { rock: { '0': ['a', 1] } }, floorVariants: [], stamps: {} })).toBeNull();
  });
  it('accepts a minimal manifest', () => {
    expect(parseTerrainManifest({ tileSize: 24, sets: { rock: { '0': [0, 0] } }, floorVariants: [], stamps: {} })).not.toBeNull();
  });
});

describe('shipped terrain sets', () => {
  const biomes = readdirSync(pub);
  it('include a default set', () => {
    expect(biomes).toContain('default');
  });
  for (const biome of biomes) {
    it(`${biome}: every position is inside its sheet; rock set is complete`, () => {
      const m = parseTerrainManifest(JSON.parse(readFileSync(resolve(pub, biome, 'terrain.json'), 'utf-8')))!;
      expect(m).not.toBeNull();
      const { w, h } = pngSize(resolve(pub, biome, 'terrain.png'));
      const all = [
        ...Object.values(m.sets).flatMap((s) => Object.values(s!)),
        ...m.floorVariants,
        ...Object.values(m.stamps),
      ] as [number, number][];
      for (const [c, r] of all) {
        expect((c + 1) * m.tileSize).toBeLessThanOrEqual(w);
        expect((r + 1) * m.tileSize).toBeLessThanOrEqual(h);
      }
      for (let i = 0; i < 16; i++) expect(m.sets.rock?.[String(i)], `rock mask ${i}`).toBeDefined();
    });
  }
});
