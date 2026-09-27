import { describe, it, expect } from 'vitest';
import { IntroClock, SKIP_FROM, SKIP_RATE, STALL_MS, pickClockSource, perfSource, createStallWatch } from './clock.js';
import { DURATION, RESOLVE_T0 } from './timeline.js';

function fake(start = 100) {
  let now = start;
  return { source: () => now, advance: (d: number) => { now += d; } };
}

describe('IntroClock', () => {
  it('reads 0 before start and elapsed time after, honouring a negative lead', () => {
    const f = fake(); const c = new IntroClock(f.source);
    expect(c.now()).toBe(0); expect(c.started).toBe(false);
    c.start(-0.05);
    expect(c.now()).toBeCloseTo(-0.05);
    f.advance(2.05);
    expect(c.now()).toBeCloseTo(2);
  });

  it('skip before the resolve jumps to SKIP_FROM and runs at SKIP_RATE', () => {
    const f = fake(); const c = new IntroClock(f.source);
    expect(SKIP_FROM).toBe(RESOLVE_T0);
    c.start(); f.advance(3);
    c.skip();
    expect(c.skipping).toBe(true);
    expect(c.now()).toBeCloseTo(SKIP_FROM);
    f.advance(1);
    expect(c.now()).toBeCloseTo(SKIP_FROM + SKIP_RATE);
  });

  it('skip during the resolve continues from the current time, and is idempotent', () => {
    const f = fake(); const c = new IntroClock(f.source);
    c.start(); f.advance(7);
    c.skip(); f.advance(0.5); c.skip();
    expect(c.now()).toBeCloseTo(7 + 0.5 * SKIP_RATE);
  });

  it('skip before start does nothing; done flips at DURATION', () => {
    const f = fake(); const c = new IntroClock(f.source);
    c.skip(); expect(c.skipping).toBe(false);
    c.start(); f.advance(DURATION - 0.1); expect(c.done).toBe(false);
    f.advance(0.2); expect(c.done).toBe(true);
  });
});

describe('IntroClock latency', () => {
  it('shows frame 0 when the audio scheduled for t=0 is heard (latency is not cancelled out)', () => {
    const LEAD = 0.05, ct0 = 10;
    const ctx = { state: 'running', currentTime: ct0, outputLatency: 0.2 };
    const s = pickClockSource(ctx, () => 0);
    const c = new IntroClock(s.source, s.latency);
    c.start(-LEAD); // audio for t=0 is scheduled at ct0 + LEAD
    ctx.currentTime = ct0 + LEAD + 0.2;
    expect(c.now()).toBeCloseTo(0, 9);
    ctx.currentTime = ct0 + LEAD + 0.2 + 3;
    expect(c.now()).toBeCloseTo(3, 9);
  });

  it('never runs backwards when latency is discovered late, then tracks the corrected time', () => {
    const f = fake(); let lat = 0;
    const c = new IntroClock(f.source, () => lat);
    c.start(); f.advance(2);
    expect(c.now()).toBeCloseTo(2);
    lat = 0.2;
    expect(c.now()).toBeCloseTo(2); // held, not 1.8
    f.advance(0.1); expect(c.now()).toBeCloseTo(2);
    f.advance(0.2); expect(c.now()).toBeCloseTo(2.1);
  });
});

describe('IntroClock.switchSource', () => {
  it('preserves t across a switch and keeps running on the new source', () => {
    const audio = fake(50), perf = fake(1000);
    const c = new IntroClock(audio.source, () => 0.1);
    c.start(); audio.advance(3.1);
    expect(c.now()).toBeCloseTo(3);
    c.switchSource(perf.source);
    expect(c.now()).toBeCloseTo(3);
    audio.advance(100); // the old clock no longer matters
    perf.advance(1.5);
    expect(c.now()).toBeCloseTo(4.5);
    perf.advance(DURATION); expect(c.done).toBe(true);
  });

  it('a skip after the switch jumps to SKIP_FROM and runs at SKIP_RATE on the new source', () => {
    const audio = fake(), perf = fake(7);
    const c = new IntroClock(audio.source);
    c.start(); audio.advance(2);
    c.switchSource(perf.source);
    perf.advance(0.5);
    c.skip();
    expect(c.now()).toBeCloseTo(SKIP_FROM);
    perf.advance(1);
    expect(c.now()).toBeCloseTo(SKIP_FROM + SKIP_RATE);
  });

  it('preserves t when switching mid-skip', () => {
    const audio = fake(), perf = fake(3);
    const c = new IntroClock(audio.source);
    c.start(); audio.advance(1); c.skip(); audio.advance(0.5);
    const t = c.now();
    expect(t).toBeCloseTo(SKIP_FROM + 0.5 * SKIP_RATE);
    c.switchSource(perf.source);
    expect(c.now()).toBeCloseTo(t);
    perf.advance(0.2);
    expect(c.now()).toBeCloseTo(t + 0.2 * SKIP_RATE);
  });
});

describe('createStallWatch', () => {
  it('flags a clock that has not advanced for STALL_MS, and recovers when it moves', () => {
    const w = createStallWatch();
    expect(w.stalled(1, 0)).toBe(false);
    expect(w.stalled(1.01, 16)).toBe(false);
    expect(w.stalled(1.01, 16 + STALL_MS - 1)).toBe(false);
    expect(w.stalled(1.01, 16 + STALL_MS)).toBe(true);
    expect(w.stalled(1.02, 16 + STALL_MS + 16)).toBe(false);
  });
});

describe('pickClockSource', () => {
  it('uses the raw audio clock, with output latency reported separately, only when running', () => {
    const ctx = { state: 'running', currentTime: 10, outputLatency: 0.02 };
    const s = pickClockSource(ctx, () => 0);
    expect(s.audio).toBe(true);
    expect(s.source()).toBe(10);
    expect(s.latency()).toBeCloseTo(0.02);
  });
  it('falls back to performance time when suspended or missing', () => {
    expect(pickClockSource({ state: 'suspended', currentTime: 0 }, () => 4000).source()).toBe(4);
    const p = pickClockSource(null, () => 1500);
    expect(p.source()).toBe(1.5);
    expect(p.audio).toBe(false);
    expect(perfSource(() => 2000).latency()).toBe(0);
  });
});
