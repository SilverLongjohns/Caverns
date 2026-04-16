import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS } from './classData.js';
import { PLAYER_CONFIG } from './data/player.js';

describe('class baseStats are flattened', () => {
  it('every class uses the same baseline as PLAYER_CONFIG', () => {
    expect(CLASS_DEFINITIONS.length).toBeGreaterThan(0);
    for (const cls of CLASS_DEFINITIONS) {
      expect(cls.baseStats).toEqual(PLAYER_CONFIG.baseStats);
    }
  });
});
