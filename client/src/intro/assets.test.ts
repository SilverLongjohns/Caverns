import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIntroAssets, introAssetUrl, ASSET_VERSION } from './assets.js';
import { AUDIO_IDS } from './timeline.js';
import { AMBIENCE_URL } from '../audio/audioEngine.js';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = '';
  set src(_: string) { queueMicrotask(() => this.onload?.()); }
}

function fakeCtx() {
  return { decodeAudioData: vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer) } as unknown as BaseAudioContext;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('intro asset URLs', () => {
  it('versions every /intro/ URL, including the ambience', () => {
    expect(introAssetUrl('x.m4a')).toBe(`/intro/x.m4a?v=${ASSET_VERSION}`);
    expect(AMBIENCE_URL).toBe(`/intro/ambience.m4a?v=${ASSET_VERSION}`);
  });
});

describe('loadIntroAssets', () => {
  it('loads once per AudioContext and reuses the result on replay', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', FakeImage);
    const ctx = fakeCtx();
    const a = await loadIntroAssets(ctx);
    expect(a.missing).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(AUDIO_IDS.length);
    for (const [url] of fetchMock.mock.calls as unknown as [string][]) expect(url).toContain(`?v=${ASSET_VERSION}`);
    expect(await loadIntroAssets(ctx)).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(AUDIO_IDS.length);
    await loadIntroAssets(fakeCtx());
    expect(fetchMock).toHaveBeenCalledTimes(AUDIO_IDS.length * 2);
  });

  it('does not cache an incomplete load', async () => {
    let ok = false;
    const fetchMock = vi.fn(async () => ({ ok, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', FakeImage);
    const ctx = fakeCtx();
    const first = await loadIntroAssets(ctx);
    expect(first.missing.length).toBe(AUDIO_IDS.length);
    ok = true;
    const second = await loadIntroAssets(ctx);
    expect(second).not.toBe(first);
    expect(second.missing).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(AUDIO_IDS.length * 2);
  });
});
