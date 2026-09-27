// Single source of truth for the intro cold open. Picture effects (shake, flash, aberration)
// and the audio schedule both read from here, so sound and image land on the same marks.
import { clamp } from './math.js';

export const DURATION = 30;
export const LR_W = 320;
export const LR_H = 180;
/** The app's body background: the dark/resolve shots fade into exactly this. */
export const BG = '#0a0806';

export type ShotId = 'power' | 'waste' | 'threshold' | 'descent' | 'dark' | 'resolve';
export interface Shot { id: ShotId; t0: number; t1: number }
export const SHOTS: readonly Shot[] = [
  { id: 'power', t0: 0, t1: 1.6 },
  { id: 'waste', t0: 1.6, t1: 8 },
  { id: 'threshold', t0: 8, t1: 13 },
  { id: 'descent', t0: 13, t1: 22 },
  { id: 'dark', t0: 22, t1: 26 },
  { id: 'resolve', t0: 26, t1: DURATION },
];

export function shotAt(t: number): Shot {
  const c = clamp(t, 0, DURATION - 1e-6);
  for (const s of SHOTS) if (c >= s.t0 && c < s.t1) return s;
  return SHOTS[SHOTS.length - 1];
}

// ── Key moments ──
export const STEP_T = 12.6;            // the figure steps off the edge
export const SCORE_STOP_T = 22;        // hard cut to black and silence
export const DRIP_T = 22.8;            // the single drip lands
export const MUSIC_RELEASE_T = 27;     // menu ambience starts fading in under the chord bloom
export const GLYPH_T0 = 26.2;          // ASCII cavern starts scanning in
export const GLYPH_T1 = 28.4;          // ...and is complete
export const LOGO_T0 = 27.2;
export const LOGO_T1 = 28.6;
export const EYES_SETTLE_T0 = 28.6;    // canvas eyes converge on the live DOM eye opacity
export const EYES_SETTLE_T1 = 29.6;
export const UNDERLAY_T0 = 29;         // canvas backdrop fades, revealing the real login screen
export const UNDERLAY_T1 = 29.8;
export const FADE_OUT_S = 0.3;         // CSS fade of the whole canvas after DURATION

export type StratumId = 'conduits' | 'screens' | 'fungal' | 'crystal';
/** Descent strata. A stratum's t0 is when its upper boundary passes the falling figure. */
export const STRATA: readonly { id: StratumId; t0: number }[] = [
  { id: 'conduits', t0: 13 },
  { id: 'screens', t0: 15.5 },
  { id: 'fungal', t0: 18.5 },
  { id: 'crystal', t0: 21 },
];

export interface Hit { t: number; k: number }
const BRAAM_K = [0.8, 0.85, 0.95];
export const HITS: readonly Hit[] = [
  { t: 0.25, k: 0.5 },                 // tube snaps open
  { t: STEP_T, k: 0.9 },
  ...STRATA.slice(1).map((s, i) => ({ t: s.t0, k: BRAAM_K[i] })),
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
export const EYE_FIRST_T = 23.6;
export const EYE_STEP = 0.2;
export function eyeOpenTime(i: number): number {
  const k = EYE_ORDER.indexOf(i);
  return k < 0 ? Infinity : EYE_FIRST_T + k * EYE_STEP;
}

// ── Audio ──
export const AUDIO_IDS = [
  'score_main', 'score_bloom',
  'sfx_relay', 'sfx_flyback', 'sfx_degauss', 'sfx_static', 'sfx_wind', 'sfx_groan', 'sfx_creak',
  'sfx_step', 'sfx_air', 'sfx_braam', 'sfx_drip', 'sfx_heart', 'sfx_tick', 'sfx_crackle',
] as const;
export type AudioId = (typeof AUDIO_IDS)[number];

/** A one-shot at timeline time t. `dur` trims it; `fadeOut` ramps to 0 over the last seconds. */
export interface Cue { id: AudioId; t: number; gain: number; dur?: number; fadeOut?: number }

/** Global level trim, set in Task 14 so the mix measures about −16 LUFS. */
export const MASTER_TRIM = 0.66;

const SCORE_T = 1.4;
const AIR_T = 12.75;
const RAW_CUES: Cue[] = [
  { id: 'sfx_relay', t: 0, gain: 0.9, dur: 1.0 },
  { id: 'sfx_flyback', t: 0.02, gain: 0.35, dur: 1.5, fadeOut: 0.5 },
  { id: 'sfx_degauss', t: 0.25, gain: 0.8, dur: 1.4, fadeOut: 0.4 },
  { id: 'sfx_static', t: 0.3, gain: 0.5, dur: 1.4, fadeOut: 0.5 },
  { id: 'sfx_wind', t: 1.2, gain: 0.55, dur: 7.6, fadeOut: 1.5 },
  { id: 'score_main', t: SCORE_T, gain: 0.9, dur: SCORE_STOP_T - SCORE_T, fadeOut: 0.012 },
  { id: 'sfx_groan', t: 4.2, gain: 0.6, dur: 3.6, fadeOut: 1.0 },
  { id: 'sfx_creak', t: 8.6, gain: 0.45, dur: 1.4, fadeOut: 0.3 },
  { id: 'sfx_step', t: STEP_T, gain: 1, dur: 2.0, fadeOut: 0.6 },
  { id: 'sfx_air', t: AIR_T, gain: 0.6, dur: SCORE_STOP_T - AIR_T, fadeOut: 0.012 },
  { id: 'sfx_braam', t: STRATA[1].t0, gain: 0.85, dur: 2.8, fadeOut: 1.0 },
  { id: 'sfx_braam', t: STRATA[2].t0, gain: 0.85, dur: 2.8, fadeOut: 1.0 },
  { id: 'sfx_braam', t: STRATA[3].t0, gain: 0.9, dur: SCORE_STOP_T - STRATA[3].t0, fadeOut: 0.012 },
  { id: 'sfx_drip', t: DRIP_T, gain: 0.8 },
  { id: 'sfx_heart', t: 23.3, gain: 0.7, dur: 2.7, fadeOut: 0.6 },
  ...EYE_ORDER.map((_, k) => ({ id: 'sfx_tick' as const, t: EYE_FIRST_T + k * EYE_STEP, gain: 0.35 })),
  { id: 'score_bloom', t: 26, gain: 0.9 },
  { id: 'sfx_crackle', t: 26, gain: 0.4, dur: 3.2, fadeOut: 0.8 },
];
export const CUES: readonly Cue[] = RAW_CUES.slice().sort((a, b) => a.t - b.t);

/** Played instead of the rest of the schedule when the viewer skips (times relative to the skip). */
export const SKIP_CUES: readonly Cue[] = [
  { id: 'sfx_crackle', t: 0, gain: 0.4, dur: 1.4, fadeOut: 0.5 },
  { id: 'score_bloom', t: 0.1, gain: 0.8 },
];
