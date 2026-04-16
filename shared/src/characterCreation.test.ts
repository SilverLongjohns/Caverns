import { describe, it, expect } from 'vitest';
import { validateStatPoints, CHARACTER_CREATION_CONFIG } from './characterCreation.js';

describe('validateStatPoints', () => {
  it('accepts a valid spread that uses the full budget', () => {
    const result = validateStatPoints({ vitality: 5, ferocity: 5, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(true);
  });

  it('accepts spreads that under-spend the budget', () => {
    const result = validateStatPoints({ vitality: 2, ferocity: 2, toughness: 2, speed: 2, tactics: 0 });
    expect(result.ok).toBe(true);
  });

  it('rejects spreads that exceed the budget', () => {
    const result = validateStatPoints({ vitality: 5, ferocity: 5, toughness: 1, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/budget/i);
  });

  it('rejects stats above perStatMax', () => {
    const result = validateStatPoints({ vitality: 6, ferocity: 0, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/max/i);
  });

  it('rejects negative stat values', () => {
    const result = validateStatPoints({ vitality: -1, ferocity: 0, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown stat ids', () => {
    const result = validateStatPoints({ vitality: 2, ferocity: 0, toughness: 0, speed: 0, tactics: 0, bogus: 1 } as Record<string, number>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
  });

  it('exposes config constants', () => {
    expect(CHARACTER_CREATION_CONFIG.pointBudget).toBe(10);
    expect(CHARACTER_CREATION_CONFIG.perStatMax).toBe(5);
    expect(CHARACTER_CREATION_CONFIG.statIds).toHaveLength(5);
  });
});
