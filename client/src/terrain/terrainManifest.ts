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

async function loadTerrainSet(biomeId: string): Promise<TerrainSet | null> {
  try {
    const res = await fetch(`/tiles/${biomeId}/terrain.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    const manifest = parseTerrainManifest(await res.json());
    if (!manifest) throw new Error('invalid manifest');
    const sheet = await loadImage(`/tiles/${biomeId}/terrain.png`);
    return { biomeId, manifest, sheet };
  } catch {
    if (biomeId === 'default') return null;
    return loadTerrainSet('default');
  }
}

const cache = new Map<string, Promise<TerrainSet | null>>();

function getTerrainSet(biomeId: string): Promise<TerrainSet | null> {
  let p = cache.get(biomeId);
  if (!p) {
    p = loadTerrainSet(biomeId);
    cache.set(biomeId, p);
  }
  return p;
}

/**
 * Loads /tiles/<biome>/terrain.{json,png}; on failure tries 'default'; resolves null ⇒ ASCII
 * fallback. Cached per biome. Returns null while loading — callers render ASCII until the set
 * is ready, which is acceptable and brief.
 */
export function useTerrainSet(biomeId: string | undefined): TerrainSet | null {
  const [set, setSet] = useState<TerrainSet | null>(null);

  useEffect(() => {
    if (!biomeId) {
      setSet(null);
      return;
    }
    let cancelled = false;
    setSet(null);
    getTerrainSet(biomeId).then((loaded) => {
      if (!cancelled) setSet(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [biomeId]);

  return set;
}
