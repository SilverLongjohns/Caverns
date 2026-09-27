import { describe, it, expect } from 'vitest';
import { planCues, encodeWav } from './audio.js';
import { MASTER_TRIM, type Cue } from './timeline.js';

const cues: Cue[] = [
  { id: 'sfx_relay', t: 0, gain: 1, dur: 1 },
  { id: 'sfx_step', t: 5, gain: 0.5, dur: 2, fadeOut: 0.5 },
  { id: 'sfx_drip', t: 8, gain: 0.8 },
  { id: 'sfx_heart', t: 9, gain: 1 },
];
const durations = { sfx_relay: 1.5, sfx_step: 3, sfx_drip: 1.2 };

describe('planCues', () => {
  it('skips cues whose buffer is missing', () => {
    expect(planCues(cues, durations, 0).map((p) => p.id)).toEqual(['sfx_relay', 'sfx_step', 'sfx_drip']);
  });
  it('trims to dur, never beyond the buffer, and applies MASTER_TRIM', () => {
    const [relay, step, drip] = planCues(cues, durations, 0);
    expect(relay).toMatchObject({ delay: 0, offset: 0, dur: 1, fadeOutAt: null });
    expect(step.gain).toBeCloseTo(0.5 * MASTER_TRIM);
    expect(step.fadeOutAt).toBeCloseTo(5 + 1.5);
    expect(drip.dur).toBeCloseTo(1.2);
  });
  it('starts mid-cue with an offset when scheduled from a later time', () => {
    const plan = planCues(cues, durations, 5.5);
    expect(plan.map((p) => p.id)).toEqual(['sfx_step', 'sfx_drip']);
    expect(plan[0]).toMatchObject({ delay: 0, offset: 0.5 });
    expect(plan[0].dur).toBeCloseTo(1.5);
    expect(plan[0].fadeOutAt).toBeCloseTo(1.0);
    expect(plan[1].delay).toBeCloseTo(2.5);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit PCM RIFF header and clipped interleaved samples', () => {
    const l = new Float32Array([0, 1, -1, 2]);
    const r = new Float32Array([0.5, -0.5, 0, -2]);
    const buf = encodeWav({ numberOfChannels: 2, sampleRate: 48000, length: 4, getChannelData: (c) => (c === 0 ? l : r) });
    const v = new DataView(buf);
    const str = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(buf.byteLength).toBe(44 + 4 * 2 * 2);
    expect(v.getInt16(44 + 2 * 2, true)).toBe(32767);   // L[1] = 1
    expect(v.getInt16(44 + 6 * 2, true)).toBe(32767);   // L[3] = 2 → clipped
    expect(v.getInt16(44 + 7 * 2, true)).toBe(-32768);  // R[3] = -2 → clipped
  });
});
