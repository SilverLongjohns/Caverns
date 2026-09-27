import { describe, it, expect } from 'vitest';
import {
  DURATION, SHOTS, shotAt, HITS, CUES, AUDIO_IDS, EYE_ORDER, eyeOpenTime,
  POWER_END_T, DARK_T0, DRIP_T, RESOLVE_T0, GLYPH_T0, GLYPH_T1, LOGO_T0, LOGO_T1,
  EYES_SETTLE_T0, EYES_SETTLE_T1, UNDERLAY_T0, UNDERLAY_T1, MUSIC_RELEASE_T, impact, SKIP_CUES,
} from './timeline.js';

describe('timeline', () => {
  it('is a 9-second ident of three contiguous shots covering exactly [0, DURATION]', () => {
    expect(DURATION).toBe(9);
    expect(SHOTS.map((s) => s.id)).toEqual(['power', 'dark', 'resolve']);
    expect(SHOTS[0].t0).toBe(0);
    expect(SHOTS[SHOTS.length - 1].t1).toBe(DURATION);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].t0).toBe(SHOTS[i - 1].t1);
    expect(SHOTS.reduce((sum, s) => sum + (s.t1 - s.t0), 0)).toBeCloseTo(DURATION, 9);
    expect(POWER_END_T).toBe(1.6);
    expect(DARK_T0).toBe(POWER_END_T);
    expect(RESOLVE_T0).toBe(5);
  });

  it('shotAt resolves boundaries to the later shot and clamps out-of-range times', () => {
    expect(shotAt(-5).id).toBe('power');
    expect(shotAt(1.599).id).toBe('power');
    expect(shotAt(1.6).id).toBe('dark');
    expect(shotAt(4.999).id).toBe('dark');
    expect(shotAt(5).id).toBe('resolve');
    expect(shotAt(99).id).toBe('resolve');
  });

  it('key moments land in order inside their shots', () => {
    expect(DRIP_T).toBeGreaterThan(DARK_T0);
    expect(GLYPH_T0).toBeGreaterThanOrEqual(RESOLVE_T0);
    expect(GLYPH_T1).toBeGreaterThan(GLYPH_T0);
    expect(LOGO_T0).toBeGreaterThan(GLYPH_T0);
    expect(LOGO_T1).toBeGreaterThan(LOGO_T0);
    expect(EYES_SETTLE_T1).toBeGreaterThan(EYES_SETTLE_T0);
    expect(UNDERLAY_T0).toBeGreaterThan(LOGO_T1);
    expect(UNDERLAY_T1).toBeLessThan(DURATION);
    expect(MUSIC_RELEASE_T).toBeGreaterThan(RESOLVE_T0);
    expect(MUSIC_RELEASE_T).toBeLessThan(DURATION);
  });

  it('hits are sorted and inside the power-on (the tube snap is the only one)', () => {
    for (let i = 1; i < HITS.length; i++) expect(HITS[i].t).toBeGreaterThan(HITS[i - 1].t);
    for (const h of HITS) {
      expect(h.t).toBeGreaterThanOrEqual(0);
      expect(h.t).toBeLessThan(POWER_END_T);
    }
  });

  it('impact peaks at a hit and decays afterwards', () => {
    const h = HITS[0];
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
    expect(CUES.find((c) => c.id === 'sfx_drip')?.t).toBe(DRIP_T);
    expect(CUES.filter((c) => c.id === 'sfx_tick')).toHaveLength(EYE_ORDER.length);
  });

  it('guarantees silence from the end of the power-on until the drip', () => {
    for (const c of CUES) {
      if (c.t >= DRIP_T) continue;
      expect(c.dur, `${c.id}@${c.t} needs an explicit dur`).toBeDefined();
      expect(c.t + (c.dur ?? 0)).toBeLessThanOrEqual(POWER_END_T + 1e-9);
    }
  });

  it('eye order is a permutation of the 11 CaveBackground eyes, all open after the drip and before the glyphs', () => {
    expect([...EYE_ORDER].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 0; i < 11; i++) {
      expect(eyeOpenTime(i)).toBeGreaterThan(DRIP_T);
      expect(eyeOpenTime(i)).toBeLessThan(GLYPH_T0);
    }
    expect(Math.max(...EYE_ORDER.map(eyeOpenTime))).toBeCloseTo(4.8, 9);
    expect(eyeOpenTime(99)).toBe(Infinity);
  });
});
