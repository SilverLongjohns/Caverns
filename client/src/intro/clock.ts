// The intro's time base. Picture follows the audio clock when audio is running, so hits stay in
// sync even when frames drop; otherwise it follows performance.now(). If the audio clock stalls
// (Safari "interrupted", iOS backgrounding), the player switches to performance time mid-run.
import { DURATION, RESOLVE_T0 } from './timeline.js';

/** A skip jumps straight to the resolve (or keeps going from later), then plays at SKIP_RATE. */
export const SKIP_FROM = RESOLVE_T0;
export const SKIP_RATE = 3;
/** How long the audio clock may stand still (in performance.now() ms) before it's abandoned. */
export const STALL_MS = 750;
export type TimeSource = () => number;
/** Seconds between a sample being scheduled and it being heard. */
export type LatencySource = () => number;

export interface ClockSource {
  source: TimeSource;
  latency: LatencySource;
  /** True when `source` is the audio clock (and so can stall). */
  audio: boolean;
}

export class IntroClock {
  private origin: number | null = null;
  private skipOrigin: number | null = null;
  private skipBase = 0;
  private last = -Infinity;

  /**
   * `source` is the raw clock that audio is scheduled against; `latency` is subtracted live from
   * the unskipped time, so frame t is shown when the audio scheduled for t is heard.
   */
  constructor(private source: TimeSource, private latency: LatencySource = () => 0) {}

  /** `offset` is the timeline time at this instant, before latency (negative = a short lead-in). */
  start(offset = 0): void {
    this.origin = this.source() - offset;
    this.skipOrigin = null;
    this.last = -Infinity;
  }

  get started(): boolean { return this.origin !== null; }
  get skipping(): boolean { return this.skipOrigin !== null; }
  get done(): boolean { return this.started && this.now() >= DURATION; }

  /** Never runs backwards: latency reported late (or jittering) holds the picture instead. */
  now(): number {
    if (this.origin === null) return 0;
    const t = this.skipOrigin === null
      ? this.source() - this.origin - this.latency()
      : this.skipBase + (this.source() - this.skipOrigin) * SKIP_RATE;
    if (t > this.last) this.last = t;
    return this.last;
  }

  skip(): void {
    if (this.origin === null || this.skipOrigin !== null) return;
    this.skipBase = Math.max(this.now(), SKIP_FROM);
    this.skipOrigin = this.source();
  }

  /** Swap the time base, continuing from the current t (skipping or not). */
  switchSource(source: TimeSource, latency: LatencySource = () => 0): void {
    const t = this.now();
    this.source = source;
    this.latency = latency;
    if (this.origin === null) return;
    if (this.skipOrigin === null) {
      this.origin = source() - latency() - t;
    } else {
      this.skipBase = t;
      this.skipOrigin = source();
    }
  }
}

type ClockCtx = { state: string; currentTime: number; outputLatency?: number };

export function pickClockSource(ctx: ClockCtx | null, perfNow: () => number): ClockSource {
  if (ctx && ctx.state === 'running') {
    return { source: () => ctx.currentTime, latency: () => ctx.outputLatency || 0, audio: true };
  }
  return perfSource(perfNow);
}

export function perfSource(perfNow: () => number): ClockSource {
  return { source: () => perfNow() / 1000, latency: () => 0, audio: false };
}

/**
 * Watches a clock value against performance.now(): `stalled` turns true once the value hasn't
 * advanced for `limitMs`.
 */
export function createStallWatch(limitMs = STALL_MS) {
  let lastValue = NaN;
  let lastMoved = 0;
  return {
    stalled(value: number, perfMs: number): boolean {
      if (value !== lastValue) { lastValue = value; lastMoved = perfMs; return false; }
      return perfMs - lastMoved >= limitMs;
    },
  };
}
