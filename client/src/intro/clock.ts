// The intro's time base. Picture follows the audio clock when audio is running, so hits stay in
// sync even when frames drop; otherwise it follows performance.now().
import { DURATION, RESOLVE_T0 } from './timeline.js';

/** A skip jumps straight to the resolve (or keeps going from later), then plays at SKIP_RATE. */
export const SKIP_FROM = RESOLVE_T0;
export const SKIP_RATE = 3;
export type TimeSource = () => number;

export class IntroClock {
  private origin: number | null = null;
  private skipOrigin: number | null = null;
  private skipBase = 0;

  constructor(private readonly source: TimeSource) {}

  /** `offset` is the timeline time at this instant (negative = a short lead-in). */
  start(offset = 0): void {
    this.origin = this.source() - offset;
    this.skipOrigin = null;
  }

  get started(): boolean { return this.origin !== null; }
  get skipping(): boolean { return this.skipOrigin !== null; }
  get done(): boolean { return this.started && this.now() >= DURATION; }

  now(): number {
    if (this.origin === null) return 0;
    if (this.skipOrigin === null) return this.source() - this.origin;
    return this.skipBase + (this.source() - this.skipOrigin) * SKIP_RATE;
  }

  skip(): void {
    if (this.origin === null || this.skipOrigin !== null) return;
    this.skipBase = Math.max(this.now(), SKIP_FROM);
    this.skipOrigin = this.source();
  }
}

export function pickClockSource(
  ctx: { state: string; currentTime: number; outputLatency?: number } | null,
  perfNow: () => number,
): TimeSource {
  if (ctx && ctx.state === 'running') return () => ctx.currentTime - (ctx.outputLatency || 0);
  return () => perfNow() / 1000;
}
