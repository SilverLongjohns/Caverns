// THE DARK (1.6–5 s): silence, one drip, then the eyes open one pair at a time, at exactly
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
  c.fillRect(160 - 34, 113 - 34, 68, 68); // the whole gradient disc, or its edge shows as a box
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
      // A detached element (the view changed under the intro) reads as NaN: converge on 0.
      const raw = e.el.isConnected ? parseFloat(getComputedStyle(e.el).opacity) : NaN;
      const live = Number.isFinite(raw) ? raw : 0;
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
