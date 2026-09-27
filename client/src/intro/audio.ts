// Schedules the intro's cue list on any BaseAudioContext: live (AudioContext) and export
// (OfflineAudioContext) share the same plan, so the review mix is exactly what players hear.
import { CUES, MASTER_TRIM, DURATION, MUSIC_RELEASE_T, type AudioId, type Cue } from './timeline.js';

export type AudioBuffers = Partial<Record<AudioId, AudioBuffer>>;

export interface PlannedCue {
  id: AudioId;
  /** Seconds after the schedule's start time. */
  delay: number;
  /** Seconds into the buffer. */
  offset: number;
  dur: number;
  gain: number;
  /** Seconds after the schedule's start when the fade-out begins, or null. */
  fadeOutAt: number | null;
}

export function planCues(
  cues: readonly Cue[],
  durations: Partial<Record<AudioId, number>>,
  fromT: number,
): PlannedCue[] {
  const out: PlannedCue[] = [];
  for (const c of cues) {
    const len = durations[c.id];
    if (len === undefined) continue;
    const full = Math.min(c.dur ?? len, len);
    if (c.t + full <= fromT) continue;
    const offset = Math.max(0, fromT - c.t);
    const delay = Math.max(0, c.t - fromT);
    const dur = full - offset;
    const fo = c.fadeOut ?? 0;
    out.push({
      id: c.id, delay, offset, dur,
      gain: c.gain * MASTER_TRIM,
      fadeOutAt: fo > 0 ? delay + Math.max(0, dur - fo) : null,
    });
  }
  return out;
}

export interface AudioHandle { stop(fade: number): void }

export function scheduleCues(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffers: AudioBuffers,
  cues: readonly Cue[],
  startAt: number,
  fromT = 0,
): AudioHandle {
  const durations: Partial<Record<AudioId, number>> = {};
  for (const [id, b] of Object.entries(buffers)) if (b) durations[id as AudioId] = b.duration;
  const live: { src: AudioBufferSourceNode; g: GainNode }[] = [];
  for (const p of planCues(cues, durations, fromT)) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[p.id]!;
    const g = ctx.createGain();
    src.connect(g).connect(dest);
    const when = startAt + p.delay;
    g.gain.setValueAtTime(p.gain, when);
    if (p.fadeOutAt !== null) {
      g.gain.setValueAtTime(p.gain, startAt + p.fadeOutAt);
      g.gain.linearRampToValueAtTime(0, when + p.dur);
    }
    src.start(when, p.offset, p.dur);
    live.push({ src, g });
  }
  return {
    stop(fade: number) {
      const now = ctx.currentTime;
      for (const { src, g } of live) {
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fade);
          src.stop(now + fade + 0.02);
        } catch { /* already finished */ }
      }
    },
  };
}

/** Ambience level relative to the intro at the default slider (0.3 music vs 0.75 intro). */
export const EXPORT_AMBIENCE_LEVEL = 0.4;

export async function renderIntroMix(buffers: AudioBuffers, ambience: AudioBuffer | null, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil((DURATION + 3) * sampleRate), sampleRate);
  scheduleCues(ctx, ctx.destination, buffers, CUES, 0);
  if (ambience) {
    const src = ctx.createBufferSource();
    src.buffer = ambience;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, MUSIC_RELEASE_T);
    g.gain.linearRampToValueAtTime(EXPORT_AMBIENCE_LEVEL, MUSIC_RELEASE_T + 2.5);
    src.connect(g).connect(ctx.destination);
    src.start(MUSIC_RELEASE_T);
  }
  return ctx.startRendering();
}

export interface WavSource {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export function encodeWav(buf: WavSource): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}
