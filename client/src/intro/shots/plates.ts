// THE WASTE (1.6–8 s) and THE THRESHOLD (8–13 s): re-pixelated AI plates with canvas life on top.
import { LR_W, LR_H } from '../timeline.js';
import { hash, vnoise } from '../math.js';
import type { IntroAssets } from '../assets.js';
import { drawPlate } from '../plate.js';

export const WASTE_T0 = 1.6;
export const THRESHOLD_T0 = 8;
/**
 * A dead signal light on the monolith (320×180 coords) that flickers once. NOTES.md's measured
 * WASTE_LIGHT (219, 87) is the middle-row lamp the chosen Veo take itself lights amber from about
 * plate t=2.9-6.5s (timeline 4.5-8.1s) — squarely under our 5.2 s flicker. Compositing a `lighter`
 * cyan flash onto that already-bright amber pixel saturates every channel to near-white
 * (measured (255,251,237) at t=5.25 vs the plate's own (238,166,72) baseline one frame earlier),
 * so the flicker read as a hot white blob, not teal, and doubled up on a beat the plate already
 * plays. Retargeted to (231, 76), a top-row lamp from NOTES.md's dead-lamp list that stays dark
 * (RGB in the 20s-60s) across the whole shot, so the teal reads as its own distinct spark.
 */
export const WASTE_LIGHT = { x: 231, y: 76, t: 5.2 };

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
