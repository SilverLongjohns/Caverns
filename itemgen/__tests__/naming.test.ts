import { describe, it, expect } from 'vitest';
import { generateName } from '../src/naming.js';
import { createRng } from '../src/rng.js';
import type { NameFragments } from '../src/types.js';

const fragments: NameFragments = {
  adjectives: ['gleaming', 'festering', 'whispering'],
  prefixes: ['Spore', 'Gloom', 'Bone'],
  suffixes: ['bane', 'fang', 'shatter'],
  baseTypes: {
    weapon: ['dagger', 'blade', 'mace'],
    offhand: ['buckler', 'shield'],
    armor: ['vest', 'plate'],
    accessory: ['amulet', 'ring'],
  },
};

describe('generateName', () => {
  it('common items use [Quality] [Material] [BaseType] format', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'common', 'fine', 'Bone', fragments, rng);
    expect(name).toMatch(/^Fine Bone \w+$/);
  });

  it('common items with standard quality omit the quality word', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'common', 'standard', 'Bone', fragments, rng);
    expect(name).toMatch(/^Bone \w+$/);
  });

  it('uncommon items use same format as common', () => {
    const rng = createRng(42);
    const name = generateName('armor', 'uncommon', 'superior', 'Chitin', fragments, rng);
    expect(name).toMatch(/^Superior Chitin \w+$/);
  });

  it('rare items use [Adjective] [Material] [BaseType] format', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'rare', 'fine', 'Crystal', fragments, rng);
    const parts = name.split(' ');
    expect(parts.length).toBe(3);
    expect(fragments.adjectives.map(a => a.charAt(0).toUpperCase() + a.slice(1)))
      .toContain(parts[0]);
    expect(parts[1]).toBe('Crystal');
  });

  it('legendary items use a compound name', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'legendary', 'masterwork', 'Deepstone', fragments, rng);
    expect(name.split(' ').length).toBe(1);
    const matchesPrefix = fragments.prefixes.some(p => name.startsWith(p));
    expect(matchesPrefix).toBe(true);
  });

  it('is deterministic with same seed', () => {
    const name1 = generateName('weapon', 'rare', 'fine', 'Bone', fragments, createRng(42));
    const name2 = generateName('weapon', 'rare', 'fine', 'Bone', fragments, createRng(42));
    expect(name1).toBe(name2);
  });
});
