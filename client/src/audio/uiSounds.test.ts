import { describe, it, expect } from 'vitest';
import { createUiThrottle, synthUiSound, type UiSound } from './uiSounds.js';

describe('createUiThrottle', () => {
  it('lets clicks and power through every time', () => {
    const ok = createUiThrottle(80);
    expect(ok('click', 0)).toBe(true);
    expect(ok('click', 1)).toBe(true);
    expect(ok('power', 2)).toBe(true);
  });
  it('throttles hover ticks to one per window', () => {
    const ok = createUiThrottle(80);
    expect(ok('tick', 1000)).toBe(true);
    expect(ok('tick', 1040)).toBe(false);
    expect(ok('tick', 1079)).toBe(false);
    expect(ok('tick', 1080)).toBe(true);
  });
});


describe('synthUiSound', () => {
  function fakeCtx() {
    const made: { kind: string; node: { type: string } }[] = [];
    const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
    const node = (kind: string) => { const n = { type: '', frequency: param(), gain: param(), Q: param(), buffer: null as unknown, connect(x: unknown) { return x; }, start() {}, stop() {} }; made.push({ kind, node: n }); return n; };
    const ctx = { currentTime: 0, sampleRate: 48000, createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'),
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }), createBufferSource: () => node('src') };
    const oscTypes = () => made.filter((m) => m.kind === 'osc').map((m) => m.node.type);
    const kinds = () => made.map((m) => m.kind);
    return { ctx, oscTypes, kinds };
  }
  const play = (s: UiSound) => { const f = fakeCtx(); synthUiSound(f.ctx as never, {} as never, s); return f; };

  it('every UI sound synthesises without throwing', () => {
    for (const s of ['click', 'tick', 'power', 'crack', 'boom', 'shimmer'] as UiSound[]) expect(() => play(s), s).not.toThrow();
  });
  it('crack is a filtered noise burst', () => {
    const f = play('crack');
    expect(f.kinds()).toContain('src');
    expect(f.kinds()).toContain('filter');
  });
  it('boom is a single low sine', () => {
    expect(play('boom').oscTypes()).toEqual(['sine']);
  });
  it('shimmer is two detuned triangles', () => {
    expect(play('shimmer').oscTypes()).toEqual(['triangle', 'triangle']);
  });
  it('power stays a sawtooth sweep', () => {
    expect(play('power').oscTypes()).toEqual(['sawtooth']);
  });
});
