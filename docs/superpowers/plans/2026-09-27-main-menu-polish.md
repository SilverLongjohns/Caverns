# Main Menu Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every pre-dungeon screen onto the relic kit using the approved framings: B for menus (a centred console on the ASCII cave) and T2 for the town (content-sized consoles on the bazaar). Add CRT power transitions, typed text, UI sounds and ambient motion, and fix the bezel slot.

**Architecture:**
- **Shared shell:** `App.tsx` wraps every non-dungeon view in one persistent `MenuShell`, which owns the full-bleed backdrop (cave + logo, or bazaar), so the backdrop never remounts between menu screens.
- **Transitions:** each screen's content sits in a `ScreenTransition`, driven by a pure reducer. It keeps the outgoing console on screen while it powers off, then powers on the incoming one. Screens are built from a thin `MenuConsole` over the existing `RelicPanel`.
- **Pure logic, unit-tested in Node:** typed-text slicing, the transition reducer, the glitch timer and the UI-sound throttle.

**Tech Stack:** React 18, Zustand, Vite, CSS keyframes, Web Audio (existing `AudioEngine`), Vitest, Playwright (screenshots).

**Spec:** `docs/superpowers/specs/2026-09-27-main-menu-polish-design.md`

**Spec clarifications made by this plan:**
- **Bezel lamps:** the spec says lamps blink "over the frame's lamp positions". The frame border uses `round`, so its lamps move with the console's width. The plan therefore adds two fixed amber lamp dots on the top rail, 28px in from each corner, blinking out of phase.
- **Intro skipping in scripts:** since commit `0365b7d` the intro plays on every load and the `caverns_intro_seen` flag is no longer read. Scripts must dismiss the intro by pressing Escape while `.intro-root` exists. Task 4 fixes `scripts/intro-render.mjs` handoff mode, which still sets the dead flag.

## Global Constraints

**Environment and git**
- Node runs on Windows. Run npm and npx via `cmd.exe /c "..."` from the repo root.
- Git: use `git.exe`, stage explicit paths only, commit locally, never push. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The dev client used for checks is at `http://localhost:5175`. If it's down, start it with `cmd.exe /c "npm run dev:sandbox"` in the background and use the port Vite prints.

**Styling**
- Don't touch `.crt-overlay`, the scanlines (0.15) or the flicker. Ambient effects add to them; they never dim them.
- Bezel: `border: 18px` with `border-image: url('/ui/relic_frame.png') 18 / 18px round` and `background-clip: border-box`.
- Timings: power off 220ms, power on 280ms, watchdog 600ms, typing 40 characters per second, hover-tick throttle 80ms, glitch every 8000–15000ms for 400ms.
- Reduced motion (`prefers-reduced-motion: reduce`): transitions swap instantly, text shows in full at once, and lamps, glitch and scan roll are off. Sounds still play.

**Behaviour**
- Every existing prop and callback signature on `LoginScreen`, `CharacterSelect`, `WorldView`, `TownView`, `StashModal`, `ShopModal` and `CharacterModal` is unchanged. Every existing sound cue (`open_audio.mp3`, `stash.mp3`, `buy-sell.mp3`, `reroll.mp3`) stays.

**Intro handoff contract** (`client/src/intro/layout.ts` measures these on `#root`):
- The DOM on the login screen must keep exactly one `.lobby-logo` img and the `CaveBackground` markup (`.lobby-cave-bg pre`, `.lobby-cave-top pre`, `.cave-eyes .cave-eye`).
- `ScreenTransition` must not animate on first mount, so the console that appears under the intro's final frame is static.

**Automation hooks** (`.sandbox/explore-shot.mjs`, `scripts/sandbox-drive.mjs`): these class names must stay on the matching elements:
- `.lobby-start`: the login Continue button;
- `.char-slot-empty`: an empty slot card;
- `.char-slot-filled .char-slot-actions`: holds Resume and `.char-slot-delete`;
- `.char-create-name`: the name input;
- `.town-panel-portal`: the portal console, containing `.town-btn` (Ready/Unready) and `.town-btn-enter`.

The create button gets `.char-create-submit`; Task 5 updates the explore script to use it.

## Review Focus

1. **Server responds mid-transition.** For example, the login succeeds while the login console is still powering on, or a fast character create, or `worldError` arrives. The UI must show the latest screen with no stale console left behind. Test: Task 2 (reducer `change` during `on`/`off`) and Task 8 (transition DOM check).
2. **Animation events that don't belong to the transition.** An `animationend` bubbling up from a child (glitch line, lamp blink, typed cursor) must not end a power transition early. Test: Task 3 (the handler ignores events whose target isn't the transition body; reducer ignores `offDone` in the wrong phase).
3. **Text that changes while typing.** For example "Connecting…" becoming the generation line, or the world name arriving late. The visible text restarts cleanly, never mixing the two. Test: Task 2 (`typedSlice` is pure) and Task 3 (`TypedText` keyed by text).
4. **Closing a panel mid-power-on,** or opening Stash while the Store is closing. Exactly one console ends up visible. Test: Task 2 (the reducer jumps to the latest key) and Task 7 (manual check: open and close quickly).
5. **Audio before the first gesture, or with Web Audio missing.** Clicking any button never throws, and the button still works. Test: Task 2 (`playUi` with no context).

---

### Task 1: Bezel slot fix

**Files:**
- Modify: `client/src/styles/relic.css` (`.relic-panel`, `.relic-panel__title`, arena comment)
- Modify: `.sandbox/css-regressions.mjs` (git-ignored check script from the revamp)

**Interfaces:**
- Produces: `.relic-panel` has an 18px bezel with the glass painted under the frame. Everything later relies on it.

- [ ] **Step 1: Add the failing cascade check.** In `.sandbox/css-regressions.mjs`, inside `p.evaluate`, add a probe panel next to the existing probes:

```js
    <section id="panel" class="relic-panel"><div class="relic-panel__screen">x</div></section>
```

Add it to the returned object:

```js
    panelBorder: cs('panel').borderTopWidth, panelClip: cs('panel').backgroundClip,
```

And add these checks before the final `console.log`:

```js
if (r.panelBorder !== '18px') fails.push(`relic-panel border is ${r.panelBorder}, want 18px (frame metal is 17-18px)`);
if (r.panelClip !== 'border-box') fails.push(`relic-panel background-clip is ${r.panelClip}, want border-box`);
```

- [ ] **Step 2: Run it to verify it fails.**
Run: `cmd.exe /c "node .sandbox/css-regressions.mjs"`
Expected: FAIL listing `relic-panel border is 24px` and `background-clip is padding-box`.

- [ ] **Step 3: Fix the kit.** In `client/src/styles/relic.css`, in the `.relic-panel` rule:
- replace `border: 24px solid transparent;` with `border: 18px solid transparent;`;
- replace `border-image: url('/ui/relic_frame.png') 24 / 24px round;` with `border-image: url('/ui/relic_frame.png') 18 / 18px round;`;
- replace `background-clip: padding-box;` with `background-clip: border-box;`.

Above the rule, add the comment `/* The frame's metal is 17-18px; an 18px slot keeps it flush with the glass (glass painted under the frame). */`.

In `.relic-panel__title`, change `top: -20px;` to `top: -17px;`.

Replace the comment line `/* The bezel costs the grid 48px of width; the unit panel gives it back (200px -> 152px). */` with `/* The bezel costs the grid 36px of width; the narrower unit panel (152px) keeps the duel at >= 28 columns. */`.

- [ ] **Step 4: Verify.**
Run: `cmd.exe /c "node .sandbox/css-regressions.mjs"` → Expected: PASS.
Run: `cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:5175"` → Expected: `cols >= 28` and `rows >= 8`.
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"` → Expected: exit 0.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/styles/relic.css
git.exe commit -m "Fit the relic bezel slot to the frame art (18px)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure logic (typed text, transition reducer, glitch timer, UI sound throttle)

**Files:**
- Create: `client/src/ui/typed.ts`, `client/src/ui/typed.test.ts`
- Create: `client/src/ui/screenTransition.ts`, `client/src/ui/screenTransition.test.ts`
- Create: `client/src/ui/ambient.ts`, `client/src/ui/ambient.test.ts`
- Create: `client/src/audio/uiSounds.ts`, `client/src/audio/uiSounds.test.ts`
- Modify: `client/src/audio/audioEngine.ts` (add `playUi`)
- Modify: `client/src/audio/audioEngine.test.ts` (add `playUi` cases)

**Interfaces:**
- Produces:
  - `typedSlice(text: string, elapsedMs: number, cps: number): string`
  - `type TransitionState = { phase: 'idle'; key: string } | { phase: 'off'; from: string; to: string } | { phase: 'on'; key: string }`
  - `type TransitionEvent = { type: 'change'; key: string; reduced: boolean } | { type: 'offDone' } | { type: 'onDone' } | { type: 'timeout' }`
  - `transition(state, event): TransitionState`, `initialTransition(key): TransitionState`, `displayKey(state): string`, `targetKey(state): string`
  - `POWER_OFF_MS = 220`, `POWER_ON_MS = 280`, `TRANSITION_WATCHDOG_MS = 600`
  - `nextGlitchDelay(rand?: () => number): number`, `GLITCH_MS = 400`
  - `type UiSound = 'click' | 'tick' | 'power'`
  - `createUiThrottle(minGapMs?: number): (sound: UiSound, nowMs: number) => boolean`
  - `synthUiSound(ctx: BaseAudioContext, dest: AudioNode, sound: UiSound): void`
  - `audioEngine.playUi(sound: UiSound): void`

- [ ] **Step 1: Write the failing tests.**

`client/src/ui/typed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { typedSlice } from './typed.js';

describe('typedSlice', () => {
  it('shows nothing before typing starts', () => {
    expect(typedSlice('Hello', 0, 40)).toBe('');
    expect(typedSlice('Hello', -50, 40)).toBe('');
  });
  it('reveals cps characters per second', () => {
    expect(typedSlice('Hello world', 100, 40)).toBe('Hell');
  });
  it('caps at the full text', () => {
    expect(typedSlice('Hello', 10_000, 40)).toBe('Hello');
  });
  it('handles the empty string and bad rates', () => {
    expect(typedSlice('', 500, 40)).toBe('');
    expect(typedSlice('Hi', 500, 0)).toBe('');
    expect(typedSlice('Hi', Number.NaN, 40)).toBe('');
  });
  it('never splits a code point', () => {
    // '⌘' and '…' are single code points; '🗝' is a surrogate pair
    expect(typedSlice('⌘ Go', 25, 40)).toBe('⌘');
    expect(typedSlice('🗝x', 25, 40)).toBe('🗝');
    expect(typedSlice('ab…', 75, 40)).toBe('ab…');
  });
});
```

`client/src/ui/screenTransition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transition, initialTransition, displayKey, targetKey } from './screenTransition.js';

const change = (key: string, reduced = false) => ({ type: 'change', key, reduced }) as const;

describe('screen transition reducer', () => {
  it('starts idle on the first key (no power-on at first mount)', () => {
    expect(initialTransition('login')).toEqual({ phase: 'idle', key: 'login' });
  });
  it('powers off the old screen, then on the new one, then idles', () => {
    let s = transition(initialTransition('login'), change('select'));
    expect(s).toEqual({ phase: 'off', from: 'login', to: 'select' });
    expect(displayKey(s)).toBe('login');
    expect(targetKey(s)).toBe('select');
    s = transition(s, { type: 'offDone' });
    expect(s).toEqual({ phase: 'on', key: 'select' });
    s = transition(s, { type: 'onDone' });
    expect(s).toEqual({ phase: 'idle', key: 'select' });
  });
  it('ignores a change to the key already showing', () => {
    const s = initialTransition('login');
    expect(transition(s, change('login'))).toBe(s);
  });
  it('jumps straight to powering on the latest key when changed mid-transition', () => {
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, change('c'))).toEqual({ phase: 'on', key: 'c' });
    const on = { phase: 'on', key: 'b' } as const;
    expect(transition(on, change('c'))).toEqual({ phase: 'on', key: 'c' });
  });
  it('swaps instantly under reduced motion', () => {
    expect(transition(initialTransition('a'), change('b', true))).toEqual({ phase: 'idle', key: 'b' });
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, change('c', true))).toEqual({ phase: 'idle', key: 'c' });
  });
  it('the watchdog finishes whatever phase is running', () => {
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, { type: 'timeout' })).toEqual({ phase: 'on', key: 'b' });
    expect(transition({ phase: 'on', key: 'b' }, { type: 'timeout' })).toEqual({ phase: 'idle', key: 'b' });
    const idle = initialTransition('a');
    expect(transition(idle, { type: 'timeout' })).toBe(idle);
  });
  it('ignores completion events from the wrong phase', () => {
    const idle = initialTransition('a');
    expect(transition(idle, { type: 'offDone' })).toBe(idle);
    expect(transition(idle, { type: 'onDone' })).toBe(idle);
    const off = transition(idle, change('b'));
    expect(transition(off, { type: 'onDone' })).toBe(off);
  });
});
```

`client/src/ui/ambient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextGlitchDelay } from './ambient.js';

describe('nextGlitchDelay', () => {
  it('stays within 8-15 seconds', () => {
    expect(nextGlitchDelay(() => 0)).toBe(8000);
    expect(nextGlitchDelay(() => 0.999999)).toBeLessThanOrEqual(15000);
    expect(nextGlitchDelay(() => 0.5)).toBe(11500);
  });
  it('clamps a misbehaving random source', () => {
    expect(nextGlitchDelay(() => -3)).toBe(8000);
    expect(nextGlitchDelay(() => 7)).toBe(15000);
    expect(nextGlitchDelay(() => Number.NaN)).toBe(8000);
  });
});
```

`client/src/audio/uiSounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createUiThrottle } from './uiSounds.js';

describe('createUiThrottle', () => {
  it('lets clicks and power through every time', () => {
    const ok = createUiThrottle(80);
    expect(ok('click', 0)).toBe(true);
    expect(ok('click', 1)).toBe(true);
    expect(ok('power', 2)).toBe(true);
  });
  it('throttles hover ticks to one per window', () => {
    const ok = createUiThrottle(80);
    expect(ok('tick', 1000)).toBe(true);
    expect(ok('tick', 1040)).toBe(false);
    expect(ok('tick', 1079)).toBe(false);
    expect(ok('tick', 1080)).toBe(true);
  });
});
```

Append to `client/src/audio/audioEngine.test.ts`, inside the file's top level:

```ts
describe('AudioEngine.playUi', () => {
  it('is a silent no-op before any audio context exists', () => {
    const engine = new AudioEngine();
    expect(() => engine.playUi('click')).not.toThrow();
    expect(() => engine.playUi('power')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/ui src/audio"`
Expected: FAIL. The four new modules can't be resolved, and `engine.playUi is not a function`.

- [ ] **Step 3: Implement.**

`client/src/ui/typed.ts`:

```ts
/** The part of `text` visible `elapsedMs` into typing at `cps` characters/second. Slices by code point. */
export function typedSlice(text: string, elapsedMs: number, cps: number): string {
  if (!(elapsedMs > 0) || !(cps > 0)) return '';
  const chars = Array.from(text);
  const n = Math.min(chars.length, Math.floor((elapsedMs * cps) / 1000));
  return chars.slice(0, n).join('');
}
```

`client/src/ui/screenTransition.ts`:

```ts
// CRT power transition between menu screens. Pure: the component renders what this says.
export const POWER_OFF_MS = 220;
export const POWER_ON_MS = 280;
export const TRANSITION_WATCHDOG_MS = 600;

export type TransitionState =
  | { phase: 'idle'; key: string }
  | { phase: 'off'; from: string; to: string }
  | { phase: 'on'; key: string };

export type TransitionEvent =
  | { type: 'change'; key: string; reduced: boolean }
  | { type: 'offDone' }
  | { type: 'onDone' }
  | { type: 'timeout' };

export function initialTransition(key: string): TransitionState {
  return { phase: 'idle', key };
}

/** The key whose content is on screen right now. */
export function displayKey(s: TransitionState): string {
  return s.phase === 'off' ? s.from : s.key;
}

/** The key the transition is heading to. */
export function targetKey(s: TransitionState): string {
  return s.phase === 'off' ? s.to : s.key;
}

export function transition(s: TransitionState, e: TransitionEvent): TransitionState {
  switch (e.type) {
    case 'change':
      if (e.key === targetKey(s)) return s;
      if (e.reduced) return { phase: 'idle', key: e.key };
      if (s.phase === 'idle') return { phase: 'off', from: s.key, to: e.key };
      return { phase: 'on', key: e.key }; // mid-transition: jump to the latest screen
    case 'offDone':
      return s.phase === 'off' ? { phase: 'on', key: s.to } : s;
    case 'onDone':
      return s.phase === 'on' ? { phase: 'idle', key: s.key } : s;
    case 'timeout':
      if (s.phase === 'off') return { phase: 'on', key: s.to };
      if (s.phase === 'on') return { phase: 'idle', key: s.key };
      return s;
  }
}
```

`client/src/ui/ambient.ts`:

```ts
export const GLITCH_MS = 400;
const GLITCH_MIN = 8000;
const GLITCH_MAX = 15000;

/** Delay before a console's next glitch line: 8-15s. */
export function nextGlitchDelay(rand: () => number = Math.random): number {
  const r = rand();
  const t = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  return Math.round(GLITCH_MIN + t * (GLITCH_MAX - GLITCH_MIN));
}
```

`client/src/audio/uiSounds.ts`:

```ts
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
```

In `client/src/audio/audioEngine.ts`:
- Add at the top: `import { createUiThrottle, synthUiSound, type UiSound } from './uiSounds.js';`
- Inside the class, after the `unlock` method, add:

```ts
  private uiThrottle = createUiThrottle(80);

  /** Short synthesised UI sound through the master bus. Silent until audio is running; never throws. */
  playUi(sound: UiSound): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      if (!this.uiThrottle(sound, performance.now())) return;
      synthUiSound(ctx, this.master, sound);
    } catch {
      /* UI sounds are best-effort */
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
Expected: all pass (the previous 73 plus the new ones) and `tsc` clean.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/ui/typed.ts client/src/ui/typed.test.ts client/src/ui/screenTransition.ts client/src/ui/screenTransition.test.ts client/src/ui/ambient.ts client/src/ui/ambient.test.ts client/src/audio/uiSounds.ts client/src/audio/uiSounds.test.ts client/src/audio/audioEngine.ts client/src/audio/audioEngine.test.ts
git.exe commit -m "Add menu motion logic: typed text, power transition reducer, glitch timer, UI sounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Menu components and styles

**Files:**
- Create: `client/src/ui/motion.ts`
- Create: `client/src/components/menu/TypedText.tsx`
- Create: `client/src/components/menu/ScreenTransition.tsx`
- Create: `client/src/components/menu/MenuShell.tsx`
- Create: `client/src/components/menu/MenuConsole.tsx`
- Create: `client/src/components/menu/index.ts`
- Create: `client/src/styles/menu.css`
- Modify: `client/src/main.tsx` (import `menu.css` after `relic.css`)
- Modify: `client/src/components/relic/RelicButton.tsx` (click sound)
- Modify: `client/src/styles/relic.css` (press flash)

**Interfaces:**
- Consumes (Task 2): `typedSlice`, `transition`, `initialTransition`, `displayKey`, `targetKey`, `TRANSITION_WATCHDOG_MS`, `nextGlitchDelay`, `GLITCH_MS`, `audioEngine.playUi`. Also `RelicPanel`, `RelicButton` from `../relic/index.js` and `CaveBackground` from `../CaveBackground.js`.
- Produces:
  - `prefersReducedMotion(): boolean`
  - `<TypedText text cps? cursor? className? />`
  - `<ScreenTransition screenKey className? onBackdropClick? >{node}</ScreenTransition>`
  - `<MenuShell backdrop>{children}</MenuShell>`
  - `<MenuConsole title? footer? ambient? className? width?>{children}</MenuConsole>`

These are presentational components. The client has no DOM test environment, so their gate is `tsc` plus the visual checks in Tasks 4–8; their logic lives in Task 2's tested modules.

- [ ] **Step 1: `client/src/ui/motion.ts`**

```ts
/** True when the OS asks for reduced motion. Safe outside browsers. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: `client/src/components/menu/TypedText.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { typedSlice } from '../../ui/typed.js';
import { prefersReducedMotion } from '../../ui/motion.js';

interface Props {
  text: string;
  cps?: number;
  /** Keep a blinking block cursor after the text (status consoles). */
  cursor?: boolean;
  className?: string;
}

function Typing({ text, cps, cursor, className }: Required<Omit<Props, 'className'>> & { className?: string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text : ''));
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(text); return; }
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const s = typedSlice(text, performance.now() - start, cps);
      setShown(s);
      if (s.length < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  const done = shown.length === text.length;
  return (
    <span className={`typed-text ${className ?? ''}`} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
      {(cursor || !done) && <span className="typed-text__cursor" aria-hidden="true">█</span>}
    </span>
  );
}

/** Text that types in at `cps`; a new `text` restarts it (keyed remount). */
export function TypedText({ text, cps = 40, cursor = false, className }: Props) {
  return <Typing key={text} text={text} cps={cps} cursor={cursor} className={className} />;
}
```

- [ ] **Step 3: `client/src/components/menu/ScreenTransition.tsx`**

```tsx
import { useEffect, useLayoutEffect, useReducer, useRef, type AnimationEvent, type MouseEvent, type ReactNode } from 'react';
import { transition, initialTransition, displayKey, targetKey, TRANSITION_WATCHDOG_MS } from '../../ui/screenTransition.js';
import { prefersReducedMotion } from '../../ui/motion.js';
import { audioEngine } from '../../audio/audioEngine.js';

interface Props {
  screenKey: string;
  children: ReactNode;
  className?: string;
  /** Called when the wrapper itself (not the console) is clicked, e.g. to close a panel. */
  onBackdropClick?: () => void;
}

/**
 * Powers the outgoing console off and the incoming one on when `screenKey` changes.
 * The outgoing content is the last committed render for its key (a ref written only in a layout
 * effect and read during the off phase), because its source state is usually gone by then.
 */
export function ScreenTransition({ screenKey, children, className = '', onBackdropClick }: Props) {
  const [state, dispatch] = useReducer(transition, screenKey, initialTransition);
  const committed = useRef<{ key: string; node: ReactNode }>({ key: screenKey, node: children });

  useLayoutEffect(() => {
    if (screenKey === targetKey(state)) return;
    const reduced = prefersReducedMotion();
    if (!reduced) audioEngine.playUi('power');
    dispatch({ type: 'change', key: screenKey, reduced });
  }, [screenKey, state]);

  useLayoutEffect(() => {
    if (displayKey(state) === screenKey) committed.current = { key: screenKey, node: children };
  });

  useEffect(() => {
    if (state.phase === 'idle') return;
    const t = window.setTimeout(() => dispatch({ type: 'timeout' }), TRANSITION_WATCHDOG_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore glitch/lamp/cursor animations bubbling up
    dispatch({ type: state.phase === 'off' ? 'offDone' : 'onDone' });
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (onBackdropClick && e.target === e.currentTarget) onBackdropClick();
  };

  const showing = displayKey(state) === screenKey ? children : committed.current.node;
  const empty = showing == null || showing === false;
  return (
    <div className={`screen-transition ${className}`} data-empty={empty} onClick={onClick}>
      {!empty && (
        <div className={`screen-transition__body screen-transition__body--${state.phase}`} onAnimationEnd={onAnimationEnd}>
          {showing}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `client/src/components/menu/MenuConsole.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { RelicPanel } from '../relic/index.js';
import { nextGlitchDelay, GLITCH_MS } from '../../ui/ambient.js';
import { prefersReducedMotion } from '../../ui/motion.js';

interface Props {
  title?: string;
  footer?: ReactNode;
  ambient?: boolean;
  className?: string;
  /** CSS width of the console, e.g. '640px'. Defaults to content width. */
  width?: string;
  children: ReactNode;
}

function useGlitch(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    let t = 0;
    const schedule = () => {
      t = window.setTimeout(() => {
        setOn(true);
        t = window.setTimeout(() => { setOn(false); schedule(); }, GLITCH_MS);
      }, nextGlitchDelay());
    };
    schedule();
    return () => window.clearTimeout(t);
  }, [enabled]);
  return on;
}

export function MenuConsole({ title, footer, ambient = true, className = '', width, children }: Props) {
  const glitch = useGlitch(ambient);
  return (
    <div className={`menu-console${ambient ? ' menu-console--ambient' : ''} ${className}`} style={width ? { width } : undefined}>
      <RelicPanel title={title}>
        <div className="menu-console__body">{children}</div>
        {footer && <div className="menu-console__footer">{footer}</div>}
        {ambient && (
          <>
            <span className="menu-console__lamp menu-console__lamp--l" aria-hidden="true" />
            <span className="menu-console__lamp menu-console__lamp--r" aria-hidden="true" />
            <span className="menu-console__scanroll" aria-hidden="true" />
            {glitch && <span className="menu-console__glitch" aria-hidden="true" />}
          </>
        )}
      </RelicPanel>
    </div>
  );
}
```

- [ ] **Step 5: `client/src/components/menu/MenuShell.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { CaveBackground } from '../CaveBackground.js';

const TOWN_BG = '/backgrounds/townbg.png';

function useImageOk(src: string, enabled: boolean): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setOk(true); };
    img.onerror = () => { if (live) setOk(false); };
    img.src = src;
    return () => { live = false; };
  }, [src, enabled]);
  return ok;
}

interface Props {
  backdrop: 'cave' | 'town';
  children: ReactNode;
}

/** Persistent full-bleed backdrop for every pre-dungeon screen. Keeps the intro handoff markup (.lobby-logo, cave glyphs). */
export function MenuShell({ backdrop, children }: Props) {
  const townOk = useImageOk(TOWN_BG, backdrop === 'town');
  const effective = backdrop === 'town' && townOk ? 'town' : 'cave';
  return (
    <div className={`lobby menu-shell menu-shell--${effective}`}>
      {effective === 'cave' ? <CaveBackground /> : <div className="menu-shell__town" aria-hidden="true" />}
      {effective === 'cave' && <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />}
      <div className="menu-shell__content">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: `client/src/components/menu/index.ts`**

```ts
export { TypedText } from './TypedText.js';
export { ScreenTransition } from './ScreenTransition.js';
export { MenuShell } from './MenuShell.js';
export { MenuConsole } from './MenuConsole.js';
```

- [ ] **Step 7: Click sound and press flash on `RelicButton`.** In `client/src/components/relic/RelicButton.tsx`:
- add `import { audioEngine } from '../../audio/audioEngine.js';`;
- in the destructured props add `onPointerDown`;
- on the `<button>` add `onPointerDown={(e) => { audioEngine.playUi('click'); onPointerDown?.(e); }}`.

In `client/src/styles/relic.css`, after the `.relic-btn:active:not(:disabled)` rule, add:

```css
.relic-btn:active:not(:disabled) { filter: brightness(1.35); transition: filter 60ms; }
```

- [ ] **Step 8: `client/src/styles/menu.css`**, then add `import './styles/menu.css';` after the `relic.css` import in `client/src/main.tsx`:

```css
/* === Menu screens (main menu polish): shell, consoles, CRT power transitions, ambient life === */
.menu-shell { position: relative; }
.menu-shell--town { background: #0a0806; }
.menu-shell__town { position: absolute; inset: 0; background: url('/backgrounds/townbg.png') center/cover no-repeat; image-rendering: pixelated; z-index: 0; }
.menu-shell__content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; width: 100%; }
.menu-shell--town .menu-shell__content { position: absolute; inset: 0; display: block; }

/* Consoles: centred, content-sized, scroll inside when too tall */
.menu-console { position: relative; max-width: 92vw; }
.menu-console .relic-panel { max-height: calc(100vh - 220px); }
.menu-shell--town .menu-console .relic-panel { max-height: calc(100vh - 48px); }
.menu-console__body { padding: 12px 16px; overflow-y: auto; min-height: 0; }
.menu-console__footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 16px 10px; border-top: 1px dashed var(--relic-divider); }

/* Screen transition: animate the body, never the wrapper (fixed layers stay fixed) */
.screen-transition__body { transform-origin: center; }
.screen-transition__body--off { animation: crt-power-off 220ms ease-in forwards; }
.screen-transition__body--on { animation: crt-power-on 280ms ease-out; }
@keyframes crt-power-off {
  0% { transform: scale(1, 1); filter: brightness(1); opacity: 1; }
  60% { transform: scale(1, 0.02); filter: brightness(3); opacity: 1; }
  100% { transform: scale(0, 0.02); filter: brightness(3); opacity: 0; }
}
@keyframes crt-power-on {
  0% { transform: scale(0, 0.02); filter: brightness(3); opacity: 0; }
  35% { transform: scale(1, 0.02); filter: brightness(3); opacity: 1; }
  80% { transform: scale(1, 1.02); filter: brightness(1.4); }
  100% { transform: scale(1, 1); filter: brightness(1); }
}

/* Modal layer for town panels */
.modal-layer { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.modal-layer[data-empty="false"] { background: rgba(0, 0, 0, 0.6); pointer-events: auto; }

/* Typed text */
.typed-text__cursor { animation: typed-blink 1s steps(1) infinite; margin-left: 1px; }
@keyframes typed-blink { 50% { opacity: 0; } }

/* Ambient life */
.menu-console__lamp { position: absolute; top: -11px; width: 4px; height: 4px; background: #ffb347; box-shadow: 0 0 6px 2px rgba(255, 170, 60, 0.6); z-index: 4; pointer-events: none; animation: lamp-blink 3.7s ease-in-out infinite; }
.menu-console__lamp--l { left: 28px; }
.menu-console__lamp--r { right: 28px; animation-duration: 5.3s; animation-delay: -1.9s; }
@keyframes lamp-blink { 0%, 100% { opacity: 1; } 45% { opacity: 0.25; } 50% { opacity: 0.9; } }
.menu-console__scanroll { position: absolute; left: 0; right: 0; top: 0; height: 60px; pointer-events: none; z-index: 3;
  background: linear-gradient(transparent, rgba(120, 220, 150, 0.035), transparent); animation: scan-roll 7s linear infinite; }
@keyframes scan-roll { from { transform: translateY(-60px); } to { transform: translateY(900px); } }
.menu-console .relic-panel { overflow: hidden; }
.menu-console__glitch { position: absolute; left: 0; right: 0; height: 2px; top: 30%; pointer-events: none; z-index: 3;
  background: rgba(200, 255, 220, 0.25); box-shadow: 0 0 6px rgba(160, 255, 200, 0.4); animation: glitch-sweep 400ms linear forwards; }
@keyframes glitch-sweep { from { top: 10%; opacity: 0.9; } to { top: 85%; opacity: 0; } }

/* Hover rims on interactive rows/cards */
.menu-hoverable { transition: box-shadow 80ms; }
.menu-hoverable:hover { box-shadow: 0 0 0 1px var(--relic-amber-rim), 0 0 8px rgba(240, 170, 60, 0.25); }

@media (prefers-reduced-motion: reduce) {
  .screen-transition__body--off, .screen-transition__body--on { animation: none; }
  .menu-console__lamp, .menu-console__scanroll, .menu-console__glitch, .typed-text__cursor { animation: none; }
  .menu-console__scanroll, .menu-console__glitch { display: none; }
}
```

- [ ] **Step 9: Typecheck and run the tests.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"`
Expected: exit 0. Nothing renders these components yet; Task 4 is their first visual check.

- [ ] **Step 10: Commit.**

```bash
git.exe add client/src/ui/motion.ts client/src/components/menu client/src/styles/menu.css client/src/main.tsx client/src/components/relic/RelicButton.tsx client/src/styles/relic.css
git.exe commit -m "Add menu shell, console, typed text and CRT screen transition components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shell wiring, login, status and game-over consoles

**Files:**
- Modify: `client/src/App.tsx` (the `content` switch for all non-dungeon views)
- Modify: `client/src/components/LoginScreen.tsx`
- Modify: `client/src/styles/menu.css` (login and status styles)

**Interfaces:**
- Consumes (Task 3): `MenuShell`, `ScreenTransition`, `MenuConsole`, `TypedText`. Also `RelicButton` from `./components/relic/index.js`.
- Produces: `App` renders `<MenuShell backdrop={currentView === 'in_world' ? 'town' : 'cave'}><ScreenTransition screenKey={currentView}>{screen}</ScreenTransition></MenuShell>` for every view except `in_dungeon`. `LoginScreen` renders only its console, with no backdrop or logo.

- [ ] **Step 1: Repair the handoff check, then record its baseline before changing anything.** `domShot` in `scripts/intro-render.mjs` sets `caverns_intro_seen`, which nothing reads since `0365b7d`, so its "plain login" shot now catches the intro instead.

Replace these two lines:

```js
    await page.addInitScript(() => localStorage.setItem('caverns_intro_seen', '1'));
    await page.goto(`${base}/`);
    await page.waitForSelector('.lobby-logo');
```

with:

```js
    await page.goto(`${base}/`);
    await page.waitForSelector('.lobby-logo');
    // The intro plays on every load: Escape at its gate finishes it outright.
    for (let i = 0; i < 40 && (await page.locator('.intro-root').count()) > 0; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
```

Run: `cmd.exe /c "node scripts/intro-render.mjs handoff --base http://localhost:5175 --out .intro/handoff-before" > .intro-handoff-before.txt 2>&1`, then view the file.
Save the printed diff numbers into the ledger as the baseline, then commit the script fix on its own:

```bash
git.exe add scripts/intro-render.mjs
git.exe commit -m "Dismiss the intro in the handoff check now that it plays every load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Rewrite `LoginScreen`'s render.** Keep all of its hooks, `submit` and the keydown effect unchanged. Delete the `CaveBackground` import. Add:

```tsx
import { MenuConsole, TypedText } from './menu/index.js';
import { RelicButton } from './relic/index.js';
```

Replace the returned JSX with:

```tsx
  return (
    <>
      <MenuConsole className="login-console" width="420px">
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label"><TypedText text="> ENTER YOUR USERNAME TO LOG IN_" /></p>
        <div className="dos-input">
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="login-actions">
          <RelicButton className="lobby-start" hot onClick={submit} disabled={!name.trim()}>
            Continue
          </RelicButton>
        </div>
      </MenuConsole>
      <button
        className="intro-replay"
        onClick={(e) => { e.currentTarget.blur(); replayIntro(); }}
        title="Replay intro"
      >
        ↺ intro
      </button>
    </>
  );
```

- [ ] **Step 3: Wire `App.tsx`.**
- Add imports: `import { MenuShell, ScreenTransition, MenuConsole, TypedText } from './components/menu/index.js';` and `import { RelicButton } from './components/relic/index.js';`.
- Change the `connecting` case to:

```tsx
    case 'connecting':
      // During the intro the cavern must already exist underneath for the handoff.
      content = introActive ? (
        <LoginScreen onLogin={actions.login} />
      ) : (
        <MenuConsole className="status-console" width="380px">
          <TypedText text="Connecting to server..." cursor />
        </MenuConsole>
      );
      break;
```

- Change the `generating` case to:

```tsx
    case 'generating':
      content = (
        <MenuConsole className="status-console" width="420px">
          <TypedText text="The caverns shift and groan..." cursor />
        </MenuConsole>
      );
      break;
```

- Change the `game_over` case to:

```tsx
    case 'game_over':
      content = (
        <MenuConsole
          className="status-console game-over-console"
          width="440px"
          footer={
            <RelicButton className="lobby-return-btn" hot onClick={() => useGameStore.setState({ gameOver: null })}>
              Return to Overworld
            </RelicButton>
          }
        >
          <h2 className="game-over-title"><TypedText text={gameOver?.result === 'victory' ? 'Victory!' : 'Wiped...'} /></h2>
          <p>
            {gameOver?.result === 'victory'
              ? 'The dungeon has been conquered!'
              : 'Your party has fallen in the darkness...'}
          </p>
        </MenuConsole>
      );
      break;
```

- Leave the `login`, `character_select`, `in_world` and `in_dungeon` cases' `content =` assignments as they are.
- Directly after the `switch` closes and before `return (`, add:

```tsx
  if (currentView !== 'in_dungeon') {
    content = (
      <MenuShell backdrop={currentView === 'in_world' ? 'town' : 'cave'}>
        <ScreenTransition screenKey={currentView}>{content}</ScreenTransition>
      </MenuShell>
    );
  }
```

- [ ] **Step 4: Append the login and status styles to `menu.css`:**

```css
/* Login + status consoles */
.menu-shell--cave .lobby-logo { margin-bottom: 14px; }
.login-console .menu-console__body { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.login-actions { margin-top: 6px; }
.status-console .menu-console__body { text-align: center; padding: 18px 16px; color: var(--relic-amber); }
.game-over-title { color: var(--relic-amber); font-weight: normal; margin-bottom: 6px; }
.game-over-console .menu-console__footer { justify-content: center; }
```

- [ ] **Step 5: Typecheck, then run the visual and handoff checks.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."` → Expected: exit 0.

Screenshot the login screen: run `cmd.exe /c "node .sandbox/explore-shot.mjs http://localhost:5175"`, which dismisses the intro with Escape, and view `.sandbox/ui-revamp/explore-step-1.png`. You should see the logo above one bezel console holding the typed prompt, name and Continue, over the full-bleed cave.

Run: `cmd.exe /c "node scripts/intro-render.mjs handoff --base http://localhost:5175 --out .intro/handoff-after"`. Expected: the glyph and logo region diffs are within ±10% of the Step 1 baseline. If the logo region regresses, the logo moved: adjust `.menu-shell--cave .lobby-logo` margins until the numbers match. The intro reads the logo's live position, so small offsets are expected to pass.

- [ ] **Step 6: Commit.**

```bash
git.exe add client/src/App.tsx client/src/components/LoginScreen.tsx client/src/styles/menu.css
git.exe commit -m "Put pre-dungeon views in the menu shell; login and status consoles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Character select and character creation

**Files:**
- Modify: `client/src/components/CharacterSelect.tsx`
- Modify: `client/src/components/CharacterSlotCard.tsx`
- Modify: `client/src/components/CharacterCreateModal.tsx`
- Modify: `client/src/styles/menu.css`
- Modify: `.sandbox/explore-shot.mjs` (git-ignored; update the Create selector)

**Interfaces:**
- Consumes: `MenuConsole`, `TypedText`, `ScreenTransition` (Task 3); `RelicButton`, `IconSocket`, `ItemIcon` from `./relic/index.js`; `getClassPortrait` from `../classPortraits.js`.
- Produces: character select and creation as consoles. A nested `ScreenTransition` keyed `'select' | 'create'` powers between them.

- [ ] **Step 1: `CharacterSlotCard`: keep `relative()` and the props, and replace the component body:**

```tsx
import type { CharacterSummary } from '@caverns/shared';
import { RelicButton, IconSocket } from './relic/index.js';
import { getClassPortrait } from '../classPortraits.js';
import { audioEngine } from '../audio/audioEngine.js';
```

```tsx
export function CharacterSlotCard({ slotIndex, character, onCreate, onResume, onDelete }: Props) {
  const tick = () => audioEngine.playUi('tick');
  if (!character) {
    return (
      <div className="char-slot char-slot-empty menu-hoverable" onClick={onCreate} onMouseEnter={tick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCreate(); }}>
        <IconSocket size={32}><span className="relic-socket__glyph">+</span></IconSocket>
        <div className="char-slot-number">Slot {slotIndex + 1} · empty</div>
        <RelicButton size="sm" onClick={(e) => { e.stopPropagation(); onCreate(); }}>Create</RelicButton>
      </div>
    );
  }
  const portrait = getClassPortrait(character.className);
  return (
    <div className="char-slot char-slot-filled menu-hoverable" onMouseEnter={tick}>
      <div className="char-slot-portrait">
        {portrait ? <img src={portrait} alt="" /> : <span className="relic-socket__glyph">☉</span>}
      </div>
      <div className="char-slot-name">{character.name}</div>
      <div className="char-slot-meta">Lv {character.level} · {character.className}</div>
      <div className="char-slot-meta">{character.gold}g · last {relative(character.lastPlayedAt)}</div>
      <div className="char-slot-actions">
        <RelicButton hot={!character.inUse} onClick={() => onResume(character.id)} disabled={character.inUse}>
          {character.inUse ? 'In use' : 'Resume'}
        </RelicButton>
        <RelicButton
          size="sm"
          tone="danger"
          className="char-slot-delete"
          onClick={() => { if (confirm(`Delete ${character.name}?`)) onDelete(character.id); }}
        >
          Delete
        </RelicButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `CharacterSelect`**
- Keep all of its hooks, `copyCode`, `submitJoin` and `SLOT_CAP`.
- Delete the `CaveBackground` import. Add `import { MenuConsole, TypedText, ScreenTransition } from './menu/index.js';` and `import { RelicButton } from './relic/index.js';`.
- Replace everything from `if (creatingSlot !== null) {` to the end of the component with:

```tsx
  const create = (
    <CharacterCreateModal
      onCreate={(name, cls, pts) => {
        onCreate(name, cls, pts);
        setCreatingSlot(null);
      }}
      onCancel={() => setCreatingSlot(null)}
    />
  );

  const select = (
    <MenuConsole
      title="Characters"
      width="640px"
      footer={
        <div className="world-code-bar">
          {inviteCode && (
            <div className="world-code-block">
              <span className="world-code-label">World</span>
              <code className="world-code-value">{inviteCode}</code>
              <RelicButton size="sm" className="world-code-copy" onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</RelicButton>
            </div>
          )}
          <div className="world-code-join">
            <input
              className="world-code-input"
              placeholder="Join code"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') submitJoin(); }}
            />
            <RelicButton size="sm" className="world-code-join-btn" onClick={submitJoin} disabled={joinCode.trim().length === 0}>
              Join
            </RelicButton>
          </div>
          <RelicButton size="sm" className="char-select-logout" onClick={onLogout}>Logout</RelicButton>
          {worldError && <div className="world-code-error">{worldError}</div>}
        </div>
      }
    >
      {account && <p className="char-select-greeting"><TypedText text={`Welcome, ${account.displayName}`} /></p>}
      <div className="char-slot-grid">
        {Array.from({ length: SLOT_CAP }).map((_, i) => (
          <CharacterSlotCard
            key={i}
            slotIndex={i}
            character={characters[i]}
            onCreate={() => setCreatingSlot(i)}
            onResume={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
    </MenuConsole>
  );

  return (
    <ScreenTransition screenKey={creatingSlot !== null ? 'create' : 'select'}>
      {creatingSlot !== null ? create : select}
    </ScreenTransition>
  );
}
```

- [ ] **Step 3: `CharacterCreateModal`: keep all of its state, memos, `adjust` and `canCreate`.** Delete the `CaveBackground` import. Add:

```tsx
import { MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';
```

Replace the returned JSX with:

```tsx
  return (
    <MenuConsole
      title="New Character"
      width="760px"
      footer={
        <div className="char-create-footer">
          <RelicButton className="char-create-submit" hot onClick={() => onCreate(name.trim(), className, points)} disabled={!canCreate}>
            Create
          </RelicButton>
          <RelicButton onClick={onCancel}>Cancel</RelicButton>
        </div>
      }
    >
      <div className="char-create-modal">
        <aside className="char-create-portrait-col">
          <div className="char-create-portrait">
            {(() => {
              const src = getClassPortrait(className);
              return src ? <img src={src} alt={classDef?.displayName ?? className} /> : <span className="relic-socket__glyph">☉</span>;
            })()}
          </div>
          <input autoFocus className="char-create-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={20} />
        </aside>

        <section className="char-create-class-col">
          <div className="char-create-class-tabs">
            {CLASS_DEFINITIONS.map((c) => (
              <RelicButton key={c.id} size="sm" hot={className === c.id} className="char-create-class-tab" onClick={() => setClassName(c.id)}>
                {c.displayName}
              </RelicButton>
            ))}
          </div>
          {classDef && (
            <>
              <p className="char-create-class-desc">{classDef.description}</p>
              <div className="char-create-loadout">
                <h4>Starting Gear</h4>
                {starterItems ? (
                  <div className="char-create-gear">
                    <div className="char-create-gear-row"><ItemIcon item={starterItems.weapon} /><span>{starterItems.weapon.name}</span></div>
                    <div className="char-create-gear-row"><ItemIcon item={starterItems.offhand} /><span>{starterItems.offhand.name}</span></div>
                  </div>
                ) : (
                  <p>—</p>
                )}
              </div>
              <div className="char-create-abilities">
                <h4>Abilities</h4>
                <ul>
                  {classDef.abilities.map((a) => (
                    <li key={a.id}><strong>{a.name}</strong> — {a.description}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        <aside className="char-create-stats-col">
          <div className="char-create-points-header">Points: {remaining} / {CHARACTER_CREATION_CONFIG.pointBudget}</div>
          <div className="char-create-stats">
            {statDefs.map((def) => (
              <div key={def.id} className="char-create-stat-row">
                <span className="char-create-stat-name">{def.displayName}</span>
                <RelicButton size="sm" onClick={() => adjust(def.id, -1)}>−</RelicButton>
                <span className="char-create-stat-value">{points[def.id] ?? 0}</span>
                <RelicButton size="sm" onClick={() => adjust(def.id, +1)}>+</RelicButton>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </MenuConsole>
  );
```

- [ ] **Step 4: Append the select and create styles to `menu.css`:**

```css
/* Character select */
.char-select-greeting { text-align: center; color: var(--relic-dim); margin-bottom: 10px; }
.menu-console .char-slot-grid { display: flex; gap: 14px; justify-content: center; }
.menu-console .char-slot { width: 170px; min-height: 190px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: rgba(11, 9, 7, 0.85); cursor: default; }
.menu-console .char-slot-empty { border: 1px dashed var(--relic-divider); cursor: pointer; }
.menu-console .char-slot-filled { border: 1px solid #6d5230; }
.char-slot-portrait { width: 56px; height: 84px; border: 2px solid #000; box-shadow: 0 0 0 1px var(--relic-bronze); background: #050403; display: flex; align-items: center; justify-content: center; }
.char-slot-portrait img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
.menu-console .char-slot-name { color: var(--relic-amber); }
.menu-console .char-slot-meta, .menu-console .char-slot-number { color: var(--relic-dim); font-size: 0.7rem; letter-spacing: 0.06em; }
.menu-console .char-slot-actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.menu-console .world-code-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; width: 100%; justify-content: space-between; }
.menu-console .world-code-block, .menu-console .world-code-join { display: flex; align-items: center; gap: 8px; }
.menu-console .world-code-value { color: #5fe0d0; letter-spacing: 0.2em; border: 1px dashed var(--relic-divider); padding: 1px 6px; }
.menu-console .world-code-input { width: 90px; background: #0f0b08; color: var(--relic-text); border: 1px dashed var(--relic-divider); padding: 2px 6px; font-family: inherit; letter-spacing: 0.15em; }
.menu-console .world-code-error { width: 100%; color: #e06a5a; font-size: 0.75rem; }

/* Character creation */
.menu-console .char-create-modal { display: flex; gap: 16px; border: none; background: transparent; padding: 0; }
.char-create-portrait { width: 112px; height: 168px; border: 2px solid #000; box-shadow: 0 0 0 1px var(--relic-bronze); background: #050403; margin-bottom: 8px; }
.char-create-portrait img { width: 100%; height: 100%; image-rendering: pixelated; }
.menu-console .char-create-name { width: 112px; background: #0f0b08; color: var(--relic-amber); border: 1px dashed var(--relic-divider); padding: 3px 6px; font-family: inherit; }
.menu-console .char-create-class-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.char-create-gear { display: flex; flex-direction: column; gap: 6px; }
.char-create-gear-row { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
.menu-console .char-create-stat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.menu-console .char-create-stat-name { width: 80px; }
.char-create-footer { display: flex; gap: 10px; justify-content: center; width: 100%; }
```

- [ ] **Step 5: Update the explore script.** In `.sandbox/explore-shot.mjs`, replace:

```js
  await page.locator('.lobby-choose .lobby-start', { hasText: 'Create' }).click();
```

with:

```js
  await page.locator('.char-create-submit').click();
```

- [ ] **Step 6: Typecheck, then run the visual check.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."` → Expected: exit 0.
Run: `cmd.exe /c "node .sandbox/explore-shot.mjs http://localhost:5175"` → Expected: reaches the dungeon.
View `explore-step-2.png` (select), `-3` (create) and `-4` (created). Each should show one bezel console with the logo above, and create should be a separate screen from select.

- [ ] **Step 7: Commit.**

```bash
git.exe add client/src/components/CharacterSelect.tsx client/src/components/CharacterSlotCard.tsx client/src/components/CharacterCreateModal.tsx client/src/styles/menu.css
git.exe commit -m "Character select and creation as relic consoles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Town hub (T2)

**Files:**
- Modify: `client/src/components/WorldView.tsx` (layout; the Party console)
- Modify: `client/src/components/TownView.tsx` (the Services and Portal consoles)
- Modify: `client/src/styles/menu.css`

**Interfaces:**
- Consumes: `MenuConsole`, `TypedText` (Task 3); `RelicButton`, `IconSocket` from `./relic/index.js`; `getParticipantGlyph` from `../glyphs.js`.
- Produces: a `.town-hub` layout with `.town-services`, `.town-party` and `.town-panel-portal` consoles. The explore script's selectors (`.town-panel-portal .town-btn`, `.town-btn-enter`) keep working.

- [ ] **Step 1: `WorldView`: keep the props and destructuring.** Add:

```tsx
import { MenuConsole, TypedText } from './menu/index.js';
import { RelicButton, IconSocket } from './relic/index.js';
import { getParticipantGlyph } from '../glyphs.js';
```

Delete the `getClassPortrait` import. Replace the returned JSX with:

```tsx
  return (
    <div className="town-hub">
      <h2 className="town-hub__title"><TypedText text={currentWorld.name} /></h2>
      <TownView
        onPortalReady={onPortalReady}
        onPortalUnready={onPortalUnready}
        onPortalEnter={onPortalEnter}
        onInteract={onInteract}
        onOpenCharacterPanel={onOpenCharacterPanel}
      />
      <MenuConsole
        className="town-party"
        title="Party"
        width="220px"
        footer={<RelicButton size="sm" className="world-leave-btn" onClick={onLeaveWorld}>Leave World</RelicButton>}
      >
        <ul className="world-member-list">
          {members.map((m) => {
            const glyph = getParticipantGlyph({ type: 'player', className: m.className });
            return (
              <li key={m.connectionId} className="world-member">
                <IconSocket size={24} title={m.className}>
                  {glyph ? <img className="relic-socket__img" src={glyph} alt="" /> : <span className="relic-socket__glyph">{m.characterName.charAt(0)}</span>}
                </IconSocket>
                <div className="world-member-info">
                  <span className={`world-member-name class-${m.className}`}>{m.characterName}</span>
                  <span className="world-member-meta">Lv {m.level} · {m.className}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </MenuConsole>
      <StashModal onDeposit={onStashDeposit} onWithdraw={onStashWithdraw} onClose={onStashClose} />
      <ShopModal onBuy={onShopBuy} onSell={onShopSell} onReroll={onShopReroll} onClose={onShopClose} />
      <CharacterModal onEquipItem={onCharacterEquip} onDropItem={onCharacterDrop} onAllocateStat={onCharacterAllocateStat} onClose={onCharacterClose} />
    </div>
  );
```

- [ ] **Step 2: `TownView`: keep the hooks and derived values** (`shop`, `stash`, `portal`, `mine`, `isReady`, `readyCount`). Add:

```tsx
import { MenuConsole } from './menu/index.js';
import { RelicButton, IconSocket } from './relic/index.js';
import { audioEngine } from '../audio/audioEngine.js';
```

Replace the returned JSX with:

```tsx
  const open = (fn: () => void) => () => { new Audio('/audio/open_audio.mp3').play(); fn(); };
  const tick = () => audioEngine.playUi('tick');
  const portrait = mine ? getClassPortrait(mine.className) : null;
  return (
    <>
      <MenuConsole className="town-services" title="Services" width="280px">
        {stash && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(() => onInteract(stash.id))}>
            <IconSocket size={32}><span className="relic-socket__glyph">▣</span></IconSocket>
            <span className="town-service__text"><span className="town-service__name">Adventurer's Stash</span><span className="town-service__desc">Deposit and withdraw gear</span></span>
          </button>
        )}
        {shop && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(() => onInteract(shop.id))}>
            <IconSocket size={32}><img className="relic-socket__img town-service__portrait" src="/portraits/shopkeep.png" alt="" /></IconSocket>
            <span className="town-service__text"><span className="town-service__name">General Store</span><span className="town-service__desc">Buy and sell wares</span></span>
          </button>
        )}
        {mine && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(onOpenCharacterPanel)}>
            <IconSocket size={32}>
              {portrait ? <img className="relic-socket__img town-service__portrait" src={portrait} alt="" /> : <span className="relic-socket__glyph">?</span>}
            </IconSocket>
            <span className="town-service__text"><span className="town-service__name">{mine.characterName}</span><span className="town-service__desc">Manage equipment and stats</span></span>
          </button>
        )}
        <div className="town-service town-service--disabled" aria-disabled="true">
          <IconSocket size={32}><span className="relic-socket__glyph">¶</span></IconSocket>
          <span className="town-service__text"><span className="town-service__name">Bulletin Board</span><span className="town-service__desc">No notices posted</span></span>
        </div>
      </MenuConsole>

      {portal && (
        <MenuConsole className="town-panel-portal" title="Portal" width="360px">
          <div className="town-portal__name">⌘ {portal.label ?? 'Portal'}</div>
          <div className="town-muster-count">
            {readyCount} / {members.length} ready
            {readyCount > 0
              ? ` · ${muster?.readyMembers.map((r) => r.characterName).join(', ')}`
              : ' · Nobody ready'}
          </div>
          <div className="town-muster-actions">
            {!isReady ? (
              <RelicButton className="town-btn" hot onClick={onPortalReady}>Ready</RelicButton>
            ) : (
              <RelicButton className="town-btn" onClick={onPortalUnready}>Unready</RelicButton>
            )}
            <RelicButton className="town-btn town-btn-enter" hot={isReady} onClick={onPortalEnter} disabled={!isReady}>
              Enter Dungeon
            </RelicButton>
          </div>
        </MenuConsole>
      )}
    </>
  );
```

- [ ] **Step 3: Append the town styles to `menu.css`:**

```css
/* Town hub (T2): content-sized consoles on the bazaar */
.town-hub { position: absolute; inset: 0; }
.town-hub__title { position: absolute; top: 14px; left: 0; right: 0; text-align: center; font-weight: normal; font-size: 1rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--relic-amber); text-shadow: 0 0 4px #000, 0 0 8px #000; z-index: 2; }
.town-services { position: absolute; left: 16px; top: 52px; }
.town-party { position: absolute; right: 16px; top: 52px; }
.town-panel-portal { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); }
.town-service { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 4px; background: none; border: none; border-bottom: 1px dashed var(--relic-divider); color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
.town-service--disabled { opacity: 0.5; cursor: default; }
.town-service__text { display: flex; flex-direction: column; }
.town-service__name { color: var(--relic-amber); }
.town-service__desc { color: var(--relic-dim); font-size: 0.7rem; }
.town-service__portrait { object-fit: cover; object-position: top; }
.town-portal__name { color: #7fe08a; }
.town-panel-portal .town-muster-count { color: var(--relic-dim); font-size: 0.75rem; margin: 4px 0 10px; }
.town-panel-portal .town-muster-actions { display: flex; gap: 10px; }
.town-party .world-member-list { list-style: none; }
.town-party .world-member { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.town-party .world-member-info { display: flex; flex-direction: column; }
.town-party .world-member-meta { color: var(--relic-dim); font-size: 0.7rem; }
```

- [ ] **Step 4: Typecheck, then run the visual check.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."` → Expected: exit 0.
Run: `cmd.exe /c "node .sandbox/explore-shot.mjs http://localhost:5175"` → Expected: reaches the dungeon.
View `explore-step-5.png` (world). It should match the approved T2 mockup:
- bazaar full-bleed with the title centred;
- Services console on the left, sized to its content;
- Party console top right;
- Portal console bottom centre under the gate;
- no see-through ring on any bezel.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/components/WorldView.tsx client/src/components/TownView.tsx client/src/styles/menu.css
git.exe commit -m "Town hub as T2 relic consoles on the bazaar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Stash, Store and Character panels as consoles

**Files:**
- Modify: `client/src/components/StashModal.tsx`
- Modify: `client/src/components/ShopModal.tsx`
- Modify: `client/src/components/CharacterModal.tsx`
- Modify: `client/src/styles/menu.css`

**Interfaces:**
- Consumes: `ScreenTransition`, `MenuConsole` (Task 3); `RelicButton`, `ItemIcon` from `./relic/index.js`.
- Produces: each panel renders `<ScreenTransition screenKey={open ? '<name>' : 'closed'} className="modal-layer" onBackdropClick={onClose}>`, always mounted, so closing plays the power-off.

In each panel, the early `if (!x) return null;` becomes "render the layer with `null` children". Every handler, sound cue, and `disabled`/`title` attribute stays byte-for-byte the same; only the wrappers and the button elements change.

- [ ] **Step 1: `StashModal`.** Add:

```tsx
import { ScreenTransition, MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';
```

Replace:

```tsx
  if (!openStash) return null;

  const filled = openStash.items.filter((i) => i !== null).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="stash-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="stash-title">Adventurer's Stash</h2>
```

with:

```tsx
  const filled = openStash ? openStash.items.filter((i) => i !== null).length : 0;

  return (
    <ScreenTransition screenKey={openStash ? 'stash' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {openStash && (
      <MenuConsole title="Adventurer's Stash" width="760px" className="stash-modal" footer={<RelicButton className="stash-close-btn" onClick={onClose}>Close</RelicButton>}>
```

Remove the old `<div className="stash-actions">…</div>` block. Replace the closing `</div>\n    </div>\n  );` with:

```tsx
      </MenuConsole>
      )}
    </ScreenTransition>
  );
```

In all three slot-button maps, change the button content from `{item ? slotLabel(item) : '—'}` to `{item ? <><ItemIcon item={item} /><span className="stash-slot__name">{slotLabel(item)}</span></> : '—'}`.

- [ ] **Step 2: `ShopModal`.** Add:

```tsx
import { ScreenTransition, MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';
```

- Replace `if (!shop) return null;` and the `stop` line with nothing.
- Replace the returned opening:

```tsx
    <div className="modal-overlay" onClick={onClose}>
      <div className="shop-modal" onClick={stop}>
        <header className="shop-modal-header">
          <h2>{shop.name}</h2>
          <div className="shop-gold">{shop.gold}g</div>
          <button className="shop-close-btn" onClick={onClose}>×</button>
        </header>
```

with:

```tsx
    <ScreenTransition screenKey={shop ? 'shop' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {shop && (
      <MenuConsole title={shop.name} width="880px" className="shop-modal"
        footer={<><div className="shop-gold">{shop.gold}g</div><RelicButton className="shop-close-btn" onClick={onClose}>Close</RelicButton></>}>
```

- Replace the final `      </div>\n    </div>\n  );` of the component with:

```tsx
      </MenuConsole>
      )}
    </ScreenTransition>
  );
```

- Change the Reroll `<button className="shop-reroll-btn" …>` / `</button>` to `<RelicButton size="sm" className="shop-reroll-btn" …>` / `</RelicButton>`, keeping the same props and children.
- In the Staples map, add `<ItemIcon item={slot.item} />` as the first child of the button.
- In the Wares map, inside `{slot.item ? (<> … </>)`, add `<ItemIcon item={slot.item} />` as the first child.
- In `SellSlot`, change the filled content to `<><ItemIcon item={item} /><div className={`shop-slot-name rarity-${item.rarity}`}>{item.name}</div></>`.

- [ ] **Step 3: `CharacterModal`.** Split it so the panel's contents render only when it's open.

Add:

```tsx
import { ScreenTransition, MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';
```

Rename the existing component function body into a new component, `CharacterPanelBody`:
- **Signature:** `function CharacterPanelBody({ panel, onEquipItem, onDropItem, onAllocateStat }: { panel: CharacterPanelView } & Omit<Props, 'onClose'>)`.
- **Its body:** everything the old component did from `const portrait = getClassPortrait(panel.className);` down to its `return`.
- **What it returns:** only the existing `<div className="char-modal-body">…</div>` JSX, without the outer overlay, `.char-modal` wrapper, header or close button.

Inside that JSX:
- `<button className="stat-alloc-btn" onClick={() => onAllocateStat(def.id)}>+</button>` becomes `<RelicButton size="sm" className="stat-alloc-btn" onClick={() => onAllocateStat(def.id)}>+</RelicButton>`.
- `<button className="equip-btn" onClick={() => onEquipItem(i)}>` … `</button>` becomes `<RelicButton size="sm" className="equip-btn" onClick={() => onEquipItem(i)}>` … `</RelicButton>`.
- `<button className="drop-btn" onClick={() => onDropItem(i)}>Drop</button>` becomes `<RelicButton size="sm" tone="danger" className="drop-btn" onClick={() => onDropItem(i)}>Drop</RelicButton>`.
- In the consumable and inventory rows, insert `<ItemIcon item={item} />` as the first child of `<div className="char-item-row">`.
- In `EquipSlot`, when `item` is set, render `<ItemIcon item={item} />` before the `<span className={`rarity-${item.rarity}`}>`.

The exported component becomes:

```tsx
export function CharacterModal({ onEquipItem, onDropItem, onAllocateStat, onClose }: Props) {
  const panel = useGameStore((s) => s.openCharacterPanel);
  const error = useGameStore((s) => s.characterPanelError);
  return (
    <ScreenTransition screenKey={panel ? 'character' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {panel && (
        <MenuConsole title="Character" width="720px" className="char-modal" footer={<RelicButton onClick={onClose}>Close</RelicButton>}>
          {error && <div className="char-modal-error">{error}</div>}
          <CharacterPanelBody panel={panel} onEquipItem={onEquipItem} onDropItem={onDropItem} onAllocateStat={onAllocateStat} />
        </MenuConsole>
      )}
    </ScreenTransition>
  );
}
```

`CharacterPanelView` is already imported as a type at the top of the file.

- [ ] **Step 4: Append the panel styles to `menu.css`:**

```css
/* Town panels as consoles */
.modal-layer .menu-console .relic-panel { max-height: calc(100vh - 48px); }
.stash-slot, .shop-slot { display: flex; align-items: center; gap: 8px; text-align: left; }
.stash-slot__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shop-modal .menu-console__footer { justify-content: space-between; }
.shop-gold { color: var(--relic-amber); }
.char-modal .char-item-row, .char-modal .char-equip-slot { display: flex; align-items: center; gap: 8px; }
```

- [ ] **Step 5: Typecheck, then run the visual check.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."` → Expected: exit 0.

Extend a copy of the explore flow, or do it by hand in the dev client. In the town, click each service row and screenshot the opened panel, then close it. All three should open as a bezel console over a dimmed town, with item icons in their rows, and close with the power-off.

Review Focus 4: click Stash, then within 100ms click Close, then the Store. Exactly one console should be visible at the end.

- [ ] **Step 6: Commit.**

```bash
git.exe add client/src/components/StashModal.tsx client/src/components/ShopModal.tsx client/src/components/CharacterModal.tsx client/src/styles/menu.css
git.exe commit -m "Stash, Store and Character panels as relic consoles with power transitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verification

**Files:** none tracked. Checks only; fixes go to the owning task's files with their own commits.

- [ ] **Step 1: Transition DOM check** (Review Focus 1). Create `.sandbox/menu-transition.mjs`:

```js
// After a screen change the old console must power off and be removed; the new one must end idle.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5175';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${base}/`);
await p.waitForSelector('.lobby-start');
for (let i = 0; i < 40 && (await p.locator('.intro-root').count()) > 0; i++) {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
}
await p.keyboard.type(`tx${Date.now() % 100000}`);
await p.keyboard.press('Enter');
const seenOff = await p.waitForSelector('.screen-transition__body--off', { timeout: 3000 }).then(() => true, () => false);
await p.waitForSelector('.char-slot-grid', { timeout: 20000 });
await p.waitForTimeout(700);
const phases = await p.$$eval('.screen-transition__body', (els) => els.map((e) => e.className));
const loginGone = (await p.locator('.login-console').count()) === 0;
await b.close();
console.log(JSON.stringify({ seenOff, phases, loginGone }));
const bad = !seenOff || !loginGone || phases.some((c) => /--(off|on)\b/.test(c));
console.log(bad ? 'FAIL' : 'PASS');
process.exit(bad ? 1 : 0);
```

Run: `cmd.exe /c "node .sandbox/menu-transition.mjs"` → Expected: PASS.

- [ ] **Step 2: Screenshots at 1600×1000.**
- Run `cmd.exe /c "node .sandbox/explore-shot.mjs http://localhost:5175"` and view `explore-step-1..5.png` (login, select, create, created, town).
- Screenshot the connecting console by stopping the game server briefly, or skip it if that isn't practical, and ledger which.
- Screenshot each town panel from Task 7.

- [ ] **Step 3: Regressions.**
- `cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:5175"` → `cols >= 28`, `rows >= 8`.
- `cmd.exe /c "node .sandbox/css-regressions.mjs"` → PASS.
- `cmd.exe /c "node .sandbox/move-closes.mjs"` → PASS.
- `cmd.exe /c "node scripts/intro-render.mjs handoff --base http://localhost:5175 --out .intro/handoff-final"` → within ±10% of the Task 4 baseline.

- [ ] **Step 4: Full suite.**
Run: `cmd.exe /c "npm test && cd client && npx tsc --noEmit -p ."` → Expected: every workspace passes and `tsc` is clean.

- [ ] **Step 5: Reduced-motion check.** Launch the page with `p.emulateMedia({ reducedMotion: 'reduce' })` (copy `menu-transition.mjs` with that line added after `newPage`).
Expected:
- `seenOff` is false, because the swap is instant;
- the login and select typed text is complete on the first screenshot;
- no `.menu-console__glitch` or `.menu-console__scanroll` is visible.

- [ ] **Step 6: Show the user** the before/after screenshots on the mockup page, then record memory (`mcp__thinker__memory_store`) for anything non-obvious learned.
