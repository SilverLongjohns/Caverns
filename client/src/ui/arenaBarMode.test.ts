import { describe, it, expect } from 'vitest';
import type { AbilityDefinition } from '@caverns/shared';
import { effectiveArenaBarMode } from './arenaBarMode.js';

const ability = { id: 'a', name: 'A', targetType: 'enemy' } as AbilityDefinition;

describe('effectiveArenaBarMode', () => {
  it('is idle whenever it is not my turn', () => {
    expect(effectiveArenaBarMode({ mode: 'move' }, false, true)).toEqual({ mode: 'idle' });
  });

  it('shows the main buttons at the start of my turn', () => {
    expect(effectiveArenaBarMode({ mode: 'idle' }, true, false)).toEqual({ mode: 'main' });
  });

  it('keeps a map-targeting mode while the map is still waiting for a click', () => {
    expect(effectiveArenaBarMode({ mode: 'move' }, true, true)).toEqual({ mode: 'move' });
    expect(effectiveArenaBarMode({ mode: 'target_attack' }, true, true)).toEqual({ mode: 'target_attack' });
  });

  it('returns to the main buttons once the map click has been handled', () => {
    expect(effectiveArenaBarMode({ mode: 'move' }, true, false)).toEqual({ mode: 'main' });
    expect(effectiveArenaBarMode({ mode: 'target_attack' }, true, false)).toEqual({ mode: 'main' });
    expect(effectiveArenaBarMode({ mode: 'target_ability', ability }, true, false)).toEqual({ mode: 'main' });
  });

  it('leaves menu modes alone (they do not target the map)', () => {
    expect(effectiveArenaBarMode({ mode: 'items' }, true, false)).toEqual({ mode: 'items' });
    expect(effectiveArenaBarMode({ mode: 'abilities' }, true, false)).toEqual({ mode: 'abilities' });
    expect(effectiveArenaBarMode({ mode: 'target_item', itemIndex: 0 }, true, false)).toEqual({ mode: 'target_item', itemIndex: 0 });
  });

  it('target_shoot drops back to main when the map is no longer targeting', () => {
    expect(effectiveArenaBarMode({ mode: 'target_shoot' }, true, false)).toEqual({ mode: 'main' });
    expect(effectiveArenaBarMode({ mode: 'target_shoot' }, true, true)).toEqual({ mode: 'target_shoot' });
  });
});
