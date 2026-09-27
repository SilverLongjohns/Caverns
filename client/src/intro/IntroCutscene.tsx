import { useEffect, useRef, useState } from 'react';
import { audioEngine, AMBIENCE_URL } from '../audio/audioEngine.js';
import { useIntroStore } from './introStore.js';
import { IntroRenderer } from './renderer.js';
import { measureLayout } from './layout.js';
import { loadIntroAssets, isComplete, emptyAssets, type IntroAssets } from './assets.js';
import { IntroClock, pickClockSource } from './clock.js';
import { scheduleCues, renderIntroMix, encodeWav, type AudioHandle } from './audio.js';
import { CUES, SKIP_CUES, DURATION, MUSIC_RELEASE_T, FADE_OUT_S, DARK_T0 } from './timeline.js';
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
            if (t >= DARK_T0) measure();
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
        if (!measuredDark && t >= DARK_T0) { measuredDark = true; measure(); }
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
