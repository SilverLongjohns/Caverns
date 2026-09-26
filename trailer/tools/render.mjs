// Headless renderer for the Caverns trailer. Zero dependencies: serves the trailer
// over HTTP, drives Chromium/Edge through the DevTools protocol, and pulls frames
// straight off the canvas, so the video is frame-exact regardless of machine speed.
//
//   node tools/render.mjs stills 5,24.5,48 [outDir]       → PNG stills
//   node tools/render.mjs wav out/score.wav               → the synthesized score
//   node tools/render.mjs frames [fps] [from] [to] | ffmpeg -f image2pipe -framerate 30 -i - ...
//
// Set BROWSER to a Chrome/Edge executable if the default path doesn't exist.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BROWSER = process.env.BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.css': 'text/css' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caverns-trailer-'));
  const proc = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--window-size=1920,1080', '--hide-scrollbars', '--mute-audio', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 800));
    return m.result?.result?.value;
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); };
  return { send, evaluate, close };
}

async function open(query = 'mute') {
  const srv = await serve();
  const b = await launch();
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/index.html?${query}` });
  for (let i = 0; i < 400; i++) {
    if (await b.evaluate('!!(window.__trailer && window.__trailer.ready())').catch(() => false)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const errs = await b.evaluate('window.__errors || []');
  if (errs.length) log('page errors:', errs);
  return { ...b, done: () => { b.close(); srv.close(); } };
}

const [mode, ...args] = process.argv.slice(2);
const b = await open(mode === 'wav' || mode === 'live' ? '' : 'mute');
try {
  if (mode === 'stills') {
    const times = args[0].split(',').map(Number);
    const dir = path.resolve(args[1] || path.join(ROOT, 'out', 'stills'));
    fs.mkdirSync(dir, { recursive: true });
    for (const t of times) {
      const b64 = await b.evaluate(`__trailer.frame(${t}, 'image/png')`);
      const f = path.join(dir, `f_${t.toFixed(2).padStart(6, '0')}.png`);
      fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      log('wrote', f);
    }
  } else if (mode === 'wav') {
    const f = path.resolve(args[0] || path.join(ROOT, 'out', 'score.wav'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await b.evaluate('__trailer.wav().then(s => (window.__wav = s, s.length))', true);
    const len = await b.evaluate('window.__wav.length');
    const parts = [];
    for (let i = 0; i < len; i += 4_000_000) parts.push(await b.evaluate(`window.__wav.slice(${i}, ${i + 4_000_000})`));
    fs.writeFileSync(f, Buffer.from(parts.join(''), 'base64'));
    log('wrote', f);
  } else if (mode === 'frames') {
    const fps = Number(args[0] || 30);
    const dur = await b.evaluate('__trailer.duration');
    const from = Number(args[1] || 0), to = Number(args[2] || dur);
    const n = Math.round((to - from) * fps);
    for (let i = 0; i < n; i++) {
      const b64 = await b.evaluate(`__trailer.frame(${from + i / fps}, 'image/jpeg', 0.95)`);
      const ok = process.stdout.write(Buffer.from(b64, 'base64'));
      if (!ok) await new Promise(r => process.stdout.once('drain', r));
      if (i % fps === 0) log(`frame ${i}/${n}`);
    }
  } else if (mode === 'live') {
    // Smoke-test the real playback path: cached score decode, start, clock advance.
    for (let i = 0; i < 100 && !(await b.evaluate("document.getElementById('ui').classList.contains('ready')")); i++) await new Promise(r => setTimeout(r, 200));
    const info = await b.evaluate(`({ buf: scoreBuf && scoreBuf.duration, el: !!scoreEl, status: statusEl.textContent })`);
    await b.evaluate('userStart()');
    await new Promise(r => setTimeout(r, 2000));
    const t = await b.evaluate('now()');
    log(JSON.stringify({ ...info, clockAfter2s: t, ctxState: await b.evaluate('actx && actx.state'), errors: await b.evaluate('window.__errors') }));
  } else if (mode === 'eval') {
    log(JSON.stringify(await b.evaluate(args[0], true)));
  } else {
    log('usage: render.mjs stills|wav|frames ...');
  }
} finally { b.done(); }
