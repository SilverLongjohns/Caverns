import { describe, it, expect } from 'vitest';
import { createUiThrottle } from './uiSounds.js';

describe('createUiThrottle', () => {
  it('lets clicks and power through every time', () => {
    const ok = createUiThrottle(80);
    expect(ok('click', 0)).toBe(true);
    expect(ok('click', 1)).toBe(true);
    expect(ok('power', 2)).toBe(true);
  });
  it('throttles hover ticks to one per window', () => {
    const ok = createUiThrottle(80);
    expect(ok('tick', 1000)).toBe(true);
    expect(ok('tick', 1040)).toBe(false);
    expect(ok('tick', 1079)).toBe(false);
    expect(ok('tick', 1080)).toBe(true);
  });
});
