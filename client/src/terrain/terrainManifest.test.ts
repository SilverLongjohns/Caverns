import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTerrainManifest, createTerrainSetCache, type TerrainSet } from './terrainManifest.js';

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

function fakeSet(biomeId: string): TerrainSet {
  return { biomeId, manifest: { tileSize: 24, sets: {}, floorVariants: [], stamps: {} }, sheet: {} as HTMLImageElement };
}

describe('createTerrainSetCache', () => {
  it('resolves a biome and makes it available synchronously via `resolved` afterward', async () => {
    const loader = vi.fn(async (id: string) => fakeSet(id));
    const cache = createTerrainSetCache(loader);
    expect(cache.resolved.has('a')).toBe(false);
    const set = await cache.get('a');
    expect(set).toEqual(fakeSet('a'));
    expect(cache.resolved.get('a')).toEqual(fakeSet('a'));
  });

  it('caches per biome: a second get for the same biome does not call the loader again', async () => {
    const loader = vi.fn(async (id: string) => fakeSet(id));
    const cache = createTerrainSetCache(loader);
    await cache.get('a');
    await cache.get('a');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("routes a failing biome's fallback through the SAME cache entry as 'default', so two failing biomes share one 'default' load", async () => {
    const loader = vi.fn(async (id: string) => {
      if (id === 'default') return fakeSet('default');
      throw new Error(`no such biome: ${id}`);
    });
    const cache = createTerrainSetCache(loader);
    const [a, b] = await Promise.all([cache.get('volcanic'), cache.get('fungal')]);
    expect(a).toEqual(fakeSet('default'));
    expect(b).toEqual(fakeSet('default'));
    expect(loader).toHaveBeenCalledTimes(3); // volcanic, fungal, default (once, shared)
    expect(loader).toHaveBeenCalledWith('default');
  });

  it('does not cache a final null (both the biome and default fail) -- a later get retries the loader', async () => {
    const loader = vi.fn(async () => {
      throw new Error('always fails');
    });
    const cache = createTerrainSetCache(loader);
    const first = await cache.get('a');
    expect(first).toBeNull();
    expect(cache.resolved.has('a')).toBe(false);
    expect(loader).toHaveBeenCalledTimes(2); // a, then default fallback

    const second = await cache.get('a');
    expect(second).toBeNull();
    expect(loader).toHaveBeenCalledTimes(4); // retried: a, default again
  });

  it('warns via console.warn when a biome fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });
    const cache = createTerrainSetCache(loader);
    await cache.get('default'); // biomeId === 'default' -- no further fallback, just warns and returns null
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
