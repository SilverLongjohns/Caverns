// One AudioContext for the whole client: master volume → { intro bus, ambience, world music, sfx, biome beds }.
// The ambience is a decoded buffer looped sample-accurately (HTMLAudio loops of AAC have gaps).
import { clamp } from '../intro/math.js';
import type { MusicTrack } from './musicTrack.js';
import { introAssetUrl } from '../intro/assets.js';
import { createUiThrottle, synthUiSound, type UiSound } from './uiSounds.js';
import { SFX, SFX_FILES, type SfxFiles, type SfxId } from './sfxManifest.js';
import { pickTake, SfxLimiter } from './sfxRules.js';

export const AMBIENCE_URL = introAssetUrl('ambience.m4a');
export const WORLD_URL = '/audio/gasket_maples.mp3';
/** The intro plays this much louder than music at the same slider position (capped at unity). */
export const INTRO_BOOST = 2.5;
/** Biome beds crossfade over this long. */
export const BED_FADE_S = 2;
/** Bed bus level while a fight is on. */
export const BED_DUCK = 0.4;
export const DUCK_RAMP_S = 0.3;

const UI_SAMPLE: Record<UiSound, SfxId> = {
  click: 'ui_click', tick: 'ui_tick', power: 'ui_power', crack: 'crack', boom: 'boom', shimmer: 'shimmer',
};

export function busGains(volume: number, muted: boolean): { master: number; intro: number } {
  const master = muted ? 0 : clamp(volume, 0, 1);
  if (master === 0) return { master: 0, intro: 0 };
  return { master, intro: Math.min(1, master * INTRO_BOOST) / master };
}

type Listener = () => void;

export class AudioEngine {
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
  private watchingState = false;
  private sfxBus!: GainNode;
  private bedBus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private lastTake = new Map<SfxId, number>();
  private limiter = new SfxLimiter();
  private bedId: SfxId | null = null;
  /** Bumped on every setBed so a load that resolves after a later call never starts. */
  private bedGen = 0;
  private bedVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  constructor(private readonly files: SfxFiles = SFX_FILES) {}

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
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.bedBus = ctx.createGain();
      this.bedBus.connect(this.master);
      this.ctx = ctx;
      this.applyGains();
    }
    return this.ctx;
  }

  /**
   * Call from inside a user gesture. Only counts as unlocked once the context is actually
   * running (a resume outside a real activation, e.g. on Escape, fails or stays pending), so
   * callers can keep retrying on later gestures until it is.
   */
  unlock(): Promise<void> {
    const ctx = this.context();
    if (!this.watchingState) {
      this.watchingState = true;
      ctx.addEventListener('statechange', this.checkRunning);
    }
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    return resumed.then(this.checkRunning, () => {});
  }

  private uiThrottle = createUiThrottle(80);

  /** UI sound through the master bus: the curated sample when there is one, else the synth. Never throws. */
  playUi(sound: UiSound): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      if (!this.uiThrottle(sound, performance.now())) return;
      const id = UI_SAMPLE[sound];
      if (this.hasSample(id)) this.playSfx(id);
      else synthUiSound(ctx, this.master, sound);
    } catch {
      /* UI sounds are best-effort */
    }
  }

  hasSample(id: SfxId): boolean {
    return (this.files[id]?.length ?? 0) > 0;
  }

  /** Where the dev audition page routes raw takes, so it hears the real master volume. */
  sfxDestination(): AudioNode {
    this.context();
    return this.sfxBus;
  }

  /** A curated one-shot. Silent until audio is running or when the id has no files; never throws. */
  playSfx(id: SfxId, opts: { volume?: number; pitch?: number; fallback?: UiSound; limitKey?: string } = {}): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const files = this.files[id];
      if (!files?.length) {
        if (opts.fallback) synthUiSound(ctx, this.master, opts.fallback);
        return;
      }
      const t = SFX[id];
      const key = opts.limitKey ?? id;
      if (!this.limiter.tryStart(key, performance.now(), t.minGapMs ?? 0, t.maxVoices ?? 3)) return;
      const idx = pickTake(files.length, this.lastTake.get(id));
      this.lastTake.set(id, idx);
      void this.loadBuffer(files[idx]).then((buf) => {
        if (!buf) { this.limiter.end(key); return; }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const jitter = t.pitchJitter ?? 0;
        src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
        const g = ctx.createGain();
        g.gain.value = t.volume * (opts.volume ?? 1);
        src.connect(g).connect(this.sfxBus);
        src.onended = () => this.limiter.end(key);
        src.start();
      });
    } catch {
      /* SFX are best-effort */
    }
  }

  preloadSfx(ids: SfxId[]): void {
    for (const id of ids) for (const url of this.files[id] ?? []) void this.loadBuffer(url);
  }

  /** Crossfade to a looping biome bed (null fades out). A bed that loads after the player moved on never starts. */
  setBed(id: SfxId | null): void {
    try {
      if (id === this.bedId) return;
      this.bedId = id;
      const gen = ++this.bedGen;
      const ctx = this.context();
      const now = ctx.currentTime;
      const old = this.bedVoice;
      this.bedVoice = null;
      if (old) {
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setValueAtTime(old.gain.gain.value, now);
        old.gain.gain.linearRampToValueAtTime(0, now + BED_FADE_S);
        old.src.stop(now + BED_FADE_S + 0.05);
      }
      const url = id ? this.files[id]?.[0] : undefined;
      if (!id || !url) return;
      void this.loadBuffer(url).then((buf) => {
        if (!buf || gen !== this.bedGen) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = ctx.createGain();
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(SFX[id].volume, t + BED_FADE_S);
        src.connect(g).connect(this.bedBus);
        src.start();
        this.bedVoice = { src, gain: g };
      });
    } catch {
      /* beds are best-effort */
    }
  }

  setDuck(on: boolean): void {
    try {
      const ctx = this.context();
      const now = ctx.currentTime;
      const g = this.bedBus.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(on ? BED_DUCK : 1, now + DUCK_RAMP_S);
    } catch {
      /* best-effort */
    }
  }

  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`sfx ${r.status}`); return r.arrayBuffer(); })
        .then((d) => this.context().decodeAudioData(d))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }

  private checkRunning = (): void => {
    if (this.unlocked || this.ctx?.state !== 'running') return;
    this.unlocked = true;
    this.listeners.forEach((l) => l());
  };

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
