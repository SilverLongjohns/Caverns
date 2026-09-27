// POWER-ON (0–1.6 s): an old analogue set warming up: dot → line → tube snaps open →
// snow, one vertical roll, barrel bulge relaxing into the Waste.
import { clamp, inv, ease, hash } from '../math.js';
import { LR_W, LR_H } from '../timeline.js';
import type { IntroAssets } from '../assets.js';
import { drawPlate } from '../plate.js';

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
