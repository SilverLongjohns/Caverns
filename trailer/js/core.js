'use strict';
// ─────────────────────────────────────────────────────────────
//  CAVERNS — trailer core: constants, math, timeline data, assets
// ─────────────────────────────────────────────────────────────

const W = 1920, H = 1080;
const DURATION = 96.5;
const LB = 138;                       // letterbox bar height (2.39:1)
const FRAME_TOP = LB, FRAME_BOT = H - LB;

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, x) => (b === a ? (x >= a ? 1 : 0) : clamp((x - a) / (b - a)));
const E = {
  in2: t => t * t,
  out2: t => 1 - (1 - t) * (1 - t),
  in3: t => t * t * t,
  out3: t => 1 - Math.pow(1 - t, 3),
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  sine: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
};

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }
function vnoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
function fbm(x) { return vnoise(x) * 0.5 + vnoise(x * 2.13 + 17) * 0.3 + vnoise(x * 4.7 + 41) * 0.2; }

// Fade-in over `a`, hold, fade-out over `b`, inside [t0, t1].
function win(t, t0, t1, a = 0.3, b = 0.3) {
  return Math.max(0, Math.min(inv(t0, t0 + a, t), 1 - inv(t1 - b, t1, t)));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Typed text: shared by the picture (what's visible) and the score (key clicks) ──
const TYPED = {
  open1:  { t: 1.2,  cps: 15, voice: 'key',  text: 'DAYLIGHT FADES BEHIND YOU.' },
  open2:  { t: 3.4,  cps: 19, voice: 'key',  text: 'The darkness below is not yet absolute.' },
  shop1:  { t: 11.3, cps: 22, voice: 'blip', text: 'Another sump for the deep.' },
  shop2:  { t: 12.9, cps: 24, voice: 'blip', text: "Coin up front. The dead don't pay." },
  log1:   { t: 60.05, cps: 75, voice: 'key', text: 'The Cave Troll lunges from the dark.' },
  log2:   { t: 60.6, cps: 60, voice: 'key',  text: 'Templar raises NULL WARD.' },
  log3:   { t: 61.0, cps: 90, voice: 'key',  text: 'Phaseknife flanks. PHASE STRIKE: 23 damage.' },
  down1:  { t: 69.05, cps: 45, voice: 'key', text: 'TEMPLAR IS DOWNED.' },
  down2:  { t: 69.65, cps: 45, voice: 'key', text: 'SUTURIST casts SUTURE.' },
  boss:   { t: 72.5, cps: 18, voice: 'key',  text: 'THRONE OF THE MYCELIUM KING' },
  end:    { t: 88.6, cps: 20, voice: 'key',  text: '> PLAY IN YOUR BROWSER' },
};
function typed(id, t) {
  const d = TYPED[id];
  const n = Math.floor((t - d.t) * d.cps);
  return n <= 0 ? '' : d.text.slice(0, n);
}
function typedDone(id, t) { const d = TYPED[id]; return t >= d.t + d.text.length / d.cps; }

// ── Impacts: drive shake, flash and chromatic split (the score hits the same marks) ──
const HITS = [
  [15.0, 0.35], [24.0, 1.0],
  [27, 0.75], [30, 0.75], [33, 0.75], [36, 0.75], [39, 0.75],
  [42, 0.9],
  [45, 0.8], [48, 0.8], [51, 0.8], [54, 0.8],
  [57, 1.0],
  [60, 0.6], [61.5, 0.85], [63, 0.5], [63.9, 0.95], [64.5, 0.85], [66, 0.8], [67.5, 0.85], [69, 0.6], [70.5, 0.95],
  [75, 0.25], [78, 1.0], [79.5, 0.6], [81.8, 0.75],
  [84, 1.0],
];
function impact(t, decay) {
  let v = 0;
  for (const [ht, s] of HITS) {
    if (t >= ht && t - ht < 3) v += s * Math.exp(-(t - ht) * decay);
  }
  return v;
}

// ── Assets ──
const IMG_SRC = {
  cave: 'assets/cave_mouth.png', fungal: 'assets/fungal.png', crystal: 'assets/crystal.png',
  drowned: 'assets/drowned.png', ossuary: 'assets/ossuary.png', magma: 'assets/magma.png',
  throne: 'assets/throne.png', town: 'assets/townbg.png', logo: 'assets/Caverns_Logo.png',
  templar: 'assets/templar.png', phaseknife: 'assets/phaseknife.png', suturist: 'assets/suturist.png',
  junk: 'assets/junk_prophet.png', shopkeep: 'assets/shopkeep.png',
  king: 'assets/mycelium_king.png', ratking: 'assets/rat_king.png', charnel: 'assets/charnel_king.png',
  titan: 'assets/forge_titan.png', leviathan: 'assets/leviathan.png',
};
// Pixel art is pre-scaled by an integer factor with nearest-neighbour so later smooth
// resampling during camera moves stays crisp and shimmer-free.
const PIXEL_UP = {
  cave: 4, fungal: 4, crystal: 4, drowned: 4, ossuary: 4, magma: 4, throne: 4,
  templar: 8, phaseknife: 8, suturist: 8, junk: 8, shopkeep: 8,
  king: 4, ratking: 6, charnel: 6, titan: 6, leviathan: 6,
};
const A = {};      // prepared images (canvas or img)
const GLOW = {};   // blurred silhouettes for rim light

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function pixUp(img, n) {
  const c = makeCanvas(img.width * n, img.height * n);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function silhouette(src, color, blur, scale = 0.25) {
  const pad = Math.ceil(blur * 3);
  const w = Math.ceil(src.width * scale), h = Math.ceil(src.height * scale);
  const c = makeCanvas(w + pad * 2, h + pad * 2);
  const x = c.getContext('2d');
  x.filter = `blur(${blur}px)`;
  x.drawImage(src, pad, pad, w, h);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  c.padPx = pad; c.srcScale = scale; c.srcW = src.width;
  return c;
}
// Draw a silhouette glow aligned to where its source is drawn at (x, y) with width w.
function drawGlow(ctx, g, x, y, w) {
  const k = w / g.srcW / g.srcScale;
  const off = g.padPx * k;
  ctx.drawImage(g, x - off, y - off, g.width * k, g.height * k);
}

function placeholder(name) {
  const c = makeCanvas(160, 160);
  const x = c.getContext('2d');
  x.fillStyle = '#222'; x.fillRect(0, 0, 160, 160);
  x.fillStyle = '#666'; x.font = '14px monospace'; x.fillText(name, 8, 80);
  return c;
}

function loadImage(src) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

async function loadAssets(onProgress) {
  const fonts = [
    new FontFace('Cinzel', 'url(fonts/Cinzel.ttf)', { weight: '400 900' }),
    new FontFace('Cormorant', 'url(fonts/CormorantItalic.ttf)', { weight: '300 700', style: 'italic' }),
    new FontFace('VT323', 'url(fonts/VT323.ttf)'),
  ];
  const keys = Object.keys(IMG_SRC);
  let done = 0;
  const total = keys.length + fonts.length;
  const tick = () => onProgress && onProgress(++done / total);

  await Promise.all([
    ...fonts.map(f => f.load().then(ff => { document.fonts.add(ff); tick(); }).catch(tick)),
    ...keys.map(k => loadImage(IMG_SRC[k]).then(im => {
      if (!im) { console.warn('missing asset', k); A[k] = placeholder(k); }
      else A[k] = PIXEL_UP[k] ? pixUp(im, PIXEL_UP[k]) : im;
      tick();
    })),
  ]);

  // Portraits dissolve into darkness at the bottom (alpha fade baked in, so it works on any background).
  for (const k of ['templar', 'phaseknife', 'suturist', 'junk']) {
    const src = A[k], c = makeCanvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#000'); g.addColorStop(0.68, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    A[k + '_fade'] = c;
  }
  // Rock texture for the tunnel dive, lifted from the cave-mouth art.
  {
    const c = makeCanvas(640, 640), x = c.getContext('2d');
    x.drawImage(A.cave, A.cave.width * 0.66, A.cave.height * 0.03, A.cave.width * 0.3, A.cave.height * 0.5, 0, 0, 640, 640);
    A.rock = c;
  }

  // The leviathan sprite runs off its canvas; feather the edges so it sits in the dark.
  {
    const src = A.leviathan, c = makeCanvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    const g = x.createRadialGradient(c.width / 2, c.height * 0.45, c.width * 0.3, c.width / 2, c.height * 0.45, c.width * 0.56);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    A.leviathan = c;
  }

  const CLS = { templar: '#ffcf7a', phaseknife: '#6ff2e6', suturist: '#ff6a4d', junk: '#ffa04a', shopkeep: '#ffb060' };
  for (const k in CLS) GLOW[k] = silhouette(A[k + '_fade'] || A[k], CLS[k], 10, 0.25);
  GLOW.king = silhouette(A.king, '#4dffe0', 10, 0.25);
  GLOW.logo = silhouette(A.logo, '#ff8a2a', 14, 0.25);
  for (const k of ['ratking', 'charnel', 'titan', 'leviathan']) GLOW[k] = silhouette(A[k], '#ffffff', 8, 0.25);
}
