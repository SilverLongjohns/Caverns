// One AudioContext for the whole client: master volume → { intro bus, ambience, world music }.
// The ambience is a decoded buffer looped sample-accurately (HTMLAudio loops of AAC have gaps).
import { clamp } from '../intro/math.js';
import type { MusicTrack } from './musicTrack.js';
import { introAssetUrl } from '../intro/assets.js';

export const AMBIENCE_URL = introAssetUrl('ambience.m4a');
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
