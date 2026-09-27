// Everything the intro loads. Missing files are recorded rather than thrown, so development
// works before all art exists; production builds refuse to play an incomplete intro.
import { AUDIO_IDS, type AudioId } from './timeline.js';
import type { AudioBuffers } from './audio.js';

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
  for (const id of AUDIO_IDS) {
    jobs.push(loadAudio(ctx, id).then((b) => { a.audio[id] = b; }, () => { a.missing.push(`audio:${id}`); }));
  }
  await Promise.all(jobs);
  return a;
}
