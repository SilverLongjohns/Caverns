// THE DESCENT (13–22 s): a vertical fall through four strata, each boundary landing on a braam.
import { LR_W, LR_H, STRATA, type StratumId } from '../timeline.js';
import { clamp, lerp, ease, hash, vnoise } from '../math.js';
import type { IntroAssets, ImageId } from '../assets.js';

export const DESCENT_T0 = 13;
/** Screen row (low-res px) of the falling figure. */
export const FIG_Y = 90;

/** Camera depth in low-res px after u seconds of falling: accelerating. */
export function fallDepth(u: number): number {
  return 28 * u + 4 * u * u;
}

/** Depth where stratum i begins: its boundary crosses the figure exactly at STRATA[i].t0. */
export function stratumTop(i: number): number {
  return i === 0 ? -Infinity : fallDepth(STRATA[i].t0 - DESCENT_T0) + FIG_Y;
}

export function stratumAtDepth(d: number): number {
  let k = 0;
  for (let i = 1; i < STRATA.length; i++) if (d >= stratumTop(i)) k = i;
  return k;
}

const WALL: Record<StratumId, ImageId> = {
  conduits: 'wall_conduits', screens: 'wall_screens', fungal: 'wall_fungal', crystal: 'wall_crystal',
};
const AMBIENT: Record<StratumId, string> = {
  conduits: '#4a3c3c', screens: '#2e454c', fungal: '#2c4a3a', crystal: '#3a2e50',
};
/** Dead-screen centres in wall_screens.png pixel coords (from art/intro/NOTES-descent.md). */
export const SCREEN_SPOTS: readonly { x: number; y: number }[] = [
  { x: 79, y: 28 }, { x: 75, y: 74 }, { x: 77, y: 122 }, { x: 77, y: 168 }, { x: 81, y: 218 },
];
const SCREEN_GLYPHS: readonly ImageId[] = ['glyph_lurker', 'glyph_spider', 'glyph_colossus'];

let light: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null = null;
let tint: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null = null;
function scratch(ref: typeof light, w: number, h: number) {
  if (ref) return ref;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d')! };
}

function drawWalls(c: CanvasRenderingContext2D, a: IntroAssets, cam: number): void {
  for (let i = 0; i < STRATA.length; i++) {
    const img = a.images[WALL[STRATA[i].id]];
    if (!img) continue;
    const top = i === 0 ? 0 : stratumTop(i);
    const bottom = i + 1 < STRATA.length ? stratumTop(i + 1) : Infinity;
    const y0 = Math.max(0, Math.round(top - cam)), y1 = Math.min(LR_H, Math.round(bottom - cam));
    if (y1 <= y0) continue;
    const texY = Math.round(cam + y0 - top);
    c.save();
    c.beginPath();
    c.rect(0, y0, LR_W, y1 - y0);
    c.clip();
    c.drawImage(img, 0, y0 - texY);
    c.translate(LR_W, 0);
    c.scale(-1, 1);
    c.drawImage(img, 0, y0 - texY);
    c.restore();
  }
}

function drawScreens(c: CanvasRenderingContext2D, a: IntroAssets, cam: number, t: number): void {
  const i = STRATA.findIndex((s) => s.id === 'screens');
  const top = stratumTop(i), bottom = stratumTop(i + 1);
  tint = scratch(tint, 24, 24);
  SCREEN_SPOTS.forEach((p, k) => {
    const y = top + p.y - cam;
    if (y < -12 || y > LR_H + 12 || top + p.y > bottom) return;
    const flick = hash(Math.floor(t * 12) * 3.7 + k) > 0.35 ? 1 : 0.25;
    const g = a.images[SCREEN_GLYPHS[k % SCREEN_GLYPHS.length]];
    if (!g) return;
    const tx = tint!.x;
    tx.globalCompositeOperation = 'source-over';
    tx.clearRect(0, 0, 24, 24);
    tx.drawImage(g, 0, 0, 24, 24);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = '#7fffe0';
    tx.fillRect(0, 0, 24, 24);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55 * flick;
    for (const x of [p.x, LR_W - p.x]) c.drawImage(tint!.c, Math.round(x - 6), Math.round(y - 6), 12, 12);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  });
}

function drawParticles(c: CanvasRenderingContext2D, id: StratumId, cam: number, t: number): void {
  // Debris streaking upward past the camera.
  for (let i = 0; i < 34; i++) {
    const x = Math.round(hash(i) * LR_W);
    const y = Math.round(((hash(i + 50) * 400 - cam * (1.4 + hash(i + 9) * 0.8)) % 200 + 200) % 200 - 10);
    c.fillStyle = `rgba(200,190,170,${0.12 + hash(i * 2.1) * 0.25})`;
    c.fillRect(x, y, 1, 2 + Math.round(hash(i * 4.4) * 4));
  }
  // Stratum emissives: spores in the fungal band, glints in the crystal band.
  if (id === 'fungal' || id === 'crystal') {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const x = Math.round(hash(i * 1.3 + 7) * LR_W);
      const y = Math.round(((hash(i * 2.7) * 260 - cam * 0.9 - t * (id === 'fungal' ? 6 : 0)) % 200 + 200) % 200 - 10);
      const tw = id === 'crystal' ? (hash(Math.floor(t * 8) + i) > 0.85 ? 1 : 0.2) : 0.6 + 0.4 * Math.sin(t * 3 + i);
      c.fillStyle = id === 'fungal' ? `rgba(90,255,190,${0.45 * tw})` : `rgba(190,140,255,${0.7 * tw})`;
      c.fillRect(x, y, 1, 1);
    }
    c.globalCompositeOperation = 'source-over';
  }
}

export function drawDescent(c: CanvasRenderingContext2D, t: number, a: IntroAssets): void {
  const u = clamp(t - DESCENT_T0, 0, 9);
  const cam = fallDepth(u);
  const id = STRATA[stratumAtDepth(cam + FIG_Y)].id;
  const jx = Math.round(vnoise(u * 9) * 0.8), jy = Math.round(vnoise(u * 9 + 33) * 0.8);
  c.save();
  c.translate(jx, jy);

  // Far wall: slow parallax, dim.
  const far = a.images.descent_far;
  if (far) {
    c.globalAlpha = 0.55;
    c.drawImage(far, 0, -Math.round(cam * 0.12) % far.height);
    c.globalAlpha = 1;
  }

  // Daylight shaft from above, shrinking to a coin, then a star.
  const fade = ease.out2(clamp(u / 6.5));
  const beamW = lerp(90, 0, fade);
  if (beamW > 0.5) {
    const g = c.createLinearGradient(0, 0, 0, LR_H);
    g.addColorStop(0, `rgba(255,236,200,${0.5 * (1 - fade)})`);
    g.addColorStop(1, 'rgba(255,236,200,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(LR_W / 2 - beamW * 0.35, 0);
    c.lineTo(LR_W / 2 + beamW * 0.35, 0);
    c.lineTo(LR_W / 2 + beamW, LR_H);
    c.lineTo(LR_W / 2 - beamW, LR_H);
    c.fill();
    c.globalCompositeOperation = 'source-over';
  }

  drawWalls(c, a, cam);
  drawScreens(c, a, cam, t); // culls itself to the screens stratum

  // Ledges on stratum boundaries.
  const ledge = a.images.ledge;
  if (ledge) for (let i = 1; i < STRATA.length; i++) {
    const y = Math.round(stratumTop(i) - cam - ledge.height / 2);
    if (y > -ledge.height && y < LR_H) c.drawImage(ledge, 0, y);
  }

  // The falling figure, tumbling.
  const fig = a.images.figure_fall;
  let fx = LR_W / 2, fy = FIG_Y;
  if (fig) {
    const fs = fig.height, frames = Math.max(1, Math.floor(fig.width / fs));
    const f = Math.floor(u * 10) % frames;
    fx = Math.round(LR_W / 2 + vnoise(u * 0.7) * 14);
    fy = Math.round(FIG_Y + vnoise(u * 1.3 + 5) * 4);
    c.drawImage(fig, f * fs, 0, fs, fs, fx - fs / 2, fy - fs / 2, fs, fs);
  }

  // Lighting: stratum ambient × lantern, multiplied over the scene.
  light = scratch(light, LR_W, LR_H);
  const lx = light.x;
  lx.globalCompositeOperation = 'source-over';
  lx.fillStyle = AMBIENT[id];
  lx.fillRect(0, 0, LR_W, LR_H);
  lx.globalCompositeOperation = 'lighter';
  const r = 64 + vnoise(u * 11) * 6;
  const lg = lx.createRadialGradient(fx, fy, 0, fx, fy, r);
  lg.addColorStop(0, 'rgba(255,214,150,1)');
  lg.addColorStop(0.45, 'rgba(200,140,80,0.55)');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  lx.fillStyle = lg;
  lx.fillRect(0, 0, LR_W, LR_H);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(light.c, 0, 0);
  // A faint additive stratum wash so the void between features never reads as pure black.
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.16;
  c.fillStyle = AMBIENT[id];
  c.fillRect(0, 0, LR_W, LR_H);
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,190,110,0.35)';
  c.fillRect(fx - 1, fy + 2, 2, 2);
  c.globalCompositeOperation = 'source-over';

  drawParticles(c, id, cam, t);

  // Foreground silhouettes: fastest parallax, both edges.
  const near = a.images.near_wall;
  if (near) {
    const ny = -Math.round((cam * 1.6) % near.height);
    for (const oy of [ny, ny + near.height]) {
      c.drawImage(near, 0, oy);
      c.save();
      c.translate(LR_W, 0);
      c.scale(-1, 1);
      c.drawImage(near, 0, oy + 97);
      c.drawImage(near, 0, oy + 97 - near.height);
      c.restore();
    }
  }

  // The last of the daylight: a star at the top of the shaft.
  if (u > 6) {
    const tw = 0.6 + 0.4 * hash(Math.floor(t * 10));
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = `rgba(255,245,225,${tw * clamp((9 - u) / 1.5)})`;
    c.fillRect(LR_W / 2, 3, 1, 1);
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}
