// Pure playback rules for sampled SFX: take rotation and per-id throttling.

/** Random take index that never repeats `last` (unless there is only one take). */
export function pickTake(count: number, last: number | undefined, rand: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (last === undefined) return Math.min(count - 1, Math.floor(rand() * count));
  const i = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return i >= last ? i + 1 : i;
}

/** Per-id minimum gap and concurrent-voice cap, so a party's steps or a flurry of hits can't stack into noise. */
export class SfxLimiter {
  private lastAt = new Map<string, number>();
  private voices = new Map<string, number>();

  tryStart(id: string, nowMs: number, minGapMs: number, maxVoices: number): boolean {
    const last = this.lastAt.get(id);
    if (last !== undefined && nowMs - last < minGapMs) return false;
    const v = this.voices.get(id) ?? 0;
    if (v >= maxVoices) return false;
    this.lastAt.set(id, nowMs);
    this.voices.set(id, v + 1);
    return true;
  }

  end(id: string): void {
    this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 0) - 1));
  }
}
