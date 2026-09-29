import { useEffect, useState } from 'react';

export type SheetPos = [col: number, row: number];

export interface TerrainManifest {
  tileSize: number;
  /** Corner sets keyed by UPPER-terrain mask (bit=1 ⇒ upper: NW<<3|NE<<2|SW<<1|SE). */
  sets: Partial<Record<'rock' | 'water' | 'chasm', Record<string, SheetPos>>>;
  floorVariants: SheetPos[];
  stamps: Partial<Record<'hazard' | 'bridge_h' | 'bridge_v' | 'exit' | 'torch', SheetPos>>;
}

export interface TerrainSet {
  biomeId: string;
  manifest: TerrainManifest;
  sheet: HTMLImageElement;
}

const SET_NAMES = ['rock', 'water', 'chasm'] as const;
const STAMP_NAMES = ['hazard', 'bridge_h', 'bridge_v', 'exit', 'torch'] as const;

function isSheetPos(v: unknown): v is SheetPos {
  return Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]);
}

function isMaskRecord(v: unknown): v is Record<string, SheetPos> {
  if (typeof v !== 'object' || v === null) return false;
  for (const [key, pos] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 0 || n > 15 || String(n) !== key) return false;
    if (!isSheetPos(pos)) return false;
  }
  return true;
}

/** Validates the shape of a parsed terrain.json; returns null if it isn't a valid TerrainManifest. */
export function parseTerrainManifest(raw: unknown): TerrainManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.tileSize !== 'number' || !Number.isFinite(r.tileSize) || r.tileSize <= 0) return null;

  if (typeof r.sets !== 'object' || r.sets === null) return null;
  const setsIn = r.sets as Record<string, unknown>;
  const sets: TerrainManifest['sets'] = {};
  for (const [key, value] of Object.entries(setsIn)) {
    if (!(SET_NAMES as readonly string[]).includes(key)) return null;
    if (!isMaskRecord(value)) return null;
    sets[key as (typeof SET_NAMES)[number]] = value;
  }

  if (!Array.isArray(r.floorVariants) || !r.floorVariants.every(isSheetPos)) return null;
  const floorVariants = r.floorVariants as SheetPos[];

  if (typeof r.stamps !== 'object' || r.stamps === null) return null;
  const stampsIn = r.stamps as Record<string, unknown>;
  const stamps: TerrainManifest['stamps'] = {};
  for (const [key, value] of Object.entries(stampsIn)) {
    if (!(STAMP_NAMES as readonly string[]).includes(key)) return null;
    if (!isSheetPos(value)) return null;
    stamps[key as (typeof STAMP_NAMES)[number]] = value;
  }

  return { tileSize: r.tileSize, sets, floorVariants, stamps };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

/** Fetches ONE biome's terrain set, no fallback and no caching of its own — throws on any failure
 * (bad status, invalid manifest, image load error). Fallback-to-'default' and caching live in
 * `createTerrainSetCache`, which wraps this. */
async function fetchTerrainSet(biomeId: string): Promise<TerrainSet | null> {
  const res = await fetch(`/tiles/${biomeId}/terrain.json`);
  if (!res.ok) throw new Error(`${res.status}`);
  const manifest = parseTerrainManifest(await res.json());
  if (!manifest) throw new Error('invalid manifest');
  const sheet = await loadImage(`/tiles/${biomeId}/terrain.png`);
  return { biomeId, manifest, sheet };
}

export interface TerrainSetCache {
  /** Biomes that have SETTLED to a non-null TerrainSet, read synchronously (no await) so a caller
   * (useTerrainSet) can seed/update its state without a one-frame ASCII flash for a biome that's
   * already resolved. A biome absent from this map may be unresolved, in flight, or have most
   * recently failed (see `get` below) — `has`/`get` on this map never itself trigger a load. */
  resolved: Map<string, TerrainSet | null>;
  /** Resolves `biomeId`, using `resolved` as a cache and sharing one in-flight load per biome.
   * On failure (loader throws) falls back to `get('default')` — routed through this SAME cache,
   * so N biomes failing at once share one 'default' load instead of each re-fetching it. A biome
   * whose load AND whose 'default' fallback both fail resolves to null but is deliberately NOT
   * cached as a final answer (M6): a later `get` for that biome retries from scratch instead of
   * being stuck with a transient failure (e.g. a dropped network request) forever. */
  get(biomeId: string): Promise<TerrainSet | null>;
}

/** Builds a terrain-set cache around `loader` (given a biomeId, resolves its TerrainSet or throws
 * — no fallback/caching logic of its own). Exported for testing with an injected fake loader; the
 * app uses the single shared instance below, built from the real `fetchTerrainSet`. */
export function createTerrainSetCache(loader: (biomeId: string) => Promise<TerrainSet | null>): TerrainSetCache {
  const resolved = new Map<string, TerrainSet | null>();
  const pending = new Map<string, Promise<TerrainSet | null>>();

  async function resolveOne(biomeId: string): Promise<TerrainSet | null> {
    try {
      return await loader(biomeId);
    } catch (err) {
      console.warn(`[terrain] failed to load terrain set for biome "${biomeId}"`, err);
      if (biomeId === 'default') return null;
      return cache.get('default');
    }
  }

  const cache: TerrainSetCache = {
    resolved,
    get(biomeId: string): Promise<TerrainSet | null> {
      if (resolved.has(biomeId)) return Promise.resolve(resolved.get(biomeId) ?? null);
      let p = pending.get(biomeId);
      if (!p) {
        p = resolveOne(biomeId).then((set) => {
          pending.delete(biomeId);
          if (set !== null) resolved.set(biomeId, set); // never cache a final null -- allow retry
          return set;
        });
        pending.set(biomeId, p);
      }
      return p;
    },
  };

  return cache;
}

const sharedTerrainSetCache = createTerrainSetCache(fetchTerrainSet);

/**
 * Loads /tiles/<biome>/terrain.{json,png}; on failure tries 'default'; resolves null ⇒ ASCII
 * fallback. Cached per biome (see `createTerrainSetCache`) — a biome that's already resolved is
 * returned synchronously (seeded into state, and set again from the effect without first
 * resetting to null) so remounting the same biome (room entry, combat start/end) doesn't flash
 * ASCII for one frame while a cache hit is still in flight.
 */
export function useTerrainSet(biomeId: string | undefined): TerrainSet | null {
  const [set, setSet] = useState<TerrainSet | null>(() =>
    biomeId ? sharedTerrainSetCache.resolved.get(biomeId) ?? null : null
  );

  useEffect(() => {
    if (!biomeId) {
      setSet(null);
      return;
    }
    let cancelled = false;
    const cached = sharedTerrainSetCache.resolved.get(biomeId);
    if (cached !== undefined) {
      // Already resolved -- set synchronously-ish (still a state update, but from an already-
      // settled value) without first resetting to null, so no ASCII flash.
      setSet(cached);
    } else {
      sharedTerrainSetCache.get(biomeId).then((loaded) => {
        if (!cancelled) setSet(loaded);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [biomeId]);

  return set;
}
