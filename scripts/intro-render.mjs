// Headless review tooling for the intro cold open (Playwright, Edge channel).
// Needs the Vite dev server (npm run dev:client); `handoff` and `keys` also need the game server (npm run dev).
//
//   node scripts/intro-render.mjs stills 0.1,5,12.6,20,24,29.99 [--out .intro/stills] [--viewport 1920x1080]
//   node scripts/intro-render.mjs frames 30 [--out .intro/frames] [--from 0] [--to 30.5]
//   node scripts/intro-render.mjs wav [--out .intro/intro.wav]
//   node scripts/intro-render.mjs handoff [--viewport 1920x1080] [--out .intro/handoff]
//   node scripts/intro-render.mjs keys
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const base = opt('base', 'http://localhost:5173');
const [vw, vh] = opt('viewport', '1920x1080').split('x').map(Number);
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

async function handoff() {
  const out = opt('out', '.intro/handoff');
  mkdirSync(out, { recursive: true });
  const a = await withPage(async (page) => {
    await openStill(page, 29.99);
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(() => window.__intro.render(29.99));
    await page.waitForTimeout(300);
    return page.screenshot();
  });
  const b = await withPage(async (page) => {
    await page.addInitScript(() => localStorage.setItem('caverns_intro_seen', '1'));
    await page.goto(`${base}/`);
    await page.waitForSelector('.lobby-logo');
    await page.addStyleTag({ content: FREEZE });
    await page.waitForTimeout(800);
    return page.screenshot();
  });
  writeFileSync(join(out, `intro_${vw}x${vh}.png`), a);
  writeFileSync(join(out, `dom_${vw}x${vh}.png`), b);
  const stats = await withPage((page) => page.evaluate(async ([pa, pb]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = ia.width, h = ia.height;
    const grab = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = grab(ia), db = grab(ib);
    const heat = document.createElement('canvas'); heat.width = w; heat.height = h;
    const hx = heat.getContext('2d'), hd = hx.createImageData(w, h);
    let sum = 0, over = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d; if (d > 24) over++;
      hd.data[i] = Math.min(255, d * 8); hd.data[i + 3] = 255;
    }
    hx.putImageData(hd, 0, 0);
    const n = da.length / 4;
    return { mean: sum / n, pctOver24: (over / n) * 100, heat: heat.toDataURL('image/png').split(',')[1] };
  }, [a.toString('base64'), b.toString('base64')]));
  writeFileSync(join(out, `diff_${vw}x${vh}.png`), Buffer.from(stats.heat, 'base64'));
  const pass = stats.mean <= 1.5 && stats.pctOver24 <= 0.5;
  console.log(`handoff ${vw}x${vh}: mean ${stats.mean.toFixed(3)}, >24: ${stats.pctOver24.toFixed(3)}% → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
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
