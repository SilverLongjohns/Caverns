import { describe, it, expect } from 'vitest';
import type { AbilityDefinition } from '@caverns/shared';
import { abilityAvailable } from './abilityAvailability.js';

const base = { name: 'X', description: '', energyCost: 0, passive: false, effects: [] } as const;
const normal: AbilityDefinition = { ...base, id: 'n', targetType: 'enemy', effects: [] };
const free: AbilityDefinition = { ...base, id: 'f', targetType: 'tile', freeAction: true, effects: [] };

describe('abilityAvailable', () => {
  it('normal abilities need the turn\'s action', () => {
    expect(abilityAvailable(normal, false, [])).toBe(true);
    expect(abilityAvailable(normal, true, [])).toBe(false);
  });
  it('free actions ignore the action but are once per turn', () => {
    expect(abilityAvailable(free, true, [])).toBe(true);
    expect(abilityAvailable(free, false, ['f'])).toBe(false);
  });
});
