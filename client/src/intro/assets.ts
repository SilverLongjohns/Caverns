// Everything the intro loads. Missing files are recorded rather than thrown, so development
// works before all art exists; production builds refuse to play an incomplete intro.
import { AUDIO_IDS, type AudioId } from './timeline.js';
import type { AudioBuffers } from './audio.js';

/**
 * Appended as `?v=` to every /intro/ URL. The server caches non-HTML files as immutable for a
 * year and these files aren't content-hashed, so bump this whenever an asset is re-baked.
 */
export const ASSET_VERSION = '20260927';
export const introAssetUrl = (file: string): string => `/intro/${file}?v=${ASSET_VERSION}`;

export const IMAGE_FILES = {
  logo: '/Caverns_Logo.png',
} as const;
export type ImageId = keyof typeof IMAGE_FILES;

export interface IntroAssets {
  images: Partial<Record<ImageId, HTMLImageElement>>;
  audio: AudioBuffers;
  missing: string[];
}

export function emptyAssets(): IntroAssets {
  return { images: {}, audio: {}, missing: [] };
}

export function isComplete(a: IntroAssets): boolean {
  return a.missing.length === 0;
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

async function loadAudio(ctx: BaseAudioContext, id: AudioId): Promise<AudioBuffer> {
  const url = introAssetUrl(`${id}.m4a`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return ctx.decodeAudioData(await r.arrayBuffer());
}

const cache = new WeakMap<BaseAudioContext, Promise<IntroAssets>>();

/**
 * Loads (and decodes) everything once per AudioContext, so a replay starts instantly. An
 * incomplete or failed load isn't kept: the next call tries again.
 */
export function loadIntroAssets(ctx: BaseAudioContext): Promise<IntroAssets> {
  let p = cache.get(ctx);
  if (!p) {
    const load = loadAll(ctx);
    p = load;
    cache.set(ctx, load);
    const evict = () => { if (cache.get(ctx) === load) cache.delete(ctx); };
    load.then((a) => { if (!isComplete(a)) evict(); }, evict);
  }
  return p;
}

async function loadAll(ctx: BaseAudioContext): Promise<IntroAssets> {
  const a = emptyAssets();
  const jobs: Promise<void>[] = [];
  for (const [id, url] of Object.entries(IMAGE_FILES) as [ImageId, string][]) {
    jobs.push(loadImage(url).then((img) => { a.images[id] = img; }, () => { a.missing.push(url); }));
  }
  for (const id of AUDIO_IDS) {
    jobs.push(loadAudio(ctx, id).then((b) => { a.audio[id] = b; }, () => { a.missing.push(`audio:${id}`); }));
  }
  await Promise.all(jobs);
  return a;
}
