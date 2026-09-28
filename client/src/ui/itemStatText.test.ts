import { describe, it, expect } from 'vitest';
import { formatItemStats } from './itemStatText.js';
describe('formatItemStats', () => {
  it('guns show damage, range and magazine', () => {
    expect(formatItemStats({ damage: 3, range: 2, magazine: 5 })).toMatch(/\+3 .*range 2.*5 rds/);
  });
  it('melee items unchanged', () => {
    expect(formatItemStats({ damage: 2, initiative: 1 })).toMatch(/\+2 .*\+1 /);
    expect(formatItemStats({ healAmount: 15 })).toBe('heals 15');
  });
});
