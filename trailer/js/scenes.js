'use strict';
// ─────────────────────────────────────────────────────────────
//  CAVERNS — scenes. Every scene is a pure function of time, so any
//  frame can be rendered on demand (scrubbing, stills, video export).
// ─────────────────────────────────────────────────────────────

const SCENES = [];
function scene(t0, t1, fn) { SCENES.push({ t0, t1, fn }); }

// ── Palette ──
const GOLD = '#d4a857', AMBER_TEXT = '#c8b89a', PARCH = '#eadbbd';
const LOG = { narration: '#b4b4b4', combat: '#ff4444', loot: '#ffd700', system: '#5a7a7a', chat: '#77ccee' };
const LEGEND = '#e8873a';

// ── Drawing helpers ──
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

function bgXform(img, zoom, fx, fy) {
  const base = Math.max(W / img.width, H / img.height);
  const s = base * zoom;
  const iw = img.width * s, ih = img.height * s;
  const dx = clamp(W / 2 - fx * iw, W - iw, 0);
  const dy = clamp(H / 2 - fy * ih, H - ih, 0);
  return { dx, dy, iw, ih, map: (u, v) => [dx + u * iw, dy + v * ih], k: iw / 1920 };
}
function drawBG(c, img, zoom, fx, fy) {
  const X = bgXform(img, zoom, fx, fy);
  c.drawImage(img, X.dx, X.dy, X.iw, X.ih);
  return X;
}

function glow(c, x, y, r, col, a) {
  if (a <= 0 || r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(0.35, rgba(col, a * 0.45));
  g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

function black(c, a) { if (a > 0) { c.fillStyle = `rgba(0,0,0,${Math.min(1, a)})`; c.fillRect(0, 0, W, H); } }

function goldGrad(c, y, size, tint) {
  const g = c.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.12);
  if (tint) {
    g.addColorStop(0, '#fff8ea'); g.addColorStop(0.45, rgba(tint, 1)); g.addColorStop(1, rgba(tint.map(v => v * 0.55), 1));
  } else {
    g.addColorStop(0, '#fff4c4'); g.addColorStop(0.45, '#f8c96a'); g.addColorStop(1, '#b86f24');
  }
  return g;
}

// Tracked text with optional per-letter reveal (reveal(i, n) → 0..1).
function textT(c, str, x, y, o = {}) {
  const { font = 'Cinzel', size = 60, weight = 700, style = '', tracking = 0, align = 'center', fill = '#fff',
    alpha = 1, reveal = null, shadow = 0, shadowColor = 'rgba(0,0,0,0.8)', maxWidth = 0, rise = 0.18 } = o;
  let sz = size;
  c.font = `${style} ${weight} ${sz}px ${font}`;
  let widths = [...str].map(ch => c.measureText(ch).width);
  let total = widths.reduce((a, b) => a + b, 0) + tracking * (str.length - 1);
  if (maxWidth && total > maxWidth) {
    const k = maxWidth / total; sz = size * k;
    c.font = `${style} ${weight} ${sz}px ${font}`;
    widths = widths.map(w => w * k); total = maxWidth;
  }
  let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.save();
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.fillStyle = typeof fill === 'function' ? fill(sz) : fill;
  if (shadow) { c.shadowBlur = shadow; c.shadowColor = shadowColor; }
  const chars = [...str];
  for (let i = 0; i < chars.length; i++) {
    const a = reveal ? reveal(i, chars.length) : 1;
    if (a > 0.001) {
      c.globalAlpha = alpha * clamp(a);
      c.fillText(chars[i], px, y + (1 - clamp(a)) * sz * rise);
    }
    px += widths[i] + tracking;
  }
  c.restore();
  return { width: total, size: sz };
}
const stagger = (t, t0, per = 0.035, dur = 0.5, ease = E.out3) => (i) => ease(inv(t0 + i * per, t0 + i * per + dur, t));

function wrapLines(c, text, maxW) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function cursor(t) { return (Math.floor(t / 0.265) % 2 === 0) ? '█' : ' '; }

// Pixel skull (threat rating), drawn as crisp blocks.
const SKULL = [
  '..#####..',
  '.#######.',
  '#########',
  '##..#..##',
  '##..#..##',
  '####.####',
  '.#######.',
  '..#.#.#..',
  '..#####..',
];
function skull(c, x, y, px, col, a = 1) {
  c.save(); c.globalAlpha = a; c.fillStyle = col;
  for (let r = 0; r < SKULL.length; r++) for (let q = 0; q < SKULL[r].length; q++)
    if (SKULL[r][q] === '#') c.fillRect(Math.round(x + q * px), Math.round(y + r * px), Math.ceil(px), Math.ceil(px));
  c.restore();
}

// ── Particles (deterministic in t) ──
function embers(c, t, o) {
  const { n = 60, x0 = 0, x1 = W, y0 = H, rise = 700, speed = 0.12, drift = 60, wind = 0, size = 3, col = [255, 160, 70], a = 0.9, seed = 1 } = o;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const h1 = hash(i * 13.1 + seed), h2 = hash(i * 7.7 + seed * 3), h3 = hash(i * 3.3 + seed * 7);
    const ph = (t * speed * (0.6 + h2 * 0.8) + h1) % 1;
    const x = lerp(x0, x1, h3) + Math.sin(t * (0.8 + h1) + i) * drift * ph + wind * ph;
    const y = y0 - ph * rise * (0.6 + h1 * 0.6);
    const fl = 0.6 + 0.4 * Math.sin(t * 9 + i * 2.1);
    const al = a * Math.sin(Math.PI * ph) * fl;
    const s = size * (0.5 + h2);
    c.fillStyle = rgba(col, al);
    c.fillRect(x, y, s, s);
    if (s > 2.5) { c.fillStyle = rgba(col, al * 0.15); c.fillRect(x - s, y - s, s * 3, s * 3); }
  }
  c.restore();
}

function motes(c, t, o) {
  const { n = 50, col = [255, 220, 180], a = 0.35, size = 2.5, seed = 5, speed = 0.02, area = [0, 0, W, H] } = o;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const h1 = hash(i * 17.3 + seed), h2 = hash(i * 5.1 + seed), h3 = hash(i * 9.9 + seed);
    const x = area[0] + ((h1 + t * speed * (h3 - 0.5)) % 1 + 1) % 1 * area[2] + Math.sin(t * 0.7 + i) * 20;
    const y = area[1] + ((h2 + t * speed * 0.6) % 1) * area[3] + Math.cos(t * 0.5 + i * 1.3) * 16;
    const tw = 0.5 + 0.5 * Math.sin(t * (1 + h3 * 2) + i);
    const s = size * (0.5 + h3);
    glow(c, x, y, s * 3, col, a * tw * 0.5);
    c.fillStyle = rgba(col, a * tw); c.fillRect(x - s / 2, y - s / 2, s, s);
  }
  c.restore();
}

// Fog texture (pre-rendered once)
let FOG = null;
function makeFog() {
  const c = makeCanvas(1024, 576), x = c.getContext('2d');
  const r = mulberry32(77);
  for (let i = 0; i < 90; i++) {
    const px = r() * 1024, py = r() * 576, rad = 60 + r() * 220;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    const v = 120 + r() * 80;
    g.addColorStop(0, `rgba(${v},${v * 0.92},${v * 0.82},${0.06 + r() * 0.08})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 576);
  }
  FOG = c;
}
function fog(c, t, a = 0.5, speed = 18, blend = 'screen') {
  if (!FOG) makeFog();
  c.save(); c.globalCompositeOperation = blend; c.globalAlpha = a;
  const off = (t * speed) % 2400;
  c.drawImage(FOG, -off, -60, 2400, 1350);
  c.drawImage(FOG, 2400 - off, -60, 2400, 1350);
  c.globalAlpha = a * 0.6;
  const off2 = (t * speed * 0.55 + 700) % 2400;
  c.drawImage(FOG, 2400 - off2, 0, -2400, 1200);
  c.drawImage(FOG, 4800 - off2, 0, -2400, 1200);
  c.restore();
}

function bottomShade(c, from = 560, a = 0.8) {
  const g = c.createLinearGradient(0, from, 0, FRAME_BOT);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.fillStyle = g; c.fillRect(0, from, W, FRAME_BOT - from);
}

function rule(c, cx, y, w, col, a) {
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.fillRect(cx - w / 2, y, w, 2);
}

// ═════════════════════════════════════════════════════════════
//  ACT I — COLD OPEN: a CRT wakes in the dark (0 – 6.45)
// ═════════════════════════════════════════════════════════════
scene(0, 6.45, (c, t) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  if (t < 0.5) return;
  const w1 = E.outExpo(inv(0.5, 0.62, t)), h1 = E.outExpo(inv(0.62, 0.9, t));
  const h2 = 1 - E.inExpo(inv(6.0, 6.14, t)), w2 = 1 - E.inExpo(inv(6.12, 6.3, t));
  const sw = W * 0.8 * w1 * w2, sh = Math.max(2, H * 0.56 * h1 * h2);
  const cx = W / 2, cy = H / 2;
  const hot = 1 - h1 + (1 - h2);                    // line/dot phases burn hot

  if (t > 6.3) { // collapsed dot fading
    const a = 1 - inv(6.3, 6.45, t);
    glow(c, cx, cy, 90, [255, 230, 180], a * 0.8);
    return;
  }
  c.save();
  const bg = c.createRadialGradient(cx, cy, 0, cx, cy, sw * 0.6);
  bg.addColorStop(0, '#1a130a'); bg.addColorStop(1, '#060403');
  c.fillStyle = bg;
  c.beginPath(); c.roundRect(cx - sw / 2, cy - sh / 2, sw, sh, Math.min(28, sh / 2)); c.fill();
  c.clip();
  // phosphor bloom
  glow(c, cx, cy, sw * 0.5, [212, 168, 87], 0.06);
  // text
  const l1 = typed('open1', t), l2 = typed('open2', t);
  c.font = '80px VT323'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(212,168,87,0.65)'; c.shadowBlur = 18;
  c.fillStyle = GOLD;
  const cur = cursor(t);
  const l1full = TYPED.open1.text;
  const w1t = c.measureText(l1full).width;
  c.textAlign = 'left';
  c.fillText(l1 + (l2 ? '' : cur), cx - w1t / 2, cy - 44);
  if (l2 || t > 3.1) {
    c.font = '54px VT323'; c.fillStyle = AMBER_TEXT; c.shadowColor = 'rgba(200,184,154,0.4)';
    const w2t = c.measureText(TYPED.open2.text).width;
    c.fillText(l2 + cur, cx - w2t / 2, cy + 44);
  }
  c.shadowBlur = 0;
  // scanline roll band
  const band = ((t * 0.35) % 1.4 - 0.2) * sh + cy - sh / 2;
  const bgd = c.createLinearGradient(0, band - 60, 0, band + 60);
  bgd.addColorStop(0, 'rgba(255,220,160,0)'); bgd.addColorStop(0.5, 'rgba(255,220,160,0.035)'); bgd.addColorStop(1, 'rgba(255,220,160,0)');
  c.fillStyle = bgd; c.fillRect(cx - sw / 2, band - 60, sw, 120);
  // hot line during power on/off
  if (hot > 0.01) { c.fillStyle = `rgba(255,244,220,${clamp(hot)})`; c.fillRect(cx - sw / 2, cy - sh / 2, sw, sh); }
  c.restore();
  // bezel reflection
  c.strokeStyle = `rgba(212,168,87,${0.12 * h1 * h2})`; c.lineWidth = 2;
  c.beginPath(); c.roundRect(cx - sw / 2 - 10, cy - sh / 2 - 10, sw + 20, sh + 20, 34); c.stroke();
});

// ═════════════════════════════════════════════════════════════
//  THE LAST FIRE — camp at dusk, the shopkeep (6.3 – 15.0)
// ═════════════════════════════════════════════════════════════
scene(6.3, 15.0, (c, t) => {
  const p = inv(6.3, 15.0, t);
  const X = drawBG(c, A.town, lerp(1.02, 1.16, E.sine(p)), lerp(0.5, 0.53, p), lerp(0.55, 0.66, p));
  const [fx, fy] = X.map(0.527, 0.70);
  const fl = 0.78 + 0.22 * fbm(t * 5.5) + 0.08 * Math.sin(t * 23);
  c.save(); c.globalCompositeOperation = 'lighter';
  glow(c, fx, fy - 60 * X.k, 620 * X.k, [255, 130, 40], 0.16 * fl);
  glow(c, fx, fy - 40 * X.k, 180 * X.k, [255, 200, 120], 0.2 * fl);
  c.restore();
  // warm grade + fire-lit breathing
  c.save(); c.globalCompositeOperation = 'multiply';
  c.fillStyle = `rgba(255,${200 + fl * 20},${150 + fl * 20},1)`; c.fillRect(0, 0, W, H);
  c.restore();
  embers(c, t, { n: 70, x0: fx - 80 * X.k, x1: fx + 80 * X.k, y0: fy - 20 * X.k, rise: 650 * X.k, speed: 0.28, drift: 80, wind: 90, size: 3.2, seed: 2 });
  motes(c, t, { n: 30, col: [255, 200, 150], a: 0.18, size: 2, seed: 9 });

  // narration
  const a1 = win(t, 7.4, 10.5, 0.8, 0.6);
  if (a1 > 0) textT(c, 'Beyond the last fire, the mountain waits.', W / 2, 850 - (t - 7.4) * 6, {
    font: 'Cormorant', style: 'italic', weight: 500, size: 60, fill: PARCH, alpha: a1, shadow: 24,
    reveal: stagger(t, 7.4, 0.022, 0.6), rise: 0.1 });

  // shopkeep dialogue
  if (t > 10.7) {
    const s = E.outExpo(inv(10.75, 11.35, t));
    const px = lerp(-760, 130, s), py = 440;
    c.save();
    c.globalAlpha = s;
    const dark = c.createLinearGradient(0, 380, 0, FRAME_BOT);
    dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(1, 'rgba(0,0,0,0.75)');
    c.fillStyle = dark; c.fillRect(0, 380, W, FRAME_BOT - 380);
    // portrait
    const pw = 300, ph = 450;
    c.fillStyle = 'rgba(12,9,6,0.92)'; c.fillRect(px - 8, py - 8, pw + 16, ph + 16);
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.35 * s * fl; drawGlow(c, GLOW.shopkeep, px, py, pw); c.restore();
    const br = 1 + Math.sin(t * 1.6) * 0.006;
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    c.drawImage(A.shopkeep, px - pw * (br - 1) / 2, py - ph * (br - 1), pw * br, ph * br);
    // firelight on the right side of the face
    const fg = c.createLinearGradient(px, 0, px + pw, 0);
    fg.addColorStop(0, 'rgba(0,0,0,0.35)'); fg.addColorStop(1, `rgba(255,140,60,${0.18 * fl})`);
    c.globalCompositeOperation = 'overlay'; c.fillStyle = fg; c.fillRect(px, py, pw, ph);
    c.restore();
    c.strokeStyle = GOLD; c.lineWidth = 2; c.strokeRect(px - 8, py - 8, pw + 16, ph + 16);
    c.strokeStyle = '#3d3122'; c.lineWidth = 1; c.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
    // dialogue box
    const bx = px + pw + 40, by = 690, bw = 1080, bh = 190;
    c.fillStyle = 'rgba(10,8,6,0.9)'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = GOLD; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    c.strokeStyle = '#3d3122'; c.strokeRect(bx + 6, by + 6, bw - 12, bh - 12);
    c.font = '40px VT323'; c.fillStyle = GOLD; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.shadowColor = 'rgba(212,168,87,0.5)'; c.shadowBlur = 10;
    c.fillText('SHOPKEEP', bx + 34, by + 52);
    c.font = '56px VT323'; c.fillStyle = '#e8dcc0'; c.shadowColor = 'rgba(232,220,192,0.35)';
    const s1 = typed('shop1', t), s2 = typed('shop2', t);
    const cur = cursor(t);
    c.fillText(s1 + (s2 || !s1 ? '' : cur), bx + 34, by + 112);
    if (s2) c.fillText(s2 + cur, bx + 34, by + 164);
    c.restore();
  }
  black(c, 1 - E.out2(inv(6.3, 8.2, t)));
});

// ═════════════════════════════════════════════════════════════
//  THE MOUTH — cave entrance, push into the dark (15.0 – 21.25)
// ═════════════════════════════════════════════════════════════
scene(15.0, 21.25, (c, t) => {
  const slow = E.sine(inv(15.0, 19.4, t));
  const rush = E.in3(inv(19.2, 21.25, t));
  const zoom = lerp(1.06, 1.3, slow) * (1 + rush * 5.5);
  const fx = lerp(0.5, 0.618, E.inOut(inv(15, 20.2, t))), fy = lerp(0.52, 0.52, slow);
  const X = drawBG(c, A.cave, zoom, fx, fy);
  if (rush > 0.02) { // zoom blur
    c.save(); c.globalAlpha = 0.22 * clamp(rush * 3);
    for (const k of [1.03, 1.07, 1.12]) { const Y = bgXform(A.cave, zoom * k, fx, fy); c.drawImage(A.cave, Y.dx, Y.dy, Y.iw, Y.ih); }
    c.restore();
  }
  const [tx, ty] = X.map(0.455, 0.555);
  const fl = 0.75 + 0.25 * fbm(t * 7) + 0.1 * Math.sin(t * 31);
  c.save(); c.globalCompositeOperation = 'lighter';
  glow(c, tx, ty, 380 * X.k, [255, 140, 50], 0.22 * fl);
  glow(c, tx, ty, 90 * X.k, [255, 220, 150], 0.35 * fl);
  c.restore();
  embers(c, t, { n: 55, x0: -200, x1: W, y0: H + 40, rise: 1000, speed: 0.1, wind: 500, drift: 40, size: 3, seed: 4 });
  motes(c, t, { n: 25, col: [255, 190, 130], a: 0.12, seed: 3, speed: 0.05 });
  bottomShade(c, 600, 0.7 * (1 - inv(19.2, 20, t)));
  const a = win(t, 15.7, 18.9, 0.8, 0.7);
  if (a > 0) textT(c, 'Every delve begins where the light ends.', W / 2, 860, {
    font: 'Cormorant', style: 'italic', weight: 500, size: 60, fill: PARCH, alpha: a, shadow: 24, reveal: stagger(t, 15.7, 0.02, 0.6), rise: 0.1 });
  black(c, 1 - inv(15.0, 15.18, t));
  black(c, E.in2(inv(19.6, 21.2, t)) * 0.97);
});

// ═════════════════════════════════════════════════════════════
//  THE DESCENT — procedural tunnel dive (21.2 – 23.9)
// ═════════════════════════════════════════════════════════════
let ROCK_PATS = null;   // rock texture pre-darkened into 12 light levels → one fill per ring
const FLASHES = [[22.3, 'fungal'], [22.85, 'crystal'], [23.3, 'ossuary'], [23.62, 'magma']];
scene(21.2, 24.0, (c, t) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  if (t >= 23.88) return;
  c.fillStyle = 'rgb(10,6,3)'; c.fillRect(0, 0, W, H);   // matches the darkest rock level, so the far void dissolves
  if (!ROCK_PATS) ROCK_PATS = Array.from({ length: 12 }, (_, i) => {
    const cv = makeCanvas(A.rock.width, A.rock.height), x = cv.getContext('2d');
    x.drawImage(A.rock, 0, 0);
    x.fillStyle = `rgba(10,6,3,${1 - Math.pow(i / 11, 1.1) * 1.0})`; x.fillRect(0, 0, cv.width, cv.height);
    return c.createPattern(cv, 'repeat');
  });
  const tau = t - 21.2;
  const zc = 3.5 * tau + 3.2 * tau * tau;
  const F = 820, SP = 0.45, VIS = 16;
  const path = z => [Math.sin(z * 0.33) * 0.55 + Math.sin(z * 0.11) * 0.4, Math.cos(z * 0.27) * 0.3];
  const [camx, camy] = path(zc + 0.8);
  const roll = Math.sin(tau * 0.9) * 0.12;
  const k0 = Math.ceil(zc / SP);
  c.save(); c.translate(W / 2, H / 2); c.rotate(roll);
  for (let k = k0 + Math.floor(VIS / SP); k >= k0; k--) {
    const z = k * SP, rel = z - zc;
    if (rel < 0.12) continue;
    const [ox, oy] = path(z);
    const sx = (ox - camx) * F / rel, sy = (oy - camy) * F / rel;
    if (F / rel * 0.5 > 1300 + Math.hypot(sx, sy)) continue;            // hole covers the whole screen
    const N = 22;
    const fogK = clamp(1 - rel / VIS);
    const lit = Math.pow(clamp(1.4 / (rel + 0.25)), 1.15) * fogK * fogK;
    const warm = 0.35 + 0.65 * hash(k * 3.1);
    c.beginPath();
    c.rect(-W * 0.62, -H * 0.66, W * 1.24, H * 1.32);
    for (let j = 0; j <= N; j++) {
      const jj = j % N;
      const th = (jj / N) * Math.PI * 2 + k * 0.37;
      let r = 1.05 + 0.32 * hash(k * 31.7 + jj * 7.3);
      if (Math.sin(th) < -0.55 && hash(k * 11 + jj) > 0.62) r *= 0.55;       // stalactites
      if (Math.sin(th) > 0.7 && hash(k * 5 + jj) > 0.75) r *= 0.72;          // rubble
      const px = sx + Math.cos(th) * r * 1.35 * F / rel, py = sy + Math.sin(th) * r * F / rel;
      j === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
    const sc = F / rel / 520;
    const pat = ROCK_PATS[Math.round(clamp(lit * (0.8 + 0.3 * warm)) * 11)];
    pat.setTransform(new DOMMatrix().translateSelf(sx, sy).rotateSelf(k * 47).scaleSelf(sc, sc));
    c.fillStyle = pat; c.fill('evenodd');
    if (lit > 0.08) {
      c.strokeStyle = `rgba(255,${150 + 40 * warm | 0},80,${0.14 * lit})`;
      c.lineWidth = clamp(2.2 * F / rel / 110, 1, 9);
      c.stroke();
    }
  }
  // distant glow — something is alive down there
  c.globalCompositeOperation = 'lighter';
  { const [vx, vy] = path(zc + VIS); glow(c, (vx - camx) * F / VIS, (vy - camy) * F / VIS, 300, [60, 210, 190], 0.1 + 0.04 * Math.sin(t * 3)); }
  // dust streaks
  for (let i = 0; i < 140; i++) {
    const ang = hash(i * 1.7) * Math.PI * 2, rad = 0.3 + hash(i * 2.9) * 0.9;
    const zp = hash(i * 4.3) * VIS;
    const rel = ((zp - zc) % VIS + VIS) % VIS + 0.1;
    const x = Math.cos(ang) * rad * 1.3, y = Math.sin(ang) * rad;
    const vel = 3.5 + 6.4 * tau;
    const rel2 = rel + vel * 0.03;
    const a = clamp(1 - rel / VIS) * 0.8;
    c.strokeStyle = `rgba(255,210,160,${a})`;
    c.lineWidth = clamp(3 / rel, 0.5, 4);
    c.beginPath(); c.moveTo(x * F / rel, y * F / rel); c.lineTo(x * F / rel2, y * F / rel2); c.stroke();
  }
  c.restore();
  // torch light from camera
  c.save(); c.globalCompositeOperation = 'lighter';
  glow(c, W * 0.3, H * 0.95, 900, [255, 120, 40], 0.12 + 0.04 * fbm(t * 8));
  c.restore();
  // subliminal flash-frames of what waits below
  for (const [ft, key] of FLASHES) {
    if (t >= ft && t < ft + 0.085) {
      c.save(); c.globalAlpha = 0.9;
      drawBG(c, A[key], 1.1 + (t - ft) * 2, 0.5, 0.5);
      c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,240,220,0.18)'; c.fillRect(0, 0, W, H);
      c.restore();
    }
  }
  black(c, 1 - inv(21.2, 21.5, t));
});

// ═════════════════════════════════════════════════════════════
//  TITLE CARDS
// ═════════════════════════════════════════════════════════════
function card(c, t, t0, t1, small, big, o = {}) {
  c.fillStyle = '#050403'; c.fillRect(0, 0, W, H);
  const p = inv(t0, t1, t);
  fog(c, t, 0.35, 14);
  embers(c, t, { n: 40, y0: FRAME_BOT + 20, rise: 820, speed: 0.07, drift: 60, wind: 120, size: 2.6, a: 0.7, seed: 11 });
  const out = 1 - inv(t1 - 0.3, t1, t);
  c.save();
  c.translate(W / 2, H / 2); const s = 1 + 0.05 * p; c.scale(s, s); c.translate(-W / 2, -H / 2);
  const yS = o.ySmall || 455, yB = o.yBig || 630;
  textT(c, small, W / 2, yS, { size: 50, weight: 600, tracking: 22, fill: goldGrad(c, yS, 50), alpha: out, reveal: stagger(t, t0 + 0.05, 0.03, 0.6), shadow: 30, shadowColor: 'rgba(255,150,60,0.35)' });
  rule(c, W / 2, yS + 36, 900 * E.outExpo(inv(t0 + 0.2, t0 + 1.2, t)), [212, 168, 87], 0.7 * out);
  textT(c, big, W / 2, yB, { size: o.bigSize || 150, weight: 700, tracking: 10, fill: sz => goldGrad(c, yB, sz), alpha: out, reveal: stagger(t, t0 + 0.25, 0.045, 0.7), shadow: 40, shadowColor: 'rgba(255,140,40,0.35)', maxWidth: 1600 });
  c.restore();
}
scene(24.0, 27.0, (c, t) => card(c, t, 24.0, 27.0, 'EVERY DELVE', 'A NEW DARK'));
scene(42.0, 45.0, (c, t) => card(c, t, 42.0, 45.0, 'FOUR CALLINGS', 'WHO DESCENDS?'));

// ═════════════════════════════════════════════════════════════
//  THE DEPTHS — five biomes, one bar each (27 – 42)
// ═════════════════════════════════════════════════════════════
const BIOMES = [
  { img: 'fungal', num: 'II', name: 'FUNGAL DEPTHS', sub: 'The air grows thick with spores.', z: [1.04, 1.2], f: [[0.5, 0.45], [0.52, 0.42]], col: [90, 255, 210],
    fx(c, t, X) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const u = 0.36 + hash(i * 3.3) * 0.3, v = 0.28 + hash(i * 5.1) * 0.32;
        const [x, y] = X.map(u, v); const pu = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7);
        glow(c, x, y, (20 + hash(i) * 40) * X.k * 2, [80, 255, 200], 0.25 * pu);
      }
      c.restore();
      motes(c, t, { n: 90, col: [110, 255, 215], a: 0.55, size: 3.5, seed: 21, speed: 0.03 });
      glow(c, W / 2, H * 0.45, 700, [30, 120, 110], 0.08);
    } },
  { img: 'crystal', num: 'III', name: 'CRYSTAL CAVERNS', sub: 'Light refracts in dazzling patterns.', z: [1.18, 1.04], f: [[0.55, 0.42], [0.52, 0.45]], col: [190, 170, 255],
    fx(c, t, X) {
      c.save(); c.globalCompositeOperation = 'lighter';
      const [bx, by] = X.map(0.68, -0.05);
      for (let i = 0; i < 4; i++) {
        const sh = 0.05 + 0.03 * Math.sin(t * 1.3 + i * 2);
        c.save(); c.translate(bx, by); c.rotate(0.62 + i * 0.07 + Math.sin(t * 0.4 + i) * 0.02);
        const g = c.createLinearGradient(0, 0, 0, 1400); g.addColorStop(0, `rgba(200,210,255,${sh})`); g.addColorStop(1, 'rgba(200,210,255,0)');
        c.fillStyle = g; c.fillRect(-40 - i * 50, 0, 60 + i * 20, 1500); c.restore();
      }
      for (let i = 0; i < 30; i++) {
        const [x, y] = X.map(hash(i * 7.1), 0.1 + hash(i * 2.3) * 0.85);
        const tw = Math.pow(Math.max(0, Math.sin(t * (2 + hash(i) * 3) + i * 3)), 8);
        if (tw < 0.02) continue;
        const L = 34 * tw * X.k * 1.5;
        c.fillStyle = `rgba(235,230,255,${tw})`;
        c.fillRect(x - L, y - 1.5, L * 2, 3); c.fillRect(x - 1.5, y - L, 3, L * 2);
        glow(c, x, y, L * 1.3, [200, 180, 255], tw * 0.6);
      }
      c.restore();
      motes(c, t, { n: 40, col: [210, 200, 255], a: 0.35, size: 2, seed: 31, speed: 0.015 });
    } },
  { img: 'drowned', num: 'IV', name: 'DROWNED PASSAGES', sub: 'The air tastes of salt and rot.', z: [1.0, 1.14], f: [[0.5, 0.58], [0.5, 0.62]], col: [120, 230, 230],
    fx(c, t, X) {
      c.save(); c.globalCompositeOperation = 'lighter';
      const [wx, wy] = X.map(0.5, 0.745);
      for (let i = 0; i < 4; i++) {
        const ph = ((t * 0.9 + i * 0.25) % 1);
        c.strokeStyle = `rgba(160,255,250,${0.5 * (1 - ph)})`; c.lineWidth = 2.5;
        c.beginPath(); c.ellipse(wx, wy, 20 + ph * 260 * X.k, (6 + ph * 60) * X.k, 0, 0, Math.PI * 2); c.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const ph = (t * 1.3 + hash(i * 3.7)) % 1;
        const [x, y0] = X.map(0.47 + hash(i * 9.2) * 0.07, 0.05);
        const y = lerp(y0, wy, E.in2(ph));
        c.fillStyle = `rgba(170,255,250,${0.7})`; c.fillRect(x, y, 3, 12 + 18 * ph);
      }
      for (let i = 0; i < 26; i++) {
        const [x, y] = X.map(((hash(i * 2.2) + t * 0.02 * (hash(i) - 0.5)) % 1 + 1) % 1, 0.8 + hash(i * 4.1) * 0.18);
        const a = 0.5 + 0.5 * Math.sin(t * 3 + i);
        c.fillStyle = `rgba(140,240,240,${0.18 * a})`; c.fillRect(x - 40, y, 80 + hash(i) * 80, 3);
      }
      c.restore();
    } },
  { img: 'ossuary', num: 'V', name: 'OSSUARY HALLS', sub: 'Skulls stare from every surface.', z: [1.14, 1.0], f: [[0.5, 0.5], [0.5, 0.48]], col: [210, 255, 210],
    fx(c, t, X) {
      c.save(); c.globalCompositeOperation = 'lighter';
      const flames = [[0.254, 0.318], [0.269, 0.51], [0.298, 0.49], [0.331, 0.534], [0.858, 0.307], [0.753, 0.534], [0.782, 0.495], [0.814, 0.547], [0.587, 0.552]];
      flames.forEach(([u, v], i) => {
        const [x, y] = X.map(u, v); const f = 0.7 + 0.3 * fbm(t * 6 + i * 10);
        glow(c, x, y, 150 * X.k * 1.6, [170, 255, 170], 0.22 * f);
        glow(c, x, y, 40 * X.k * 1.6, [230, 255, 220], 0.4 * f);
      });
      c.restore();
      motes(c, t, { n: 60, col: [230, 220, 190], a: 0.22, size: 2, seed: 41, speed: 0.02 });
    } },
  { img: 'magma', num: 'VI', name: 'MAGMA RIFTS', sub: 'The stone itself radiates heat.', z: [1.02, 1.16], f: [[0.45, 0.5], [0.5, 0.45]], col: [255, 140, 50], haze: true,
    fx(c, t) {
      c.save(); c.globalCompositeOperation = 'lighter';
      glow(c, W * 0.5, H * 0.7, 1100, [255, 90, 20], 0.12 + 0.05 * Math.sin(t * 2.3));
      c.restore();
      embers(c, t, { n: 120, y0: FRAME_BOT + 20, rise: 900, speed: 0.22, drift: 70, wind: 60, size: 3.5, col: [255, 150, 60], seed: 51 });
    } },
];

BIOMES.forEach((b, i) => {
  const t0 = 27 + i * 3, t1 = t0 + 3;
  scene(t0, t1, (c, t) => {
    const p = inv(t0, t1, t);
    const img = A[b.img];
    const z = lerp(b.z[0], b.z[1], E.sine(p) * 0.3 + p * 0.7);
    const fx = lerp(b.f[0][0], b.f[1][0], p), fy = lerp(b.f[0][1], b.f[1][1], p);
    let X;
    if (b.haze) {
      X = bgXform(img, z, fx, fy);
      const strips = 60, sh = H / strips;
      for (let s = 0; s < strips; s++) {
        const y = s * sh;
        const off = Math.sin(y * 0.018 + t * 7) * 3 * (y / H);
        const sy = (y - X.dy) / X.ih * img.height, shh = sh / X.ih * img.height;
        c.drawImage(img, 0, sy, img.width, shh + 1, X.dx + off, y, X.iw, sh + 1);
      }
    } else X = drawBG(c, img, z, fx, fy);
    b.fx(c, t, X);
    // title block
    bottomShade(c, 520, 0.85);
    const tin = E.outExpo(inv(t0 + 0.12, t0 + 0.9, t)), tout = 1 - inv(t1 - 0.3, t1 - 0.02, t);
    const a = tin * tout, ox = (1 - tin) * -50;
    const x = 150 + ox;
    c.save(); c.globalAlpha = a;
    textT(c, `DEPTH ${b.num}`, x, 706, { size: 34, weight: 700, tracking: 16, align: 'left', fill: rgba(b.col.map(v => Math.min(255, v * 0.5 + 140)), 1), shadow: 22, shadowColor: rgba(b.col, 0.9) });
    textT(c, b.name, x - 4, 810, { size: 112, weight: 700, tracking: 6, align: 'left', fill: sz => goldGrad(c, 810, sz), reveal: stagger(t, t0 + 0.15, 0.025, 0.5), shadow: 30 });
    const rg = c.createLinearGradient(x, 0, x + 700, 0); rg.addColorStop(0, rgba(b.col, 0.8)); rg.addColorStop(1, rgba(b.col, 0));
    c.fillStyle = rg; c.fillRect(x, 838, 700 * E.outExpo(inv(t0 + 0.3, t0 + 1.2, t)), 2);
    textT(c, b.sub, x, 895, { font: 'Cormorant', style: 'italic', weight: 500, size: 46, align: 'left', fill: PARCH, alpha: inv(t0 + 0.5, t0 + 1.0, t), shadow: 12 });
    c.restore();
  });
});

// ═════════════════════════════════════════════════════════════
//  THE DELVERS — four classes (45 – 57), lineup (57 – 60)
// ═════════════════════════════════════════════════════════════
const CHARS = [
  { img: 'templar', name: 'TEMPLAR', tag: 'HOLD THE LINE', col: [255, 200, 110],
    desc: 'A plated bulwark who pulls fire and holds the line.', ab: ['NULL WARD', 'BANNER PULSE'] },
  { img: 'phaseknife', name: 'PHASEKNIFE', tag: 'STRIKE FROM NOWHERE', col: [100, 240, 225],
    desc: 'A blink-footed killer who slips in, opens a throat, and is gone.', ab: ['PHASE STRIKE', 'GLEAN'] },
  { img: 'suturist', name: 'SUTURIST', tag: 'KEEP THEM BREATHING', col: [255, 110, 85],
    desc: 'A field surgeon who knits flesh and keeps the dying upright.', ab: ['SUTURE', 'CRASH GRAFT', 'BONE SPIKE'] },
  { img: 'junk', name: 'JUNK PROPHET', tag: 'BREAK THEIR NERVE', col: [255, 165, 80],
    desc: 'A ragged tinkerer whose scrap tools break enemy nerve.', ab: ['STATIC HYMN', 'SCRAP VOLLEY', 'RELIQUARY DRONE'] },
];

function slashWipe(c, t, t0, col) {
  const p = inv(t0, t0 + 0.28, t);
  if (p <= 0 || p >= 1) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  const x = lerp(-600, W + 600, E.out3(p));
  c.translate(x, H / 2); c.rotate(0.35);
  const g = c.createLinearGradient(-120, 0, 120, 0);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, `rgba(255,255,255,${0.9 * (1 - p)})`); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.fillRect(-120, -1400, 240, 2800);
  c.restore();
}

function lightShafts(c, t, col, a) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    c.save(); c.translate(300 + i * 260 + Math.sin(t * 0.3 + i) * 30, FRAME_TOP - 40); c.rotate(0.28 - i * 0.03);
    const g = c.createLinearGradient(0, 0, 0, 1100);
    g.addColorStop(0, rgba(col, a * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.3)))); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.fillRect(-30 - i * 8, 0, 60 + i * 16, 1100); c.restore();
  }
  c.restore();
}

CHARS.forEach((ch, i) => {
  const t0 = 45 + i * 3, t1 = t0 + 3;
  scene(t0, t1, (c, t) => {
    const p = inv(t0, t1, t);
    c.fillStyle = '#040303'; c.fillRect(0, 0, W, H);
    const bgG = c.createRadialGradient(560, 520, 0, 560, 520, 1000);
    bgG.addColorStop(0, rgba(ch.col.map(v => v * 0.35), 1)); bgG.addColorStop(0.45, rgba(ch.col.map(v => v * 0.08), 1)); bgG.addColorStop(1, '#030202');
    c.fillStyle = bgG; c.fillRect(0, 0, W, H);
    fog(c, t + i * 20, 0.28, 30);
    lightShafts(c, t, ch.col, 0.05);
    // portrait
    const pin = E.outExpo(inv(t0, t0 + 0.7, t));
    const sc = 4.7 * (1.04 - 0.04 * pin + 0.03 * p);
    const pw = 112 * sc, ph = 168 * sc;
    const px = 560 - pw / 2 + (1 - pin) * 140, py = 555 - ph / 2;
    c.save(); c.globalAlpha = inv(t0, t0 + 0.2, t);
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.75 * (0.85 + 0.15 * Math.sin(t * 3));
    drawGlow(c, GLOW[ch.img], px, py, pw); c.restore();
    c.drawImage(A[ch.img + '_fade'], px, py, pw, ph);
    c.restore();
    motes(c, t, { n: 45, col: ch.col, a: 0.4, size: 2.6, seed: 60 + i, speed: 0.03 });
    // text block
    const x = 1010;
    textT(c, ch.tag, x, 390, { size: 30, weight: 600, tracking: 12, align: 'left', fill: rgba(ch.col, 1), alpha: inv(t0 + 0.12, t0 + 0.4, t), shadow: 16, shadowColor: rgba(ch.col, 0.6) });
    textT(c, ch.name, x - 6, 525, { size: 150, weight: 700, tracking: 4, align: 'left', fill: sz => goldGrad(c, 525, sz, ch.col), reveal: stagger(t, t0 + 0.2, 0.035, 0.55), shadow: 40, shadowColor: rgba(ch.col, 0.35), maxWidth: 820 });
    const rg = c.createLinearGradient(x, 0, x + 780, 0); rg.addColorStop(0, rgba(ch.col, 0.9)); rg.addColorStop(1, rgba(ch.col, 0));
    c.fillStyle = rg; c.fillRect(x, 560, 780 * E.outExpo(inv(t0 + 0.35, t0 + 1.2, t)), 2);
    c.save();
    c.font = 'italic 500 50px Cormorant';
    const lines = wrapLines(c, ch.desc, 790);
    lines.forEach((ln, k) => textT(c, ln, x, 630 + k * 56, { font: 'Cormorant', style: 'italic', weight: 500, size: 50, align: 'left', fill: PARCH, alpha: inv(t0 + 0.5 + k * 0.1, t0 + 0.9 + k * 0.1, t), shadow: 10 }));
    c.restore();
    let ax = x;
    const ay = 630 + lines.length * 56 + 40;
    ch.ab.forEach((ab, k) => {
      const a = E.out3(inv(t0 + 0.8 + k * 0.14, t0 + 1.1 + k * 0.14, t));
      c.save(); c.globalAlpha = a;
      c.font = '38px VT323';
      const w = c.measureText(ab).width + 36;
      c.fillStyle = rgba(ch.col, 0.12); c.fillRect(ax, ay + (1 - a) * 14, w, 52);
      c.strokeStyle = rgba(ch.col, 0.85); c.lineWidth = 1.5; c.strokeRect(ax + 0.5, ay + 0.5 + (1 - a) * 14, w, 52);
      c.fillStyle = '#f4ead4'; c.textBaseline = 'middle'; c.shadowColor = rgba(ch.col, 0.6); c.shadowBlur = 10;
      c.fillText(ab, ax + 18, ay + 28 + (1 - a) * 14);
      c.restore();
      ax += w + 18;
    });
    slashWipe(c, t, t0, ch.col);
  });
});

scene(57, 60, (c, t) => {
  const p = inv(57, 60, t);
  c.fillStyle = '#040303'; c.fillRect(0, 0, W, H);
  fog(c, t, 0.3, 20);
  c.save(); c.translate(W / 2, H / 2); const s = 1 + 0.045 * E.sine(p); c.scale(s, s); c.translate(-W / 2, -H / 2);
  const sc = 3.25, pw = 112 * sc, ph = 168 * sc;
  CHARS.forEach((ch, i) => {
    const lit = E.out3(inv(57 + i * 0.18, 57 + i * 0.18 + 0.35, t));
    const cx = 390 + i * 380, py = 545 - ph / 2;
    c.save(); c.globalCompositeOperation = 'lighter';
    glow(c, cx, 520, 420, ch.col, 0.14 * lit);
    c.globalAlpha = 0.7 * lit; drawGlow(c, GLOW[ch.img], cx - pw / 2, py, pw);
    c.restore();
    c.save(); c.filter = `brightness(${0.08 + 0.92 * lit})`;
    c.drawImage(A[ch.img + '_fade'], cx - pw / 2, py, pw, ph);
    c.restore();
  });
  c.restore();
  motes(c, t, { n: 50, col: [255, 210, 150], a: 0.3, seed: 70, speed: 0.03 });
  textT(c, 'CO-OP FOR 1–4 PLAYERS', W / 2, 225, { size: 36, weight: 600, tracking: 16, fill: goldGrad(c, 225, 36), reveal: stagger(t, 57.3, 0.02, 0.5), shadow: 20 });
  textT(c, 'ONE SHARED DARK', W / 2, 915, { size: 72, weight: 700, tracking: 10, fill: sz => goldGrad(c, 915, sz), reveal: stagger(t, 57.8, 0.04, 0.6), shadow: 30, shadowColor: 'rgba(255,140,40,0.4)' });
  black(c, E.in2(inv(59.75, 60, t)) * 0.6);
});

// ═════════════════════════════════════════════════════════════
//  MONTAGE — the game in motion (60 – 72), a cut every 1.5 s
// ═════════════════════════════════════════════════════════════
function panel(c, x, y, w, h, border = GOLD) {
  c.fillStyle = 'rgba(10,8,6,0.93)'; c.fillRect(x, y, w, h);
  c.strokeStyle = border; c.lineWidth = 2; c.strokeRect(x, y, w, h);
  c.strokeStyle = '#3d3122'; c.lineWidth = 1; c.strokeRect(x + 6, y + 6, w - 12, h - 12);
}
function vtLine(c, str, x, y, col, size = 48, glowA = 0.45, align = 'left') {
  c.font = `${size}px VT323`; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.shadowColor = col; c.shadowBlur = 12 * glowA; c.fillText(str, x, y); c.shadowBlur = 0;
}

// 60.0 — combat log
scene(60, 61.5, (c, t) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  drawBG(c, A.fungal, 1.3, 0.5, 0.5);
  black(c, 0.72);
  c.save(); c.translate(W / 2, H / 2); const s = 1.0 + 0.05 * inv(60, 61.5, t); c.scale(s, s); c.translate(-W / 2, -H / 2);
  panel(c, 300, 250, 1320, 580);
  vtLine(c, 'COMBAT ── ROUND 3', 340, 310, GOLD, 40);
  c.fillStyle = '#3d3122'; c.fillRect(330, 330, 1260, 2);
  vtLine(c, 'CAVE TROLL', 1460, 310, '#e8dcc0', 40, 0.45, 'right');
  skull(c, 1480, 284, 3.2, '#ff5544'); skull(c, 1520, 284, 3.2, '#ff5544');
  const l1 = typed('log1', t), l2 = typed('log2', t), l3 = typed('log3', t);
  vtLine(c, '> ' + l1, 340, 410, LOG.narration, 54);
  if (l2) vtLine(c, '> ' + l2, 340, 490, LOG.chat, 54);
  if (l3) vtLine(c, '> ' + l3 + cursor(t), 340, 570, LOG.combat, 54);
  // HP bars
  const hp = [['TEMPLAR', 0.82], ['PHASEKNIFE', 0.64], ['SUTURIST', 0.9]];
  hp.forEach(([n, v], k) => {
    const y = 660 + k * 50;
    vtLine(c, n, 340, y + 28, '#c8b89a', 36, 0.2);
    c.fillStyle = '#1c1510'; c.fillRect(560, y + 6, 420, 24);
    c.fillStyle = v > 0.7 ? '#6a9a3a' : '#b0902a'; c.fillRect(560, y + 6, 420 * v, 24);
  });
  // cave troll HP dropping on the strike
  const trollHp = lerp(0.78, 0.41, E.out3(inv(61.1, 61.35, t)));
  vtLine(c, 'TROLL', 1060, 688, '#ff7766', 36, 0.2);
  c.fillStyle = '#1c1510'; c.fillRect(1160, 666, 420, 24);
  c.fillStyle = '#b8352a'; c.fillRect(1160, 666, 420 * trollHp, 24);
  c.restore();
});

function monsterShot(c, t, t0, o) {
  const t1 = t0 + 1.5, p = inv(t0, t1, t);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  drawBG(c, A[o.bg], lerp(1.25, 1.35, p), o.bf[0], o.bf[1]);
  black(c, 0.55);
  const vg = c.createRadialGradient(W / 2, 520, 100, W / 2, 520, 1000);
  vg.addColorStop(0, rgba(o.col, 0.18)); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
  // monster slams in
  const slam = E.outExpo(inv(t0, t0 + 0.35, t));
  const sc = (o.scale || 3.5) * lerp(1.35, 1, slam) * (1 + 0.04 * p);
  const img = A[o.img], sw = img.width / 6 * sc, sh = img.height / 6 * sc;
  const mx = W / 2 - sw / 2, my = (o.floor || 700) - sh;
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.3 * slam; drawGlow(c, GLOW[o.img], mx, my, sw); c.restore();
  c.save(); c.globalAlpha = inv(t0, t0 + 0.08, t); c.drawImage(img, mx, my, sw, sh); c.restore();
  if (o.eyes) { c.save(); c.globalCompositeOperation = 'lighter'; o.eyes.forEach(([u, v]) => glow(c, mx + u * sw, my + v * sh, 40, o.eyeCol || o.col, 0.6 * (0.7 + 0.3 * Math.sin(t * 12)))); c.restore(); }
  if (o.fx) o.fx(c, t);
  bottomShade(c, 640, 0.9);
  // threat rating
  const n = o.skulls || 3;
  for (let k = 0; k < n; k++) {
    const st = t0 + 0.15 + k * 0.16;
    const a = E.out3(inv(st, st + 0.12, t));
    if (a <= 0) continue;
    const ss = lerp(2.2, 1, E.outBack(inv(st, st + 0.2, t)));
    const px = 9 * ss, size = 9 * px;
    const cx = W / 2 + (k - (n - 1) / 2) * 110;
    c.save(); c.globalCompositeOperation = 'lighter'; glow(c, cx, 742, 70, [255, 60, 40], 0.35 * a); c.restore();
    skull(c, cx - size / 2, 742 - size / 2, px, '#efe3c8', a);
  }
  textT(c, o.name, W / 2, 880, { size: 96, weight: 700, tracking: 8, maxWidth: 1400, fill: sz => goldGrad(c, 880, sz), reveal: stagger(t, t0 + 0.1, 0.02, 0.35), shadow: 30, shadowColor: 'rgba(0,0,0,0.9)' });
  textT(c, 'PARTY RECOMMENDED', W / 2, 922, { font: 'VT323', weight: 400, size: 38, tracking: 8, fill: '#ff5544', alpha: inv(t0 + 0.5, t0 + 0.7, t), shadow: 14, shadowColor: 'rgba(255,60,40,0.6)' });
}

scene(61.5, 63.0, (c, t) => monsterShot(c, t, 61.5, { img: 'ratking', bg: 'cave', bf: [0.62, 0.55], col: [255, 60, 50], name: 'THE RAT KING', scale: 3.4, floor: 705,
  fx: (c, t) => embers(c, t, { n: 30, size: 2, col: [255, 90, 70], a: 0.5, seed: 81, speed: 0.1 }) }));

// 63.0 — attack timing QTE (faithful to QTE_CONFIG zones)
scene(63.0, 64.5, (c, t) => {
  c.fillStyle = '#050403'; c.fillRect(0, 0, W, H);
  drawBG(c, A.ossuary, 1.4, 0.5, 0.5); black(c, 0.8);
  const bx = 360, by = 560, bw = 1200, bh = 64;
  const zones = [[0, 0.45, '#3a2f22'], [0.45, 0.65, '#3f6b2f'], [0.65, 0.72, '#e0b45a'], [0.72, 0.82, '#3f6b2f'], [0.82, 1, '#3a2f22']];
  const hit = 63.9, locked = t >= hit;
  const mk = locked ? 0.685 : E.in2(inv(63.0, hit, t)) * 0.685;
  const shake = locked ? Math.exp(-(t - hit) * 10) * 8 : 0;
  c.save(); c.translate(Math.sin(t * 90) * shake, 0);
  vtLine(c, 'ATTACK', bx, by - 40, GOLD, 48);
  vtLine(c, 'PHASEKNIFE → GRAVE WARDEN', bx + bw, by - 40, '#c8b89a', 40, 0.2, 'right');
  c.fillStyle = '#0c0907'; c.fillRect(bx - 8, by - 8, bw + 16, bh + 16);
  zones.forEach(([a, b, col]) => { c.fillStyle = col; c.fillRect(bx + a * bw, by, (b - a) * bw, bh); });
  c.strokeStyle = GOLD; c.lineWidth = 2; c.strokeRect(bx - 8, by - 8, bw + 16, bh + 16);
  const mx = bx + mk * bw;
  c.save(); c.globalCompositeOperation = 'lighter'; glow(c, mx, by + bh / 2, 90, [255, 240, 200], 0.5); c.restore();
  c.fillStyle = '#fffbe8'; c.fillRect(mx - 4, by - 22, 8, bh + 44);
  c.restore();
  if (locked) {
    const k = E.outBack(inv(hit, hit + 0.25, t));
    c.save(); c.globalCompositeOperation = 'lighter';
    glow(c, bx + 0.685 * bw, by + bh / 2, 600, [255, 200, 90], 0.5 * Math.exp(-(t - hit) * 3));
    c.restore();
    textT(c, 'PERFECT', W / 2, 430, { size: 150 * (0.6 + 0.4 * k), weight: 700, tracking: 12, fill: sz => goldGrad(c, 430, sz), shadow: 50, shadowColor: 'rgba(255,170,60,0.7)' });
    textT(c, '×2.0 CRITICAL', W / 2, 760, { font: 'VT323', weight: 400, size: 64, tracking: 6, fill: '#ffd700', alpha: inv(hit + 0.1, hit + 0.25, t), shadow: 16, shadowColor: 'rgba(255,215,0,0.6)' });
    const dmgY = 880 - E.out3(inv(hit + 0.1, hit + 0.8, t)) * 60;
    textT(c, '46', W / 2, dmgY, { font: 'VT323', weight: 400, size: 110, fill: '#ff4444', alpha: inv(hit + 0.1, hit + 0.2, t) * (1 - inv(64.3, 64.5, t)), shadow: 20, shadowColor: 'rgba(255,40,40,0.8)' });
    // blade slash
    const sp = inv(hit, hit + 0.18, t);
    if (sp < 1) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.translate(W / 2, H / 2); c.rotate(-0.42);
      const L = 2200 * E.out3(sp);
      const g = c.createLinearGradient(-L / 2, 0, L / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, `rgba(255,250,230,${1 - sp})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(-L / 2, -5, L, 10); c.restore();
    }
  }
});

scene(64.5, 66.0, (c, t) => monsterShot(c, t, 64.5, { img: 'charnel', bg: 'ossuary', bf: [0.5, 0.5], col: [120, 170, 255], name: 'THE CHARNEL KING', scale: 3.5, floor: 710,
  eyes: [[0.44, 0.24], [0.54, 0.24]], eyeCol: [110, 170, 255],
  fx: (c, t) => motes(c, t, { n: 40, col: [140, 190, 255], a: 0.4, seed: 91 }) }));

// 66.0 — legendary drop, need / greed / pass
scene(66.0, 67.5, (c, t) => {
  c.fillStyle = '#050302'; c.fillRect(0, 0, W, H);
  const p = inv(66, 67.5, t);
  c.save(); c.globalCompositeOperation = 'lighter'; c.translate(W / 2, 470); c.rotate(t * 0.35);
  for (let i = 0; i < 16; i++) {
    c.rotate(Math.PI * 2 / 16);
    const g = c.createLinearGradient(0, 0, 0, 1100); g.addColorStop(0, 'rgba(255,150,60,0.16)'); g.addColorStop(1, 'rgba(255,150,60,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.lineTo(-55 - (i % 2) * 40, 1100); c.lineTo(55 + (i % 2) * 40, 1100); c.fill();
  }
  c.restore();
  c.save(); c.globalCompositeOperation = 'lighter'; glow(c, W / 2, 470, 700, [255, 130, 40], 0.3); c.restore();
  embers(c, t, { n: 80, x0: 500, x1: 1420, y0: 900, rise: 700, speed: 0.3, size: 3, col: [255, 190, 90], seed: 101 });
  const k = E.outBack(inv(66, 66.35, t));
  c.save(); c.translate(W / 2, 480); const s = (0.75 + 0.25 * k) * (1 + 0.03 * p); c.scale(s, s); c.translate(-W / 2, -480);
  const cw = 900, chh = 400, cx = W / 2 - cw / 2, cy = 270;
  panel(c, cx, cy, cw, chh, LEGEND);
  c.save(); c.shadowColor = 'rgba(232,135,58,0.8)'; c.shadowBlur = 40; c.strokeStyle = LEGEND; c.lineWidth = 3; c.strokeRect(cx, cy, cw, chh); c.restore();
  textT(c, 'LEGENDARY WEAPON', W / 2, cy + 70, { font: 'VT323', weight: 400, size: 40, tracking: 10, fill: LEGEND, shadow: 12, shadowColor: 'rgba(232,135,58,0.7)' });
  textT(c, 'WORLDSPLITTER', W / 2, cy + 175, { size: 96, weight: 700, tracking: 6, fill: sz => { const g = c.createLinearGradient(0, cy + 100, 0, cy + 185); g.addColorStop(0, '#fff0c0'); g.addColorStop(0.5, '#ffb04a'); g.addColorStop(1, '#b3561c'); return g; }, reveal: stagger(t, 66.1, 0.03, 0.3), shadow: 30, shadowColor: 'rgba(255,120,30,0.6)' });
  c.font = 'italic 500 40px Cormorant';
  wrapLines(c, 'An ancient blade that hums with barely contained power. Each swing tears the air itself.', 780)
    .forEach((ln, i) => textT(c, ln, W / 2, cy + 250 + i * 44, { font: 'Cormorant', style: 'italic', weight: 500, size: 40, fill: PARCH, alpha: inv(66.3, 66.5, t) }));
  // need / greed / pass
  const btns = ['NEED', 'GREED', 'PASS'];
  btns.forEach((b, i) => {
    const bw = 220, bx = W / 2 - 360 + i * 250, byy = cy + chh + 50;
    const sel = i === 0 && t > 66.85;
    const a = inv(66.4 + i * 0.07, 66.55 + i * 0.07, t);
    c.save(); c.globalAlpha = a;
    c.fillStyle = sel ? '#5a3a14' : '#2a2218'; c.fillRect(bx, byy, bw, 72);
    c.strokeStyle = sel ? '#ffcf7a' : GOLD; c.lineWidth = sel ? 3 : 1.5; c.strokeRect(bx, byy, bw, 72);
    if (sel) { c.shadowColor = 'rgba(255,200,100,0.8)'; c.shadowBlur = 30; c.strokeRect(bx, byy, bw, 72); }
    c.restore();
    textT(c, b, bx + bw / 2, byy + 50, { font: 'VT323', weight: 400, size: 48, tracking: 4, fill: sel ? '#fff1c8' : GOLD, alpha: a });
  });
  c.restore();
});

scene(67.5, 69.0, (c, t) => monsterShot(c, t, 67.5, { img: 'titan', bg: 'magma', bf: [0.5, 0.45], col: [255, 110, 30], name: 'THE FORGE TITAN', scale: 3.5, floor: 710,
  eyes: [[0.44, 0.17], [0.54, 0.17]], eyeCol: [255, 140, 40],
  fx: (c, t) => embers(c, t, { n: 90, y0: FRAME_BOT, rise: 800, speed: 0.3, size: 3.5, col: [255, 140, 50], seed: 111 }) }));

// 69.0 — downed and sutured back
scene(69.0, 70.5, (c, t) => {
  c.fillStyle = '#060303'; c.fillRect(0, 0, W, H);
  const healed = t > 69.95;
  const pulse = healed ? 0 : 0.5 + 0.5 * Math.sin(t * 14);
  const vg = c.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 1100);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, healed ? 'rgba(20,90,70,0.55)' : `rgba(150,10,10,${0.4 + 0.25 * pulse})`);
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
  const sc = 3.3, pw = 112 * sc, ph = 168 * sc;
  // templar (left)
  c.save(); c.filter = healed ? 'none' : 'grayscale(1) brightness(0.55)';
  c.drawImage(A.templar_fade, 330, 560 - ph / 2, pw, ph); c.restore();
  // suturist (right)
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = inv(69.6, 69.8, t) * 0.8; drawGlow(c, GLOW.suturist, W - 330 - pw, 560 - ph / 2, pw); c.restore();
  c.save(); c.globalAlpha = 0.4 + 0.6 * inv(69.5, 69.7, t); c.drawImage(A.suturist_fade, W - 330 - pw, 560 - ph / 2, pw, ph); c.restore();
  const fade = c.createLinearGradient(0, 560 + ph / 2 - 160, 0, 560 + ph / 2);
  fade.addColorStop(0, 'rgba(6,3,3,0)'); fade.addColorStop(1, 'rgba(6,3,3,1)');
  c.fillStyle = fade; c.fillRect(0, 560 + ph / 2 - 160, W, 162);
  // HP bar
  const hp = healed ? lerp(0, 0.3, E.out3(inv(69.95, 70.25, t))) : lerp(0.18, 0, E.in2(inv(69.0, 69.3, t)));
  const bx = 760, by = 520, bw = 400;
  vtLine(c, 'TEMPLAR', bx, by - 16, '#e8dcc0', 44, 0.2);
  vtLine(c, `${Math.round(hp * 50)}/50`, bx + bw - 90, by - 16, healed ? '#77ffcc' : '#ff4444', 44, 0.4);
  c.fillStyle = '#1c1510'; c.fillRect(bx, by, bw, 30);
  c.fillStyle = healed ? '#40d0a0' : '#c02a20'; c.fillRect(bx, by, bw * hp, 30);
  c.strokeStyle = '#3d3122'; c.strokeRect(bx, by, bw, 30);
  const d1 = typed('down1', t), d2 = typed('down2', t);
  textT(c, d1, W / 2, 660, { font: 'VT323', weight: 400, size: 60, tracking: 4, fill: LOG.combat, shadow: 16, shadowColor: 'rgba(255,40,40,0.7)' });
  if (d2) textT(c, d2, W / 2, 730, { font: 'VT323', weight: 400, size: 60, tracking: 4, fill: '#77ffcc', shadow: 16, shadowColor: 'rgba(80,255,190,0.7)' });
  if (healed) {
    const hp2 = inv(69.95, 70.5, t);
    c.save(); c.globalCompositeOperation = 'lighter';
    glow(c, 330 + pw / 2, 560, 500 * E.out3(hp2), [80, 255, 190], 0.5 * (1 - hp2));
    c.restore();
    motes(c, t, { n: 40, col: [110, 255, 200], a: 0.6 * (1 - hp2), size: 3, seed: 121, area: [300, 300, 500, 500], speed: 0.2 });
  }
});

scene(70.5, 72.0, (c, t) => {
  monsterShot(c, t, 70.5, { img: 'leviathan', bg: 'drowned', bf: [0.5, 0.6], col: [60, 220, 200], name: 'THE DROWNED LEVIATHAN', scale: 3.6, floor: 715,
    fx: (c, t) => motes(c, t, { n: 40, col: [120, 255, 230], a: 0.4, seed: 131, speed: 0.05 }) });
  black(c, E.in3(inv(71.3, 71.97, t)) * 0.85);
});

// ═════════════════════════════════════════════════════════════
//  THE KING — boss reveal (72 – 84)
// ═════════════════════════════════════════════════════════════
scene(72.0, 84.0, (c, t) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  if (t >= 83.88) return;
  const reveal = E.in2(inv(75.6, 78.0, t));          // pre-hit creep of light
  const lit = t >= 78 ? 1 : 0;
  const after = inv(78, 84, t);
  // throne room
  if (t > 75.5) {
    const X = drawBG(c, A.throne, lerp(1.05, 1.18, inv(75.5, 84, t)), 0.5, 0.45);
    black(c, 1 - (0.25 * reveal + 0.6 * lit * (0.85 + 0.15 * Math.sin(t * 2))));
  }
  // spores
  const sporeA = 0.15 + 0.4 * inv(72, 78, t) + 0.3 * lit;
  motes(c, t, { n: 110, col: [90, 255, 220], a: sporeA, size: 3, seed: 141, speed: 0.025 });
  // king
  const kImg = A.king;
  const kH = lerp(780, 860, E.out3(after)) + reveal * 20;
  const kW = kH * kImg.width / kImg.height;
  const kx = W / 2 - kW / 2, ky = 985 - kH + (1 - lit) * 20;
  const bright = lit ? 0.35 + 0.65 * Math.min(1, 0.6 + 0.4 * E.out3(after)) : 0.03 + 0.2 * reveal;
  if (t > 74.6) {
    c.save(); c.globalCompositeOperation = 'lighter';
    c.globalAlpha = (lit ? 0.5 : 0.22 * reveal) * (0.8 + 0.2 * Math.sin(t * 2.4));
    drawGlow(c, GLOW.king, kx, ky, kW);
    c.restore();
    c.save(); c.filter = `brightness(${bright})`; c.drawImage(kImg, kx, ky, kW, kH); c.restore();
  }
  // eyes open at 75
  if (t >= 75) {
    const eo = E.outExpo(inv(75, 75.4, t));
    const flick = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 5);
    c.save(); c.globalCompositeOperation = 'lighter';
    [[0.4766, 0.3047], [0.5219, 0.3047]].forEach(([u, v]) => {
      const x = kx + u * kW, y = ky + v * kH;
      glow(c, x, y, 110 * eo, [80, 255, 230], 0.4 * flick);
      glow(c, x, y, 26 * eo, [220, 255, 250], 0.95 * flick);
      c.fillStyle = `rgba(230,255,250,${eo})`; c.fillRect(x - 10 * eo, y - 3, 20 * eo, 6);
    });
    c.restore();
  }
  // spore burst at the hit
  if (t >= 78) {
    const b = inv(78, 80.5, t);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 120; i++) {
      const ang = hash(i * 3.3) * Math.PI * 2, sp = 300 + hash(i * 1.9) * 900;
      const d = E.out3(b) * sp;
      const x = W / 2 + Math.cos(ang) * d, y = 520 + Math.sin(ang) * d * 0.6;
      const a = (1 - b) * 0.8;
      c.fillStyle = `rgba(120,255,225,${a})`; c.fillRect(x, y, 3 + hash(i) * 3, 3 + hash(i) * 3);
    }
    glow(c, W / 2, 520, 900, [60, 220, 190], 0.35 * Math.exp(-(t - 78) * 1.5));
    c.restore();
  }
  // boss title (typed, system colour)
  const bt = typed('boss', t);
  if (bt && t < 75.2) textT(c, bt + (t < 74.6 ? cursor(t) : ''), W / 2, 560, { font: 'VT323', weight: 400, size: 56, tracking: 10, fill: '#7fa3a3', alpha: 1 - inv(74.7, 75.1, t), shadow: 14, shadowColor: 'rgba(90,200,200,0.5)' });
  if (t > 78) bottomShade(c, 600, 0.85);
  // taglines
  const tg1 = t >= 79.5 && t < 81.8, tg2 = t >= 81.8;
  if (tg1) textT(c, 'DESCEND TOGETHER.', W / 2, 890, { size: 104, weight: 700, tracking: 12, fill: sz => goldGrad(c, 890, sz), reveal: stagger(t, 79.5, 0.03, 0.4), shadow: 40, shadowColor: 'rgba(0,0,0,0.9)' });
  if (tg2) textT(c, 'OR FALL TOGETHER.', W / 2, 890, { size: 104, weight: 700, tracking: 12, fill: sz => goldGrad(c, 890, sz, [120, 255, 225]), reveal: stagger(t, 81.8, 0.03, 0.4), shadow: 40, shadowColor: 'rgba(0,0,0,0.9)', alpha: 1 - inv(83.5, 83.85, t) });
});

// ═════════════════════════════════════════════════════════════
//  LOGO (84 – 96.5)
// ═════════════════════════════════════════════════════════════
let LOGO_FX = null;
scene(84.0, DURATION, (c, t) => {
  c.fillStyle = '#030202'; c.fillRect(0, 0, W, H);
  const p = inv(84, 96, t);
  fog(c, t, 0.22, 10);
  const fl = 0.8 + 0.2 * fbm(t * 4);
  c.save(); c.globalCompositeOperation = 'lighter';
  glow(c, W / 2, 700, 900, [255, 110, 30], 0.14 * fl);
  c.restore();
  embers(c, t, { n: 110, y0: FRAME_BOT + 30, rise: 900, speed: 0.08, drift: 80, wind: 60, size: 3, seed: 151 });
  const inE = E.outExpo(inv(84, 85.4, t));
  const lw = 1320 * lerp(1.1, 1, inE) * (1 + 0.025 * p), lh = lw * A.logo.height / A.logo.width;
  const lx = W / 2 - lw / 2, ly = 450 - lh / 2;
  // glow halo
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 * fl * inE; drawGlow(c, GLOW.logo, lx, ly, lw); c.restore();
  c.save(); c.filter = `brightness(${lerp(3, 1, E.out3(inv(84, 84.9, t)))})`; c.globalAlpha = inv(84, 84.05, t);
  c.drawImage(A.logo, lx, ly, lw, lh); c.restore();
  // light sweep
  const sp = inv(85.2, 86.6, t);
  if (sp > 0 && sp < 1) {
    if (!LOGO_FX) LOGO_FX = makeCanvas(1600, 520);
    const x = LOGO_FX.getContext('2d');
    const fw = LOGO_FX.width, fh = fw * A.logo.height / A.logo.width;
    x.clearRect(0, 0, fw, LOGO_FX.height);
    x.globalCompositeOperation = 'source-over'; x.drawImage(A.logo, 0, 0, fw, fh);
    x.globalCompositeOperation = 'source-in';
    const bx = lerp(-300, fw + 300, E.inOut(sp));
    const g = x.createLinearGradient(bx - 160, 0, bx + 160, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,250,230,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, fw, fh);
    c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(LOGO_FX, 0, 0, fw, fh, lx, ly, lw, lh); c.restore();
  }
  textT(c, 'A CO-OPERATIVE DUNGEON CRAWLER FOR 1–4 PLAYERS', W / 2, 745, { size: 36, weight: 600, tracking: 12, fill: PARCH, reveal: stagger(t, 86.8, 0.018, 0.6), shadow: 18, maxWidth: 1500 });
  rule(c, W / 2, 775, 1000 * E.outExpo(inv(87.2, 88.4, t)), [212, 168, 87], 0.6);
  const e = typed('end', t);
  if (e) {
    c.font = '54px VT323';
    const fullW = c.measureText(TYPED.end.text).width;
    vtLine(c, e + cursor(t), W / 2 - fullW / 2, 850, GOLD, 54, 0.8);
  }
  black(c, E.in2(inv(94.4, 96.3, t)));
});
