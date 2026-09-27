import { describe, it, expect } from 'vitest';
import { IntroClock, SKIP_FROM, SKIP_RATE, pickClockSource } from './clock.js';
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

describe('pickClockSource', () => {
  it('uses the audio clock (minus output latency) only when the context is running', () => {
    const ctx = { state: 'running', currentTime: 10, outputLatency: 0.02 };
    expect(pickClockSource(ctx, () => 0)()).toBeCloseTo(9.98);
  });
  it('falls back to performance time when suspended or missing', () => {
    expect(pickClockSource({ state: 'suspended', currentTime: 0 }, () => 4000)()).toBe(4);
    expect(pickClockSource(null, () => 1500)()).toBe(1.5);
  });
});
