import { describe, it, expect } from 'vitest';
import {
  DURATION, SHOTS, shotAt, HITS, STRATA, CUES, AUDIO_IDS, EYE_ORDER, eyeOpenTime,
  SCORE_STOP_T, DRIP_T, impact, SKIP_CUES,
} from './timeline.js';

describe('timeline', () => {
  it('shots are contiguous and cover exactly [0, DURATION]', () => {
    expect(DURATION).toBe(30);
    expect(SHOTS[0].t0).toBe(0);
    expect(SHOTS[SHOTS.length - 1].t1).toBe(DURATION);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].t0).toBe(SHOTS[i - 1].t1);
  });

  it('shotAt resolves boundaries to the later shot and clamps out-of-range times', () => {
    expect(shotAt(-5).id).toBe('power');
    expect(shotAt(1.6).id).toBe('waste');
    expect(shotAt(7.999).id).toBe('waste');
    expect(shotAt(8).id).toBe('threshold');
    expect(shotAt(22).id).toBe('dark');
    expect(shotAt(99).id).toBe('resolve');
  });

  it('hits are sorted, inside the piece, and every stratum boundary has a braam hit', () => {
    for (let i = 1; i < HITS.length; i++) expect(HITS[i].t).toBeGreaterThan(HITS[i - 1].t);
    for (const h of HITS) {
      expect(h.t).toBeGreaterThanOrEqual(0);
      expect(h.t).toBeLessThan(DURATION);
    }
    for (const s of STRATA.slice(1)) {
      expect(HITS.some((h) => h.t === s.t0)).toBe(true);
      expect(CUES.some((c) => c.id === 'sfx_braam' && c.t === s.t0)).toBe(true);
    }
  });

  it('impact peaks at a hit and decays afterwards', () => {
    const h = HITS[1];
    expect(impact(h.t, 7)).toBeCloseTo(h.k, 5);
    expect(impact(h.t + 0.5, 7)).toBeLessThan(h.k);
    expect(impact(h.t - 0.01, 7)).toBeLessThan(h.k);
  });

  it('cues are sorted, reference known audio ids, and sit inside the piece', () => {
    for (let i = 1; i < CUES.length; i++) expect(CUES[i].t).toBeGreaterThanOrEqual(CUES[i - 1].t);
    for (const c of [...CUES, ...SKIP_CUES]) {
      expect(AUDIO_IDS).toContain(c.id);
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.t).toBeLessThan(DURATION);
    }
  });

  it('guarantees silence from the hard cut until the drip', () => {
    for (const c of CUES) {
      if (c.t >= DRIP_T) continue;
      expect(c.dur, `${c.id}@${c.t} needs an explicit dur`).toBeDefined();
      expect(c.t + (c.dur ?? 0)).toBeLessThanOrEqual(SCORE_STOP_T + 1e-9);
    }
  });

  it('eye order is a permutation of the 11 CaveBackground eyes, all open before the resolve', () => {
    expect([...EYE_ORDER].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 0; i < 11; i++) {
      expect(eyeOpenTime(i)).toBeGreaterThan(DRIP_T);
      expect(eyeOpenTime(i)).toBeLessThan(26);
    }
    expect(eyeOpenTime(99)).toBe(Infinity);
  });
});
