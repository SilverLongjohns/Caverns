import { describe, it, expect } from 'vitest';
import { parseStill, shouldPlayIntro, stillTime } from './introState.js';

describe('introState', () => {
  it('plays on every load', () => {
    expect(shouldPlayIntro({ search: '', reducedMotion: false })).toBe(true);
  });

  it('?intro forces play even with reduced motion', () => {
    expect(shouldPlayIntro({ search: '?intro', reducedMotion: true })).toBe(true);
  });

  it('reduced motion skips the intro', () => {
    expect(shouldPlayIntro({ search: '', reducedMotion: true })).toBe(false);
  });

  it('never plays on sandbox pages, even when forced', () => {
    expect(shouldPlayIntro({ search: '?sandbox=duel', reducedMotion: false })).toBe(false);
    expect(shouldPlayIntro({ search: '?sandbox=duel&intro', reducedMotion: false })).toBe(false);
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
