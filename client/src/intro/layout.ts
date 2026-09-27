// Geometry: cover-fitting the 320×180 scene, and measuring the real login DOM so the final
// shots draw the ASCII cavern, eyes and logo at exactly the pixels the page will show.
import { LR_W, LR_H, GLYPH_T0, GLYPH_T1 } from './timeline.js';
import { clamp, hash } from './math.js';

export interface Fit { k: number; ps: number; dx: number; dy: number }

/** The intermediate pre-scaled canvas never gets wider than this (device px). */
export const MAX_PRESCALE_W = 4096;
const MAX_PS = Math.floor(MAX_PRESCALE_W / LR_W);

/**
 * Cover-fit the low-res frame into vw×vh device px. `k` is the exact scale; `ps` is the integer
 * pre-scale for "sharp bilinear" upscaling (nearest ×ps, then smooth to ×k): crisp and even.
 * `ps` is capped so the intermediate canvas stays ≤ MAX_PRESCALE_W wide; above that (5K+ device
 * px) the final smooth step scales up from the capped size instead.
 */
export function coverFit(vw: number, vh: number): Fit {
  const k = Math.max(vw / LR_W, vh / LR_H);
  const ps = Math.min(MAX_PS, Math.max(1, Math.ceil(k - 1e-9)));
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
