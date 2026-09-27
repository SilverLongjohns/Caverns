// Single source of truth for the intro cold open, a 9-second CRT ident. Picture effects (shake,
// flash, aberration) and the audio schedule both read from here, so sound and image land together.
import { clamp } from './math.js';

export const DURATION = 9;
export const LR_W = 320;
export const LR_H = 180;
/** The app's body background: the power-on decays into it, and the dark/resolve shots sit on it. */
export const BG = '#0a0806';

export type ShotId = 'power' | 'dark' | 'resolve';
export interface Shot { id: ShotId; t0: number; t1: number }
export const SHOTS: readonly Shot[] = [
  { id: 'power', t0: 0, t1: 1.6 },
  { id: 'dark', t0: 1.6, t1: 5 },
  { id: 'resolve', t0: 5, t1: DURATION },
];

export function shotAt(t: number): Shot {
  const c = clamp(t, 0, DURATION - 1e-6);
  for (const s of SHOTS) if (c >= s.t0 && c < s.t1) return s;
  return SHOTS[SHOTS.length - 1];
}

// ── Key moments ──
export const POWER_END_T = SHOTS[0].t1;  // the set has warmed up; black and silence until the drip
export const DARK_T0 = SHOTS[1].t0;      // the dark begins (the DOM is measured from here on)
export const DRIP_T = 2.4;               // the single drip lands
export const RESOLVE_T0 = SHOTS[2].t0;   // the resolve begins
export const MUSIC_RELEASE_T = 6;        // menu ambience starts fading in under the chord bloom
export const GLYPH_T0 = 5;               // ASCII cavern starts scanning in
export const GLYPH_T1 = 7.2;             // ...and is complete
export const LOGO_T0 = 6;
export const LOGO_T1 = 7.4;
export const EYES_SETTLE_T0 = 7.4;       // canvas eyes converge on the live DOM eye opacity
export const EYES_SETTLE_T1 = 8.4;
export const UNDERLAY_T0 = 8;            // the whole frame crossfades to the real login screen
export const UNDERLAY_T1 = 8.8;
export const FADE_OUT_S = 0.3;           // CSS fade of the whole canvas after DURATION

export interface Hit { t: number; k: number }
export const HITS: readonly Hit[] = [
  { t: 0.25, k: 0.5 },                   // tube snaps open
];

/** Strongest decaying impulse from any hit at time t. */
export function impact(t: number, decay: number): number {
  let v = 0;
  for (const h of HITS) {
    const d = t - h.t;
    if (d >= 0 && d < 3) v = Math.max(v, h.k * Math.exp(-d * decay));
  }
  return v;
}

// ── Eyes: indices into CaveBackground's EYES array (DOM order of .cave-eyes) ──
export const EYE_ORDER: readonly number[] = [4, 0, 9, 1, 7, 2, 10, 5, 3, 6, 8];
export const EYE_FIRST_T = 2.8;
export const EYE_STEP = 0.2;
export function eyeOpenTime(i: number): number {
  const k = EYE_ORDER.indexOf(i);
  return k < 0 ? Infinity : EYE_FIRST_T + k * EYE_STEP;
}

// ── Audio ──
export const AUDIO_IDS = [
  'score_bloom',
  'sfx_relay', 'sfx_flyback', 'sfx_degauss', 'sfx_static', 'sfx_drip', 'sfx_heart', 'sfx_tick', 'sfx_crackle',
] as const;
export type AudioId = (typeof AUDIO_IDS)[number];

/** A one-shot at timeline time t. `dur` trims it; `fadeOut` ramps to 0 over the last seconds. */
export interface Cue { id: AudioId; t: number; gain: number; dur?: number; fadeOut?: number }

/** Global level trim, set so the mix measures about −16 LUFS. */
export const MASTER_TRIM = 1.45;

const RAW_CUES: Cue[] = [
  { id: 'sfx_relay', t: 0, gain: 0.6, dur: 1.0 },
  { id: 'sfx_flyback', t: 0.02, gain: 0.35, dur: 1.5, fadeOut: 0.5 },
  { id: 'sfx_degauss', t: 0.25, gain: 0.5, dur: 1.3, fadeOut: 0.4 },
  { id: 'sfx_static', t: 0.3, gain: 0.36, dur: 1.3, fadeOut: 0.6 },
  { id: 'sfx_drip', t: DRIP_T, gain: 0.8 },
  { id: 'sfx_heart', t: 2.7, gain: 0.7, dur: 2.3, fadeOut: 0.6 },
  ...EYE_ORDER.map((_, k) => ({ id: 'sfx_tick' as const, t: EYE_FIRST_T + k * EYE_STEP, gain: 0.35 })),
  { id: 'score_bloom', t: RESOLVE_T0, gain: 1 },
  { id: 'sfx_crackle', t: RESOLVE_T0, gain: 0.4, dur: 2.5, fadeOut: 0.8 },
];
export const CUES: readonly Cue[] = RAW_CUES.slice().sort((a, b) => a.t - b.t);

/** Played instead of the rest of the schedule when the viewer skips (times relative to the skip). */
export const SKIP_CUES: readonly Cue[] = [
  { id: 'sfx_crackle', t: 0, gain: 0.4, dur: 1.4, fadeOut: 0.5 },
  { id: 'score_bloom', t: 0.1, gain: 0.8 },
];
