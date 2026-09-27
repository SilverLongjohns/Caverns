import { describe, it, expect, vi, afterEach } from 'vitest';
import { busGains, INTRO_BOOST, AudioEngine } from './audioEngine.js';

describe('busGains', () => {
  it('passes the slider through as master volume', () => {
    expect(busGains(0.3, false).master).toBeCloseTo(0.3);
  });
  it('boosts the intro so it plays at INTRO_BOOST × volume, capped at unity overall', () => {
    const g = busGains(0.3, false);
    expect(g.master * g.intro).toBeCloseTo(0.3 * INTRO_BOOST);
    const loud = busGains(1, false);
    expect(loud.master * loud.intro).toBeCloseTo(1);
  });
  it('silences everything when muted or at zero', () => {
    expect(busGains(0.8, true)).toEqual({ master: 0, intro: 0 });
    expect(busGains(0, false)).toEqual({ master: 0, intro: 0 });
  });
  it('clamps out-of-range volumes', () => {
    expect(busGains(3, false).master).toBe(1);
    expect(busGains(-1, false)).toEqual({ master: 0, intro: 0 });
  });
});

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  resumeResult: 'ok' | 'reject' | 'pending' = 'reject';
  private handlers: (() => void)[] = [];
  createGain() {
    return { gain: { value: 1, setTargetAtTime() {} }, connect: (n: unknown) => n };
  }
  addEventListener(_: string, h: () => void) { this.handlers.push(h); }
  resume(): Promise<void> {
    if (this.resumeResult === 'reject') return Promise.reject(new Error('not allowed'));
    if (this.resumeResult === 'pending') return new Promise(() => {});
    this.state = 'running';
    return Promise.resolve();
  }
  /** The browser resuming the context later on its own. */
  fireRunning() { this.state = 'running'; this.handlers.forEach((h) => h()); }
}

describe('AudioEngine.unlock', () => {
  function setup() {
    const ctxs: FakeAudioContext[] = [];
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { constructor() { super(); ctxs.push(this); } });
    const engine = new AudioEngine();
    const heard = vi.fn();
    engine.subscribe(heard);
    engine.context();
    return { engine, ctx: ctxs[0], heard };
  }
  afterEach(() => { vi.unstubAllGlobals(); });

  it('stays locked when resume() fails, then unlocks on a later successful gesture', async () => {
    const { engine, ctx, heard } = setup();
    await engine.unlock();
    expect(engine.getUnlocked()).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    ctx.resumeResult = 'ok';
    await engine.unlock();
    expect(engine.getUnlocked()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    await engine.unlock();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('unlocks when the context starts running later (statechange), not before', async () => {
    const { engine, ctx, heard } = setup();
    ctx.resumeResult = 'pending';
    void engine.unlock();
    await Promise.resolve();
    expect(engine.getUnlocked()).toBe(false);
    ctx.fireRunning();
    expect(engine.getUnlocked()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('AudioEngine.playUi', () => {
  it('is a silent no-op before any audio context exists', () => {
    const engine = new AudioEngine();
    expect(() => engine.playUi('click')).not.toThrow();
    expect(() => engine.playUi('power')).not.toThrow();
  });
});
