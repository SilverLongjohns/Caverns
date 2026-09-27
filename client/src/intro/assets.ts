// Everything the intro loads. Missing files are recorded rather than thrown, so development
// works before all art exists; production builds refuse to play an incomplete intro.
import { AUDIO_IDS, type AudioId } from './timeline.js';
import type { PlateAtlas, PlateManifest } from './plate.js';
import type { AudioBuffers } from './audio.js';

export const IMAGE_FILES = {
  logo: '/Caverns_Logo.png',
  descent_far: '/intro/descent_far.png',
  wall_conduits: '/intro/wall_conduits.png',
  wall_screens: '/intro/wall_screens.png',
  wall_fungal: '/intro/wall_fungal.png',
  wall_crystal: '/intro/wall_crystal.png',
  near_wall: '/intro/near_wall.png',
  ledge: '/intro/ledge.png',
  figure_fall: '/intro/figure_fall.png',
  glyph_lurker: '/sprites/glyphs/mobs/cave_lurker.png',
  glyph_spider: '/sprites/glyphs/mobs/crystal_spider.png',
  glyph_colossus: '/sprites/glyphs/mobs/bone_colossus.png',
} as const;
export type ImageId = keyof typeof IMAGE_FILES;

export const PLATE_IDS = ['waste', 'threshold'] as const;
export type PlateId = (typeof PLATE_IDS)[number];

export interface IntroAssets {
  images: Partial<Record<ImageId, HTMLImageElement>>;
  plates: Partial<Record<PlateId, PlateAtlas>>;
  audio: AudioBuffers;
  missing: string[];
}

export function emptyAssets(): IntroAssets {
  return { images: {}, plates: {}, audio: {}, missing: [] };
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

async function loadPlate(id: PlateId): Promise<PlateAtlas> {
  const r = await fetch(`/intro/${id}.json`);
  if (!r.ok) throw new Error(`/intro/${id}.json`);
  const manifest = (await r.json()) as PlateManifest;
  const images = await Promise.all(manifest.files.map((f) => loadImage(`/intro/${f}`)));
  return { manifest, images };
}

async function loadAudio(ctx: BaseAudioContext, id: AudioId): Promise<AudioBuffer> {
  const r = await fetch(`/intro/${id}.m4a`);
  if (!r.ok) throw new Error(`/intro/${id}.m4a`);
  return ctx.decodeAudioData(await r.arrayBuffer());
}

export async function loadIntroAssets(ctx: BaseAudioContext): Promise<IntroAssets> {
  const a = emptyAssets();
  const jobs: Promise<void>[] = [];
  for (const [id, url] of Object.entries(IMAGE_FILES) as [ImageId, string][]) {
    jobs.push(loadImage(url).then((img) => { a.images[id] = img; }, () => { a.missing.push(url); }));
  }
  for (const id of PLATE_IDS) {
    jobs.push(loadPlate(id).then((p) => { a.plates[id] = p; }, () => { a.missing.push(`plate:${id}`); }));
  }
  for (const id of AUDIO_IDS) {
    jobs.push(loadAudio(ctx, id).then((b) => { a.audio[id] = b; }, () => { a.missing.push(`audio:${id}`); }));
  }
  await Promise.all(jobs);
  return a;
}
