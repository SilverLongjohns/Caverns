// Synthesised UI sounds (no asset files). Routed by the caller into the master bus.
export type UiSound = 'click' | 'tick' | 'power';

/** Hover ticks play at most once per window; clicks and power always play. */
export function createUiThrottle(minGapMs = 80): (sound: UiSound, nowMs: number) => boolean {
  let lastTick = Number.NEGATIVE_INFINITY;
  return (sound, now) => {
    if (sound !== 'tick') return true;
    if (now - lastTick < minGapMs) return false;
    lastTick = now;
    return true;
  };
}

function blip(ctx: BaseAudioContext, dest: AudioNode, freq: number, dur: number, peak: number, type: OscillatorType = 'square'): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function synthUiSound(ctx: BaseAudioContext, dest: AudioNode, sound: UiSound): void {
  if (sound === 'click') {
    // relay: a hard square snap plus a low body
    blip(ctx, dest, 1900, 0.018, 0.12);
    blip(ctx, dest, 220, 0.04, 0.08, 'triangle');
  } else if (sound === 'tick') {
    blip(ctx, dest, 3200, 0.008, 0.035, 'sine');
  } else {
    // power: a rising sweep with a short hum
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.26);
  }
}
