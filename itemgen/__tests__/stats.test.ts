import { describe, it, expect } from 'vitest';
import { generateStats, BASE_STAT_RANGES, STAT_CEILINGS } from '../src/stats.js';
import { createRng } from '../src/rng.js';
import type { MaterialDef } from '../src/types.js';

const boneMaterial: MaterialDef = {
  id: 'bone', name: 'Bone',
  statBias: { damage: 1.2, defense: 0.8 },
  slots: ['weapon'], tier: 1,
};

const neutralMaterial: MaterialDef = {
  id: 'neutral', name: 'Neutral',
  statBias: {},
  slots: ['weapon', 'offhand', 'armor', 'accessory'], tier: 1,
};

describe('generateStats', () => {
  it('produces weapon stats with damage as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('weapon', 1, neutralMaterial, 'standard', rng);
    expect(stats.damage).toBeGreaterThan(0);
  });

  it('produces offhand stats with defense as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('offhand', 1, neutralMaterial, 'standard', rng);
    expect(stats.defense).toBeGreaterThan(0);
  });

  it('produces armor stats with defense as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('armor', 2, neutralMaterial, 'standard', rng);
    expect(stats.defense).toBeGreaterThan(0);
  });

  it('applies material bias — bone weapon should have higher damage', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const boneStats = generateStats('weapon', 1, boneMaterial, 'standard', rng1);
    const neutralStats = generateStats('weapon', 1, neutralMaterial, 'standard', rng2);
    expect(boneStats.damage!).toBeGreaterThanOrEqual(neutralStats.damage!);
  });

  it('masterwork quality produces higher stats than crude', () => {
    const stats1 = generateStats('weapon', 2, neutralMaterial, 'masterwork', createRng(42));
    const stats2 = generateStats('weapon', 2, neutralMaterial, 'crude', createRng(42));
    expect(stats1.damage!).toBeGreaterThan(stats2.damage!);
  });

  it('skull-3 produces higher stats than skull-1', () => {
    const stats1 = generateStats('weapon', 3, neutralMaterial, 'standard', createRng(42));
    const stats2 = generateStats('weapon', 1, neutralMaterial, 'standard', createRng(42));
    expect(stats1.damage!).toBeGreaterThan(stats2.damage!);
  });

  it('clamps skull-1 stats to not exceed skull-2 floor', () => {
    const highBias: MaterialDef = {
      id: 'high', name: 'High', statBias: { damage: 2.0 }, slots: ['weapon'], tier: 1,
    };
    const rng = createRng(42);
    const stats = generateStats('weapon', 1, highBias, 'masterwork', rng);
    const skull2Floor = BASE_STAT_RANGES.weapon[2].min;
    expect(stats.damage!).toBeLessThanOrEqual(skull2Floor);
  });

  it('is deterministic with the same seed', () => {
    const stats1 = generateStats('weapon', 2, boneMaterial, 'fine', createRng(99));
    const stats2 = generateStats('weapon', 2, boneMaterial, 'fine', createRng(99));
    expect(stats1).toEqual(stats2);
  });
});
