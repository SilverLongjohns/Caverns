'use strict';
// ─────────────────────────────────────────────────────────────
//  CAVERNS — synthesized trailer score.
//  Everything is scheduled into an OfflineAudioContext and rendered to a
//  single buffer, so playback is sample-locked to the picture timeline.
// ─────────────────────────────────────────────────────────────

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

async function renderScore(sampleRate = 48000, onProgress = null) {
  const ac = new OfflineAudioContext(2, Math.ceil(DURATION * sampleRate), sampleRate);
  buildScore(ac);
  if (onProgress) {
    for (let t = 4; t < DURATION; t += 4) {
      ac.suspend(t).then(() => { onProgress(t / DURATION); ac.resume(); });
    }
  }
  return ac.startRendering();
}

function buildScore(ac) {
  const rnd = mulberry32(90210);
  const sr = ac.sampleRate;

  // ── Master chain ──
  const master = ac.createGain();
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 3.5;
  glue.attack.value = 0.01; glue.release.value = 0.3;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.12;
  master.connect(glue); glue.connect(limiter); limiter.connect(ac.destination);
  master.gain.setValueAtTime(0.85, 0);
  master.gain.setValueAtTime(0.85, 94.0);
  master.gain.linearRampToValueAtTime(0.0, 96.4);

  // ── Reverb (generated hall impulse, darkening as it decays) ──
  function makeIR(seconds, decay) {
    const len = Math.floor(seconds * sr);
    const buf = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const coef = 0.15 + 0.8 * k;               // one-pole lowpass closing over time
        lp += (1 - coef) * ((rnd() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - k, decay) * (i < sr * 0.012 ? 0 : 1);
      }
    }
    return buf;
  }
  const hall = ac.createConvolver(); hall.buffer = makeIR(5.0, 2.6);
  const hallRet = ac.createGain();
  hallRet.gain.setValueAtTime(0.9, 0); hallRet.gain.setValueAtTime(0.9, 71.96);
  hallRet.gain.linearRampToValueAtTime(0, 71.99); hallRet.gain.setValueAtTime(0, 73.2); hallRet.gain.linearRampToValueAtTime(0.9, 74.8);
  hall.connect(hallRet); hallRet.connect(master);

  // Section gates shape the mix arc and make hard trailer cuts possible (tails included).
  // Group A carries the main score; group B carries the boss-intro "silence".
  const gateCurve = [[0, 1], [21.2, 0.72], [23.95, 0.72], [24.0, 1], [27, 0.7], [41.95, 0.7], [42.0, 0.9], [44.95, 0.9],
    [45, 0.82], [56.95, 0.82], [57, 0.95], [59.95, 0.95], [60, 1], [71.95, 1], [71.99, 0], [77.9, 0], [77.97, 1]];
  const gates = {};
  function gateFor(group) {
    if (gates[group]) return gates[group];
    const dry = ac.createGain(), wet = ac.createGain();
    dry.connect(master); wet.connect(hall);
    if (group === 'A') for (const g of [dry.gain, wet.gain]) {
      g.setValueAtTime(1, 0);
      for (const [t, v] of gateCurve) g.linearRampToValueAtTime(v, t);
    }
    return (gates[group] = { dry, wet });
  }
  let group = 'A';

  // Buses are shared per (group, wet, dry, pan) so thousands of notes don't each spawn a mixer strip.
  const buses = new Map();
  function bus(wet = 0.3, dry = 1, pan = 0) {
    wet = Math.round(wet * 20) / 20; pan = Math.round(pan * 5) / 5;
    const key = group + '|' + wet + '|' + dry + '|' + pan;
    if (buses.has(key)) return buses.get(key);
    const gate = gateFor(group);
    const g = ac.createGain(); g.gain.value = dry; buses.set(key, g);
    let out = g;
    if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(gate.dry);
    if (wet > 0) { const s = ac.createGain(); s.gain.value = wet; out.connect(s); s.connect(gate.wet); }
    return g;
  }

  // ── Shared sources ──
  const noiseBuf = ac.createBuffer(2, sr * 3, sr);
  for (let ch = 0; ch < 2; ch++) { const d = noiseBuf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  function noise(t, dur, offset = 0) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.start(t, (offset + rnd() * 2.5) % 2.9); s.stop(t + dur + 0.05);
    return s;
  }
  function osc(type, freq, t, dur, detune = 0) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function filt(type, freq, Q = 0.7) { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f; }
  function gainEnv(t, a, peak, hold, rel, curve = 'exp') {
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + a + hold);
    if (curve === 'exp') p.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    else p.linearRampToValueAtTime(0.0001, t + a + hold + rel);
    return g;
  }
  const shaperCurve = (() => {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2.8 * x) / Math.tanh(2.8); }
    return c;
  })();
  function shaper() { const s = ac.createWaveShaper(); s.curve = shaperCurve; s.oversample = '2x'; return s; }

  // ─────────── Instruments ───────────

  function boom(t, lvl = 0.6) {
    const out = bus(0.35);
    const o = osc('sine', 95, t, 3);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const g = gainEnv(t, 0.004, lvl, 0.05, 2.6);
    const sh = shaper();
    o.connect(g); g.connect(sh); sh.connect(out);
    const n = noise(t, 1.2); const lp = filt('lowpass', 420, 0.8);
    lp.frequency.setValueAtTime(420, t); lp.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    const ng = gainEnv(t, 0.002, lvl * 0.9, 0.0, 0.9);
    n.connect(lp); lp.connect(ng); ng.connect(out);
  }

  function taiko(t, lvl = 0.5, pitch = 1, pan = 0) {
    const out = bus(0.3, 1, pan);
    const o = osc('sine', 160 * pitch, t, 0.8);
    o.frequency.exponentialRampToValueAtTime(52 * pitch, t + 0.13);
    const g = gainEnv(t, 0.002, lvl, 0.02, 0.55);
    o.connect(g); g.connect(out);
    const n = noise(t, 0.2); const bp = filt('bandpass', 900 * pitch, 1.1);
    const ng = gainEnv(t, 0.001, lvl * 0.55, 0, 0.09);
    n.connect(bp); bp.connect(ng); ng.connect(out);
  }

  function clap(t, lvl = 0.25) {
    const out = bus(0.4, 1, (rnd() - 0.5) * 0.3);
    const n = noise(t, 0.4); const bp = filt('bandpass', 1500, 0.9);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) { p.linearRampToValueAtTime(lvl, t + i * 0.011 + 0.001); p.linearRampToValueAtTime(lvl * 0.2, t + i * 0.011 + 0.009); }
    p.linearRampToValueAtTime(lvl, t + 0.035); p.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(bp); bp.connect(g); g.connect(out);
  }

  function hat(t, lvl = 0.05) {
    const out = bus(0.12, 1, (rnd() - 0.5) * 0.6);
    const n = noise(t, 0.08); const hp = filt('highpass', 8000, 0.7);
    const g = gainEnv(t, 0.001, lvl, 0, 0.045);
    n.connect(hp); hp.connect(g); g.connect(out);
  }

  function crash(t, lvl = 0.25) {
    const out = bus(0.5);
    const n = noise(t, 4); const hp = filt('highpass', 3200, 0.5);
    const g = gainEnv(t, 0.003, lvl, 0.05, 3.2);
    n.connect(hp); hp.connect(g); g.connect(out);
  }

  function braam(t, dur, midis, lvl = 0.4) {
    const out = bus(0.45);
    const lp = filt('lowpass', 90, 3.5);
    lp.frequency.setValueAtTime(90, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.16);
    lp.frequency.exponentialRampToValueAtTime(420, t + Math.min(1.2, dur * 0.5));
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const sh = shaper();
    const g = gainEnv(t, 0.03, lvl, dur * 0.25, dur * 0.75);
    // brass flutter
    const lfo = osc('sine', 6.5, t, dur); const lfoG = ac.createGain(); lfoG.gain.value = lvl * 0.12;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    lp.connect(sh); sh.connect(g); g.connect(out);
    const per = 0.22 / midis.length;
    for (const m of midis) {
      for (const d of [-14, 0, 13]) { const o = osc('sawtooth', mtof(m), t, dur, d); const og = ac.createGain(); og.gain.value = per; o.connect(og); og.connect(lp); }
    }
    const sub = osc('sine', mtof(Math.min(...midis)), t, dur);
    const sg = gainEnv(t, 0.02, lvl * 0.8, dur * 0.3, dur * 0.7);
    sub.connect(sg); sg.connect(out);
  }

  function riser(t0, t1, lvl = 0.25) {
    const out = bus(0.35);
    const d = t1 - t0;
    const n = noise(t0, d); const bp = filt('bandpass', 150, 2.2);
    bp.frequency.setValueAtTime(150, t0); bp.frequency.exponentialRampToValueAtTime(7500, t1);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(lvl, t1 - 0.01); g.gain.linearRampToValueAtTime(0, t1 + 0.01);
    n.connect(bp); bp.connect(g); g.connect(out);
    const o = osc('sawtooth', 55, t0, d); o.frequency.exponentialRampToValueAtTime(440, t1);
    const o2 = osc('sawtooth', 55, t0, d, 11); o2.frequency.exponentialRampToValueAtTime(440, t1);
    const lp = filt('lowpass', 300, 2); lp.frequency.setValueAtTime(300, t0); lp.frequency.exponentialRampToValueAtTime(3000, t1);
    const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(lvl * 0.35, t1 - 0.01); og.gain.linearRampToValueAtTime(0, t1 + 0.01);
    o.connect(lp); o2.connect(lp); lp.connect(og); og.connect(out);
  }

  function revCymbal(tEnd, len = 1.5, lvl = 0.22) {
    const out = bus(0.2);
    const n = noise(tEnd - len, len); const hp = filt('highpass', 4000, 0.5);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, tEnd - len);
    g.gain.exponentialRampToValueAtTime(lvl, tEnd - 0.005); g.gain.linearRampToValueAtTime(0, tEnd + 0.005);
    n.connect(hp); hp.connect(g); g.connect(out);
  }

  function whoosh(t, dur = 0.6, lvl = 0.18) {
    const out = bus(0.25);
    const pan = ac.createStereoPanner(); pan.pan.setValueAtTime(-0.7, t); pan.pan.linearRampToValueAtTime(0.7, t + dur);
    const n = noise(t, dur); const bp = filt('bandpass', 300, 1.3);
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(pan); pan.connect(out);
  }

  function bell(t, midi, lvl = 0.1, wet = 0.7) {
    const out = bus(wet, 1, (rnd() - 0.5) * 0.4);
    const f = mtof(midi);
    const parts = [[1, 1, 4.0], [2.0, 0.45, 2.2], [3.0, 0.25, 1.3], [4.16, 0.18, 0.8], [5.43, 0.1, 0.5]];
    for (const [r, a, dcy] of parts) {
      const o = osc('sine', f * r, t, dcy + 0.1);
      const g = gainEnv(t, 0.003, lvl * a, 0, dcy);
      o.connect(g); g.connect(out);
    }
  }

  function pad(t0, t1, midis, lvl = 0.06, cutoff = 900, attack = 1.5, release = 1.5, wet = 0.5) {
    const out = bus(wet);
    const lp = filt('lowpass', cutoff, 0.6);
    const lfo = osc('sine', 0.17, t0, t1 - t0 + release); const lg = ac.createGain(); lg.gain.value = cutoff * 0.25;
    lfo.connect(lg); lg.connect(lp.frequency);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t0); p.linearRampToValueAtTime(lvl, t0 + attack);
    p.setValueAtTime(lvl, t1); p.linearRampToValueAtTime(0.0001, t1 + release);
    lp.connect(g); g.connect(out);
    const per = 1 / midis.length;
    for (const m of midis) for (const d of [-9, 8]) {
      const o = osc('sawtooth', mtof(m), t0, t1 - t0 + release, d);
      const og = ac.createGain(); og.gain.value = per * 0.5; o.connect(og); og.connect(lp);
    }
  }

  function choir(t0, t1, midis, lvl = 0.06, attack = 1.8, release = 2.5) {
    const out = bus(0.75);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t0); p.linearRampToValueAtTime(lvl, t0 + attack);
    p.setValueAtTime(lvl, t1); p.linearRampToValueAtTime(0.0001, t1 + release);
    g.connect(out);
    const formants = [[700, 1.0, 9], [1150, 0.55, 10], [2650, 0.22, 12]];
    const src = ac.createGain(); src.gain.value = 1 / midis.length;
    for (const [f, a, q] of formants) { const bp = filt('bandpass', f, q); const fg = ac.createGain(); fg.gain.value = a * 2.2; src.connect(bp); bp.connect(fg); fg.connect(g); }
    for (const m of midis) for (const d of [-12, 0, 11]) {
      const o = osc('sawtooth', mtof(m), t0, t1 - t0 + release, d);
      const vib = osc('sine', 4.6 + rnd(), t0, t1 - t0 + release); const vg = ac.createGain(); vg.gain.value = 9;
      vib.connect(vg); vg.connect(o.detune);
      o.connect(src);
    }
  }

  function horn(t, dur, midi, lvl = 0.12) {
    const out = bus(0.55);
    const lp = filt('lowpass', 350, 1.2);
    lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(1500, t + 0.22); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(lvl, t + 0.12);
    p.setValueAtTime(lvl * 0.85, t + dur - 0.1); p.linearRampToValueAtTime(0.0001, t + dur + 0.35);
    lp.connect(g); g.connect(out);
    for (const d of [-7, 6]) {
      const o = osc('sawtooth', mtof(midi), t, dur + 0.4, d);
      const vib = osc('sine', 5.2, t, dur + 0.4); const vg = ac.createGain();
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(10, t + 0.5);
      vib.connect(vg); vg.connect(o.detune);
      o.connect(lp);
    }
    const o8 = osc('sawtooth', mtof(midi - 12), t, dur + 0.4); const g8 = ac.createGain(); g8.gain.value = 0.5; o8.connect(g8); g8.connect(lp);
  }

  function stringNote(t, midi, lvl = 0.05, len = 0.16) {
    const out = bus(0.28, 1, (rnd() - 0.5) * 0.5);
    const lp = filt('lowpass', 2600, 1.2);
    const g = gainEnv(t, 0.004, lvl, 0.02, len);
    lp.connect(g); g.connect(out);
    for (const d of [-6, 7]) { const o = osc('sawtooth', mtof(midi), t, len + 0.1, d); o.connect(lp); }
  }

  function tremolo(t0, t1, midis, lvl = 0.05, cutoff = 1600) {
    const out = bus(0.5);
    const lp = filt('lowpass', cutoff, 0.8);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t0); p.exponentialRampToValueAtTime(lvl, t1 - 0.02); p.linearRampToValueAtTime(0, t1 + 0.02);
    const trem = ac.createGain(); trem.gain.value = 0.5;
    const lfo = osc('square', 11, t0, t1 - t0); const lg = ac.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(trem.gain);
    lp.connect(trem); trem.connect(g); g.connect(out);
    for (const m of midis) for (const d of [-8, 9]) { const o = osc('sawtooth', mtof(m), t0, t1 - t0, d); const og = ac.createGain(); og.gain.value = 0.4; o.connect(og); og.connect(lp); }
  }

  function bassNote(t, dur, midi, lvl = 0.14) {
    const out = bus(0.1);
    const lp = filt('lowpass', 260, 1.5);
    const g = gainEnv(t, 0.01, lvl, dur * 0.6, dur * 0.4 + 0.2);
    lp.connect(g); g.connect(out);
    osc('sawtooth', mtof(midi), t, dur + 0.3).connect(lp);
    const s = osc('sine', mtof(midi - 12), t, dur + 0.3); const sg = ac.createGain(); sg.gain.value = 1.6; s.connect(sg); sg.connect(lp);
  }

  function heartbeat(t, lvl = 0.5) {
    for (const [dt, a] of [[0, 1], [0.26, 0.7]]) {
      const out = bus(0.15);
      const o = osc('sine', 62, t + dt, 0.5); o.frequency.exponentialRampToValueAtTime(36, t + dt + 0.2);
      const g = gainEnv(t + dt, 0.006, lvl * a, 0.02, 0.3);
      const lp = filt('lowpass', 180);
      o.connect(g); g.connect(lp); lp.connect(out);
    }
  }

  function subDrop(t, lvl = 0.5, dur = 2.2) {
    const out = bus(0.2);
    const o = osc('sine', 80, t, dur); o.frequency.exponentialRampToValueAtTime(24, t + dur);
    const g = gainEnv(t, 0.01, lvl, 0.2, dur - 0.2);
    o.connect(g); g.connect(out);
  }

  function keyClick(t, lvl = 0.05) {
    const out = bus(0.08, 1, (rnd() - 0.5) * 0.3);
    const n = noise(t, 0.03); const bp = filt('bandpass', 2600 + rnd() * 1800, 1.5);
    const g = gainEnv(t, 0.0008, lvl, 0, 0.022);
    n.connect(bp); bp.connect(g); g.connect(out);
    const o = osc('square', 140 + rnd() * 30, t, 0.03); const og = gainEnv(t, 0.001, lvl * 0.25, 0, 0.018);
    const lp = filt('lowpass', 900); o.connect(lp); lp.connect(og); og.connect(out);
  }

  function voiceBlip(t, lvl = 0.035) {
    const out = bus(0.12);
    const o = osc('square', [196, 220, 233, 262][Math.floor(rnd() * 4)], t, 0.07);
    const lp = filt('lowpass', 1400);
    const g = gainEnv(t, 0.004, lvl, 0.02, 0.04);
    o.connect(lp); lp.connect(g); g.connect(out);
  }

  function uiBlip(t, midi, lvl = 0.05, dur = 0.08, type = 'square') {
    const out = bus(0.2);
    const o = osc(type, mtof(midi), t, dur); const lp = filt('lowpass', 3000);
    const g = gainEnv(t, 0.002, lvl, dur * 0.4, dur * 0.6);
    o.connect(lp); lp.connect(g); g.connect(out);
  }

  function shing(t, lvl = 0.2) {
    bell(t, 96, lvl * 0.6, 0.6); bell(t, 103, lvl * 0.35, 0.6);
    const out = bus(0.5);
    const n = noise(t, 1.2); const hp = filt('highpass', 5000); const bp = filt('bandpass', 7000, 3);
    const g = gainEnv(t, 0.002, lvl, 0.03, 0.9);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
  }

  function slash(t, lvl = 0.25) {
    const out = bus(0.2);
    const n = noise(t, 0.3); const bp = filt('bandpass', 1200, 2);
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(6000, t + 0.12);
    const g = gainEnv(t, 0.01, lvl, 0.02, 0.15);
    n.connect(bp); bp.connect(g); g.connect(out);
  }

  function bed(t0, t1, type, lvl, cutoff, fadeIn = 1.5, fadeOut = 1.5) {
    const out = bus(0.3);
    const n = noise(t0, t1 - t0 + fadeOut);
    const f = filt(type, cutoff, 0.7);
    const lfo = osc('sine', 0.13, t0, t1 - t0 + fadeOut); const lg = ac.createGain(); lg.gain.value = cutoff * 0.4;
    lfo.connect(lg); lg.connect(f.frequency);
    const g = ac.createGain(); const p = g.gain;
    p.setValueAtTime(0.0001, t0); p.linearRampToValueAtTime(lvl, t0 + fadeIn);
    p.setValueAtTime(lvl, t1); p.linearRampToValueAtTime(0.0001, t1 + fadeOut);
    n.connect(f); f.connect(g); g.connect(out);
  }

  function crackles(t0, t1, rate, lvl) {
    let t = t0;
    while (t < t1) {
      t += -Math.log(1 - rnd()) / rate;
      const out = bus(0.15, 1, (rnd() - 0.5) * 0.8);
      const n = noise(t, 0.02); const bp = filt('bandpass', 1500 + rnd() * 5000, 1.5);
      const g = gainEnv(t, 0.0005, lvl * (0.3 + rnd()), 0, 0.006 + rnd() * 0.015);
      n.connect(bp); bp.connect(g); g.connect(out);
    }
  }

  // ─────────── Arrangement ───────────
  const D = 38; // D2

  // Typed text → key clicks / dialogue blips
  for (const id in TYPED) {
    const d = TYPED[id];
    group = d.t > 71.9 && d.t < 78 ? 'B' : 'A';
    for (let i = 0; i < d.text.length; i++) {
      if (d.text[i] === ' ') continue;
      const t = d.t + i / d.cps;
      if (d.voice === 'blip') { if (i % 2 === 0) voiceBlip(t); }
      else keyClick(t, d.cps > 40 ? 0.03 : 0.05);
    }
  }
  group = 'A';

  // ACT I — cold open (0–6.3)
  bed(0, 6.4, 'lowpass', 0.05, 500, 2, 1);
  pad(0.3, 6.0, [26, 38], 0.07, 180, 3, 0.8, 0.3);
  taiko(0.5, 0.12, 0.6); uiBlip(0.52, 100, 0.012, 0.25, 'sine');                 // CRT power-on thunk + whine
  [[1.2, 74], [2.4, 69], [3.6, 65], [4.8, 64]].forEach(([t, m]) => bell(t, m, 0.09));
  (() => { const out = bus(0.2); const o = osc('sine', 900, 6.0, 0.4); o.frequency.exponentialRampToValueAtTime(40, 6.32); const g = gainEnv(6.0, 0.005, 0.05, 0.1, 0.22); o.connect(g); g.connect(out); })();

  // Camp (6.3–15)
  bed(6.3, 15.0, 'lowpass', 0.05, 380, 1.5, 0.3);
  crackles(6.5, 15.0, 11, 0.06);
  pad(6.3, 14.8, [D, 50, 53, 57], 0.055, 750, 2.5, 0.4);
  [[8.0, 77], [8.75, 76], [9.5, 74], [11.0, 69]].forEach(([t, m]) => bell(t, m, 0.07));
  revCymbal(15.0, 1.6, 0.14);

  // Cave mouth (15–21.2)
  boom(15.0, 0.45);
  bed(15.0, 21.2, 'lowpass', 0.07, 600, 0.2, 0.3);
  pad(15.0, 21.0, [34, 46, 50, 53], 0.06, 500, 1.2, 0.4);
  tremolo(17.6, 23.9, [62, 63, 74], 0.05, 1800);
  riser(18.0, 21.2, 0.2);

  // Tunnel (21.2–23.9)
  for (let t = 21.2, k = 0; t < 23.85; k++) { taiko(t, 0.22 + k * 0.012, 0.8); t += Math.max(0.14, 0.375 - k * 0.018); }
  [21.25, 21.9, 22.45, 22.9, 23.25, 23.55].forEach((t, i) => whoosh(t, 0.45, 0.14 + i * 0.02));
  riser(21.2, 23.9, 0.28);
  revCymbal(23.9, 1.8, 0.2);
  subDrop(21.2, 0.3, 2.6);

  // Title card (24–27)
  braam(24.0, 3.3, [26, 38, 45], 0.55);
  boom(24.0, 0.8); taiko(24.0, 0.9, 0.7); crash(24.0, 0.2);
  choir(24.2, 26.6, [50, 57, 62], 0.035, 1.0, 1.2);
  revCymbal(27.0, 1.2, 0.12);

  // Groove used for the biome, character and montage sections
  const CH = {
    Dm: [38, 3, 7], Bb: [34, 4, 7], Gm: [43, 3, 7], A: [45, 4, 7], F: [41, 4, 7], C: [36, 4, 7], Dm2: [38, 3, 7],
  };
  const STEP = 0.1875;
  const OST = ['R', 'R', '5', 'R', '8', 'R', '5', 'R', 'R', 'R', '5', 'R', '3', 'R', '5', '3'];
  function ostinatoBar(t0, chord, lvl = 0.045, until = Infinity) {
    const [root, third, fifth] = CH[chord];
    const r = root + 12;
    for (let i = 0; i < 16; i++) {
      const t = t0 + i * STEP; if (t >= until) break;
      const s = OST[i];
      const m = s === 'R' ? r : s === '5' ? r + fifth : s === '3' ? r + third : r + 12;
      const acc = [0, 3, 6, 8, 11, 14].includes(i) ? 1.35 : 0.85;
      stringNote(t, m, lvl * acc);
      if (i % 2 === 0) stringNote(t, m + 12, lvl * 0.35 * acc, 0.12);
    }
  }
  function drumBar(t0, intensity = 1, fill = false) {
    taiko(t0, 0.85, 0.75);
    taiko(t0 + 6 * STEP, 0.45 * intensity, 1.0, -0.3);
    taiko(t0 + 10 * STEP, 0.35 * intensity, 1.1, 0.3);
    taiko(t0 + 12 * STEP, 0.55 * intensity, 0.9);
    if (intensity > 1.2) { taiko(t0 + 3 * STEP, 0.3, 1.2, 0.4); taiko(t0 + 8 * STEP, 0.4, 0.9, -0.4); }
    if (fill) for (let i = 13; i < 16; i++) taiko(t0 + i * STEP, 0.3 + (i - 13) * 0.1, 1.2 + (i - 13) * 0.1);
    for (let i = 0; i < 16; i += 2) hat(t0 + i * STEP, i % 4 === 0 ? 0.04 : 0.025);
  }
  function bar(t0, chord, opts = {}) {
    const { ost = 0.045, drums = 1, fill = false, pad: padLvl = 0.035, bass = true, until = Infinity } = opts;
    ostinatoBar(t0, chord, ost, until);
    if (drums) drumBar(t0, drums, fill);
    const [root, third, fifth] = CH[chord];
    if (bass) bassNote(t0, 2.8, root, 0.12);
    if (padLvl) pad(t0, t0 + 2.9, [root + 12, root + 12 + third, root + 12 + fifth, root + 24], padLvl, 1100, 0.3, 0.3, 0.5);
  }

  // Biomes (27–42): one bar per depth, hit on each cut
  ['Dm', 'Bb', 'Gm', 'A', 'Dm'].forEach((ch, i) => {
    const t = 27 + i * 3;
    bar(t, ch, { fill: i === 4, until: 41.95 });
    boom(t, 0.42); whoosh(t - 0.4, 0.45, 0.12);
  });
  choir(27.2, 41.6, [62, 65, 69], 0.022, 3, 0.5);

  // "WHO DESCENDS?" (42–45)
  braam(42.0, 3.0, [26, 38, 45, 50], 0.45);
  boom(42.0, 0.6); crash(42.0, 0.15);
  riser(43.4, 45.0, 0.2); revCymbal(45.0, 1.4, 0.15);

  // Characters (45–57): full groove + horn theme
  const charBars = ['Dm', 'F', 'C', 'Bb'];
  charBars.forEach((ch, i) => {
    const t = 45 + i * 3;
    bar(t, ch, { drums: 1.3, fill: i === 3, ost: 0.05 });
    const [root, third, fifth] = CH[ch];
    braam(t, 0.9, [root, root + 12, root + 12 + fifth], 0.22);
    boom(t, 0.35); slash(t - 0.05, 0.18);
    clap(t + 1.5, 0.16);
  });
  [[45.0, 69], [46.5, 74], [48.0, 72], [49.5, 69], [51.0, 67], [52.5, 72], [54.0, 74], [55.5, 73]]
    .forEach(([t, m]) => horn(t, 1.35, m, 0.1));

  // Lineup (57–60)
  braam(57.0, 3.0, [26, 38, 45, 50], 0.5); boom(57.0, 0.7); crash(57.0, 0.25);
  [57.0, 57.18, 57.36, 57.54].forEach((t, i) => taiko(t, 0.6, 0.9 + i * 0.12));
  bar(57.0, 'A', { drums: 0, ost: 0.05, pad: 0.03 });
  choir(57.0, 59.8, [57, 61, 64, 69], 0.04, 0.6, 0.4);
  riser(58.0, 60.0, 0.24); revCymbal(60.0, 1.5, 0.16);

  // Montage (60–72): cut every 1.5 s
  ['Dm', 'Bb', 'Gm', 'A'].forEach((ch, i) => {
    const t = 60 + i * 3;
    bar(t, ch, { drums: 1.6, ost: 0.055, fill: i === 3, until: 71.95 });
    for (let k = 0; k < 16; k += 2) taiko(t + k * STEP + STEP, 0.16, 1.4, (k % 4 ? 0.3 : -0.3));
    clap(t + 0.75, 0.12); clap(t + 2.25, 0.12);
  });
  for (let i = 0; i < 8; i++) { const t = 60 + i * 1.5; boom(t, i === 7 ? 0.6 : 0.4); whoosh(t - 0.35, 0.4, 0.1); }
  braam(61.5, 1.4, [26, 38, 44], 0.35);
  for (let i = 0; i < 12; i++) uiBlip(63.0 + i * 0.075, 72 + i, 0.022, 0.04);   // QTE sweep ticks
  shing(63.9, 0.28); slash(63.88, 0.35); taiko(63.9, 0.9, 0.8);
  braam(64.5, 1.4, [25, 37, 44], 0.35);
  [74, 77, 81, 86, 89, 93].forEach((m, i) => bell(66.0 + i * 0.06, m, 0.06, 0.6));
  choir(66.0, 67.3, [62, 66, 69, 74], 0.04, 0.2, 0.6);
  braam(67.5, 1.4, [26, 38, 45], 0.35);
  uiBlip(69.05, 81, 0.04, 0.45, 'sine');                                          // downed flatline
  [74, 78, 81, 86].forEach((m, i) => bell(69.7 + i * 0.07, m, 0.06, 0.5));         // suture shimmer
  braam(70.5, 1.45, [22, 34, 41], 0.45);
  riser(70.5, 71.95, 0.28); revCymbal(71.95, 1.4, 0.2);

  // Boss (72–84) — the intro lives on group B so it survives the hard cut
  group = 'B';
  (() => { const out = bus(0.8); const o = osc('sine', 1480, 72.1, 5.8); const v = osc('sine', 5.5, 72.1, 5.8); const vg = ac.createGain(); vg.gain.value = 18; v.connect(vg); vg.connect(o.detune);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, 72.1); g.gain.linearRampToValueAtTime(0.01, 73.5); g.gain.setValueAtTime(0.01, 77.6); g.gain.linearRampToValueAtTime(0.0001, 77.95); o.connect(g); g.connect(out); })();
  bed(72.1, 77.9, 'lowpass', 0.035, 300, 1.0, 0.1);
  [72.4, 73.3, 74.2, 75.1, 76.0, 76.85, 77.6].forEach((t, i) => heartbeat(t, 0.28 + i * 0.04));
  subDrop(75.0, 0.45, 3.0);
  tremolo(75.0, 77.95, [38, 39, 45, 50, 51], 0.06, 900);
  choir(75.2, 77.9, [50, 51, 57], 0.03, 2.4, 0.1);
  riser(76.2, 78.0, 0.25); revCymbal(78.0, 2.0, 0.22);

  group = 'A';
  braam(78.0, 4.0, [26, 38, 45, 50, 53], 0.6);
  boom(78.0, 0.9); taiko(78.0, 1.0, 0.65); crash(78.0, 0.28);
  choir(78.0, 83.7, [62, 65, 69, 74], 0.06, 0.5, 0.25);
  ['Dm', 'Bb'].forEach((ch, i) => bar(78 + i * 3, ch, { drums: 1.7, ost: 0.055, fill: i === 1, until: 83.85, pad: 0 }));
  boom(79.5, 0.5); taiko(79.5, 0.8, 0.7); crash(79.5, 0.12);
  braam(81.8, 2.0, [22, 34, 41, 46], 0.4); boom(81.8, 0.6); crash(81.8, 0.14);
  riser(82.6, 83.9, 0.25); revCymbal(83.9, 1.2, 0.18);

  // Logo (84–96.5): final hit and a hopeful D-major resolve
  braam(84.0, 6.0, [26, 38, 45, 50, 54], 0.6);
  boom(84.0, 1.0); taiko(84.0, 1.0, 0.6); crash(84.0, 0.32);
  choir(84.0, 93.5, [62, 66, 69, 74], 0.06, 1.2, 2.8);
  pad(84.3, 93.5, [38, 50, 54, 57], 0.045, 800, 2.5, 2.8);
  [[86.0, 74], [86.75, 69], [87.5, 66], [88.25, 64], [89.5, 62], [91.5, 74]].forEach(([t, m]) => bell(t, m, 0.08));
  bed(84.0, 93.0, 'lowpass', 0.03, 400, 2, 3);
  crackles(84.5, 94, 6, 0.04);
}

// Encode an AudioBuffer as 16-bit PCM WAV (for export).
function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = clamp(chans[c][i], -1, 1); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return data.buffer;
}
