import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine, BED_DUCK } from './audioEngine.js';
import type { SfxLimiter } from './sfxRules.js';

type Param = { value: number; setTargetAtTime: () => void; cancelScheduledValues: () => void; setValueAtTime: (v: number) => void; linearRampToValueAtTime: (v: number) => void; exponentialRampToValueAtTime: () => void };
const param = (v = 1): Param => {
  const p: Param = {
    value: v,
    setTargetAtTime() {},
    cancelScheduledValues() {},
    setValueAtTime(x) { p.value = x; },
    linearRampToValueAtTime(x) { p.value = x; },
    exponentialRampToValueAtTime() {},
  };
  return p;
};

class FakeCtx {
  state: 'suspended' | 'running' = 'running';
  currentTime = 0;
  destination = {};
  sources: { url?: string; buffer: unknown; loop: boolean; started: boolean; stopped: boolean; onended: (() => void) | null; playbackRate: Param }[] = [];
  createGain() { const g = { gain: param(1), connect: (n: unknown) => n }; return g; }
  createBufferSource() {
    const s = { buffer: null as unknown, loop: false, started: false, stopped: false, onended: null as (() => void) | null, playbackRate: param(1),
      connect: (n: unknown) => n, start() { s.started = true; }, stop() { s.stopped = true; } };
    this.sources.push(s);
    return s;
  }
  decodeAudioData(d: ArrayBuffer) { return Promise.resolve({ tag: new TextDecoder().decode(d) }); }
  addEventListener() {}
  resume() { return Promise.resolve(); }
}

let ctx: FakeCtx;
function setup(files: Record<string, string[]>, opts: { failUrls?: string[]; state?: 'running' | 'suspended' } = {}) {
  vi.stubGlobal('AudioContext', class extends FakeCtx { constructor() { super(); ctx = this; this.state = opts.state ?? 'running'; } });
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
    opts.failUrls?.includes(url)
      ? { ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
      : { ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url).buffer) },
  )));
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const engine = new AudioEngine(files as never);
  engine.context();
  return { engine, advance: (ms: number) => { now += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('playSfx', () => {
  it('plays a decoded take through a buffer source', async () => {
    const { engine } = setup({ unlock: ['/a/unlock_1.mp3'] });
    engine.playSfx('unlock');
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(true);
  });
  it('is silent while the context is locked', async () => {
    const { engine } = setup({ unlock: ['/a/unlock_1.mp3'] }, { state: 'suspended' });
    engine.playSfx('unlock');
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
  it('is silent for a sound with no files and never throws', async () => {
    const { engine } = setup({});
    expect(() => engine.playSfx('unlock')).not.toThrow();
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
  it('releases the voice when a file fails to load, so later plays still work', async () => {
    const { engine, advance } = setup({ player_down: ['/bad.mp3'] }, { failUrls: ['/bad.mp3'] });
    for (let i = 0; i < 4; i++) { engine.playSfx('player_down'); advance(10); await flush(); }
    // A leaked voice per failed load would leave 3 held; with every voice released, a 1-voice cap still admits a play.
    const limiter = (engine as unknown as { limiter: SfxLimiter }).limiter;
    expect(limiter.tryStart('player_down', 99_999, 0, 1)).toBe(true);
  });
  it('throttles steps by minGapMs', async () => {
    const { engine, advance } = setup({ step: ['/s1', '/s2', '/s3', '/s4'] });
    engine.playSfx('step');
    engine.playSfx('step');
    advance(100);
    engine.playSfx('step');
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });
  it('a separate limit key keeps allies\' steps from eating your own', async () => {
    const { engine } = setup({ step: ['/s1', '/s2', '/s3', '/s4'] });
    engine.playSfx('step', { volume: 0.4, limitKey: 'step:other' });
    engine.playSfx('step');
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });
  it('rotates takes without repeating back-to-back', async () => {
    const { engine, advance } = setup({ step: ['/s1', '/s2', '/s3', '/s4'] });
    for (let i = 0; i < 12; i++) { engine.playSfx('step'); advance(150); await flush(); ctx.sources.at(-1)?.onended?.(); }
    const tags = ctx.sources.map((s) => (s.buffer as { tag: string }).tag);
    for (let i = 1; i < tags.length; i++) expect(tags[i]).not.toBe(tags[i - 1]);
  });
  it('falls back to the synth UI sound when asked and no sample exists', async () => {
    const { engine } = setup({});
    const osc = vi.fn(() => ({ type: '', frequency: param(), connect: (n: unknown) => n, start() {}, stop() {} }));
    (ctx as unknown as { createOscillator: typeof osc }).createOscillator = osc;
    engine.playSfx('ui_open', { fallback: 'power' });
    expect(osc).toHaveBeenCalled();
  });
});

describe('playUi', () => {
  it('uses the sample when one exists instead of the synth', async () => {
    const { engine } = setup({ ui_click: ['/click.mp3'] });
    const osc = vi.fn();
    (ctx as unknown as { createOscillator: typeof osc }).createOscillator = osc;
    engine.playUi('click');
    await flush();
    expect(osc).not.toHaveBeenCalled();
    expect(ctx.sources).toHaveLength(1);
  });
});

describe('beds', () => {
  it('loops the bed and crossfades to a new one', async () => {
    const { engine } = setup({ amb_fungal: ['/f.mp3'], amb_bone: ['/b.mp3'] });
    engine.setBed('amb_fungal');
    await flush();
    expect(ctx.sources[0].loop).toBe(true);
    engine.setBed('amb_bone');
    await flush();
    expect(ctx.sources[0].stopped).toBe(true);
    expect(ctx.sources[1].loop).toBe(true);
  });
  it('never starts a stale bed that finished loading after the player moved on', async () => {
    const { engine } = setup({ amb_fungal: ['/f.mp3'], amb_bone: ['/b.mp3'] });
    engine.setBed('amb_fungal');
    engine.setBed('amb_bone');
    await flush();
    const started = ctx.sources.filter((s) => s.started);
    expect(started).toHaveLength(1);
    expect((started[0].buffer as { tag: string }).tag).toBe('/b.mp3');
  });
  it('going A -> B -> A before A loads starts exactly one A', async () => {
    const { engine } = setup({ amb_fungal: ['/f.mp3'], amb_bone: ['/b.mp3'] });
    engine.setBed('amb_fungal');
    engine.setBed('amb_bone');
    engine.setBed('amb_fungal');
    await flush();
    const started = ctx.sources.filter((s) => s.started);
    expect(started).toHaveLength(1);
    expect((started[0].buffer as { tag: string }).tag).toBe('/f.mp3');
  });
  it('setBed(null) fades out and does not throw while locked', async () => {
    const { engine } = setup({ amb_fungal: ['/f.mp3'] }, { state: 'suspended' });
    expect(() => { engine.setBed('amb_fungal'); engine.setBed(null); engine.setDuck(true); }).not.toThrow();
  });
  it('ducks the bed bus', () => {
    const { engine } = setup({});
    engine.setDuck(true);
    expect((engine as unknown as { bedBus: { gain: Param } }).bedBus.gain.value).toBe(BED_DUCK);
    engine.setDuck(false);
    expect((engine as unknown as { bedBus: { gain: Param } }).bedBus.gain.value).toBe(1);
  });
});
