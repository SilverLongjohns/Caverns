// Picture pipeline: shot → 320×180 scene → (CRT warm-up pass) → low-res bloom → sharp-bilinear
// upscale with shake → chromatic split / flash → power-on aperture → native-res layers (eyes,
// ASCII cavern, logo) aligned to the DOM → grain. The app's .crt-overlay adds scanlines on top.
import { LR_W, LR_H, BG, POWER_END_T, DARK_T0, RESOLVE_T0, shotAt, impact, type ShotId } from './timeline.js';
import { coverFit, type Fit, type SceneLayout } from './layout.js';
import { hash, vnoise, mulberry32 } from './math.js';
import type { IntroAssets } from './assets.js';
import { drawDeadGlass, drawPower, crtWarmPass, drawPowerAperture, powerState } from './shots/power.js';
import { drawDarkLowRes, drawEyes } from './shots/dark.js';
import { drawResolve, underlayAlpha, buildGlyphPlan, type GlyphPlan } from './shots/resolve.js';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const x = c.getContext('2d', opts);
  if (!x) throw new Error('2D canvas unavailable');
  return x;
}

export class IntroRenderer {
  private readonly o: CanvasRenderingContext2D;
  private readonly lr = makeCanvas(LR_W, LR_H);
  private readonly lx = ctx2d(this.lr, { willReadFrequently: true }); // crtWarmPass reads it back
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
  private plan: GlyphPlan | null = null;

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
    if (this.layout) this.plan = buildGlyphPlan(this.o, this.layout, this.dpr);
  }

  setLayout(layout: SceneLayout | null): void {
    this.layout = layout;
    this.plan = layout ? buildGlyphPlan(this.o, layout, this.dpr) : null;
  }

  renderGate(time: number): void {
    drawDeadGlass(this.o, this.out.width, this.out.height, time, this.dpr);
  }

  render(t: number, a: IntroAssets): void {
    t = Math.max(0, t);
    const shot = shotAt(t);
    this.drawScene(shot.id, t);
    this.compose(t, a);
  }

  /** Low-res scene for the current shot. */
  protected drawScene(id: ShotId, t: number): void {
    const lx = this.lx;
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalAlpha = 1;
    lx.globalCompositeOperation = 'source-over';
    lx.filter = 'none';
    lx.imageSmoothingEnabled = false;
    lx.fillStyle = BG; // the static dies into exactly the page background the rest plays on
    lx.fillRect(0, 0, LR_W, LR_H);
    lx.save();
    if (id === 'power') drawPower(lx, t);
    else if (id === 'dark') drawDarkLowRes(lx, t);
    lx.restore();
    if (t < POWER_END_T) crtWarmPass(lx, t);
  }

  /** Opacity of the whole finished frame: 1 until the real login screen is revealed underneath. */
  protected backdrop(t: number): number {
    return underlayAlpha(t);
  }

  /** Native-resolution layers drawn after the upscale (eyes, glyphs, logo, power aperture). */
  protected drawNative(t: number, a: IntroAssets): void {
    if (t < 0.6) drawPowerAperture(this.o, t, this.out.width, this.out.height, this.dpr);
    if (this.layout && t >= DARK_T0) {
      this.o.setTransform(1, 0, 0, 1, 0, 0);
      drawEyes(this.o, t, this.layout, this.dpr);
      if (t >= RESOLVE_T0 && this.plan) drawResolve(this.o, t, this.layout, this.plan, a.images.logo, this.dpr, this.filtersOK);
    }
  }

  /** Extra horizontal jitter in low-res px (degauss wobble). */
  protected wobble(t: number): number {
    return t < POWER_END_T ? powerState(t).wobble * 2 : 0;
  }

  private compose(t: number, a: IntroAssets): void {
    const o = this.o, W = this.out.width, H = this.out.height;
    const { k, ps, dx, dy } = this.fit;
    const back = this.backdrop(t);
    if (back <= 0) {
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, W, H);
      return;
    }

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
    o.setTransform(zs, 0, 0, zs, (W / 2) * (1 - zs) + sx, (H / 2) * (1 - zs) + sy);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(this.px, dx, dy, LR_W * k, LR_H * k);
    if (this.filtersOK) {
      o.globalCompositeOperation = 'screen';
      o.globalAlpha = 0.35;
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

    // Film grain.
    const fi = Math.floor(t * 24);
    const pat = o.createPattern(this.grains[fi % 4], 'repeat');
    if (pat) {
      const gx = (hash(fi) * 256) | 0, gy = (hash(fi + 0.5) * 256) | 0;
      o.globalCompositeOperation = 'overlay';
      o.globalAlpha = 0.1;
      o.translate(-gx, -gy);
      o.fillStyle = pat;
      o.fillRect(gx, gy, W, H);
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.globalAlpha = 1;
    }

    // Handoff: fade the finished frame as a whole — a true crossfade onto the identical DOM
    // underneath. (Fading only the backdrop would stack the canvas glyphs, logo and eyes on the
    // DOM's own during the fade, and they'd flare brighter for a moment.)
    if (back < 1) {
      o.globalCompositeOperation = 'destination-out';
      o.fillStyle = `rgba(0,0,0,${1 - back})`;
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'source-over';
    }
  }

  /** For subclasses/shots: the low-res scene context and the output context. */
  protected get sceneCtx(): CanvasRenderingContext2D { return this.lx; }
  protected get outCtx(): CanvasRenderingContext2D { return this.o; }
  protected get outW(): number { return this.out.width; }
  protected get outH(): number { return this.out.height; }
}
