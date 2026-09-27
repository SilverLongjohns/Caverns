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
/** Every glyph has cooled to the DOM colour by now (last reveal ≤ GLYPH_T1, heat e^-6·0.5 ≈ 5 %). */
const SETTLE_T = GLYPH_T1 + 0.5;

export function drawResolve(
  o: CanvasRenderingContext2D, t: number, layout: SceneLayout, plan: GlyphPlan,
  logo: HTMLImageElement | undefined, dpr: number, filtersOK: boolean,
): void {
  const settled = t >= SETTLE_T;
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
      // .lobby's phosphor text-shadow, eased in so the cooled glyphs don't pop when it arrives.
      o.shadowColor = `rgba(200,170,120,${0.2 * ease.out2(inv(0, 0.4, t - SETTLE_T))})`;
      o.shadowBlur = 2 * dpr;
      o.fillStyle = pre.color;
      for (const l of p.lines) o.fillText(l.text, pre.x * dpr, l.baseline);
    } else {
      // Heat is colour only: a fresh glyph starts hot amber and cools to the DOM colour.
      for (const l of p.lines) for (const c of l.cells) {
        if (t < c.tr) continue;
        const heat = Math.exp(-(t - c.tr) * 6);
        const col = base.map((v, i) => Math.round(lerp(v, HOT[i], heat)));
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
