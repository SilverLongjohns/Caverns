// Synthesised UI sounds (no asset files). Routed by the caller into the master bus.
export type UiSound = 'click' | 'tick' | 'power' | 'crack' | 'boom' | 'shimmer';

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
  } else if (sound === 'power') {
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
  } else if (sound === 'crack') {
    // sharp noise burst through a bandpass + a bright square snap
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.1);
    blip(ctx, dest, 2400, 0.03, 0.08);
  } else if (sound === 'boom') {
    // low falling sine thump with a tail
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.62);
  } else {
    // shimmer: two detuned rising triangles
    for (const f of [660, 663]) {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 2, t + 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + 0.47);
    }
  }
}
