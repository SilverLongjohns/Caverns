# Intro Cold Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 30-second, wordless cinematic cold open. It starts with an old-TV CRT power-on and resolves pixel-for-pixel into the existing login screen. Picture comes from a canvas engine, re-pixelated AI video plates and PixelLab art; sound comes from ElevenLabs.

**Architecture:** A self-contained `client/src/intro/` module. Its timing and data layers are pure and unit-tested. Rendering is a 320×180 low-res scene layer, sharp-bilinear upscaled, plus a native-resolution layer that draws the ASCII cavern, eyes and logo at the exact DOM coordinates of the real screen underneath. AI video plates are re-pixelated **offline** by an ffmpeg bake script into palette-snapped PNG atlases, so every frame is a pure function of time. Audio runs through one shared Web Audio engine (`client/src/audio/`). The engine also takes over `MusicPlayer`, adding a seamless menu ambience loop that crossfades to `gasket_maples` in-world. A Playwright tool renders stills, exports frames and the mix, and verifies the handoff and input isolation.

**Tech Stack:** TypeScript, React 19 + Zustand, Canvas 2D, Web Audio, Vite, Vitest, Playwright (Edge channel), ffmpeg (WSL), PixelLab MCP, ElevenLabs MCP.

**Spec:** `docs/superpowers/specs/2026-09-27-intro-cold-open-design.md`

**Two decisions refine the spec:**
1. *Plates are re-pixelated offline, not live.* Offline baking gives the same result as the spec's `plate.ts` pass (downsample to 320×180 → palette snap → Bayer dither) with no `<video>` sync drift, no mobile autoplay issues, and exact stills. Plates ship as palette PNG atlases, not MP4.
2. *The score is two cues from the start* (`score_main` hard-stopped at 22.0 s, `score_bloom` at 26.0 s). This was the spec's fallback. It makes the silence a guarantee rather than a hope.

## Global Constraints

- Duration **30.0 s**. Shot bounds: power 0–1.6, waste 1.6–8, threshold 8–13, descent 13–22, dark 22–26, resolve 26–30.
- `CaveBackground.tsx` and the logo are **not modified**. The only `LoginScreen` change is the `↺ intro` replay link.
- Wordless: no narration or text cards (the gate prompt `▌ PRESS ANY KEY` is the only text).
- localStorage key `caverns_intro_seen` (value `'1'`), and every storage access is try/catch-guarded. `?intro` forces play. `?still=<t>` renders one frame. The intro never plays with `?sandbox=`. Honour `prefers-reduced-motion` (skip) unless `?intro`.
- Fallbacks: assets fail, or aren't ready 8 s after the gate → go straight to login. A render error → immediate handoff. The intro never blocks login.
- Escape on the gate skips entirely. Any key or click during playback → accelerated resolve (jump to 26 s, 3× speed).
- Canvas sits **below** the app's `.crt-overlay` (z 998). Intro root z-index 900.
- Music: ambience loop on connecting/login/character_select; `gasket_maples` elsewhere; 2.5 s crossfade. `MusicPlayer` volume/mute (key `caverns_music_volume`) control both and the intro.
- Assets live in `client/public/intro/`, target **≤ 6 MB** total. Raw generations go in `art/intro/raw/` (git-ignored). Review output goes in `.intro/` (git-ignored).
- Art direction: Caves-of-Qud retro-future post-collapse (relic megastructures, salt waste, strange skies). No classic fantasy. The figure is a generic gas-masked sump. Style anchor: `client/public/portraits/*.png`.
- Node runs on **Windows**: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && <cmd>"`. ffmpeg runs in **WSL** (`/usr/bin/ffmpeg`).
- Tests: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro src/audio"`. Type check: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit"` (it's clean at the start, so keep it clean).
- Commits: Windows git, **explicit paths only**, never push, branch `feature/intro-cold-open`. Recipe:
  ```bash
  printf '%s\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' "<subject>" > .git/CLAUDE_MSG
  cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && git add <paths> && git commit -q -F .git/CLAUDE_MSG"; rm -f .git/CLAUDE_MSG
  ```
- **User checkpoints** (Tasks 8 and 10) must be run by the controlling session, not a subagent, because they need the user's eyes and ears.

## Review Focus

1. **Keystrokes during the intro must not type into the login name field.** A capture-phase window listener swallows them, including during the fade. Pinned by the `keys` mode in Task 6, run in Task 13.
2. **A returning user with a session token** reaches `character_select` mid-intro. The handoff must still land correctly (CharacterSelect also renders `CaveBackground` + logo; measurement is class-based). Pinned by `measureLayout` using only class selectors (Task 4) and a manual check in Task 14.
3. **Suspended/blocked audio** (gesture not honoured, headless): the clock must fall back to `performance.now()`, and the intro plays silently and still finishes. Pinned by the `pickClockSource` tests (Task 1).
4. **Automation and sandbox pages** (`?sandbox=`, Playwright fresh profiles) must never get an intro that covers the UI. Pinned by the `shouldPlayIntro` tests (Task 1).
5. **Odd viewports and resize mid-intro** (1366×768, ultrawide, portrait): cover-fit must fill with no gaps, and native layers must re-measure. Pinned by the `coverFit` tests (Task 4) and `stills --viewport` runs in Task 13.

---

## File Structure

```
client/src/intro/
  math.ts            easing, noise, hash, clamp/lerp/inv (pure)
  timeline.ts        shots, hits, strata, eye order, audio cues, key times (pure data)
  introState.ts      should-play logic, seen flag, URL params (pure + browser reader)
  introStore.ts      zustand store: active / musicHold / gateless
  clock.ts           IntroClock (skip-aware) + pickClockSource (pure)
  layout.ts          coverFit, glyphRevealTime (pure) + measureLayout (DOM)
  plate.ts           atlas frame math (pure) + drawPlate
  assets.ts          manifest + loader
  audio.ts           planCues/encodeWav (pure) + scheduleCues + renderIntroMix
  renderer.ts        IntroRenderer: low-res scene → upscale → post → native layers
  shots/power.ts     powerState (pure), dead glass, CRT warm pass, aperture
  shots/plates.ts    waste + threshold plates with dust and signal-light overlays
  shots/descent.ts   fallDepth/stratum math (pure) + parallax fall
  shots/dark.ts      drip + ripple (low-res), eyes (native)
  shots/resolve.ts   glyph build, logo burn, underlay fade (native)
  IntroCutscene.tsx  React shell: gate, input, loop, lifecycle, still/export hooks
  README.md          pipeline + tooling notes
  *.test.ts          unit tests for every pure module
client/src/audio/
  audioEngine.ts     shared AudioContext, master/intro/music buses, track crossfade
  musicTrack.ts      pickTrack (pure)
  *.test.ts
client/src/components/MusicPlayer.tsx   (modify) UI over audioEngine
client/src/components/LoginScreen.tsx   (modify) replay link
client/src/App.tsx                      (modify) mount intro, login underlay while connecting
client/src/styles/index.css             (modify) intro + replay + hidden music player styles
scripts/intro-bake.sh                   ffmpeg: palette, plates→atlases, layers, audio, analysis
scripts/intro-render.mjs                Playwright: stills, frames, wav, handoff, keys
client/public/intro/                    shipped assets
art/intro/                              palette + keyframes (tracked), raw/ (ignored)
```

---

### Task 1: Pure intro core: math, timeline, state, clock

**Files:**
- Create: `client/src/intro/math.ts`, `client/src/intro/timeline.ts`, `client/src/intro/introState.ts`, `client/src/intro/clock.ts`, `client/src/intro/introStore.ts`
- Test: `client/src/intro/timeline.test.ts`, `client/src/intro/introState.test.ts`, `client/src/intro/clock.test.ts`

**Interfaces:**
- Produces: `clamp, lerp, inv, ease, hash, vnoise, mulberry32` (math); `DURATION, LR_W, LR_H, BG, SHOTS, shotAt, HITS, impact, STRATA, STEP_T, SCORE_STOP_T, DRIP_T, MUSIC_RELEASE_T, GLYPH_T0, GLYPH_T1, LOGO_T0, LOGO_T1, UNDERLAY_T0, UNDERLAY_T1, EYES_SETTLE_T0, EYES_SETTLE_T1, FADE_OUT_S, EYE_ORDER, EYE_FIRST_T, EYE_STEP, eyeOpenTime, AUDIO_IDS, AudioId, Cue, CUES, SKIP_CUES, MASTER_TRIM, ShotId, StratumId` (timeline); `SEEN_KEY, StorageLike, IntroEnv, hasSeenIntro, markIntroSeen, parseStill, shouldPlayIntro, safeStorage, readIntroEnv` (introState); `IntroClock, SKIP_FROM, SKIP_RATE, TimeSource, pickClockSource` (clock); `useIntroStore, createIntroStore` with state `{ active, musicHold, gateless, releaseMusic(), finish(), replay() }` (introStore).

- [ ] **Step 1: Write the failing tests**

`client/src/intro/timeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DURATION, SHOTS, shotAt, HITS, STRATA, CUES, AUDIO_IDS, EYE_ORDER, eyeOpenTime,
  SCORE_STOP_T, DRIP_T, impact, SKIP_CUES,
} from './timeline.js';

describe('timeline', () => {
  it('shots are contiguous and cover exactly [0, DURATION]', () => {
    expect(DURATION).toBe(30);
    expect(SHOTS[0].t0).toBe(0);
    expect(SHOTS[SHOTS.length - 1].t1).toBe(DURATION);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].t0).toBe(SHOTS[i - 1].t1);
  });

  it('shotAt resolves boundaries to the later shot and clamps out-of-range times', () => {
    expect(shotAt(-5).id).toBe('power');
    expect(shotAt(1.6).id).toBe('waste');
    expect(shotAt(7.999).id).toBe('waste');
    expect(shotAt(8).id).toBe('threshold');
    expect(shotAt(22).id).toBe('dark');
    expect(shotAt(99).id).toBe('resolve');
  });

  it('hits are sorted, inside the piece, and every stratum boundary has a braam hit', () => {
    for (let i = 1; i < HITS.length; i++) expect(HITS[i].t).toBeGreaterThan(HITS[i - 1].t);
    for (const h of HITS) {
      expect(h.t).toBeGreaterThanOrEqual(0);
      expect(h.t).toBeLessThan(DURATION);
    }
    for (const s of STRATA.slice(1)) {
      expect(HITS.some((h) => h.t === s.t0)).toBe(true);
      expect(CUES.some((c) => c.id === 'sfx_braam' && c.t === s.t0)).toBe(true);
    }
  });

  it('impact peaks at a hit and decays afterwards', () => {
    const h = HITS[1];
    expect(impact(h.t, 7)).toBeCloseTo(h.k, 5);
    expect(impact(h.t + 0.5, 7)).toBeLessThan(h.k);
    expect(impact(h.t - 0.01, 7)).toBeLessThan(h.k);
  });

  it('cues are sorted, reference known audio ids, and sit inside the piece', () => {
    for (let i = 1; i < CUES.length; i++) expect(CUES[i].t).toBeGreaterThanOrEqual(CUES[i - 1].t);
    for (const c of [...CUES, ...SKIP_CUES]) {
      expect(AUDIO_IDS).toContain(c.id);
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.t).toBeLessThan(DURATION);
    }
  });

  it('guarantees silence from the hard cut until the drip', () => {
    for (const c of CUES) {
      if (c.t >= DRIP_T) continue;
      expect(c.dur, `${c.id}@${c.t} needs an explicit dur`).toBeDefined();
      expect(c.t + (c.dur ?? 0)).toBeLessThanOrEqual(SCORE_STOP_T + 1e-9);
    }
  });

  it('eye order is a permutation of the 11 CaveBackground eyes, all open before the resolve', () => {
    expect([...EYE_ORDER].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 0; i < 11; i++) {
      expect(eyeOpenTime(i)).toBeGreaterThan(DRIP_T);
      expect(eyeOpenTime(i)).toBeLessThan(26);
    }
    expect(eyeOpenTime(99)).toBe(Infinity);
  });
});
```

`client/src/intro/introState.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SEEN_KEY, hasSeenIntro, markIntroSeen, parseStill, shouldPlayIntro, type StorageLike } from './introState.js';

function mem(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const throwing: StorageLike = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
};

describe('introState', () => {
  it('plays on first visit and not after being marked seen', () => {
    const s = mem();
    expect(shouldPlayIntro({ storage: s, search: '', reducedMotion: false })).toBe(true);
    markIntroSeen(s);
    expect(s.data[SEEN_KEY]).toBe('1');
    expect(shouldPlayIntro({ storage: s, search: '', reducedMotion: false })).toBe(false);
  });

  it('?intro forces play even when seen or reduced motion', () => {
    const s = mem(); markIntroSeen(s);
    expect(shouldPlayIntro({ storage: s, search: '?intro', reducedMotion: true })).toBe(true);
  });

  it('reduced motion skips the intro', () => {
    expect(shouldPlayIntro({ storage: mem(), search: '', reducedMotion: true })).toBe(false);
  });

  it('never plays on sandbox pages, even when forced', () => {
    expect(shouldPlayIntro({ storage: mem(), search: '?sandbox=duel', reducedMotion: false })).toBe(false);
    expect(shouldPlayIntro({ storage: mem(), search: '?sandbox=duel&intro', reducedMotion: false })).toBe(false);
  });

  it('survives throwing and missing storage', () => {
    expect(hasSeenIntro(throwing)).toBe(false);
    expect(() => markIntroSeen(throwing)).not.toThrow();
    expect(hasSeenIntro(null)).toBe(false);
    expect(() => markIntroSeen(null)).not.toThrow();
  });

  it('parses ?still as a finite number or null', () => {
    expect(parseStill('?intro&still=12.5')).toBe(12.5);
    expect(parseStill('?still=abc')).toBeNull();
    expect(parseStill('?intro')).toBeNull();
    expect(parseStill('?still=0')).toBe(0);
  });
});
```

`client/src/intro/clock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { IntroClock, SKIP_FROM, SKIP_RATE, pickClockSource } from './clock.js';

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
    c.start(); f.advance(5);
    c.skip();
    expect(c.skipping).toBe(true);
    expect(c.now()).toBeCloseTo(SKIP_FROM);
    f.advance(1);
    expect(c.now()).toBeCloseTo(SKIP_FROM + SKIP_RATE);
  });

  it('skip during the resolve continues from the current time, and is idempotent', () => {
    const f = fake(); const c = new IntroClock(f.source);
    c.start(); f.advance(28);
    c.skip(); f.advance(0.5); c.skip();
    expect(c.now()).toBeCloseTo(28 + 0.5 * SKIP_RATE);
  });

  it('skip before start does nothing; done flips at DURATION', () => {
    const f = fake(); const c = new IntroClock(f.source);
    c.skip(); expect(c.skipping).toBe(false);
    c.start(); f.advance(29.9); expect(c.done).toBe(false);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro"`
Expected: FAIL. The modules can't be resolved.

- [ ] **Step 3: Implement the modules**

`client/src/intro/math.ts`:
```ts
// Small numeric helpers shared by every intro shot. Everything is a pure function of its inputs.

export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Normalised position of x in [a, b], clamped to [0, 1]. */
export const inv = (a: number, b: number, x: number): number =>
  b === a ? (x >= a ? 1 : 0) : clamp((x - a) / (b - a));

export const ease = {
  in2: (t: number) => t * t,
  out2: (t: number) => 1 - (1 - t) * (1 - t),
  out3: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Deterministic pseudo-random in [0, 1). */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Smooth 1D value noise in [-1, 1]. */
export function vnoise(x: number): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`client/src/intro/timeline.ts`:
```ts
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
export const MASTER_TRIM = 1;

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
```

`client/src/intro/introState.ts`:
```ts
// Whether the cold open should play, and the "seen" flag. Storage is always try/catch-guarded.

export const SEEN_KEY = 'caverns_intro_seen';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface IntroEnv { storage: StorageLike | null; search: string; reducedMotion: boolean }

export function hasSeenIntro(storage: StorageLike | null): boolean {
  try { return storage?.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function markIntroSeen(storage: StorageLike | null): void {
  try { storage?.setItem(SEEN_KEY, '1'); } catch { /* private mode etc. */ }
}

export function parseStill(search: string): number | null {
  const v = new URLSearchParams(search).get('still');
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function shouldPlayIntro(env: IntroEnv): boolean {
  const params = new URLSearchParams(env.search);
  if (params.has('sandbox')) return false;
  if (params.has('intro')) return true;
  if (env.reducedMotion) return false;
  return !hasSeenIntro(env.storage);
}

export function safeStorage(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

export function readIntroEnv(): IntroEnv {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browsers */ }
  return { storage: safeStorage(), search: window.location.search, reducedMotion };
}
```

`client/src/intro/clock.ts`:
```ts
// The intro's time base. Picture follows the audio clock when audio is running, so hits stay in
// sync even when frames drop; otherwise it follows performance.now().
import { DURATION } from './timeline.js';

export const SKIP_FROM = 26;
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
```

`client/src/intro/introStore.ts`:
```ts
import { create } from 'zustand';
import { readIntroEnv, shouldPlayIntro } from './introState.js';

export interface IntroStore {
  /** The cutscene is mounted (gate, playing or fading). */
  active: boolean;
  /** Menu music is held back so the intro owns the soundstage. */
  musicHold: boolean;
  /** Replays skip the dead-TV gate: the click that asked for the replay already unlocked audio. */
  gateless: boolean;
  releaseMusic(): void;
  finish(): void;
  replay(): void;
}

export function createIntroStore(initialActive: boolean) {
  return create<IntroStore>((set) => ({
    active: initialActive,
    musicHold: initialActive,
    gateless: false,
    releaseMusic: () => set({ musicHold: false }),
    finish: () => set({ active: false, musicHold: false, gateless: false }),
    replay: () => set({ active: true, musicHold: true, gateless: true }),
  }));
}

export const useIntroStore = createIntroStore(typeof window !== 'undefined' && shouldPlayIntro(readIntroEnv()));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro"`
Expected: PASS (all tests in timeline, introState, clock).
Then `npx tsc --noEmit` (same cmd wrapper). Expected: no errors.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/math.ts client/src/intro/timeline.ts client/src/intro/introState.ts client/src/intro/clock.ts client/src/intro/introStore.ts client/src/intro/timeline.test.ts client/src/intro/introState.test.ts client/src/intro/clock.test.ts`. Subject: `Add intro cold open timeline, state and clock`.

---

### Task 2: Shared audio engine and MusicPlayer refactor

**Files:**
- Create: `client/src/audio/audioEngine.ts`, `client/src/audio/musicTrack.ts`
- Modify: `client/src/components/MusicPlayer.tsx` (full rewrite, same UI), `client/src/styles/index.css` (append)
- Test: `client/src/audio/musicTrack.test.ts`, `client/src/audio/audioEngine.test.ts`

**Interfaces:**
- Consumes: `useIntroStore` (`musicHold`, `active`) from Task 1; `selectCurrentView`, `ClientView` from `client/src/store/gameStore.ts`.
- Produces: `audioEngine` singleton with `context(): AudioContext`, `unlock(): Promise<void>`, `subscribe(cb): () => void`, `getUnlocked(): boolean`, `setVolume(volume: number, muted: boolean): void`, `introDestination(): AudioNode`, `setTrack(track: MusicTrack | null, fade?: number): void`; `busGains(volume, muted): { master: number; intro: number }`; `INTRO_BOOST`; `AMBIENCE_URL`; `pickTrack(view: ClientView, hold: boolean): MusicTrack | null`; `MusicTrack = 'ambience' | 'world'`.

- [ ] **Step 1: Write the failing tests**

`client/src/audio/musicTrack.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickTrack } from './musicTrack.js';

describe('pickTrack', () => {
  it('holds all music while the intro owns the soundstage', () => {
    expect(pickTrack('login', true)).toBeNull();
    expect(pickTrack('in_world', true)).toBeNull();
  });
  it('plays the cavern ambience on pre-game screens', () => {
    for (const v of ['connecting', 'login', 'character_select'] as const) expect(pickTrack(v, false)).toBe('ambience');
  });
  it('plays the world track once in the game', () => {
    for (const v of ['in_world', 'in_dungeon', 'game_over', 'generating'] as const) expect(pickTrack(v, false)).toBe('world');
  });
});
```

`client/src/audio/audioEngine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { busGains, INTRO_BOOST } from './audioEngine.js';

describe('busGains', () => {
  it('passes the slider through as master volume', () => {
    expect(busGains(0.3, false).master).toBeCloseTo(0.3);
  });
  it('boosts the intro so it plays at INTRO_BOOST × volume, capped at unity overall', () => {
    const g = busGains(0.3, false);
    expect(g.master * g.intro).toBeCloseTo(0.3 * INTRO_BOOST);
    const loud = busGains(1, false);
    expect(loud.master * loud.intro).toBeCloseTo(1);
  });
  it('silences everything when muted or at zero', () => {
    expect(busGains(0.8, true)).toEqual({ master: 0, intro: 0 });
    expect(busGains(0, false)).toEqual({ master: 0, intro: 0 });
  });
  it('clamps out-of-range volumes', () => {
    expect(busGains(3, false).master).toBe(1);
    expect(busGains(-1, false)).toEqual({ master: 0, intro: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/audio"`
Expected: FAIL. The modules can't be resolved.

- [ ] **Step 3: Implement the engine, the track picker and the new MusicPlayer**

`client/src/audio/musicTrack.ts`:
```ts
import type { ClientView } from '../store/gameStore.js';

export type MusicTrack = 'ambience' | 'world';

const PRE_GAME: ReadonlySet<ClientView> = new Set(['connecting', 'login', 'character_select']);

export function pickTrack(view: ClientView, hold: boolean): MusicTrack | null {
  if (hold) return null;
  return PRE_GAME.has(view) ? 'ambience' : 'world';
}
```

`client/src/audio/audioEngine.ts`:
```ts
// One AudioContext for the whole client: master volume → { intro bus, ambience, world music }.
// The ambience is a decoded buffer looped sample-accurately (HTMLAudio loops of AAC have gaps).
import { clamp } from '../intro/math.js';
import type { MusicTrack } from './musicTrack.js';

export const AMBIENCE_URL = '/intro/ambience.m4a';
export const WORLD_URL = '/audio/gasket_maples.mp3';
/** The intro plays this much louder than music at the same slider position (capped at unity). */
export const INTRO_BOOST = 2.5;

export function busGains(volume: number, muted: boolean): { master: number; intro: number } {
  const master = muted ? 0 : clamp(volume, 0, 1);
  if (master === 0) return { master: 0, intro: 0 };
  return { master, intro: Math.min(1, master * INTRO_BOOST) / master };
}

type Listener = () => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private intro!: GainNode;
  private amb!: GainNode;
  private world!: GainNode;
  private ambStarted = false;
  private ambBuffer: Promise<AudioBuffer | null> | null = null;
  private worldEl: HTMLAudioElement | null = null;
  private worldPauseTimer = 0;
  private track: MusicTrack | null = null;
  private gains = busGains(0.3, false);
  private readonly listeners = new Set<Listener>();
  private unlocked = false;

  context(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.intro = ctx.createGain();
      this.intro.connect(this.master);
      this.amb = ctx.createGain();
      this.amb.gain.value = 0;
      this.amb.connect(this.master);
      this.world = ctx.createGain();
      this.world.gain.value = 0;
      this.world.connect(this.master);
      this.ctx = ctx;
      this.applyGains();
    }
    return this.ctx;
  }

  /** Call from inside a user gesture. */
  unlock(): Promise<void> {
    const ctx = this.context();
    const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    if (!this.unlocked) {
      this.unlocked = true;
      this.listeners.forEach((l) => l());
    }
    return resumed.catch(() => {});
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  getUnlocked = (): boolean => this.unlocked;

  setVolume(volume: number, muted: boolean): void {
    this.gains = busGains(volume, muted);
    if (this.ctx) this.applyGains();
  }

  introDestination(): AudioNode {
    this.context();
    return this.intro;
  }

  setTrack(track: MusicTrack | null, fade = 2.5): void {
    if (track === this.track) return;
    this.track = track;
    const ctx = this.context();
    const now = ctx.currentTime;
    const ramp = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(v, now + fade);
    };
    ramp(this.amb, track === 'ambience' ? 1 : 0);
    ramp(this.world, track === 'world' ? 1 : 0);
    if (track === 'ambience') void this.startAmbience();
    if (track === 'world') this.startWorld();
    else this.pauseWorldAfter(fade);
  }

  private applyGains(): void {
    const t = this.ctx!.currentTime;
    this.master.gain.setTargetAtTime(this.gains.master, t, 0.05);
    this.intro.gain.setTargetAtTime(this.gains.intro, t, 0.05);
  }

  private loadAmbience(): Promise<AudioBuffer | null> {
    this.ambBuffer ??= fetch(AMBIENCE_URL)
      .then((r) => { if (!r.ok) throw new Error(`ambience ${r.status}`); return r.arrayBuffer(); })
      .then((d) => this.context().decodeAudioData(d))
      .catch(() => null);
    return this.ambBuffer;
  }

  private async startAmbience(): Promise<void> {
    if (this.ambStarted) return;
    this.ambStarted = true;
    const buf = await this.loadAmbience();
    if (!buf) {
      // No ambience asset: fall back to the world track so the menu isn't silent.
      this.ambStarted = false;
      if (this.track === 'ambience') { this.track = null; this.setTrack('world'); }
      return;
    }
    const src = this.context().createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.amb);
    src.start();
  }

  private startWorld(): void {
    window.clearTimeout(this.worldPauseTimer);
    if (!this.worldEl) {
      const el = new Audio(WORLD_URL);
      el.loop = true;
      this.context().createMediaElementSource(el).connect(this.world);
      this.worldEl = el;
    }
    void this.worldEl.play().catch(() => {});
  }

  private pauseWorldAfter(fade: number): void {
    if (!this.worldEl) return;
    window.clearTimeout(this.worldPauseTimer);
    this.worldPauseTimer = window.setTimeout(() => this.worldEl?.pause(), fade * 1000 + 100);
  }
}

export const audioEngine = new AudioEngine();
```

`client/src/components/MusicPlayer.tsx` (replace the whole file):
```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import { audioEngine } from '../audio/audioEngine.js';
import { pickTrack } from '../audio/musicTrack.js';
import { useGameStore, selectCurrentView } from '../store/gameStore.js';
import { useIntroStore } from '../intro/introStore.js';

const STORAGE_KEY = 'caverns_music_volume';

function loadVolume(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return parseFloat(saved);
  } catch { /* ignore */ }
  return 0.3;
}

export function MusicPlayer() {
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const view = useGameStore(selectCurrentView);
  const hold = useIntroStore((s) => s.musicHold);
  const introActive = useIntroStore((s) => s.active);
  const unlocked = useSyncExternalStore(audioEngine.subscribe, audioEngine.getUnlocked);

  useEffect(() => {
    audioEngine.setVolume(volume, muted);
    try { localStorage.setItem(STORAGE_KEY, String(volume)); } catch { /* ignore */ }
  }, [volume, muted]);

  // Browsers block audio until a gesture. The intro unlocks on its own gate; otherwise the first click/key does.
  useEffect(() => {
    const unlock = () => { void audioEngine.unlock(); };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (unlocked) audioEngine.setTrack(pickTrack(view, hold));
  }, [unlocked, view, hold]);

  return (
    <div className={`music-player${introActive ? ' music-player--hidden' : ''}`}>
      <button
        className="music-mute-btn"
        onClick={() => setMuted((m) => !m)}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '♪✕' : '♪'}
      </button>
      <input
        type="range"
        className="music-volume-slider"
        min="0"
        max="1"
        step="0.05"
        value={muted ? 0 : volume}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setVolume(v);
          if (muted && v > 0) setMuted(false);
        }}
      />
    </div>
  );
}
```

Append to `client/src/styles/index.css` directly after the `.music-player { ... }` block:
```css
.music-player--hidden { opacity: 0; pointer-events: none; }
```

- [ ] **Step 4: Run tests and type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/audio src/intro && npx tsc --noEmit"`
Expected: PASS, no type errors.

- [ ] **Step 5: Smoke-test in the browser**

Start both dev servers in the background: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run dev"` (run_in_background). Until Task 5 mounts the intro, a first visit leaves `musicHold` true and the menu silent. That's expected. Check that the page loads without errors:
```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node -e \"const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({channel:'msedge'});const p=await b.newPage();const e=[];p.on('pageerror',x=>e.push(String(x)));await p.goto('http://localhost:5173/');await p.waitForTimeout(2000);console.log('errors:',e);await b.close();})()\""
```
Expected: `errors: []`.

- [ ] **Step 6: Commit**

Paths: `client/src/audio/audioEngine.ts client/src/audio/musicTrack.ts client/src/audio/musicTrack.test.ts client/src/audio/audioEngine.test.ts client/src/components/MusicPlayer.tsx client/src/styles/index.css`. Subject: `Move music onto a shared Web Audio engine with menu ambience track`.

---

### Task 3: Intro audio scheduling and WAV export

**Files:**
- Create: `client/src/intro/audio.ts`
- Test: `client/src/intro/audio.test.ts`

**Interfaces:**
- Consumes: `CUES, Cue, AudioId, MASTER_TRIM, DURATION, MUSIC_RELEASE_T` (Task 1).
- Produces: `PlannedCue`, `planCues(cues, durations, fromT): PlannedCue[]`, `AudioHandle { stop(fade: number): void }`, `scheduleCues(ctx, dest, buffers, cues, startAt, fromT?): AudioHandle`, `renderIntroMix(buffers, ambience): Promise<AudioBuffer>`, `WavSource`, `encodeWav(buf: WavSource): ArrayBuffer`, `EXPORT_AMBIENCE_LEVEL`.

- [ ] **Step 1: Write the failing tests**

`client/src/intro/audio.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro/audio.test.ts"`
Expected: FAIL. The module can't be resolved.

- [ ] **Step 3: Implement `client/src/intro/audio.ts`**

```ts
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
```

- [ ] **Step 4: Run tests and type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro && npx tsc --noEmit"`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/audio.ts client/src/intro/audio.test.ts`. Subject: `Add intro cue scheduling and WAV export`.

---

### Task 4: Layout, cover-fit, plates, descent math, power state (pure helpers)

**Files:**
- Create: `client/src/intro/layout.ts`, `client/src/intro/plate.ts`, `client/src/intro/shots/descent.ts` (math only in this task), `client/src/intro/shots/power.ts` (`powerState` only in this task)
- Test: `client/src/intro/layout.test.ts`, `client/src/intro/plate.test.ts`, `client/src/intro/shots/descent.test.ts`, `client/src/intro/shots/power.test.ts`

**Interfaces:**
- Consumes: Task 1 constants.
- Produces:
  - layout: `Fit { k; ps; dx; dy }`, `coverFit(vw, vh): Fit`, `Rect`, `PreBox { x; y; w; h; clip: Rect; lines: string[]; fontSize; fontFamily; fontWeight; fontStyle; color; opacity; letterSpacing; lineHeight; anchor: 'bottom' | 'top' }`, `EyeBox { a: Rect; b: Rect; el: HTMLElement }`, `SceneLayout { w; h; pres: PreBox[]; eyes: EyeBox[]; logo: Rect | null }`, `measureLayout(root: HTMLElement): SceneLayout`, `glyphRevealTime(anchor, y, viewH, seed): number`.
  - plate: `PlateManifest { fps; frames; cols; rows; w; h; files: string[] }`, `PlateAtlas { manifest; images: HTMLImageElement[] }`, `plateFrameIndex(m, localT)`, `plateFrameSource(m, index): { file; sx; sy }`, `drawPlate(c, atlas | undefined, localT)`.
  - descent: `DESCENT_T0 = 13`, `FIG_Y = 90`, `fallDepth(u)`, `stratumTop(i)`, `stratumAtDepth(d)`.
  - power: `PowerState`, `powerState(t)`.

- [ ] **Step 1: Write the failing tests**

`client/src/intro/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { coverFit, glyphRevealTime } from './layout.js';
import { GLYPH_T0, GLYPH_T1, LR_W, LR_H } from './timeline.js';

describe('coverFit', () => {
  const sizes: [number, number][] = [[1920, 1064], [1366, 752], [3840, 2144], [2560, 1064], [800, 1200], [320, 180], [100, 50]];
  it.each(sizes)('covers %ix%i with no gaps, centred, using an integer pre-scale ≥ k', (vw, vh) => {
    const f = coverFit(vw, vh);
    expect(LR_W * f.k).toBeGreaterThanOrEqual(vw - 1e-6);
    expect(LR_H * f.k).toBeGreaterThanOrEqual(vh - 1e-6);
    expect(f.dx).toBeLessThanOrEqual(1e-6);
    expect(f.dy).toBeLessThanOrEqual(1e-6);
    expect(f.dx * 2 + LR_W * f.k).toBeCloseTo(vw, 6);
    expect(Number.isInteger(f.ps)).toBe(true);
    expect(f.ps).toBeGreaterThanOrEqual(Math.max(1, f.k - 1e-6));
    expect(f.ps).toBeLessThan(f.k + 1);
  });
  it('is exactly 6× at 1920×1080', () => {
    expect(coverFit(1920, 1080)).toEqual({ k: 6, ps: 6, dx: 0, dy: 0 });
  });
});

describe('glyphRevealTime', () => {
  it('stays within the glyph window', () => {
    for (let y = 0; y <= 1000; y += 50) for (const a of ['top', 'bottom'] as const) {
      const t = glyphRevealTime(a, y, 1000, y * 7);
      expect(t).toBeGreaterThanOrEqual(GLYPH_T0);
      expect(t).toBeLessThanOrEqual(GLYPH_T1);
    }
  });
  it('builds stalagmites bottom-up and stalactites top-down (ignoring jitter)', () => {
    expect(glyphRevealTime('bottom', 990, 1000, 0)).toBeLessThan(glyphRevealTime('bottom', 500, 1000, 0));
    expect(glyphRevealTime('top', 10, 1000, 0)).toBeLessThan(glyphRevealTime('top', 300, 1000, 0));
  });
});
```

`client/src/intro/plate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { plateFrameIndex, plateFrameSource, type PlateManifest } from './plate.js';

const m: PlateManifest = { fps: 24, frames: 40, cols: 4, rows: 4, w: 320, h: 180, files: ['a.png', 'b.png', 'c.png'] };

describe('plate atlas math', () => {
  it('maps time to a clamped frame index', () => {
    expect(plateFrameIndex(m, -1)).toBe(0);
    expect(plateFrameIndex(m, 0)).toBe(0);
    expect(plateFrameIndex(m, 1 / 24 + 1e-9)).toBe(1);
    expect(plateFrameIndex(m, 100)).toBe(39);
  });
  it('locates a frame inside the right atlas cell', () => {
    expect(plateFrameSource(m, 0)).toEqual({ file: 0, sx: 0, sy: 0 });
    expect(plateFrameSource(m, 5)).toEqual({ file: 0, sx: 320, sy: 180 });
    expect(plateFrameSource(m, 16)).toEqual({ file: 1, sx: 0, sy: 0 });
    expect(plateFrameSource(m, 39)).toEqual({ file: 2, sx: 3 * 320, sy: 360 });
  });
});
```

`client/src/intro/shots/descent.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fallDepth, stratumTop, stratumAtDepth, FIG_Y, DESCENT_T0 } from './descent.js';
import { STRATA } from '../timeline.js';

describe('descent depth model', () => {
  it('falls monotonically and accelerates', () => {
    expect(fallDepth(0)).toBe(0);
    expect(fallDepth(2) - fallDepth(1)).toBeLessThan(fallDepth(8) - fallDepth(7));
  });
  it('each stratum boundary passes the figure exactly on its braam mark', () => {
    for (let i = 1; i < STRATA.length; i++) {
      const u = STRATA[i].t0 - DESCENT_T0;
      expect(stratumAtDepth(fallDepth(u - 0.01) + FIG_Y)).toBe(i - 1);
      expect(stratumAtDepth(fallDepth(u + 0.01) + FIG_Y)).toBe(i);
      expect(stratumTop(i)).toBeCloseTo(fallDepth(u) + FIG_Y);
    }
  });
  it('the whole column fits the 256px strips (no stratum taller than 256)', () => {
    for (let i = 0; i < STRATA.length; i++) {
      const top = i === 0 ? 0 : stratumTop(i);
      const bottom = i + 1 < STRATA.length ? stratumTop(i + 1) : fallDepth(9) + 180;
      expect(bottom - top).toBeLessThanOrEqual(256);
    }
  });
});
```

`client/src/intro/shots/power.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { powerState } from './power.js';

describe('powerState', () => {
  it('starts as a dot, becomes a line, then opens the tube', () => {
    expect(powerState(0.03).line).toBe(0);
    expect(powerState(0.03).dot).toBeGreaterThan(0);
    expect(powerState(0.2).line).toBeGreaterThan(0.5);
    expect(powerState(0.2).open).toBe(0);
    expect(powerState(0.6).open).toBeGreaterThan(0.95);
  });
  it('snow, barrel and roll are finished by the time the Waste shot starts', () => {
    const s = powerState(1.6);
    expect(s.snow).toBe(0);
    expect(s.barrel).toBeCloseTo(0, 5);
    expect(s.roll).toBe(1);
  });
  it('overbright decays after the snap', () => {
    expect(powerState(0.26).over).toBeGreaterThan(powerState(0.5).over);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro"`
Expected: FAIL. The new modules can't be resolved.

- [ ] **Step 3: Implement**

`client/src/intro/layout.ts`:
```ts
// Geometry: cover-fitting the 320×180 scene, and measuring the real login DOM so the final
// shots draw the ASCII cavern, eyes and logo at exactly the pixels the page will show.
import { LR_W, LR_H, GLYPH_T0, GLYPH_T1 } from './timeline.js';
import { clamp, hash } from './math.js';

export interface Fit { k: number; ps: number; dx: number; dy: number }

/**
 * Cover-fit the low-res frame into vw×vh device px. `k` is the exact scale; `ps` is the integer
 * pre-scale for "sharp bilinear" upscaling (nearest ×ps, then smooth to ×k): crisp and even.
 */
export function coverFit(vw: number, vh: number): Fit {
  const k = Math.max(vw / LR_W, vh / LR_H);
  const ps = Math.max(1, Math.ceil(k - 1e-9));
  return { k, ps, dx: (vw - LR_W * k) / 2, dy: (vh - LR_H * k) / 2 };
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PreBox extends Rect {
  clip: Rect;
  lines: string[];
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  opacity: number;
  letterSpacing: number;
  lineHeight: number;
  anchor: 'bottom' | 'top';
}
export interface EyeBox { a: Rect; b: Rect; el: HTMLElement }
export interface SceneLayout { w: number; h: number; pres: PreBox[]; eyes: EyeBox[]; logo: Rect | null }

function rel(r: DOMRect, o: DOMRect): Rect {
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
}

/** CSS-px layout of the cavern screen under `root`. Class-based, so it works on login and character select. */
export function measureLayout(root: HTMLElement): SceneLayout {
  const o = root.getBoundingClientRect();
  const pres: PreBox[] = [];
  root.querySelectorAll<HTMLElement>('.lobby-cave-bg pre, .lobby-cave-top pre').forEach((el) => {
    const cs = getComputedStyle(el);
    const container = el.parentElement!;
    const fontSize = parseFloat(cs.fontSize);
    pres.push({
      ...rel(el.getBoundingClientRect(), o),
      clip: rel(container.getBoundingClientRect(), o),
      lines: (el.textContent ?? '').split('\n'),
      fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      color: cs.color,
      opacity: parseFloat(cs.opacity),
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      lineHeight: cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight),
      anchor: container.classList.contains('lobby-cave-top') ? 'top' : 'bottom',
    });
  });
  const eyes: EyeBox[] = [];
  root.querySelectorAll<HTMLElement>('.cave-eyes').forEach((el) => {
    const spans = el.querySelectorAll<HTMLElement>('.cave-eye');
    if (spans.length < 2) return;
    eyes.push({ a: rel(spans[0].getBoundingClientRect(), o), b: rel(spans[1].getBoundingClientRect(), o), el });
  });
  const logoEl = root.querySelector<HTMLElement>('.lobby-logo');
  return { w: o.width, h: o.height, pres, eyes, logo: logoEl ? rel(logoEl.getBoundingClientRect(), o) : null };
}

/** When the glyph at CSS y lights up. Stalagmites sweep bottom-up, stalactites top-down, with jitter. */
export function glyphRevealTime(anchor: 'bottom' | 'top', y: number, viewH: number, seed: number): number {
  const jitter = 0.25;
  const span = GLYPH_T1 - GLYPH_T0 - jitter;
  const frac = anchor === 'bottom' ? clamp((viewH - y) / (viewH * 0.55)) : clamp(y / (viewH * 0.35));
  return GLYPH_T0 + frac * span + hash(seed) * jitter;
}
```

`client/src/intro/plate.ts`:
```ts
// AI video plates, pre-pixelated offline (scripts/intro-bake.sh) into palette PNG atlases.
import { LR_W, LR_H } from './timeline.js';

export interface PlateManifest { fps: number; frames: number; cols: number; rows: number; w: number; h: number; files: string[] }
export interface PlateAtlas { manifest: PlateManifest; images: HTMLImageElement[] }

export function plateFrameIndex(m: PlateManifest, localT: number): number {
  return Math.min(m.frames - 1, Math.max(0, Math.floor(localT * m.fps + 1e-6)));
}

export function plateFrameSource(m: PlateManifest, index: number): { file: number; sx: number; sy: number } {
  const per = m.cols * m.rows;
  const file = Math.floor(index / per), cell = index % per;
  return { file, sx: (cell % m.cols) * m.w, sy: Math.floor(cell / m.cols) * m.h };
}

export function drawPlate(c: CanvasRenderingContext2D, atlas: PlateAtlas | undefined, localT: number): void {
  if (!atlas) return;
  const m = atlas.manifest;
  const { file, sx, sy } = plateFrameSource(m, plateFrameIndex(m, localT));
  const img = atlas.images[file];
  if (img) c.drawImage(img, sx, sy, m.w, m.h, 0, 0, LR_W, LR_H);
}
```

`client/src/intro/shots/descent.ts` (math only for now; Task 12 adds drawing below it):
```ts
// THE DESCENT (13–22 s): a vertical fall through four strata, each boundary landing on a braam.
import { STRATA } from '../timeline.js';

export const DESCENT_T0 = 13;
/** Screen row (low-res px) of the falling figure. */
export const FIG_Y = 90;

/** Camera depth in low-res px after u seconds of falling: accelerating. */
export function fallDepth(u: number): number {
  return 28 * u + 4 * u * u;
}

/** Depth where stratum i begins: its boundary crosses the figure exactly at STRATA[i].t0. */
export function stratumTop(i: number): number {
  return i === 0 ? -Infinity : fallDepth(STRATA[i].t0 - DESCENT_T0) + FIG_Y;
}

export function stratumAtDepth(d: number): number {
  let k = 0;
  for (let i = 1; i < STRATA.length; i++) if (d >= stratumTop(i)) k = i;
  return k;
}
```

`client/src/intro/shots/power.ts` (state only for now; Task 11 adds drawing below it):
```ts
// POWER-ON (0–1.6 s): an old analogue set warming up: dot → line → tube snaps open →
// snow, one vertical roll, barrel bulge relaxing into the Waste.
import { clamp, inv, ease } from '../math.js';

export interface PowerState {
  /** 0..1 size of the centre dot. */ dot: number;
  /** 0..1 width of the horizontal line. */ line: number;
  /** 0..1 vertical aperture. */ open: number;
  /** 0..1 overbright wash. */ over: number;
  /** 0..1 static snow mix. */ snow: number;
  /** 0..1 vertical-hold roll progress (1 = settled). */ roll: number;
  /** Barrel distortion strength. */ barrel: number;
  /** Signed degauss wobble. */ wobble: number;
}

export function powerState(t: number): PowerState {
  return {
    dot: t < 0 ? 0 : ease.out2(inv(0, 0.06, t)),
    line: t < 0.06 ? 0 : ease.out3(inv(0.06, 0.25, t)),
    open: t < 0.25 ? 0 : ease.outExpo(inv(0.25, 0.55, t)),
    over: t < 0.25 ? 1 : Math.exp(-(t - 0.25) * 6),
    snow: t < 0.7 ? 1 : clamp(1 - inv(0.7, 1.35, t)),
    roll: ease.inOut(inv(0.72, 1.22, t)),
    barrel: t < 0.25 ? 0.35 : 0.35 * (1 - ease.out3(inv(0.25, 1.6, t))),
    wobble: t < 0.28 || t > 1.0 ? 0 : Math.exp(-(t - 0.28) * 4) * Math.sin(t * 55),
  };
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/intro && npx tsc --noEmit"`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/layout.ts client/src/intro/plate.ts client/src/intro/shots/descent.ts client/src/intro/shots/power.ts client/src/intro/layout.test.ts client/src/intro/plate.test.ts client/src/intro/shots/descent.test.ts client/src/intro/shots/power.test.ts`. Subject: `Add intro geometry, plate, descent and power-on math`.

---

### Task 5: Renderer skeleton, IntroCutscene shell and app integration

This produces a fully working flow (gate → play → skip → handoff → replay, still mode) with placeholder shot drawing (flat colours per shot), before any art exists. Tasks 11–13 replace the placeholder drawing.

**Files:**
- Create: `client/src/intro/assets.ts`, `client/src/intro/renderer.ts`, `client/src/intro/IntroCutscene.tsx`
- Modify: `client/src/App.tsx`, `client/src/components/LoginScreen.tsx`, `client/src/styles/index.css`, `.gitignore`

**Interfaces:**
- Consumes: everything from Tasks 1–4; `audioEngine` (Task 2).
- Produces: `IMAGE_FILES`, `ImageId`, `PLATE_IDS`, `PlateId`, `IntroAssets { images; plates; audio; missing: string[] }`, `loadIntroAssets(ctx: BaseAudioContext): Promise<IntroAssets>`, `isComplete(a): boolean`, `emptyAssets(): IntroAssets`; `IntroRenderer` with `resize(cssW, cssH, dpr)`, `setLayout(layout | null)`, `renderGate(timeSec)`, `render(t, assets)`; `window.__intro = { ready(): boolean; render(t: number): void; mixWav(): Promise<string /* base64 */> }` in still mode.

- [ ] **Step 1: Write `client/src/intro/assets.ts`**

```ts
// Everything the intro loads. Missing files are recorded rather than thrown, so development
// works before all art exists; production builds refuse to play an incomplete intro.
import { AUDIO_IDS, type AudioId } from './timeline.js';
import type { PlateAtlas, PlateManifest } from './plate.js';
import type { AudioBuffers } from './audio.js';

export const IMAGE_FILES = {
  logo: '/Caverns_Logo.png',
  descent_far: '/intro/descent_far.png',
  wall_conduits: '/intro/wall_conduits.png',
  wall_screens: '/intro/wall_screens.png',
  wall_fungal: '/intro/wall_fungal.png',
  wall_crystal: '/intro/wall_crystal.png',
  near_wall: '/intro/near_wall.png',
  ledge: '/intro/ledge.png',
  figure_fall: '/intro/figure_fall.png',
  glyph_lurker: '/sprites/glyphs/mobs/cave_lurker.png',
  glyph_spider: '/sprites/glyphs/mobs/crystal_spider.png',
  glyph_colossus: '/sprites/glyphs/mobs/bone_colossus.png',
} as const;
export type ImageId = keyof typeof IMAGE_FILES;

export const PLATE_IDS = ['waste', 'threshold'] as const;
export type PlateId = (typeof PLATE_IDS)[number];

export interface IntroAssets {
  images: Partial<Record<ImageId, HTMLImageElement>>;
  plates: Partial<Record<PlateId, PlateAtlas>>;
  audio: AudioBuffers;
  missing: string[];
}

export function emptyAssets(): IntroAssets {
  return { images: {}, plates: {}, audio: {}, missing: [] };
}

export function isComplete(a: IntroAssets): boolean {
  return a.missing.length === 0;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

async function loadPlate(id: PlateId): Promise<PlateAtlas> {
  const r = await fetch(`/intro/${id}.json`);
  if (!r.ok) throw new Error(`/intro/${id}.json`);
  const manifest = (await r.json()) as PlateManifest;
  const images = await Promise.all(manifest.files.map((f) => loadImage(`/intro/${f}`)));
  return { manifest, images };
}

async function loadAudio(ctx: BaseAudioContext, id: AudioId): Promise<AudioBuffer> {
  const r = await fetch(`/intro/${id}.m4a`);
  if (!r.ok) throw new Error(`/intro/${id}.m4a`);
  return ctx.decodeAudioData(await r.arrayBuffer());
}

export async function loadIntroAssets(ctx: BaseAudioContext): Promise<IntroAssets> {
  const a = emptyAssets();
  const jobs: Promise<void>[] = [];
  for (const [id, url] of Object.entries(IMAGE_FILES) as [ImageId, string][]) {
    jobs.push(loadImage(url).then((img) => { a.images[id] = img; }, () => { a.missing.push(url); }));
  }
  for (const id of PLATE_IDS) {
    jobs.push(loadPlate(id).then((p) => { a.plates[id] = p; }, () => { a.missing.push(`plate:${id}`); }));
  }
  for (const id of AUDIO_IDS) {
    jobs.push(loadAudio(ctx, id).then((b) => { a.audio[id] = b; }, () => { a.missing.push(`audio:${id}`); }));
  }
  await Promise.all(jobs);
  return a;
}
```

- [ ] **Step 2: Write `client/src/intro/renderer.ts` with placeholder shots**

```ts
// Picture pipeline: shot → 320×180 scene → (CRT warm-up pass) → low-res bloom → sharp-bilinear
// upscale with shake → chromatic split / flash → power-on aperture → native-res layers (eyes,
// ASCII cavern, logo) aligned to the DOM → grain. The app's .crt-overlay adds scanlines on top.
import { LR_W, LR_H, BG, shotAt, impact, type ShotId } from './timeline.js';
import { coverFit, type Fit, type SceneLayout } from './layout.js';
import { hash, vnoise, mulberry32 } from './math.js';
import type { IntroAssets } from './assets.js';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas unavailable');
  return x;
}

// Placeholder look per shot, replaced shot by shot in Tasks 11–13.
const PLACEHOLDER: Record<ShotId, string> = {
  power: '#223', waste: '#8a5a3c', threshold: '#5a3c2a', descent: '#1c2430', dark: BG, resolve: BG,
};

export class IntroRenderer {
  private readonly o: CanvasRenderingContext2D;
  private readonly lr = makeCanvas(LR_W, LR_H);
  private readonly lx = ctx2d(this.lr);
  private px = makeCanvas(LR_W, LR_H);
  private pxx = ctx2d(this.px);
  private readonly bloom = makeCanvas(LR_W / 2, LR_H / 2);
  private readonly bx = ctx2d(this.bloom);
  private ca = makeCanvas(1, 1);
  private cax = ctx2d(this.ca);
  private readonly grains: HTMLCanvasElement[];
  private readonly filtersOK: boolean;
  protected fit: Fit = coverFit(LR_W, LR_H);
  protected dpr = 1;
  protected layout: SceneLayout | null = null;

  constructor(private readonly out: HTMLCanvasElement) {
    this.o = ctx2d(out);
    this.filtersOK = typeof this.bx.filter === 'string';
    this.grains = [0, 1, 2, 3].map((k) => {
      const c = makeCanvas(256, 256), x = ctx2d(c);
      const id = x.createImageData(256, 256), r = mulberry32(k * 991 + 7);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 128 + (r() - 0.5) * 200;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      return c;
    });
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.out.width !== w) this.out.width = w;
    if (this.out.height !== h) this.out.height = h;
    this.fit = coverFit(w, h);
    if (this.px.width !== LR_W * this.fit.ps) {
      this.px = makeCanvas(LR_W * this.fit.ps, LR_H * this.fit.ps);
      this.pxx = ctx2d(this.px);
    }
    this.ca = makeCanvas(w, h);
    this.cax = ctx2d(this.ca);
  }

  setLayout(layout: SceneLayout | null): void {
    this.layout = layout;
  }

  renderGate(time: number): void {
    const o = this.o;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.fillStyle = '#050505';
    o.fillRect(0, 0, this.out.width, this.out.height);
    void time;
  }

  render(t: number, a: IntroAssets): void {
    t = Math.max(0, t);
    const shot = shotAt(t);
    this.drawScene(shot.id, t, a);
    this.compose(t, a);
  }

  /** Low-res scene for the current shot. */
  protected drawScene(id: ShotId, t: number, a: IntroAssets): void {
    const lx = this.lx;
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalAlpha = 1;
    lx.globalCompositeOperation = 'source-over';
    lx.filter = 'none';
    lx.imageSmoothingEnabled = false;
    lx.fillStyle = PLACEHOLDER[id];
    lx.fillRect(0, 0, LR_W, LR_H);
    void t; void a;
  }

  /** Backdrop opacity: 1 until the real login screen is revealed underneath. */
  protected backdrop(t: number): number {
    void t;
    return 1;
  }

  /** Native-resolution layers drawn after the upscale (eyes, glyphs, logo, power aperture). */
  protected drawNative(t: number, a: IntroAssets): void {
    void t; void a;
  }

  /** Extra horizontal jitter in low-res px (degauss wobble). */
  protected wobble(t: number): number {
    void t;
    return 0;
  }

  private compose(t: number, a: IntroAssets): void {
    const o = this.o, W = this.out.width, H = this.out.height;
    const { k, ps, dx, dy } = this.fit;
    const back = this.backdrop(t);

    // Low-res bloom source.
    if (this.filtersOK) {
      this.bx.globalCompositeOperation = 'source-over';
      this.bx.clearRect(0, 0, LR_W / 2, LR_H / 2);
      this.bx.filter = 'brightness(0.9) contrast(2.2) blur(2px)';
      this.bx.drawImage(this.lr, 0, 0, LR_W / 2, LR_H / 2);
      this.bx.filter = 'none';
    }

    // Integer pre-scale (crisp pixels), then smooth to the exact cover scale.
    this.pxx.imageSmoothingEnabled = false;
    this.pxx.drawImage(this.lr, 0, 0, LR_W * ps, LR_H * ps);

    const shake = impact(t, 7) * 2.5 * k;
    const sx = vnoise(t * 38) * shake + this.wobble(t) * k;
    const sy = vnoise(t * 38 + 91) * shake;
    const zs = 1 + (Math.abs(sx) + Math.abs(sy)) * 2.4 / W;

    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.filter = 'none';
    o.globalAlpha = 1;
    o.clearRect(0, 0, W, H);
    o.globalAlpha = back;
    o.setTransform(zs, 0, 0, zs, (W / 2) * (1 - zs) + sx, (H / 2) * (1 - zs) + sy);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(this.px, dx, dy, LR_W * k, LR_H * k);
    if (this.filtersOK) {
      o.globalCompositeOperation = 'screen';
      o.globalAlpha = 0.35 * back;
      o.drawImage(this.bloom, dx, dy, LR_W * k, LR_H * k);
    }
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;

    // Chromatic split on hits and during the degauss wobble.
    const caAmt = impact(t, 9) * 4 * this.dpr + Math.abs(this.wobble(t)) * 3 * this.dpr;
    if (caAmt > 0.6 && back === 1) {
      const c = this.cax;
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, W, H);
      c.drawImage(this.out, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = '#f00';
      c.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'multiply';
      o.fillStyle = '#0ff';
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'lighter';
      o.drawImage(this.ca, caAmt, 0);
      o.globalCompositeOperation = 'source-over';
    }

    // Flash on hits.
    const fl = impact(t, 24);
    if (fl > 0.02) {
      o.globalCompositeOperation = 'lighter';
      o.fillStyle = `rgba(255,232,200,${Math.min(0.3, fl * 0.25)})`;
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'source-over';
    }

    this.drawNative(t, a);

    // Film grain, fading out with the backdrop.
    const fi = Math.floor(t * 24);
    const pat = o.createPattern(this.grains[fi % 4], 'repeat');
    if (pat) {
      const gx = (hash(fi) * 256) | 0, gy = (hash(fi + 0.5) * 256) | 0;
      o.globalCompositeOperation = 'overlay';
      o.globalAlpha = 0.1 * back;
      o.translate(-gx, -gy);
      o.fillStyle = pat;
      o.fillRect(gx, gy, W, H);
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.globalAlpha = 1;
    }
  }

  /** For subclasses/shots: the low-res scene context and the output context. */
  protected get sceneCtx(): CanvasRenderingContext2D { return this.lx; }
  protected get outCtx(): CanvasRenderingContext2D { return this.o; }
  protected get outW(): number { return this.out.width; }
  protected get outH(): number { return this.out.height; }
}
```

- [ ] **Step 3: Write `client/src/intro/IntroCutscene.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { audioEngine, AMBIENCE_URL } from '../audio/audioEngine.js';
import { useIntroStore } from './introStore.js';
import { IntroRenderer } from './renderer.js';
import { measureLayout } from './layout.js';
import { loadIntroAssets, isComplete, emptyAssets, type IntroAssets } from './assets.js';
import { IntroClock, pickClockSource } from './clock.js';
import { scheduleCues, renderIntroMix, encodeWav, type AudioHandle } from './audio.js';
import { CUES, SKIP_CUES, DURATION, MUSIC_RELEASE_T, FADE_OUT_S, SCORE_STOP_T } from './timeline.js';
import { markIntroSeen, parseStill, safeStorage } from './introState.js';

const GATE_TIMEOUT_MS = 8000;
const LEAD_S = 0.05;
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);
type Stage = 'gate' | 'loading' | 'playing' | 'fading';

interface IntroHooks { ready(): boolean; render(t: number): void; mixWav(): Promise<string> }
declare global { interface Window { __intro?: IntroHooks } }

function initialStage(): Stage {
  if (parseStill(window.location.search) !== null) return 'playing';
  return useIntroStore.getState().gateless ? 'loading' : 'gate';
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function IntroCutscene() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>(initialStage);

  useEffect(() => {
    const host = hostRef.current!;
    const appRoot = host.parentElement ?? document.body;
    const renderer = new IntroRenderer(canvasRef.current!);
    const still = parseStill(window.location.search);
    const ctx = audioEngine.context();

    let phase: Stage = initialStage();
    let assets: IntroAssets | null = null;
    let failed = false;
    let disposed = false;
    let starting = false;
    let finished = false;
    let released = false;
    let measuredDark = false;
    let gateAt = phase === 'loading' ? performance.now() : 0;
    let clock: IntroClock | null = null;
    let audio: AudioHandle | null = null;
    let raf = 0;

    const setPhase = (p: Stage) => { phase = p; setStage(p); };
    const measure = () => renderer.setLayout(measureLayout(appRoot));
    const fit = () => {
      renderer.resize(appRoot.clientWidth, appRoot.clientHeight, window.devicePixelRatio || 1);
      measure();
    };
    const release = () => {
      if (released) return;
      released = true;
      useIntroStore.getState().releaseMusic();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      markIntroSeen(safeStorage());
      release();
      setPhase('fading');
      window.setTimeout(() => { if (!disposed) useIntroStore.getState().finish(); }, FADE_OUT_S * 1000 + 50);
    };

    fit();
    void document.fonts.ready.then(() => { if (!disposed) measure(); });
    window.addEventListener('resize', fit);

    const loading = loadIntroAssets(ctx).then(
      (a) => {
        if (!isComplete(a)) {
          console.warn('[intro] missing assets:', a.missing);
          if (!import.meta.env.DEV) { failed = true; return; }
        }
        assets = a;
      },
      (err) => { console.warn('[intro] asset load failed', err); failed = true; },
    );

    // ── Tooling mode: ?intro&still=<t> renders one frame and exposes window.__intro ──
    if (still !== null) {
      void loading.then(async () => {
        await document.fonts.ready;
        if (disposed) return;
        fit();
        const a = assets ?? emptyAssets();
        const hooks: IntroHooks = {
          ready: () => true,
          render: (t) => {
            if (t >= SCORE_STOP_T) measure();
            renderer.render(t, a);
            host.style.opacity = String(t < DURATION ? 1 : Math.max(0, 1 - (t - DURATION) / FADE_OUT_S));
          },
          mixWav: async () => {
            let amb: AudioBuffer | null = null;
            try { amb = await ctx.decodeAudioData(await (await fetch(AMBIENCE_URL)).arrayBuffer()); } catch { /* optional */ }
            return toBase64(encodeWav(await renderIntroMix(a.audio, amb)));
          },
        };
        hooks.render(still);
        window.__intro = hooks;
      });
      return () => {
        disposed = true;
        window.removeEventListener('resize', fit);
        delete window.__intro;
      };
    }

    const begin = async () => {
      await Promise.race([audioEngine.unlock(), new Promise((r) => setTimeout(r, 300))]);
      if (disposed || finished || !assets) return;
      clock = new IntroClock(pickClockSource(ctx, () => performance.now()));
      clock.start(-LEAD_S);
      if (ctx.state === 'running') {
        audio = scheduleCues(ctx, audioEngine.introDestination(), assets.audio, CUES, ctx.currentTime + LEAD_S);
      }
      setPhase('playing');
    };

    const skip = () => {
      if (!clock || clock.skipping) return;
      clock.skip();
      release();
      audio?.stop(0.12);
      if (ctx.state === 'running' && assets) {
        audio = scheduleCues(ctx, audioEngine.introDestination(), assets.audio, SKIP_CUES, ctx.currentTime + 0.02);
      }
    };

    // Capture phase on window: runs before LoginScreen's window keydown listener, so nothing leaks.
    const onInput = (e: Event) => {
      e.stopPropagation();
      if (finished) return;
      if (e instanceof KeyboardEvent) {
        if (MODIFIERS.has(e.key) || e.repeat) return;
        if (e.key === ' ') e.preventDefault();
      }
      if (phase === 'gate') {
        if (e instanceof KeyboardEvent && e.key === 'Escape') { finish(); return; }
        void audioEngine.unlock(); // must happen inside the gesture
        gateAt = performance.now();
        setPhase('loading');
      } else if (phase === 'playing') {
        skip();
      }
    };
    window.addEventListener('keydown', onInput, true);
    host.addEventListener('pointerdown', onInput);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      try {
        if (phase === 'gate' || phase === 'loading') {
          renderer.renderGate(performance.now() / 1000);
          if (phase === 'loading') {
            if (failed || performance.now() - gateAt > GATE_TIMEOUT_MS) finish();
            else if (assets && !starting) { starting = true; void begin(); }
          }
          return;
        }
        if (!clock || !assets) return;
        const t = clock.now();
        if (t >= MUSIC_RELEASE_T || clock.skipping) release();
        if (!measuredDark && t >= SCORE_STOP_T) { measuredDark = true; measure(); }
        renderer.render(t, assets);
        if (t >= DURATION) finish();
      } catch (err) {
        console.error('[intro] render failed', err);
        finish();
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onInput, true);
      host.removeEventListener('pointerdown', onInput);
    };
  }, []);

  return (
    <div ref={hostRef} className={`intro-root${stage === 'fading' ? ' intro-root--fading' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="intro-canvas" />
      {(stage === 'gate' || stage === 'loading') && (
        <div className={`intro-gate-prompt${stage === 'loading' ? ' intro-gate-prompt--loading' : ''}`}>
          ▌ PRESS ANY KEY
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Integrate into App and LoginScreen**

In `client/src/App.tsx`:
- Add imports next to the other component imports:
  ```tsx
  import { IntroCutscene } from './intro/IntroCutscene.js';
  import { useIntroStore } from './intro/introStore.js';
  ```
- After `const arenaIntro = useGameStore((s) => s.arenaIntro);` add:
  ```tsx
  const introActive = useIntroStore((s) => s.active);
  ```
- Replace the `case 'connecting':` block with the following. It renders the same `LoginScreen` element as the `login` case, so React keeps it mounted when the view flips:
  ```tsx
    case 'connecting':
      // During the intro the cavern must already exist underneath for the handoff.
      content = introActive ? (
        <LoginScreen onLogin={actions.login} />
      ) : (
        <div className="screen-center">
          <h1>Caverns</h1>
          <p>Connecting to server...</p>
        </div>
      );
      break;
  ```
- In the returned fragment, add the intro just before `<MusicPlayer />`:
  ```tsx
      {introActive && <IntroCutscene />}
  ```

In `client/src/components/LoginScreen.tsx`:
- Add the import `import { useIntroStore } from '../intro/introStore.js';`
- In the component body, add `const replayIntro = useIntroStore((s) => s.replay);`
- Add as the last child of the `.lobby` div (after the error line):
  ```tsx
      <button
        className="intro-replay"
        onClick={(e) => { e.currentTarget.blur(); replayIntro(); }}
        title="Replay intro"
      >
        ↺ intro
      </button>
  ```

In `client/src/styles/index.css`:
- Change the existing rule
  `.lobby > *:not(.lobby-cave-bg):not(.lobby-cave-top):not(.cave-eyes) { position: relative; z-index: 2; }`
  to
  `.lobby > *:not(.lobby-cave-bg):not(.lobby-cave-top):not(.cave-eyes):not(.intro-replay) { position: relative; z-index: 2; }`
- Append:
  ```css
  /* === Intro cold open === */
  .intro-root { position: absolute; inset: 0; z-index: 900; cursor: none; }
  .intro-root--fading { opacity: 0; transition: opacity 0.3s linear; pointer-events: none; }
  .intro-canvas { display: block; width: 100%; height: 100%; }
  .intro-gate-prompt {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    color: #4a4238; font-size: 0.95rem; letter-spacing: 0.25em; white-space: nowrap;
    text-shadow: 0 0 6px rgba(200, 170, 120, 0.15);
    animation: blink 1.2s step-end infinite;
  }
  .intro-gate-prompt--loading { animation-duration: 0.4s; }
  .intro-replay {
    position: absolute; right: 16px; bottom: 12px; z-index: 3;
    background: none; border: none; padding: 2px 4px;
    color: #4a4238; font-family: inherit; font-size: 0.75rem; letter-spacing: 0.1em; cursor: pointer;
  }
  .intro-replay:hover { color: #7a6e5a; }
  ```
  (The existing `@keyframes blink` used by `.dos-cursor` is reused.)

Append to `.gitignore`:
```
# Intro cold open: raw generations and review renders
art/intro/raw/
.intro/
```

- [ ] **Step 5: Type check and run all client tests**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit && npx vitest run"`
Expected: no type errors, all tests PASS.

- [ ] **Step 6: Manual flow check in the browser (dev servers running: `npm run dev`)**

Open `http://localhost:5173/?intro` headed or via Playwright. Check:
1. The gate shows `▌ PRESS ANY KEY`.
2. A key starts the placeholder colours cycling through the shots.
3. A key during playback jumps to the dark resolve, fades out in about 1.5 s, and the login screen is there with an empty name field.
4. Reload `http://localhost:5173/`: no intro (seen).
5. Click `↺ intro`: the intro plays without the gate.
6. Escape on the gate goes straight to the login screen.
7. `http://localhost:5173/?sandbox=duel`: no intro.

Console: only `[intro] missing assets` warnings are allowed.

- [ ] **Step 7: Commit**

Paths: `client/src/intro/assets.ts client/src/intro/renderer.ts client/src/intro/IntroCutscene.tsx client/src/App.tsx client/src/components/LoginScreen.tsx client/src/styles/index.css .gitignore`. Subject: `Add intro cutscene shell, renderer skeleton and app integration`.

---

### Task 6: Headless review tool (`scripts/intro-render.mjs`)

**Files:**
- Create: `scripts/intro-render.mjs`

**Interfaces:**
- Consumes: `window.__intro` (Task 5), the `.intro-root`, `.intro-gate-prompt`, `.dos-input-text`, `.lobby-logo` selectors.
- Produces: CLI modes `stills`, `frames`, `wav`, `handoff`, `keys` (used by Tasks 8–14).

- [ ] **Step 1: Write the script**

```js
// Headless review tooling for the intro cold open (Playwright, Edge channel).
// Needs the Vite dev server (npm run dev:client); `handoff` and `keys` also need the game server (npm run dev).
//
//   node scripts/intro-render.mjs stills 0.1,5,12.6,20,24,29.99 [--out .intro/stills] [--viewport 1920x1080]
//   node scripts/intro-render.mjs frames 30 [--out .intro/frames] [--from 0] [--to 30.5]
//   node scripts/intro-render.mjs wav [--out .intro/intro.wav]
//   node scripts/intro-render.mjs handoff [--viewport 1920x1080] [--out .intro/handoff]
//   node scripts/intro-render.mjs keys
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const base = opt('base', 'http://localhost:5173');
const [vw, vh] = opt('viewport', '1920x1080').split('x').map(Number);
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}.music-player{display:none!important}';

async function withPage(fn) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const result = await fn(page);
    if (errors.length) console.error('page errors:\n' + errors.join('\n'));
    return result;
  } finally {
    await browser.close();
  }
}

async function openStill(page, t) {
  await page.goto(`${base}/?intro&still=${t}`);
  await page.waitForFunction(() => window.__intro?.ready(), null, { timeout: 120000 });
}

async function stills() {
  const times = (argv[1] ?? '').split(',').filter(Boolean).map(Number);
  if (!times.length) throw new Error('stills: give comma-separated times');
  const out = opt('out', '.intro/stills');
  mkdirSync(out, { recursive: true });
  await withPage(async (page) => {
    await openStill(page, times[0]);
    for (const t of times) {
      await page.evaluate((x) => window.__intro.render(x), t);
      const file = join(out, `t${t.toFixed(2).padStart(6, '0')}_${vw}x${vh}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  });
}

async function frames() {
  const fps = Number(argv[1] ?? 30);
  const out = opt('out', '.intro/frames');
  const from = Number(opt('from', '0')), to = Number(opt('to', '30.5'));
  mkdirSync(out, { recursive: true });
  await withPage(async (page) => {
    await openStill(page, from);
    const n = Math.round((to - from) * fps);
    for (let i = 0; i < n; i++) {
      const t = from + i / fps;
      await page.evaluate((x) => window.__intro.render(x), t);
      await page.screenshot({ path: join(out, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (i % fps === 0) console.error(`frame ${i}/${n}`);
    }
  });
  console.log(`frames in ${out}. Encode in WSL: ffmpeg -framerate ${fps} -i ${out}/f%05d.jpg -i .intro/intro.wav -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest .intro/intro.mp4`);
}

async function wav() {
  const out = opt('out', '.intro/intro.wav');
  mkdirSync(dirname(out), { recursive: true });
  const b64 = await withPage(async (page) => {
    await openStill(page, 0);
    return page.evaluate(() => window.__intro.mixWav());
  });
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(out);
}

async function handoff() {
  const out = opt('out', '.intro/handoff');
  mkdirSync(out, { recursive: true });
  const a = await withPage(async (page) => {
    await openStill(page, 29.99);
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(() => window.__intro.render(29.99));
    await page.waitForTimeout(300);
    return page.screenshot();
  });
  const b = await withPage(async (page) => {
    await page.addInitScript(() => localStorage.setItem('caverns_intro_seen', '1'));
    await page.goto(`${base}/`);
    await page.waitForSelector('.lobby-logo');
    await page.addStyleTag({ content: FREEZE });
    await page.waitForTimeout(800);
    return page.screenshot();
  });
  writeFileSync(join(out, `intro_${vw}x${vh}.png`), a);
  writeFileSync(join(out, `dom_${vw}x${vh}.png`), b);
  const stats = await withPage((page) => page.evaluate(async ([pa, pb]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = ia.width, h = ia.height;
    const grab = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = grab(ia), db = grab(ib);
    const heat = document.createElement('canvas'); heat.width = w; heat.height = h;
    const hx = heat.getContext('2d'), hd = hx.createImageData(w, h);
    let sum = 0, over = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d; if (d > 24) over++;
      hd.data[i] = Math.min(255, d * 8); hd.data[i + 3] = 255;
    }
    hx.putImageData(hd, 0, 0);
    const n = da.length / 4;
    return { mean: sum / n, pctOver24: (over / n) * 100, heat: heat.toDataURL('image/png').split(',')[1] };
  }, [a.toString('base64'), b.toString('base64')]));
  writeFileSync(join(out, `diff_${vw}x${vh}.png`), Buffer.from(stats.heat, 'base64'));
  const pass = stats.mean <= 1.5 && stats.pctOver24 <= 0.5;
  console.log(`handoff ${vw}x${vh}: mean ${stats.mean.toFixed(3)}, >24: ${stats.pctOver24.toFixed(3)}% → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
}

async function keys() {
  await withPage(async (page) => {
    await page.goto(`${base}/?intro`);
    await page.waitForSelector('.intro-gate-prompt');
    await page.keyboard.press('x');
    await page.waitForTimeout(3000);
    await page.keyboard.type('abc');
    await page.waitForSelector('.intro-root', { state: 'detached', timeout: 15000 });
    const typed = await page.textContent('.dos-input-text');
    if (typed !== '') throw new Error(`intro leaked keystrokes into the login field: "${typed}"`);
    await page.goto(`${base}/`);
    await page.waitForTimeout(1500);
    if (await page.$('.intro-root')) throw new Error('intro replayed although it was already seen');
    console.log('keys: OK');
  });
}

const MODES = { stills, frames, wav, handoff, keys };
if (!MODES[mode]) {
  console.error('usage: node scripts/intro-render.mjs stills|frames|wav|handoff|keys ... (see header)');
  process.exit(2);
}
MODES[mode]().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify the tool against the placeholder intro**

With `npm run dev` running:
```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs stills 0.5,5,10,15,24,27 && node scripts/intro-render.mjs keys"
```
Expected: six PNGs in `.intro/stills/` showing the placeholder colours (Read two of them to confirm), then `keys: OK`. `handoff` isn't meaningful yet; run it once only to check it executes (it's expected to FAIL on the placeholder).

- [ ] **Step 3: Commit**

Paths: `scripts/intro-render.mjs`. Subject: `Add headless intro review tool`.

---

### Task 7: Offline bake script (`scripts/intro-bake.sh`)

**Files:**
- Create: `scripts/intro-bake.sh`

**Interfaces:**
- Produces subcommands used by Tasks 8–10: `palette [extra.png...]`, `layer <src.png> <name> [dither]`, `plate <id> <src.mp4> <inSec> <durSec> [fps]`, `preview <src.mp4> <inSec> <durSec> <out.mp4>`, `strip <outName> <frame.png...>`, `audio <id> <src> [ss] [dur] [fadeInMs] [fadeOutMs]`, `analyze <audio> <outPrefix>`, `contact <video> <out.png> [cols] [rows]`, `sizes`.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Offline asset baking for the intro cold open. Runs in WSL (ffmpeg). See client/src/intro/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART="$ROOT/art/intro"
OUT="$ROOT/client/public/intro"
PAL="$ART/palette.png"
mkdir -p "$ART/raw" "$OUT"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
sec() { awk "BEGIN{print $1/1000}"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  palette)   # 32-colour palette from the class portraits (style anchor), the logo, and any extra images
    inputs=(); filters=""; n=0
    for f in "$ROOT"/client/public/portraits/*.png "$ROOT/client/public/Caverns_Logo.png" "$@"; do
      inputs+=(-i "$f"); filters+="[$n:v]scale=256:256:flags=neighbor,format=rgb24[s$n];"; n=$((n+1))
    done
    stack=""; for ((i=0; i<n; i++)); do stack+="[s$i]"; done
    ff "${inputs[@]}" -filter_complex "${filters}${stack}hstack=inputs=$n,palettegen=max_colors=32:stats_mode=full" -update 1 "$PAL"
    echo "$PAL" ;;

  layer)     # layer <src.png> <name> [dither=none|bayer]: palette-snap a still, keep alpha
    d="${3:-none}"; opt="dither=$d"; [ "$d" = bayer ] && opt="dither=bayer:bayer_scale=3"
    ff -i "$1" -i "$PAL" -filter_complex "[0:v][1:v]paletteuse=$opt:alpha_threshold=128" "$OUT/$2.png"
    echo "$OUT/$2.png" ;;

  plate)     # plate <id> <src.mp4> <inSec> <durSec> [fps]: re-pixelate a video take into atlases + manifest
    id="$1"; src="$2"; ss="$3"; dur="$4"; fps="${5:-24}"
    tmp="$(mktemp -d)"
    ff -ss "$ss" -t "$dur" -i "$src" -i "$PAL" -filter_complex \
      "[0:v]fps=$fps,scale=320:180:force_original_aspect_ratio=increase:flags=area,crop=320:180,eq=contrast=1.06:saturation=1.08[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3" \
      "$tmp/f%04d.png"
    frames=$(ls "$tmp"/f*.png | wc -l)
    rm -f "$OUT/${id}"_*.png
    ff -framerate "$fps" -i "$tmp/f%04d.png" -i "$PAL" -filter_complex \
      "[0:v]format=rgb24,tile=4x4[t];[t][1:v]paletteuse=dither=none" -start_number 0 "$OUT/${id}_%02d.png"
    files=$(cd "$OUT" && ls "${id}"_*.png | sort | sed 's/.*/"&"/' | paste -sd, -)
    atlases=$(cd "$OUT" && ls "${id}"_*.png | wc -l)
    need=$(( (frames + 15) / 16 ))
    [ "$atlases" -eq "$need" ] || { echo "atlas count $atlases != expected $need" >&2; exit 1; }
    printf '{"fps":%s,"frames":%s,"cols":4,"rows":4,"w":320,"h":180,"files":[%s]}\n' "$fps" "$frames" "$files" > "$OUT/$id.json"
    ff -framerate "$fps" -i "$tmp/f%04d.png" -vf "select='not(mod(n\,12))',scale=640:360:flags=neighbor,tile=3x4" -frames:v 1 "$ART/raw/${id}_baked_contact.png"
    rm -rf "$tmp"
    echo "$id: $frames frames @${fps}fps in $atlases atlases, $(du -ch "$OUT/${id}"_*.png | tail -1 | cut -f1)" ;;

  preview)   # preview <src.mp4> <inSec> <durSec> <out.mp4>: the same re-pixelation, upscaled ×4 for eyeballing
    ff -ss "$2" -t "$3" -i "$1" -i "$PAL" -filter_complex \
      "[0:v]fps=24,scale=320:180:force_original_aspect_ratio=increase:flags=area,crop=320:180,eq=contrast=1.06:saturation=1.08[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3,scale=1280:720:flags=neighbor" \
      -c:v libx264 -crf 14 -pix_fmt yuv420p "$4"
    echo "$4" ;;

  strip)     # strip <outName> <frame.png...>: horizontal sprite strip, palette-snapped
    name="$1"; shift; n=$#; inputs=(); stack=""
    i=0; for f in "$@"; do inputs+=(-i "$f"); stack+="[$i:v]"; i=$((i+1)); done
    ff "${inputs[@]}" -i "$PAL" -filter_complex "${stack}hstack=inputs=$n[s];[s][$n:v]paletteuse=dither=none:alpha_threshold=128" "$OUT/$name.png"
    echo "$OUT/$name.png ($n frames)" ;;

  audio)     # audio <id> <src> [ss=0] [dur] [fadeInMs=5] [fadeOutMs=30]: trim, edge-fade, encode AAC 48 kHz
    id="$1"; src="$2"; ss="${3:-0}"; dur="${4:-}"; fi="${5:-5}"; fo="${6:-30}"
    topt=(); [ -n "$dur" ] && topt=(-t "$dur")
    af="aresample=48000"
    [ "$fi" != 0 ] && af+=",afade=t=in:d=$(sec "$fi")"
    [ "$fo" != 0 ] && af+=",areverse,afade=t=in:d=$(sec "$fo"),areverse"
    ff -ss "$ss" "${topt[@]}" -i "$src" -af "$af" -ac 2 -c:a aac -b:a 192k -movflags +faststart "$OUT/$id.m4a"
    echo "$OUT/$id.m4a" ;;

  analyze)   # analyze <audio> <outPrefix>: loudness, silences, waveform + spectrogram PNGs
    ffmpeg -hide_banner -i "$1" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" || true
    ffmpeg -hide_banner -i "$1" -af silencedetect=n=-45dB:d=0.25 -f null - 2>&1 | grep -o "silence_\(start\|end\): [0-9.]*" || true
    ff -i "$1" -lavfi "showspectrumpic=s=1200x400:legend=1" "$2_spec.png"
    ff -i "$1" -filter_complex "showwavespic=s=1200x200" -frames:v 1 "$2_wave.png"
    echo "$2_spec.png $2_wave.png" ;;

  contact)   # contact <video> <out.png> [cols=4] [rows=3]: evenly sampled contact sheet
    c="${3:-4}"; r="${4:-3}"; n=$((c * r))
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    ff -i "$1" -vf "fps=$n/$d,scale=320:-2,tile=${c}x${r}" -frames:v 1 "$2"
    echo "$2" ;;

  sizes)     # total shipped size
    du -ch "$OUT"/* | tail -1 ;;

  *) echo "usage: scripts/intro-bake.sh palette|layer|plate|preview|strip|audio|analyze|contact|sizes ..." >&2; exit 2 ;;
esac
```

- [ ] **Step 2: Smoke-test the subcommands with existing art**

```bash
chmod +x scripts/intro-bake.sh
bash scripts/intro-bake.sh palette && bash scripts/intro-bake.sh layer client/public/portraits/templar.png _smoke
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc=size=1280x720:rate=24 -t 2 art/intro/raw/_smoke.mp4
bash scripts/intro-bake.sh plate _smoke art/intro/raw/_smoke.mp4 0 2
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=440:d=2" art/intro/raw/_smoke.wav
bash scripts/intro-bake.sh audio _smoke art/intro/raw/_smoke.wav && bash scripts/intro-bake.sh analyze client/public/intro/_smoke.m4a art/intro/raw/_smoke
cat client/public/intro/_smoke.json
```
Expected: `art/intro/palette.png` exists (Read it: 32 swatches); `_smoke: 48 frames @24fps in 3 atlases`; a valid JSON manifest with 3 files; an m4a; loudness lines printed. Then clean up: `rm -f client/public/intro/_smoke* art/intro/raw/_smoke*` (the smoke palette is regenerated properly in Task 8).

- [ ] **Step 3: Commit**

Paths: `scripts/intro-bake.sh`. Subject: `Add intro asset bake script`.

---

### Task 8: Art production A: palette, keyframes, AI video plates *(controller-run; has a user checkpoint)*

**Files:**
- Create: `art/intro/keyframes/waste.png`, `art/intro/keyframes/threshold.png`, `art/intro/palette.png`, `client/public/intro/waste.json`, `client/public/intro/waste_*.png`, `client/public/intro/threshold.json`, `client/public/intro/threshold_*.png`
- Raw (ignored): `art/intro/raw/*`

**Interfaces:**
- Produces: plate manifests + atlases loaded by `assets.ts` (`plate:waste`, `plate:threshold`). It also records the tuning values `WASTE_LIGHT` (the pixel position of a signal light in the Waste keyframe) and `THRESHOLD_STEP_IN` (the source-video time of the step-off) in `art/intro/NOTES.md` for Task 11.

- [ ] **Step 1: Load tool schemas**

`ToolSearch` with `select:mcp__pixellab__create_image_pro,mcp__pixellab__create_image_pixflux,mcp__pixellab__get_image,mcp__pixellab__get_balance` and `select:mcp__elevenlabs__creative_create_flow,mcp__elevenlabs__creative_create_asset_upload,mcp__elevenlabs__creative_finalize_asset_upload,mcp__elevenlabs__creative_generate_video,mcp__elevenlabs__creative_get_flow_run_status,mcp__elevenlabs__creative_get_model_guide`. Check the PixelLab balance. Read the model guides for `veo-3.1-generate-001`, `kling-3-pro` and `bytedance-seedance-v2.5` (image-to-video start-frame port and duration limits).

- [ ] **Step 2: Generate the two keyframes with PixelLab**

Use the largest supported 16:9 canvas up to 320×180 (the bake downsamples to 320×180 with area filtering). If the tool accepts a style or reference image, pass `client/public/portraits/phaseknife.png`. Make 2–3 candidates each. Save them to `art/intro/raw/kf_waste_N.png` and `kf_threshold_N.png`, then view them all with Read.

Waste prompt:
> Pixel art, wide cinematic establishing shot at dusk. A vast flat salt waste of cracked white crust stretching to a low horizon. Rising out of it on the right third, a colossal half-buried monolith of ancient dark metal and stone. It's an alien megastructure, sheer and geometric, with rows of dead signal lights and faint teal circuit-glyph engravings. A strange sky of bruised violet and rust-orange bands, a pale ringed moon, long streaks of cloud. At the foot of the monolith, a tiny lone figure in a gas mask and long coat holding a small amber lantern. Desolate, eerie, retro-future post-collapse, Caves of Qud aesthetic, limited palette, no text.

Threshold prompt:
> Pixel art, medium shot. A lone traveler in a gas mask, long weathered coat and scrap-metal pauldron, holding a small glowing amber lantern. They stand on the left third at the edge of a square black shaft cut into the base of an enormous ancient metal monolith, and the shaft falls away into total darkness in the lower right. Dusk light from the left, salt dust in the air, faint teal circuit glyphs etched on the monolith wall. Retro-future post-collapse, Caves of Qud aesthetic, limited palette, no text.

Pick the best of each (composition as described, legible silhouette, no text artefacts) and copy them to `art/intro/keyframes/waste.png` and `threshold.png`.

- [ ] **Step 3: Build the palette and snap the keyframes**

```bash
bash scripts/intro-bake.sh palette art/intro/keyframes/waste.png art/intro/keyframes/threshold.png
for k in waste threshold; do
  ffmpeg -hide_banner -loglevel error -y -i art/intro/keyframes/$k.png -i art/intro/palette.png -filter_complex \
    "[0:v]scale=320:180:force_original_aspect_ratio=increase:flags=area,crop=320:180[v];[v][1:v]paletteuse=dither=none,scale=1280:720:flags=neighbor" \
    art/intro/raw/start_$k.png
done
```
Read `art/intro/palette.png` and both `start_*.png`. The palette must include the sky violets and oranges and the teal. If they're missing, raise `max_colors` to 40 in the `palette` subcommand, rerun, and note it.

- [ ] **Step 4: Generate the video takes with ElevenLabs**

`creative_create_flow` named "Caverns intro". Upload each `start_*.png`: `creative_create_asset_upload` → `curl -sS -X PUT -H 'Content-Type: image/png' --data-binary @art/intro/raw/start_waste.png "<upload_url>"` → `creative_finalize_asset_upload` → node id. Generate image-to-video from that node as the start frame, 16:9, 720p:

- Waste (8 s), one take each on `veo-3.1-generate-001`, `kling-3-pro`, `bytedance-seedance-v2.5`:
  > Slow cinematic push-in toward the monolith. Clouds drift quickly across the sky, and salt dust streams low across the ground from left to right. The tiny figure stands still, coat flapping in the wind. One signal light on the monolith flickers briefly. Preserve the pixel-art style, palette and composition exactly. No camera shake, no new objects, no text, no cuts.
- Threshold (6 s), same three models:
  > The masked traveler slowly lowers their lantern and looks down into the shaft, pauses, then steps forward off the edge and drops out of frame into the darkness. The lantern light swings. Salt dust drifts. Locked-off camera. Preserve the pixel-art style, palette and composition exactly. No text, no cuts.

Poll `creative_get_flow_run_status` (waiting `poll_after_seconds`) until done, then `curl -L -o art/intro/raw/<plate>_<model>.mp4 <url>`. The budget cap is 10 video takes in total. If a model fails or smears badly, replace it with `kling-2.6-pro` or `veo-3.1-fast-generate-001`.

- [ ] **Step 5: Judge the takes as re-pixelated**

For every take:
```bash
bash scripts/intro-bake.sh preview art/intro/raw/waste_veo.mp4 0 7.1 art/intro/raw/waste_veo_preview.mp4
bash scripts/intro-bake.sh contact art/intro/raw/waste_veo_preview.mp4 art/intro/raw/waste_veo_contact.png 4 3
```
Read each contact sheet. Reject takes with morphing geometry, text, cuts, a drifting palette or a composition change. For Threshold, find the step-off moment by extracting 0.25 s frames around it:
`ffmpeg -i <take> -vf "fps=4,scale=320:-2,tile=6x4" -frames:v 1 art/intro/raw/thr_steps.png`. Then record `THRESHOLD_STEP_IN` (seconds into the source), refined to about 1/24 s with a denser tile near the moment.

- [ ] **Step 6: USER CHECKPOINT**

Show the user the two best previews per plate (paths to the `_preview.mp4` files and the contact sheets) and your pick. Wait for their choice or a request to regenerate.

- [ ] **Step 7: Bake the chosen plates**

The Waste is shown for 6.4 s and is held on frame 0 under the power-on, so bake 6.6 s from its start. The Threshold must put the step at local 4.6 s (12.6 − 8):
```bash
bash scripts/intro-bake.sh plate waste art/intro/raw/<chosen_waste>.mp4 0 6.6
bash scripts/intro-bake.sh plate threshold art/intro/raw/<chosen_threshold>.mp4 <THRESHOLD_STEP_IN - 4.6> 5.2
bash scripts/intro-bake.sh sizes
```
If `THRESHOLD_STEP_IN < 4.6`, use `0` as the in-point and record the actual local step time in NOTES.md; Task 11 shifts `THRESHOLD_T0` accordingly. **Size gate:** the plates total must be ≤ 3.5 MB. If they're over, rebake both at `fps` 16, and at 12 if still over, and record the choice.

Record in `art/intro/NOTES.md`: the chosen takes, models, in-points, fps, `THRESHOLD_STEP_IN`, and `WASTE_LIGHT` (x, y in 320×180 coordinates of a dead signal light, read off `start_waste.png` ÷ 4).

- [ ] **Step 8: Commit**

Paths: `art/intro/keyframes/waste.png art/intro/keyframes/threshold.png art/intro/palette.png art/intro/NOTES.md client/public/intro/waste.json client/public/intro/threshold.json` plus every `client/public/intro/waste_*.png` and `client/public/intro/threshold_*.png` (list them explicitly with `ls`). Subject: `Add intro keyframes, palette and baked video plates`.

---

### Task 9: Art production B: descent layers and falling figure *(controller-run)*

**Files:**
- Create: `client/public/intro/descent_far.png`, `wall_conduits.png`, `wall_screens.png`, `wall_fungal.png`, `wall_crystal.png`, `near_wall.png`, `ledge.png`, `figure_fall.png`
- Modify: `art/intro/NOTES.md` (add `SCREEN_SPOTS`)

**Interfaces:**
- Produces: the images named in `IMAGE_FILES` (Task 5). Walls are left-wall strips with transparent backgrounds, **≤ 128 px wide × 256 px tall** (mirrored for the right wall). `descent_far` is 320×256 opaque. `near_wall` is ≤ 96×256, transparent, very dark and vertically tileable. `ledge` is 320×~32 transparent. `figure_fall` is a horizontal strip of square frames, 8 frames at 48×48 recommended.

- [ ] **Step 1: Load PixelLab schemas**

`select:mcp__pixellab__create_image_pixflux,mcp__pixellab__create_image_pro,mcp__pixellab__create_character,mcp__pixellab__animate_character,mcp__pixellab__get_character,mcp__pixellab__get_image`. Use `no_background` (or its equivalent) for every transparent layer.

- [ ] **Step 2: Generate the layers**

Make 2 candidates each and pick by viewing them with Read. Every prompt ends with ", pixel art, Caves of Qud retro-future, limited palette, no text":
- `descent_far` (320×256): "view up the inside of a vast vertical shaft far wall, dark layered rock strata with ancient rusted pipework and faint geometric relic panels, very dark, low contrast, vertically seamless"
- `wall_conduits`: "left wall of a vertical shaft, thick bundles of corroded relic conduits and cables running vertically, rusted brackets, dim amber warning lamps, transparent background, the wall faces right"
- `wall_screens`: "left wall of a vertical shaft studded with rows of dead embedded CRT screens and cracked glass monitors in rusted housings, faint teal glow, transparent background, the wall faces right"
- `wall_fungal`: "left wall of a vertical shaft overgrown with bioluminescent fungus, glowing teal and green caps, hanging mycelium threads, transparent background, the wall faces right"
- `wall_crystal`: "left wall of a vertical shaft split by veins of glowing violet crystal, sharp facets, dark rock, transparent background, the wall faces right"
- `near_wall`: "foreground silhouettes of jagged rock teeth, snapped cables and roots at the left edge, almost black, vertically seamless, transparent background"
- `ledge`: "a horizontal band of broken rock ledge and bent metal girders spanning the frame, dark, transparent background"
- Figure: `create_character` "gas-masked traveler in a long weathered coat with a small amber lantern", side view, then `animate_character` with a custom action "falling, tumbling through the air, arms and coat flailing", 8 frames. Download the frames to `art/intro/raw/fig_00.png`…

- [ ] **Step 3: Bake**

```bash
for n in descent_far wall_conduits wall_screens wall_fungal wall_crystal near_wall ledge; do
  bash scripts/intro-bake.sh layer art/intro/raw/$n.png $n
done
bash scripts/intro-bake.sh strip figure_fall art/intro/raw/fig_0*.png
bash scripts/intro-bake.sh sizes
```
Check the dimensions: `for f in client/public/intro/{descent_far,wall_*,near_wall,ledge,figure_fall}.png; do ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$f" | sed "s|^|$f |"; done`. If a wall is wider than 128 or taller than 256, rescale with `-vf scale=W:H:flags=neighbor` before `layer` (keep integer factors).

Record `SCREEN_SPOTS` in NOTES.md: the centres of 3–5 dead screens in `wall_screens.png` pixel coordinates, read off the image.

- [ ] **Step 4: Commit**

Paths: the eight `client/public/intro/*.png` files above and `art/intro/NOTES.md`. Subject: `Add intro descent layers and falling figure sprite`.

---

### Task 10: Audio production: SFX, ambience, score *(controller-run; has a user checkpoint)*

**Files:**
- Create: `client/public/intro/<AudioId>.m4a` for every `AUDIO_IDS` entry, and `client/public/intro/ambience.m4a`
- Modify: `art/intro/NOTES.md` (chosen takes and in-points)

**Interfaces:**
- Produces: the audio loaded by `assets.ts` and `audioEngine` (`AMBIENCE_URL`).

- [ ] **Step 1: Load schemas**

Load `select:mcp__elevenlabs__creative_generate_in_flow,mcp__elevenlabs__creative_add_flow_node,mcp__elevenlabs__creative_update_node,mcp__elevenlabs__creative_run_flow_nodes,mcp__elevenlabs__creative_get_flow_run_status,mcp__elevenlabs__creative_get_model_guide`. Read the guides for `eleven_text_to_sound_v2` and `eleven_music_v2`. Use the Task 8 flow.

- [ ] **Step 2: Generate the SFX (2–3 takes each, `eleven_text_to_sound_v2`, prompt_influence 0.5)**

| id | dur | prompt |
|---|---|---|
| sfx_relay | 1.0 | Old CRT television power switch: a heavy mechanical relay clunk, close-mic, dry, single hit |
| sfx_flyback | 2.0 | CRT television warming up: high-pitched flyback transformer whine rising then settling, faint electrical hum |
| sfx_degauss | 1.5 | CRT degauss: deep resonant electromagnetic thwumm with a metallic wobble and buzzing decay |
| sfx_static | 2.0 | Analog TV static snow, white-noise hiss with crackles, a channel tuning in and fading out |
| sfx_wind | 9.0 | Desolate wind over a vast salt flat at dusk, hollow gusts, fine grit hissing across the ground, no birds |
| sfx_groan | 4.0 | Distant colossal ancient machine groan, deep metallic resonance echoing across an empty desert, slow |
| sfx_creak | 1.5 | Old metal lantern handle creaking as the lantern swings, small chain rattle, close |
| sfx_step | 2.0 | Cinematic impact: a single heavy boot on metal grating followed by a deep sub-bass drop and whoosh, stepping off a ledge into an abyss |
| sfx_air | 10.0 | Falling through a deep vertical shaft: rushing wind roar, cloth flapping, pebbles and debris tumbling, rising intensity |
| sfx_braam | 3.0 | Cinematic braam: huge low brass and distorted synth hit with sub impact, dark, long reverb tail |
| sfx_drip | 2.0 | A single water droplet falling into a still underground pool in a vast cave, clear plip with long cavern reverb |
| sfx_heart | 3.0 | Slow deep heartbeat at 60 bpm, muffled, close, dark |
| sfx_tick | 0.5 | Tiny wet organic click like an eyelid opening, very subtle, close |
| sfx_crackle | 3.5 | Old CRT phosphor crackle and electrostatic sizzle as glyphs appear on screen, soft digital shimmer |

Ambience (`loop: true`, 30 s, 3 takes):
> Seamless looping ambience of a deep dark cavern: low room tone, distant water drips with long reverb, faint hum of ancient machinery far away, occasional distant stone groan. Calm, ominous, no music.

Download everything to `art/intro/raw/<id>_<n>.<ext>`.

- [ ] **Step 3: Generate the score (`eleven_music_v2`, instrumental)**

- `score_main`, 24 s, 3 takes:
  > Instrumental cinematic score, dark ambient retro-future. 0–6 s: a sparse low analog-synth drone with a lonely, detuned metallic bell motif over a desolate texture. 6–12 s: slow low strings enter with a distant tolling pulse. 12–24 s: tension builds steadily into a pulsing low synth ostinato at 90 bpm, rising strings, metallic percussion and deep taiko hits, swelling towards a climax that is still rising at the end. No vocals. In the spirit of Blade Runner and Caves of Qud.
- `score_bloom`, 8 s, 2 takes:
  > Instrumental: a single sustained orchestral and analog-synth chord that begins dissonant and ominous and slowly resolves into a warm, mysterious minor chord, then decays into silence with long reverb. No percussion, no melody, no vocals.

Run `bash scripts/intro-bake.sh analyze <file> art/intro/raw/<name>` on each and Read the waveform and spectrogram PNGs. Reject takes with vocals: when in doubt, `creative_transcribe_audio` must return no words. Also reject takes that start with silence longer than 0.3 s (or note the in-point) and `score_main` takes whose energy doesn't rise across 12–22 s.

- [ ] **Step 4: USER CHECKPOINT**

List the candidate files per id (score takes, ambience takes, braam takes at minimum) with one line each on what the analysis showed, plus your pick. Ask the user to listen and confirm or re-pick. **I can't hear the audio; their ears are the acceptance test.**

- [ ] **Step 5: Bake**

```bash
for id in sfx_relay sfx_flyback sfx_degauss sfx_static sfx_wind sfx_groan sfx_creak sfx_step sfx_air sfx_braam sfx_drip sfx_heart sfx_tick sfx_crackle; do
  bash scripts/intro-bake.sh audio $id art/intro/raw/<chosen file for $id>
done
bash scripts/intro-bake.sh audio score_main art/intro/raw/<chosen main> <leading-silence in-point or 0> "" 5 30
bash scripts/intro-bake.sh audio score_bloom art/intro/raw/<chosen bloom> <in-point or 0> "" 5 200
bash scripts/intro-bake.sh audio ambience art/intro/raw/<chosen ambience> 0 "" 0 0
bash scripts/intro-bake.sh analyze client/public/intro/ambience.m4a art/intro/raw/ambience_final
bash scripts/intro-bake.sh sizes
```
Ambience loop-seam check: `ffmpeg -i client/public/intro/ambience.m4a -af "aloop=loop=1:size=2e9" -t 60 art/intro/raw/amb_twice.wav`, then analyze it. The waveform must show no dip or click at the 30 s seam. If it does, re-bake from a take whose first and last 50 ms have similar RMS (`astats`) and note it. Total shipped size must stay ≤ 6 MB (plates included). If it's over, re-encode the SFX at 128k.

Record the chosen takes and in-points in NOTES.md.

- [ ] **Step 6: Commit**

Paths: every `client/public/intro/*.m4a` (list them explicitly) and `art/intro/NOTES.md`. Subject: `Add intro score, ambience and sound effects`.

---

### Task 11: Shots: power-on, dead glass, Waste, Threshold

**Files:**
- Modify: `client/src/intro/shots/power.ts` (append drawing), `client/src/intro/renderer.ts` (dispatch real shots)
- Create: `client/src/intro/shots/plates.ts`

**Interfaces:**
- Consumes: `powerState`, `drawPlate`, `IntroAssets`, `NOTES.md` values `WASTE_LIGHT` and `THRESHOLD_STEP_IN`.
- Produces: `drawDeadGlass(o, W, H, time, dpr)`, `crtWarmPass(c, t)`, `drawPowerAperture(o, t, W, H, dpr)`, `drawPower(c, t, a)`; `WASTE_T0`, `THRESHOLD_T0`, `WASTE_LIGHT`, `drawWaste(c, t, a)`, `drawThreshold(c, t, a)`.

- [ ] **Step 1: Append the drawing code to `shots/power.ts`**

Add these imports at the top of the file (merge with the existing `../math.js` import):
```ts
import { clamp, inv, ease, hash } from '../math.js';
import { LR_W, LR_H } from '../timeline.js';
import type { IntroAssets } from '../assets.js';
import { drawPlate } from '../plate.js';
```
Append:
```ts
/** The switched-off set behind the gate: near-black glass, a curved reflection, a standby LED. */
export function drawDeadGlass(o: CanvasRenderingContext2D, W: number, H: number, time: number, dpr: number): void {
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalAlpha = 1;
  o.globalCompositeOperation = 'source-over';
  o.fillStyle = '#060606';
  o.fillRect(0, 0, W, H);
  const refl = o.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, Math.max(W, H) * 0.55);
  refl.addColorStop(0, 'rgba(130,140,150,0.07)');
  refl.addColorStop(0.5, 'rgba(90,100,110,0.025)');
  refl.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = refl;
  o.fillRect(0, 0, W, H);
  const edge = o.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.85)');
  o.fillStyle = edge;
  o.fillRect(0, 0, W, H);
  const p = 0.55 + 0.45 * Math.sin(time * 2.2);
  o.save();
  o.shadowColor = 'rgba(255,50,30,0.9)';
  o.shadowBlur = 10 * dpr * p;
  o.fillStyle = `rgba(255,${(60 + 40 * p) | 0},40,${0.45 + 0.5 * p})`;
  o.beginPath();
  o.arc(W - 28 * dpr, H - 24 * dpr, 2.5 * dpr, 0, Math.PI * 2);
  o.fill();
  o.restore();
}

/** During the power-on the Waste is held on its first frame beneath the static. */
export function drawPower(c: CanvasRenderingContext2D, t: number, a: IntroAssets): void {
  void t;
  drawPlate(c, a.plates.waste, 0);
}

/** Low-res per-pixel pass: barrel bulge, vertical-hold roll with a blanking bar, snow. */
export function crtWarmPass(c: CanvasRenderingContext2D, t: number): void {
  const s = powerState(t);
  if (s.snow <= 0 && s.barrel <= 0.001 && (s.roll <= 0 || s.roll >= 1)) return;
  const src = c.getImageData(0, 0, LR_W, LR_H);
  const out = c.createImageData(LR_W, LR_H);
  const sd = src.data, od = out.data;
  const fi = Math.floor(t * 30);
  const rolling = s.roll > 0 && s.roll < 1;
  const rollRows = Math.round(s.roll * LR_H) % LR_H;
  const barY = (LR_H - rollRows) % LR_H;
  for (let y = 0; y < LR_H; y++) {
    const ny = (y / (LR_H - 1)) * 2 - 1;
    const barDist = rolling ? Math.min(Math.abs(y - barY), LR_H - Math.abs(y - barY)) : 99;
    const bar = barDist < 5 ? 0.15 : 1;
    for (let x = 0; x < LR_W; x++) {
      const nx = (x / (LR_W - 1)) * 2 - 1;
      const f = 1 + s.barrel * (nx * nx + ny * ny);
      const bx = Math.round(((nx * f + 1) / 2) * (LR_W - 1));
      let by = Math.round(((ny * f + 1) / 2) * (LR_H - 1));
      const o = (y * LR_W + x) * 4;
      od[o + 3] = 255;
      if (bx < 0 || bx >= LR_W || by < 0 || by >= LR_H) continue;
      by = (by + rollRows) % LR_H;
      const i = (by * LR_W + bx) * 4;
      const n = hash(x * 0.37 + y * 113.1 + fi * 7.7) * 255;
      const sn = s.snow * 0.9;
      od[o] = (sd[i] * (1 - sn) + n * sn) * bar;
      od[o + 1] = (sd[i + 1] * (1 - sn) + n * sn) * bar;
      od[o + 2] = (sd[i + 2] * (1 - sn) + n * 1.04 * sn) * bar;
    }
  }
  c.putImageData(out, 0, 0);
}

/** Native-res tube aperture: dot → line → vertical opening with an overbright wash. */
export function drawPowerAperture(o: CanvasRenderingContext2D, t: number, W: number, H: number, dpr: number): void {
  if (t >= 0.6) return;
  const s = powerState(t);
  const cy = H / 2;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalAlpha = 1;
  o.globalCompositeOperation = 'source-over';
  if (t < 0.25) {
    o.fillStyle = '#000';
    o.fillRect(0, 0, W, H);
    o.save();
    o.shadowColor = 'rgba(220,235,255,0.95)';
    o.shadowBlur = 18 * dpr;
    o.fillStyle = '#f4f8ff';
    if (s.line <= 0) {
      o.beginPath();
      o.arc(W / 2, cy, Math.max(1, s.dot * 4 * dpr), 0, Math.PI * 2);
      o.fill();
    } else {
      const lw = Math.max(8 * dpr, s.line * W);
      const th = (2 + 3 * (1 - s.line)) * dpr;
      o.fillRect(W / 2 - lw / 2, cy - th / 2, lw, th);
    }
    o.restore();
    return;
  }
  const band = Math.max(2 * dpr, s.open * H);
  o.fillStyle = '#000';
  o.fillRect(0, 0, W, Math.max(0, cy - band / 2));
  o.fillRect(0, cy + band / 2, W, Math.max(0, H - (cy + band / 2)));
  if (s.over > 0.01) {
    o.globalCompositeOperation = 'lighter';
    o.fillStyle = `rgba(235,240,255,${clamp(0.85 * s.over)})`;
    o.fillRect(0, cy - band / 2, W, band);
    o.globalCompositeOperation = 'source-over';
  }
}
```

- [ ] **Step 2: Create `shots/plates.ts`**

Fill in `WASTE_LIGHT` from NOTES.md. `THRESHOLD_T0` stays 8 unless Task 8 recorded a shifted step.
```ts
// THE WASTE (1.6–8 s) and THE THRESHOLD (8–13 s): re-pixelated AI plates with canvas life on top.
import { LR_W, LR_H } from '../timeline.js';
import { hash, vnoise } from '../math.js';
import type { IntroAssets } from '../assets.js';
import { drawPlate } from '../plate.js';

export const WASTE_T0 = 1.6;
export const THRESHOLD_T0 = 8;
/** A dead signal light on the monolith (320×180 coords, from art/intro/NOTES.md). It flickers once. */
export const WASTE_LIGHT = { x: 214, y: 58, t: 5.2 };

/** Salt dust streaming left→right, deterministic in t. */
function drawDust(c: CanvasRenderingContext2D, t: number, density: number, speed: number): void {
  const n = Math.round(60 * density);
  for (let i = 0; i < n; i++) {
    const sp = speed * (0.6 + hash(i * 3.1) * 0.8);
    const x = ((hash(i) * (LR_W + 40) + t * sp) % (LR_W + 40)) - 20;
    const y = LR_H * (0.45 + hash(i * 7.7) * 0.55) + vnoise(t * 0.8 + i) * 3;
    const a = 0.15 + hash(i * 1.9) * 0.35;
    c.fillStyle = `rgba(232,224,210,${a})`;
    c.fillRect(Math.round(x), Math.round(y), hash(i * 5.3) > 0.8 ? 2 : 1, 1);
  }
}

export function drawWaste(c: CanvasRenderingContext2D, t: number, a: IntroAssets): void {
  drawPlate(c, a.plates.waste, t - WASTE_T0);
  drawDust(c, t, 1, 70);
  const d = t - WASTE_LIGHT.t;
  const on = (d > 0 && d < 0.14) || (d > 0.24 && d < 0.3);
  if (on) {
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(120,255,230,0.95)';
    c.fillRect(WASTE_LIGHT.x, WASTE_LIGHT.y, 2, 1);
    c.fillStyle = 'rgba(120,255,230,0.25)';
    c.fillRect(WASTE_LIGHT.x - 1, WASTE_LIGHT.y - 1, 4, 3);
    c.globalCompositeOperation = 'source-over';
  }
}

export function drawThreshold(c: CanvasRenderingContext2D, t: number, a: IntroAssets): void {
  drawPlate(c, a.plates.threshold, t - THRESHOLD_T0);
  drawDust(c, t, 0.5, 45);
}
```

- [ ] **Step 3: Dispatch real shots in `renderer.ts`**

Add the imports:
```ts
import { drawDeadGlass, drawPower, crtWarmPass, drawPowerAperture, powerState } from './shots/power.js';
import { drawWaste, drawThreshold } from './shots/plates.js';
```
Replace `renderGate`'s body with `drawDeadGlass(this.o, this.out.width, this.out.height, time, this.dpr);`.
Replace `drawScene`'s `lx.fillStyle = PLACEHOLDER[id]; lx.fillRect(...)` and `void t; void a;` lines with:
```ts
    lx.fillStyle = id === 'dark' || id === 'resolve' ? BG : '#000';
    lx.fillRect(0, 0, LR_W, LR_H);
    lx.save();
    if (id === 'power') drawPower(lx, t, a);
    else if (id === 'waste') drawWaste(lx, t, a);
    else if (id === 'threshold') drawThreshold(lx, t, a);
    else if (!(id === 'dark' || id === 'resolve')) { lx.fillStyle = PLACEHOLDER[id]; lx.fillRect(0, 0, LR_W, LR_H); }
    lx.restore();
    if (t < 1.6) crtWarmPass(lx, t);
```
Replace `wobble`'s body with `return t < 1.6 ? powerState(t).wobble * 2 : 0;`.
Replace `drawNative`'s body with:
```ts
    if (t < 0.6) drawPowerAperture(this.o, t, this.out.width, this.out.height, this.dpr);
    void a;
```

- [ ] **Step 4: Type check, test, and review the stills**

```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit && npx vitest run src/intro"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs stills 0.03,0.15,0.3,0.45,0.8,1.0,1.3,1.7,3,5.25,7.5,8.5,11,12.6,12.9"
```
Read every still. Acceptance:
- 0.03 is a dot and 0.15 a line on black.
- 0.3–0.45 shows the tube opening with an overbright wash and a bulged image.
- 0.8–1.3 shows snow with one roll bar.
- 1.7 is the clean Waste with no bulge.
- At 5.25 the signal light is visible, on the monolith.
- 12.6 is the step moment in the Threshold.
- Dust reads as fine salt, not noise.

Tune the constants (dust density/alpha, `WASTE_LIGHT`, barrel strength) until each still reads right. Also run the gate: `node -e` is unnecessary; `stills` doesn't show the gate. Verify it by opening `/?intro` in the headed dev browser once.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/shots/power.ts client/src/intro/shots/plates.ts client/src/intro/renderer.ts`. Subject: `Add intro power-on, Waste and Threshold shots`.

---

### Task 12: Shot: the Descent

**Files:**
- Modify: `client/src/intro/shots/descent.ts` (append drawing), `client/src/intro/renderer.ts` (dispatch)

**Interfaces:**
- Consumes: `fallDepth`, `stratumTop`, `FIG_Y`, `STRATA`, `IntroAssets.images` (`descent_far`, `wall_*`, `near_wall`, `ledge`, `figure_fall`, `glyph_*`), `SCREEN_SPOTS` from NOTES.md.
- Produces: `drawDescent(c, t, a)`, `SCREEN_SPOTS`.

- [ ] **Step 1: Append the drawing to `shots/descent.ts`**

Add the imports (merge with the existing `STRATA` import):
```ts
import { LR_W, LR_H, STRATA, type StratumId } from '../timeline.js';
import { clamp, lerp, ease, hash, vnoise } from '../math.js';
import type { IntroAssets, ImageId } from '../assets.js';
```
Append (fill `SCREEN_SPOTS` from NOTES.md):
```ts
const WALL: Record<StratumId, ImageId> = {
  conduits: 'wall_conduits', screens: 'wall_screens', fungal: 'wall_fungal', crystal: 'wall_crystal',
};
const AMBIENT: Record<StratumId, string> = {
  conduits: '#3a3036', screens: '#26343a', fungal: '#243a30', crystal: '#2e2640',
};
/** Dead-screen centres in wall_screens.png pixel coords (from art/intro/NOTES.md). */
export const SCREEN_SPOTS: readonly { x: number; y: number }[] = [
  { x: 40, y: 40 }, { x: 52, y: 110 }, { x: 36, y: 180 },
];
const SCREEN_GLYPHS: readonly ImageId[] = ['glyph_lurker', 'glyph_spider', 'glyph_colossus'];

let light: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null = null;
let tint: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null = null;
function scratch(ref: typeof light, w: number, h: number) {
  if (ref) return ref;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d')! };
}

function drawWalls(c: CanvasRenderingContext2D, a: IntroAssets, cam: number): void {
  for (let i = 0; i < STRATA.length; i++) {
    const img = a.images[WALL[STRATA[i].id]];
    if (!img) continue;
    const top = i === 0 ? 0 : stratumTop(i);
    const bottom = i + 1 < STRATA.length ? stratumTop(i + 1) : Infinity;
    const y0 = Math.max(0, Math.round(top - cam)), y1 = Math.min(LR_H, Math.round(bottom - cam));
    if (y1 <= y0) continue;
    const texY = Math.round(cam + y0 - top);
    c.save();
    c.beginPath();
    c.rect(0, y0, LR_W, y1 - y0);
    c.clip();
    c.drawImage(img, 0, y0 - texY);
    c.translate(LR_W, 0);
    c.scale(-1, 1);
    c.drawImage(img, 0, y0 - texY);
    c.restore();
  }
}

function drawScreens(c: CanvasRenderingContext2D, a: IntroAssets, cam: number, t: number): void {
  const i = STRATA.findIndex((s) => s.id === 'screens');
  const top = stratumTop(i), bottom = stratumTop(i + 1);
  tint = scratch(tint, 24, 24);
  SCREEN_SPOTS.forEach((p, k) => {
    const y = top + p.y - cam;
    if (y < -12 || y > LR_H + 12 || top + p.y > bottom) return;
    const flick = hash(Math.floor(t * 12) * 3.7 + k) > 0.35 ? 1 : 0.25;
    const g = a.images[SCREEN_GLYPHS[k % SCREEN_GLYPHS.length]];
    if (!g) return;
    const tx = tint!.x;
    tx.globalCompositeOperation = 'source-over';
    tx.clearRect(0, 0, 24, 24);
    tx.drawImage(g, 0, 0, 24, 24);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = '#7fffe0';
    tx.fillRect(0, 0, 24, 24);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55 * flick;
    for (const x of [p.x, LR_W - p.x]) c.drawImage(tint!.c, Math.round(x - 6), Math.round(y - 6), 12, 12);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  });
}

function drawParticles(c: CanvasRenderingContext2D, id: StratumId, cam: number, t: number): void {
  // Debris streaking upward past the camera.
  for (let i = 0; i < 34; i++) {
    const x = Math.round(hash(i) * LR_W);
    const y = Math.round(((hash(i + 50) * 400 - cam * (1.4 + hash(i + 9) * 0.8)) % 200 + 200) % 200 - 10);
    c.fillStyle = `rgba(200,190,170,${0.12 + hash(i * 2.1) * 0.25})`;
    c.fillRect(x, y, 1, 2 + Math.round(hash(i * 4.4) * 4));
  }
  // Stratum emissives: spores in the fungal band, glints in the crystal band.
  if (id === 'fungal' || id === 'crystal') {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const x = Math.round(hash(i * 1.3 + 7) * LR_W);
      const y = Math.round(((hash(i * 2.7) * 260 - cam * 0.9 - t * (id === 'fungal' ? 6 : 0)) % 200 + 200) % 200 - 10);
      const tw = id === 'crystal' ? (hash(Math.floor(t * 8) + i) > 0.85 ? 1 : 0.2) : 0.6 + 0.4 * Math.sin(t * 3 + i);
      c.fillStyle = id === 'fungal' ? `rgba(90,255,190,${0.45 * tw})` : `rgba(190,140,255,${0.7 * tw})`;
      c.fillRect(x, y, 1, 1);
    }
    c.globalCompositeOperation = 'source-over';
  }
}

export function drawDescent(c: CanvasRenderingContext2D, t: number, a: IntroAssets): void {
  const u = clamp(t - DESCENT_T0, 0, 9);
  const cam = fallDepth(u);
  const id = STRATA[stratumAtDepth(cam + FIG_Y)].id;
  const jx = Math.round(vnoise(u * 9) * 0.8), jy = Math.round(vnoise(u * 9 + 33) * 0.8);
  c.save();
  c.translate(jx, jy);

  // Far wall: slow parallax, dim.
  const far = a.images.descent_far;
  if (far) {
    c.globalAlpha = 0.55;
    c.drawImage(far, 0, -Math.round(cam * 0.12) % far.height);
    c.globalAlpha = 1;
  }

  // Daylight shaft from above, shrinking to a coin, then a star.
  const fade = ease.out2(clamp(u / 6.5));
  const beamW = lerp(90, 0, fade);
  if (beamW > 0.5) {
    const g = c.createLinearGradient(0, 0, 0, LR_H);
    g.addColorStop(0, `rgba(255,236,200,${0.5 * (1 - fade)})`);
    g.addColorStop(1, 'rgba(255,236,200,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(LR_W / 2 - beamW * 0.35, 0);
    c.lineTo(LR_W / 2 + beamW * 0.35, 0);
    c.lineTo(LR_W / 2 + beamW, LR_H);
    c.lineTo(LR_W / 2 - beamW, LR_H);
    c.fill();
    c.globalCompositeOperation = 'source-over';
  }

  drawWalls(c, a, cam);
  drawScreens(c, a, cam, t); // culls itself to the screens stratum

  // Ledges on stratum boundaries.
  const ledge = a.images.ledge;
  if (ledge) for (let i = 1; i < STRATA.length; i++) {
    const y = Math.round(stratumTop(i) - cam - ledge.height / 2);
    if (y > -ledge.height && y < LR_H) c.drawImage(ledge, 0, y);
  }

  // The falling figure, tumbling.
  const fig = a.images.figure_fall;
  let fx = LR_W / 2, fy = FIG_Y;
  if (fig) {
    const fs = fig.height, frames = Math.max(1, Math.floor(fig.width / fs));
    const f = Math.floor(u * 10) % frames;
    fx = Math.round(LR_W / 2 + vnoise(u * 0.7) * 14);
    fy = Math.round(FIG_Y + vnoise(u * 1.3 + 5) * 4);
    c.drawImage(fig, f * fs, 0, fs, fs, fx - fs / 2, fy - fs / 2, fs, fs);
  }

  // Lighting: stratum ambient × lantern, multiplied over the scene.
  light = scratch(light, LR_W, LR_H);
  const lx = light.x;
  lx.globalCompositeOperation = 'source-over';
  lx.fillStyle = AMBIENT[id];
  lx.fillRect(0, 0, LR_W, LR_H);
  lx.globalCompositeOperation = 'lighter';
  const r = 64 + vnoise(u * 11) * 6;
  const lg = lx.createRadialGradient(fx, fy, 0, fx, fy, r);
  lg.addColorStop(0, 'rgba(255,214,150,1)');
  lg.addColorStop(0.45, 'rgba(200,140,80,0.55)');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  lx.fillStyle = lg;
  lx.fillRect(0, 0, LR_W, LR_H);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(light.c, 0, 0);
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(255,190,110,0.35)';
  c.fillRect(fx - 1, fy + 2, 2, 2);
  c.globalCompositeOperation = 'source-over';

  drawParticles(c, id, cam, t);

  // Foreground silhouettes: fastest parallax, both edges.
  const near = a.images.near_wall;
  if (near) {
    const ny = -Math.round((cam * 1.6) % near.height);
    for (const oy of [ny, ny + near.height]) {
      c.drawImage(near, 0, oy);
      c.save();
      c.translate(LR_W, 0);
      c.scale(-1, 1);
      c.drawImage(near, 0, oy + 97);
      c.drawImage(near, 0, oy + 97 - near.height);
      c.restore();
    }
  }

  // The last of the daylight: a star at the top of the shaft.
  if (u > 6) {
    const tw = 0.6 + 0.4 * hash(Math.floor(t * 10));
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = `rgba(255,245,225,${tw * clamp((9 - u) / 1.5)})`;
    c.fillRect(LR_W / 2, 3, 1, 1);
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}
```

- [ ] **Step 2: Dispatch in `renderer.ts`**

Add `import { drawDescent } from './shots/descent.js';` and in `drawScene` add the branch `else if (id === 'descent') drawDescent(lx, t, a);` before the placeholder fallback.

- [ ] **Step 3: Type check, test, review the stills**

```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit && npx vitest run src/intro"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs stills 13.1,14.5,15.5,16.8,18.5,19.8,21.0,21.9"
```
Read each still. Acceptance:
- The walls are continuous with no gaps or visible texture seams.
- At 15.5, 18.5 and 21.0 a ledge crosses the figure.
- The daylight beam is wide at 13.1 and gone by 19.8, and a star is visible at 19.8 and 21.0.
- The figure is lit and legible, and the strata read distinctly: amber conduits, teal screens with glyph flicker, green fungal spores, violet crystal glints.
- Nothing is pure-black mush: raise the `AMBIENT` values if the frames are too dark.

Tune the constants and `SCREEN_SPOTS` until they pass.

- [ ] **Step 4: Commit**

Paths: `client/src/intro/shots/descent.ts client/src/intro/renderer.ts`. Subject: `Add intro Descent shot`.

---

### Task 13: Shots: the Dark and the Resolve (exact handoff)

**Files:**
- Create: `client/src/intro/shots/dark.ts`, `client/src/intro/shots/resolve.ts`
- Modify: `client/src/intro/renderer.ts` (dispatch, backdrop, glyph plan)

**Interfaces:**
- Consumes: `SceneLayout`, `PreBox`, `glyphRevealTime`, `eyeOpenTime`, the timeline key times, and the `logo` image.
- Produces: `drawDarkLowRes(c, t)`, `drawEyes(o, t, layout, dpr)`, `underlayAlpha(t)`, `GlyphPlan`, `buildGlyphPlan(o, layout, dpr): GlyphPlan`, `drawResolve(o, t, layout, plan, logo, dpr)`.

- [ ] **Step 1: Write `shots/dark.ts`**

```ts
// THE DARK (22–26 s): silence, one drip, then the eyes open one pair at a time, at exactly
// the positions CaveBackground will show them.
import { DRIP_T, EYES_SETTLE_T0, EYES_SETTLE_T1, eyeOpenTime } from '../timeline.js';
import { clamp, inv, lerp, ease } from '../math.js';
import type { SceneLayout } from '../layout.js';

export function drawDarkLowRes(c: CanvasRenderingContext2D, t: number): void {
  const fall = inv(DRIP_T - 0.45, DRIP_T, t);
  if (t < DRIP_T && fall > 0) {
    c.fillStyle = 'rgba(190,210,220,0.9)';
    c.fillRect(160, Math.round(lerp(-2, 112, ease.in2(fall))), 1, 2);
    return;
  }
  const d = t - DRIP_T;
  if (d < 0 || d > 2) return;
  const fl = Math.exp(-d * 5);
  const g = c.createRadialGradient(160, 113, 0, 160, 113, 34);
  g.addColorStop(0, `rgba(170,190,200,${0.35 * fl})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = g;
  c.fillRect(120, 90, 80, 46);
  c.lineWidth = 1;
  for (let ring = 0; ring < 2; ring++) {
    const rd = d - ring * 0.18;
    if (rd <= 0) continue;
    const rx = rd * 38 + 2, alpha = 0.55 * clamp(1 - rd / 1.6);
    c.strokeStyle = `rgba(160,185,200,${alpha})`;
    c.beginPath();
    c.ellipse(160.5, 113.5, rx, rx * 0.22, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
}

/** Canvas eyes, converging on each DOM eye's live (CSS-animated) opacity before the handoff. */
export function drawEyes(o: CanvasRenderingContext2D, t: number, layout: SceneLayout, dpr: number): void {
  layout.eyes.forEach((e, i) => {
    const to = eyeOpenTime(i);
    if (t < to) return;
    const open = clamp(ease.outBack(clamp((t - to) / 0.14)), 0, 1.15);
    let alpha = 0.9 * (0.88 + 0.12 * Math.sin(t * 2.3 + i));
    if (t >= EYES_SETTLE_T0) {
      const live = parseFloat(getComputedStyle(e.el).opacity) || 0;
      alpha = lerp(alpha, live, ease.inOut(inv(EYES_SETTLE_T0, EYES_SETTLE_T1, t)));
    }
    if (alpha <= 0.005) return;
    o.save();
    o.globalAlpha = alpha;
    o.fillStyle = '#cc2020';
    for (const r of [e.a, e.b]) {
      const cx = (r.x + r.w / 2) * dpr, cy = (r.y + r.h / 2) * dpr;
      for (const [blur, col] of [[10, 'rgba(255,40,40,0.4)'], [4, '#ff3030']] as const) {
        o.shadowBlur = blur * dpr;
        o.shadowColor = col;
        o.beginPath();
        o.ellipse(cx, cy, (r.w / 2) * dpr, Math.max(0.2, (r.h / 2) * dpr * open), 0, 0, Math.PI * 2);
        o.fill();
      }
    }
    o.restore();
  });
}
```

- [ ] **Step 2: Write `shots/resolve.ts`**

```ts
// THE RESOLVE (26–30 s): the ASCII cavern scans in as phosphor glyphs at the DOM's exact
// coordinates, the logo burns in with its CSS glow, then the backdrop fades to the live page.
import { GLYPH_T0, GLYPH_T1, LOGO_T0, LOGO_T1, UNDERLAY_T0, UNDERLAY_T1 } from '../timeline.js';
import { clamp, inv, ease, lerp } from '../math.js';
import { glyphRevealTime, type SceneLayout, type PreBox } from '../layout.js';

export function underlayAlpha(t: number): number {
  return 1 - ease.inOut(inv(UNDERLAY_T0, UNDERLAY_T1, t));
}

interface Cell { x: number; ch: string; tr: number }
interface Line { baseline: number; text: string; cells: Cell[] }
interface PrePlan { pre: PreBox; font: string; lines: Line[] }
export interface GlyphPlan { pres: PrePlan[]; frontBottom: (t: number) => number; frontTop: (t: number) => number }

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/\d+(\.\d+)?/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [48, 42, 36];
}

export function buildGlyphPlan(o: CanvasRenderingContext2D, layout: SceneLayout, dpr: number): GlyphPlan {
  const pres: PrePlan[] = layout.pres.map((pre, pi) => {
    const font = `${pre.fontStyle} ${pre.fontWeight} ${pre.fontSize * dpr}px ${pre.fontFamily}`;
    o.font = font;
    o.letterSpacing = `${pre.letterSpacing * dpr}px`;
    const m = o.measureText('█');
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    const lh = pre.lineHeight * dpr;
    const lines: Line[] = pre.lines.map((text, li) => {
      const top = (pre.y + li * pre.lineHeight) * dpr;
      const cells: Cell[] = [];
      for (let ci = 0; ci < text.length; ci++) {
        const ch = text[ci];
        if (ch === ' ') continue;
        const cssY = pre.y + (li + 0.5) * pre.lineHeight;
        cells.push({
          x: pre.x * dpr + o.measureText(text.slice(0, ci)).width,
          ch,
          tr: glyphRevealTime(pre.anchor, cssY, layout.h, pi * 1000 + li * 37 + ci),
        });
      }
      return { baseline: top + (lh - (asc + desc)) / 2 + asc, text, cells };
    });
    return { pre, font, lines };
  });
  o.letterSpacing = '0px';
  const H = layout.h * dpr;
  const span = (t: number) => clamp((t - GLYPH_T0) / (GLYPH_T1 - GLYPH_T0 - 0.25));
  return {
    pres,
    frontBottom: (t) => H - span(t) * H * 0.55,
    frontTop: (t) => span(t) * H * 0.35,
  };
}

const HOT: [number, number, number] = [255, 224, 160];

export function drawResolve(
  o: CanvasRenderingContext2D, t: number, layout: SceneLayout, plan: GlyphPlan,
  logo: HTMLImageElement | undefined, dpr: number, filtersOK: boolean,
): void {
  const settled = t >= GLYPH_T1 + 0.5;
  o.save();
  o.textBaseline = 'alphabetic';
  for (const p of plan.pres) {
    const { pre } = p;
    const base = parseRgb(pre.color);
    o.save();
    o.beginPath();
    o.rect(pre.clip.x * dpr, pre.clip.y * dpr, pre.clip.w * dpr, pre.clip.h * dpr);
    o.clip();
    o.font = p.font;
    o.letterSpacing = `${pre.letterSpacing * dpr}px`;
    o.globalAlpha = pre.opacity;
    if (settled) {
      o.shadowColor = 'rgba(200,170,120,0.2)';
      o.shadowBlur = 2 * dpr;
      o.fillStyle = pre.color;
      for (const l of p.lines) o.fillText(l.text, pre.x * dpr, l.baseline);
    } else {
      for (const l of p.lines) for (const c of l.cells) {
        if (t < c.tr) continue;
        const heat = Math.exp(-(t - c.tr) * 6);
        const col = base.map((v, i) => Math.round(lerp(v, HOT[i], heat)));
        o.globalAlpha = pre.opacity;
        o.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        o.fillText(c.ch, c.x, l.baseline);
      }
    }
    o.restore();
  }
  // Scan fronts: faint amber lines riding the build.
  if (t < GLYPH_T1) {
    o.globalCompositeOperation = 'lighter';
    o.globalAlpha = 0.18;
    o.fillStyle = '#ffc070';
    o.fillRect(0, plan.frontBottom(t), layout.w * dpr, Math.max(1, dpr));
    o.fillRect(0, plan.frontTop(t), layout.w * dpr, Math.max(1, dpr));
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;
  }
  o.restore();

  // Logo: revealed top→bottom, with the same drop-shadow glow as .lobby-logo, plus a decaying burn.
  const r = layout.logo;
  if (!r || !logo || t < LOGO_T0) return;
  const p = ease.inOut(inv(LOGO_T0, LOGO_T1, t));
  const x = r.x * dpr, y = r.y * dpr, w = r.w * dpr, h = r.h * dpr, pad = 60 * dpr;
  o.save();
  o.beginPath();
  o.rect(x - pad, y - pad, w + pad * 2, pad + h * p + (p >= 1 ? pad : 0));
  o.clip();
  if (filtersOK) o.filter = `drop-shadow(0 0 ${12 * dpr}px rgba(212,168,87,0.5)) drop-shadow(0 0 ${40 * dpr}px rgba(212,168,87,0.15))`;
  else { o.shadowColor = 'rgba(212,168,87,0.5)'; o.shadowBlur = 24 * dpr; }
  o.drawImage(logo, x, y, w, h);
  o.filter = 'none';
  o.shadowBlur = 0;
  const burn = Math.exp(-Math.max(0, t - LOGO_T0) * 1.6);
  if (burn > 0.02) {
    o.globalCompositeOperation = 'lighter';
    o.globalAlpha = 0.55 * burn;
    o.drawImage(logo, x, y, w, h);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
  }
  if (p < 1) {
    o.globalCompositeOperation = 'lighter';
    o.fillStyle = `rgba(255,210,140,${0.6 * (1 - p)})`;
    o.fillRect(x, y + h * p - dpr, w, 2 * dpr);
    o.globalCompositeOperation = 'source-over';
  }
  o.restore();
}
```
Heat is expressed through colour only: a fresh glyph starts hot amber and cools to the DOM colour.

- [ ] **Step 3: Wire into `renderer.ts`**

Imports:
```ts
import { drawDarkLowRes, drawEyes } from './shots/dark.js';
import { drawResolve, underlayAlpha, buildGlyphPlan, type GlyphPlan } from './shots/resolve.js';
```
Add a field `private plan: GlyphPlan | null = null;`. In `setLayout`, after assigning, add `this.plan = layout ? buildGlyphPlan(this.o, layout, this.dpr) : null;`. In `resize`, add at the end `if (this.layout) this.plan = buildGlyphPlan(this.o, this.layout, this.dpr);`.
In `drawScene`, add the branch `else if (id === 'dark') drawDarkLowRes(lx, t);` and delete the `PLACEHOLDER` constant and its fallback branch (every shot is now real).
Replace `backdrop`'s body with `return underlayAlpha(t);`.
Replace `drawNative`'s body with:
```ts
    if (t < 0.6) drawPowerAperture(this.o, t, this.out.width, this.out.height, this.dpr);
    if (this.layout && t >= 22) {
      this.o.setTransform(1, 0, 0, 1, 0, 0);
      drawEyes(this.o, t, this.layout, this.dpr);
      if (t >= 26 && this.plan) drawResolve(this.o, t, this.layout, this.plan, a.images.logo, this.dpr, this.filtersOK);
    }
```

- [ ] **Step 4: Type check, test, review the stills and verify the handoff**

```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit && npx vitest run"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs stills 22.4,22.9,23.5,24.5,25.8,26.6,27.4,27.9,28.8,29.4,29.99"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs handoff --viewport 1920x1080 && node scripts/intro-render.mjs handoff --viewport 1280x720 && node scripts/intro-render.mjs handoff --viewport 1366x768"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs keys"
```
Read the stills:
- 22.4 is black with a falling drop, 22.9 a ripple and flash, 23.5–25.8 the eyes appearing at the cavern-eye positions.
- 26.6–27.9 the glyphs building bottom-up and top-down with hot amber heads.
- 27.9–28.8 the logo scanning in with a burn.
- 29.99 is indistinguishable from the login screen.

`handoff` must print PASS at all three sizes. If it fails, Read `.intro/handoff/diff_*.png` and fix the offending layer: glyph baselines (ascent/descent maths), letter-spacing, clip rects, logo filter. `keys` must print `keys: OK`.

Also run the Review Focus viewport stills: `node scripts/intro-render.mjs stills 5,17,27.5 --viewport 1366x768`, then `--viewport 2560x1080`, then `--viewport 800x1200`. The frame must be filled with no gaps and the native layers aligned.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/shots/dark.ts client/src/intro/shots/resolve.ts client/src/intro/renderer.ts`. Subject: `Add intro Dark and Resolve shots with exact DOM handoff`.

---

### Task 14: Final mix, full export, review, docs

**Files:**
- Modify: `client/src/intro/timeline.ts` (`MASTER_TRIM`, cue gains)
- Create: `client/src/intro/README.md`

**Interfaces:**
- Consumes: everything.
- Produces: `.intro/intro.mp4` (review deliverable, not committed), README, stored memory.

- [ ] **Step 1: Loudness-normalize the mix**

```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs wav"
bash scripts/intro-bake.sh analyze .intro/intro.wav .intro/mix
```
Read `.intro/mix_wave.png` and `mix_spec.png`. Silencedetect must report a silence starting at about 22.0 s and ending at about 22.8 s. Set `MASTER_TRIM = 10 ** ((-16 - I) / 20)`, rounded to 2 decimals, where `I` is the integrated loudness printed. Re-render and re-analyze until I ≈ −16 ±1 LUFS and the peak is ≤ −1 dBFS; lower individual cue gains if a hit clips. Run `npx vitest run src/intro` (the timeline tests must still pass).

- [ ] **Step 2: Export the review MP4**

```bash
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/intro-render.mjs frames 30 --to 31"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i .intro/frames/f%05d.jpg -i .intro/intro.wav -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest .intro/intro.mp4
bash scripts/intro-bake.sh contact .intro/intro.mp4 .intro/intro_contact.png 6 5
```
Read `.intro/intro_contact.png` for a whole-piece sanity check of continuity, exposure and shot order.

- [ ] **Step 3: Full verification**

- `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm test"` → all workspaces PASS.
- `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit && npm run build"` → clean build. Check the production bundle includes nothing unexpected.
- `node scripts/intro-render.mjs handoff` at 1920×1080 and `keys` → PASS / OK.
- `bash scripts/intro-bake.sh sizes` → ≤ 6 MB.
- Manual, headed browser (`npm run dev`), in order:
  1. First visit: gate → full play with sound → lands on login and the ambience keeps going.
  2. Log in → character select → enter world: crossfade to `gasket_maples`.
  3. Log out, click `↺ intro`: replays without the gate.
  4. Skip at 3 s, 15 s and 27 s: each resolves in under 2 s.
  5. Escape on the gate.
  6. Emulated reduced motion (DevTools rendering): no intro.
  7. Throttle the network to Slow 3G with the cache cleared: the gate waits and falls back to login within 8 s of the keypress if assets aren't ready.
  8. With a stored session token (log in, reload with `?intro`): the view becomes character select during the intro and the handoff still lands on the cavern with the logo.

Record the results.

- [ ] **Step 4: Write `client/src/intro/README.md`**

Cover:
- What the intro is and where it plays.
- File map (from this plan's File Structure).
- The timeline as the single source of truth.
- How to tune a shot: `stills`.
- How to re-bake plates, layers and audio: `intro-bake.sh` subcommands with the NOTES.md values.
- How to verify: `handoff`, `keys`.
- How to export: `frames` + `wav` + ffmpeg.
- That raw generations live in `art/intro/raw/` (ignored) and the chosen takes are recorded in `art/intro/NOTES.md`.

- [ ] **Step 5: Commit**

Paths: `client/src/intro/timeline.ts client/src/intro/README.md`. Subject: `Balance intro mix and document the intro pipeline`.

- [ ] **Step 6: Store memory and hand over**

`memory_store` (thinker) and a file memory: the intro pipeline, meaning the offline plate re-pixelation, the DOM-measured handoff, and that `audioEngine` now owns all music. Include why the non-obvious choices were made. Give the user the path to `.intro/intro.mp4`, the verification results, and the push command plus compare URL per the git memory (`git push -u origin feature/intro-cold-open`, `https://github.com/SilverLongjohns/Caverns/compare/main...feature/intro-cold-open?expand=1`) with a ready-to-paste PR description ending in the Claude Code attribution line.
