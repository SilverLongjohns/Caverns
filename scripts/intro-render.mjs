// Headless review tooling for the intro cold open (Playwright, Edge channel).
// Needs the Vite dev server (npm run dev:client); `handoff` and `keys` also need the game server (npm run dev).
//
//   node scripts/intro-render.mjs stills 0.1,5,12.6,20,24,29.99 [--out .intro/stills] [--viewport 1920x1080]
//   node scripts/intro-render.mjs frames 30 [--out .intro/frames] [--from 0] [--to 30.5]
//   node scripts/intro-render.mjs wav [--out .intro/intro.wav]
//   node scripts/intro-render.mjs handoff [--viewport 1920x1080] [--out .intro/handoff]
//       Two checks against the plain login page (animations frozen, .music-player hidden):
//       1. smoke   t=29.99, canvas fully handed over: mean <= 1.5 and <= 0.5 % of pixels differ by > 24.
//       2. align   t=ALIGN_T (28.99, canvas still fully opaque) vs the DOM, UI text hidden in both,
//                  grain off, eye rects (+ glow) masked out (the frozen DOM eyes sit at opacity 0).
//                  Pass needs all of:
//                  - mean <= 1.5 over the frame, and p99 <= 13 over "content" pixels (either image
//                    at max-channel >= 16: glyphs, logo, glow). Aligned: mean 0.4-0.8, p99 11; 1px offsets: 14-33.
//                  - registration: in the glyph region and in the logo region, shifting the canvas
//                    shot by any of the 8 one-pixel neighbours must match the DOM worse than no
//                    shift does (by >= 5 %). A glyph or logo layer that is off by 1 CSS px fails.
//   node scripts/intro-render.mjs keys
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const base = opt('base', 'http://localhost:5173');
const [vw, vh] = opt('viewport', '1920x1080').split('x').map(Number);
const ALIGN_T = 28.99;
const HIDE_UI = '.lobby-subtitle,.dos-prompt-label,.dos-input,.lobby-start,.intro-replay,.auth-error{visibility:hidden!important}';
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}.music-player{display:none!important}';

async function withPage(fn) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const result = await fn(page);
    if (errors.length) console.error('page errors:\n' + errors.join('\n'));
    return result;
  } finally {
    await browser.close();
  }
}

async function openStill(page, t) {
  await page.goto(`${base}/?intro&still=${t}`);
  await page.waitForFunction(() => window.__intro?.ready(), null, { timeout: 120000 });
}

async function stills() {
  const times = (argv[1] ?? '').split(',').filter(Boolean).map(Number);
  if (!times.length) throw new Error('stills: give comma-separated times');
  const out = opt('out', '.intro/stills');
  mkdirSync(out, { recursive: true });
  await withPage(async (page) => {
    await openStill(page, times[0]);
    for (const t of times) {
      await page.evaluate((x) => window.__intro.render(x), t);
      const file = join(out, `t${t.toFixed(2).padStart(6, '0')}_${vw}x${vh}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  });
}

async function frames() {
  const fps = Number(argv[1] ?? 30);
  const out = opt('out', '.intro/frames');
  const from = Number(opt('from', '0')), to = Number(opt('to', '30.5'));
  mkdirSync(out, { recursive: true });
  await withPage(async (page) => {
    await openStill(page, from);
    const n = Math.round((to - from) * fps);
    for (let i = 0; i < n; i++) {
      const t = from + i / fps;
      await page.evaluate((x) => window.__intro.render(x), t);
      await page.screenshot({ path: join(out, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (i % fps === 0) console.error(`frame ${i}/${n}`);
    }
  });
  console.log(`frames in ${out}. Encode in WSL: ffmpeg -framerate ${fps} -i ${out}/f%05d.jpg -i .intro/intro.wav -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest .intro/intro.mp4`);
}

async function wav() {
  const out = opt('out', '.intro/intro.wav');
  mkdirSync(dirname(out), { recursive: true });
  const b64 = await withPage(async (page) => {
    await openStill(page, 0);
    return page.evaluate(() => window.__intro.mixWav());
  });
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(out);
}

async function introShot(t, css, noGrain = false) {
  return withPage(async (page) => {
    if (noGrain) await page.addInitScript(() => { CanvasRenderingContext2D.prototype.createPattern = () => null; });
    await openStill(page, t);
    await page.addStyleTag({ content: css });
    await page.evaluate((x) => window.__intro.render(x), t);
    await page.waitForTimeout(300);
    return page.screenshot();
  });
}

/** Plain login page screenshot, plus the eye rects (padded for their glow) in page px. */
async function domShot(css) {
  return withPage(async (page) => {
    await page.addInitScript(() => localStorage.setItem('caverns_intro_seen', '1'));
    await page.goto(`${base}/`);
    await page.waitForSelector('.lobby-logo');
    await page.addStyleTag({ content: css });
    await page.waitForTimeout(800);
    const rects = (sel, pad) => page.$$eval(sel, (els, pad) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return [r.left - pad, r.top - pad, r.right + pad, r.bottom + pad];
    }), pad);
    const eyes = await rects('.cave-eye', 14);
    const regions = { glyphs: await rects('.lobby-cave-bg, .lobby-cave-top', 0), logo: await rects('.lobby-logo', 24) };
    return { png: await page.screenshot(), eyes, regions };
  });
}

/**
 * Max-channel diff stats; `mask` rects are skipped. p99 is over content pixels only.
 * For each named region (a list of rects), `reg[name]` is the mean diff with the first image
 * shifted by (0,0) and by each one-pixel neighbour: [err0, bestNeighbourErr].
 */
async function compare(a, b, mask = [], regions = {}) {
  return withPage((page) => page.evaluate(async ([pa, pb, mask, regions]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = ia.width, h = ia.height;
    const grab = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = grab(ia), db = grab(ib);
    const skip = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of mask) {
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++)
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) skip[y * w + x] = 1;
    }
    const heat = document.createElement('canvas'); heat.width = w; heat.height = h;
    const hx = heat.getContext('2d'), hd = hx.createImageData(w, h);
    const hist = new Uint32Array(256);
    let sum = 0, over = 0, n = 0, content = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      hd.data[i + 3] = 255;
      if (skip[p]) { hd.data[i + 2] = 60; continue; }
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d; n++; if (d > 24) over++;
      if (Math.max(da[i], da[i + 1], da[i + 2], db[i], db[i + 1], db[i + 2]) >= 16) { hist[d]++; content++; }
      hd.data[i] = Math.min(255, d * 8);
    }
    hx.putImageData(hd, 0, 0);
    const reg = {};
    for (const [name, rs] of Object.entries(regions)) {
      const err = (sx, sy) => {
        let e = 0, m = 0;
        for (const [x0, y0, x1, y1] of rs) {
          for (let y = Math.max(1, Math.floor(y0)); y < Math.min(h - 1, Math.ceil(y1)); y++)
            for (let x = Math.max(1, Math.floor(x0)); x < Math.min(w - 1, Math.ceil(x1)); x++) {
              const p = y * w + x;
              if (skip[p]) continue;
              const i = p * 4, j = ((y + sy) * w + (x + sx)) * 4;
              e += Math.max(Math.abs(da[j] - db[i]), Math.abs(da[j + 1] - db[i + 1]), Math.abs(da[j + 2] - db[i + 2]));
              m++;
            }
        }
        return m ? e / m : 0;
      };
      let best = Infinity;
      for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) if (sx || sy) best = Math.min(best, err(sx, sy));
      reg[name] = [err(0, 0), best];
    }
    const pct = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= content * q) return v; } return 255; };
    return { mean: sum / n, pctOver24: (over / n) * 100, p99: pct(0.99), reg, heat: heat.toDataURL('image/png').split(',')[1] };
  }, [a.toString('base64'), b.toString('base64'), mask, regions]));
}

async function handoff() {
  const out = opt('out', '.intro/handoff');
  mkdirSync(out, { recursive: true });
  const tag = `${vw}x${vh}`;

  // 1. Smoke: the last frame is the login screen.
  const a = await introShot(29.99, FREEZE);
  const { png: b } = await domShot(FREEZE);
  writeFileSync(join(out, `intro_${tag}.png`), a);
  writeFileSync(join(out, `dom_${tag}.png`), b);
  const s1 = await compare(a, b);
  writeFileSync(join(out, `diff_${tag}.png`), Buffer.from(s1.heat, 'base64'));
  const pass1 = s1.mean <= 1.5 && s1.pctOver24 <= 0.5;
  console.log(`handoff ${tag} smoke t=29.99: mean ${s1.mean.toFixed(3)}, >24: ${s1.pctOver24.toFixed(3)}% → ${pass1 ? 'PASS' : 'FAIL'}`);

  // 2. Alignment: the opaque canvas frame against the DOM it hands over to.
  const ca = await introShot(ALIGN_T, FREEZE + HIDE_UI, true);
  const { png: cb, eyes, regions } = await domShot(FREEZE + HIDE_UI);
  writeFileSync(join(out, `align_intro_${tag}.png`), ca);
  writeFileSync(join(out, `align_dom_${tag}.png`), cb);
  const s2 = await compare(ca, cb, eyes, regions);
  writeFileSync(join(out, `align_diff_${tag}.png`), Buffer.from(s2.heat, 'base64'));
  const registered = Object.values(s2.reg).every(([e0, best]) => e0 <= best * 0.95);
  const pass2 = s2.mean <= 1.5 && s2.p99 <= 13 && registered;
  const regTxt = Object.entries(s2.reg).map(([k, [e0, best]]) => `${k} ${e0.toFixed(2)} vs ±1px ${best.toFixed(2)}`).join(', ');
  console.log(`handoff ${tag} align t=${ALIGN_T}: mean ${s2.mean.toFixed(3)}, content p99 ${s2.p99}, ${regTxt} → ${pass2 ? 'PASS' : 'FAIL'}`);

  if (!(pass1 && pass2)) process.exitCode = 1;
}

async function keys() {
  await withPage(async (page) => {
    await page.goto(`${base}/?intro`);
    await page.waitForSelector('.intro-gate-prompt');
    await page.keyboard.press('x');
    await page.waitForTimeout(3000);
    await page.keyboard.type('abc');
    await page.waitForSelector('.intro-root', { state: 'detached', timeout: 15000 });
    const typed = await page.textContent('.dos-input-text');
    if (typed !== '') throw new Error(`intro leaked keystrokes into the login field: "${typed}"`);
    await page.goto(`${base}/`);
    await page.waitForTimeout(1500);
    if (await page.$('.intro-root')) throw new Error('intro replayed although it was already seen');
    console.log('keys: OK');
  });
}

const MODES = { stills, frames, wav, handoff, keys };
if (!MODES[mode]) {
  console.error('usage: node scripts/intro-render.mjs stills|frames|wav|handoff|keys ... (see header)');
  process.exit(2);
}
MODES[mode]().catch((e) => { console.error(e); process.exit(1); });
