'use strict';
// ─────────────────────────────────────────────────────────────
//  CAVERNS — renderer, post stack, playback & export hooks
// ─────────────────────────────────────────────────────────────

const out = document.getElementById('screen');
const octx = out.getContext('2d', { alpha: false });
out.width = W; out.height = H;

const sceneCv = makeCanvas(W, H), sctx = sceneCv.getContext('2d', { alpha: false });
const caCv = makeCanvas(W, H), cactx = caCv.getContext('2d');
const bloomCv = makeCanvas(480, 270), bctx = bloomCv.getContext('2d');
const filtersOK = typeof sctx.filter === 'string';

// Static overlays
const vignette = (() => {
  const c = makeCanvas(W, H), x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
})();
const scanlines = (() => {
  const c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.13)';
  for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 2);
  return c;
})();
const grains = [0, 1, 2, 3].map(k => {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  const id = x.createImageData(256, 256), r = mulberry32(k * 991 + 7);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (r() - 0.5) * 200; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0);
  return c;
});

function renderFrame(t) {
  t = clamp(t, 0, DURATION - 1e-3);
  const c = sctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  for (const s of SCENES) if (t >= s.t0 && t < s.t1) { c.save(); s.fn(c, t); c.restore(); }

  // ── Compose: camera shake ──
  const shake = impact(t, 7) * 20;
  const sx = vnoise(t * 38) * shake, sy = vnoise(t * 38 + 91) * shake;
  const zs = 1 + (shake > 0.5 ? (Math.abs(sx) + Math.abs(sy)) * 2.4 / W : 0);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over'; octx.filter = 'none';
  octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H);
  octx.setTransform(zs, 0, 0, zs, W / 2 * (1 - zs) + sx, H / 2 * (1 - zs) + sy);
  octx.drawImage(sceneCv, 0, 0);
  octx.setTransform(1, 0, 0, 1, 0, 0);

  // ── Chromatic split on impacts ──
  const ca = impact(t, 9) * 9;
  if (ca > 0.6) {
    cactx.globalCompositeOperation = 'source-over'; cactx.drawImage(out, 0, 0);
    cactx.globalCompositeOperation = 'multiply'; cactx.fillStyle = '#f00'; cactx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = 'multiply'; octx.fillStyle = '#0ff'; octx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = 'lighter'; octx.drawImage(caCv, ca, 0);
    octx.globalCompositeOperation = 'source-over';
  }

  // ── Bloom ──
  if (filtersOK) {
    bctx.globalCompositeOperation = 'source-over';
    bctx.filter = 'brightness(0.9) contrast(2.2) blur(5px)';
    bctx.clearRect(0, 0, 480, 270);
    bctx.drawImage(out, 0, 0, 480, 270);
    bctx.filter = 'none';
    octx.globalCompositeOperation = 'screen'; octx.globalAlpha = 0.42;
    octx.drawImage(bloomCv, 0, 0, W, H);
    octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over';
  }

  // ── Flash ──
  const fl = impact(t, 24);
  if (fl > 0.02) {
    octx.globalCompositeOperation = 'lighter';
    octx.fillStyle = `rgba(255,232,200,${Math.min(0.32, fl * 0.26)})`; octx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = 'source-over';
  }

  // ── Film: grain, scanlines, vignette, gate weave flicker ──
  const fi = Math.floor(t * 24);
  const g = grains[fi % 4];
  octx.globalCompositeOperation = 'overlay'; octx.globalAlpha = 0.14;
  const pat = octx.createPattern(g, 'repeat');
  const ox = (hash(fi) * 256) | 0, oy = (hash(fi + 0.5) * 256) | 0;
  octx.translate(-ox, -oy); octx.fillStyle = pat; octx.fillRect(ox, oy, W, H); octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  octx.drawImage(scanlines, 0, 0);
  octx.drawImage(vignette, 0, 0);
  const flick = 0.025 * (hash(fi * 3.7) - 0.5);
  if (flick > 0) { octx.fillStyle = `rgba(255,240,220,${flick})`; octx.fillRect(0, 0, W, H); }
  else { octx.fillStyle = `rgba(0,0,0,${-flick})`; octx.fillRect(0, 0, W, H); }

  // ── Letterbox ──
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, W, LB); octx.fillRect(0, H - LB, W, LB);
}

// ─────────── Playback ───────────
const ui = document.getElementById('ui');
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const params = new URLSearchParams(location.search);

// Audio: the score is synthesized in JS (score.js). A cached render of it ships as
// assets/score.m4a so playback starts instantly; if it's missing we synthesize live.
let scoreBuf = null, scoreEl = null, actx = null, src = null;
let playing = false, startCtx = 0, startOffset = 0, pausedAt = 0, wallStart = 0;
let muted = params.has('mute');

function now() {
  if (!playing) return pausedAt;
  if (!muted && scoreBuf && actx) return actx.currentTime - startCtx + startOffset - (actx.outputLatency || 0);
  if (!muted && scoreEl && !scoreEl.paused) return scoreEl.currentTime;
  return (performance.now() - wallStart) / 1000 + startOffset;
}

function play(from = pausedAt) {
  if (from >= DURATION - 0.05) from = 0;
  stopAudio();
  startOffset = from; playing = true;
  wallStart = performance.now();
  if (!muted && scoreBuf && actx) {
    src = actx.createBufferSource(); src.buffer = scoreBuf; src.connect(actx.destination);
    startCtx = actx.currentTime + 0.05;
    src.start(startCtx, from);
  } else if (!muted && scoreEl) {
    scoreEl.currentTime = from; scoreEl.play();
  }
  ui.classList.add('hidden');
}
function pause() { pausedAt = now(); playing = false; stopAudio(); ui.classList.remove('hidden'); statusEl.textContent = 'PAUSED — SPACE TO RESUME'; }
function stopAudio() {
  if (src) { try { src.stop(); } catch (e) {} src.disconnect(); src = null; }
  if (scoreEl) scoreEl.pause();
}
function seek(t) { const was = playing; pausedAt = clamp(t, 0, DURATION); if (was) play(pausedAt); }

function loop() {
  const t = now();
  renderFrame(t);
  bar.style.width = (t / DURATION * 100) + '%';
  if (playing && t >= DURATION) { playing = false; pausedAt = 0; ui.classList.remove('hidden'); statusEl.textContent = 'CLICK TO WATCH AGAIN'; }
  requestAnimationFrame(loop);
}

function fit() {
  const k = Math.min(innerWidth / W, innerHeight / H);
  out.style.width = (W * k) + 'px'; out.style.height = (H * k) + 'px';
}
addEventListener('resize', fit); fit();

async function loadScore() {
  // 1) cached render, decoded to a buffer (sample-accurate sync; needs http)
  try {
    const rsp = await fetch('assets/score.m4a');
    if (!rsp.ok) throw new Error(rsp.status);
    const data = await rsp.arrayBuffer();
    actx = new AudioContext({ sampleRate: 48000 });
    scoreBuf = await actx.decodeAudioData(data);
    return;
  } catch (e) { /* fall through */ }
  // 2) cached render via <audio> (works from file://)
  const el = new Audio();
  const ok = await new Promise(res => {
    el.oncanplaythrough = () => res(true); el.onerror = () => res(false);
    el.preload = 'auto'; el.src = 'assets/score.m4a'; el.load();
    setTimeout(() => res(el.readyState >= 3), 8000);
  });
  if (ok) { scoreEl = el; return; }
  // 3) synthesize live
  try {
    scoreBuf = await renderScore(32000, p => { statusEl.textContent = `FORGING THE SCORE… ${Math.round(p * 100)}%`; });
    actx = new AudioContext();
  } catch (e) { console.error(e); muted = true; }
}

async function boot() {
  statusEl.textContent = 'LIGHTING TORCHES…';
  await loadAssets(p => { statusEl.textContent = `LIGHTING TORCHES… ${Math.round(p * 100)}%`; });
  makeFog();
  if (params.has('still')) {           // ?still=42.5 — render a single frame
    pausedAt = parseFloat(params.get('still')) || 0;
    renderFrame(pausedAt); ui.classList.add('hidden');
    document.body.dataset.ready = '1';
    return;
  }
  pausedAt = parseFloat(params.get('t')) || 0;
  requestAnimationFrame(loop);
  document.body.dataset.ready = '1';
  if (!muted) await loadScore();
  statusEl.innerHTML = 'CLICK TO BEGIN<small>sound on · space pause · ←/→ seek · F fullscreen</small>';
  ui.classList.add('ready');
}

function userStart() {
  if (!document.body.dataset.ready || !ui.classList.contains('ready')) return;
  if (actx && actx.state === 'suspended') actx.resume();
  playing ? pause() : play();
}
ui.addEventListener('click', userStart);
out.addEventListener('click', userStart);
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); userStart(); }
  else if (e.code === 'ArrowRight') seek(now() + 5);
  else if (e.code === 'ArrowLeft') seek(now() - 5);
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
  else if (e.key === 'r' || e.key === 'R') seek(0);
});

// ─────────── Export hooks (used by tools/render.mjs) ───────────
window.__trailer = {
  duration: DURATION,
  ready: () => document.body.dataset.ready === '1',
  frame(t, type = 'image/jpeg', q = 0.94) { renderFrame(t); return out.toDataURL(type, q).split(',')[1]; },
  async wav() {
    const buf = await renderScore(48000);
    const bytes = new Uint8Array(audioBufferToWav(buf));
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  },
};

boot();
