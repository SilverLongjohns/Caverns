import { describe, it, expect } from 'vitest';
import { PROGRESSION_CONFIG } from '@caverns/shared';
import { formatItemStats } from './itemStatText.js';

const ferocityLabel = PROGRESSION_CONFIG.statDefinitions.find((d) => d.internalStat === 'damage')!.displayName;

describe('formatItemStats', () => {
  it('guns show damage, range and magazine', () => {
    expect(formatItemStats({ damage: 3, range: 2, magazine: 5 })).toMatch(/\+3 .*range 2.*5 rds/);
  });
  it('gun damage is labeled as shot damage, not a melee stat', () => {
    const text = formatItemStats({ damage: 3, range: 2, magazine: 5 });
    expect(text).not.toContain(ferocityLabel);
    expect(text).toContain('+3 shot dmg');
  });
  it('melee items unchanged', () => {
    expect(formatItemStats({ damage: 2, initiative: 1 })).toMatch(/\+2 .*\+1 /);
    expect(formatItemStats({ healAmount: 15 })).toBe('heals 15');
  });
});
