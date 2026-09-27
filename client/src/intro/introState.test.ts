import { describe, it, expect } from 'vitest';
import { SEEN_KEY, hasSeenIntro, markIntroSeen, parseStill, shouldPlayIntro, stillTime, type StorageLike } from './introState.js';

function mem(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const throwing: StorageLike = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
};

describe('introState', () => {
  it('plays on first visit and not after being marked seen', () => {
    const s = mem();
    expect(shouldPlayIntro({ storage: s, search: '', reducedMotion: false })).toBe(true);
    markIntroSeen(s);
    expect(s.data[SEEN_KEY]).toBe('1');
    expect(shouldPlayIntro({ storage: s, search: '', reducedMotion: false })).toBe(false);
  });

  it('?intro forces play even when seen or reduced motion', () => {
    const s = mem(); markIntroSeen(s);
    expect(shouldPlayIntro({ storage: s, search: '?intro', reducedMotion: true })).toBe(true);
  });

  it('reduced motion skips the intro', () => {
    expect(shouldPlayIntro({ storage: mem(), search: '', reducedMotion: true })).toBe(false);
  });

  it('never plays on sandbox pages, even when forced', () => {
    expect(shouldPlayIntro({ storage: mem(), search: '?sandbox=duel', reducedMotion: false })).toBe(false);
    expect(shouldPlayIntro({ storage: mem(), search: '?sandbox=duel&intro', reducedMotion: false })).toBe(false);
  });

  it('survives throwing and missing storage', () => {
    expect(hasSeenIntro(throwing)).toBe(false);
    expect(() => markIntroSeen(throwing)).not.toThrow();
    expect(hasSeenIntro(null)).toBe(false);
    expect(() => markIntroSeen(null)).not.toThrow();
  });

  it('parses ?still as a finite number or null', () => {
    expect(parseStill('?intro&still=12.5')).toBe(12.5);
    expect(parseStill('?still=abc')).toBeNull();
    expect(parseStill('?intro')).toBeNull();
    expect(parseStill('?still=0')).toBe(0);
  });

  it('enables still mode only in dev or alongside ?intro', () => {
    expect(stillTime('?still=3', false)).toBeNull();
    expect(stillTime('?intro&still=3', false)).toBe(3);
    expect(stillTime('?still=3', true)).toBe(3);
    expect(stillTime('?intro', false)).toBeNull();
  });
});
