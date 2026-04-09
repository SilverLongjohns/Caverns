import { describe, it, expect } from 'vitest';
import { AbilityResolver } from './AbilityResolver.js';
import type { AbilityEffect, ActiveBuff } from '@caverns/shared';

describe('AbilityResolver', () => {
  const resolver = new AbilityResolver();

  function makeParticipant(overrides: Partial<{
    id: string; type: 'player' | 'mob'; name: string;
    hp: number; maxHp: number; damage: number; defense: number;
    alive: boolean; buffs: ActiveBuff[];
  }> = {}) {
    return {
      id: overrides.id ?? 'p1',
      type: overrides.type ?? 'player' as const,
      name: overrides.name ?? 'Alice',
      hp: overrides.hp ?? 50,
      maxHp: overrides.maxHp ?? 50,
      damage: overrides.damage ?? 10,
      defense: overrides.defense ?? 2,
      alive: overrides.alive ?? true,
      buffs: overrides.buffs ?? [],
    };
  }

  describe('deal_damage', () => {
    it('deals multiplied damage ignoring defense', () => {
      const caster = makeParticipant({ id: 'p1', damage: 10 });
      const target = makeParticipant({ id: 'mob1', type: 'mob', defense: 5, hp: 50, maxHp: 50 });
      const effect: AbilityEffect = { type: 'deal_damage', multiplier: 2.5, ignoreDefense: true };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.damage).toBe(25); // 10 * 2.5, defense ignored
      expect(target.hp).toBe(25);
    });

    it('applies defense when ignoreDefense is false', () => {
      const caster = makeParticipant({ id: 'p1', damage: 10 });
      const target = makeParticipant({ id: 'mob1', type: 'mob', defense: 3, hp: 50, maxHp: 50 });
      const effect: AbilityEffect = { type: 'deal_damage', multiplier: 2.0, ignoreDefense: false };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.damage).toBe(14); // (10 - 3) * 2.0
      expect(target.hp).toBe(36);
    });
  });

  describe('heal', () => {
    it('heals percentage of max hp', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', hp: 20, maxHp: 50 });
      const effect: AbilityEffect = { type: 'heal', percentMaxHp: 0.3 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.healing).toBe(15); // 50 * 0.3
      expect(target.hp).toBe(35);
    });

    it('does not overheal', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', hp: 45, maxHp: 50 });
      const effect: AbilityEffect = { type: 'heal', percentMaxHp: 0.3 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.healing).toBe(5);
      expect(target.hp).toBe(50);
    });
  });

  describe('apply_buff', () => {
    it('applies a flat defense buff to self', () => {
      const caster = makeParticipant({ id: 'p1', buffs: [] });
      const effect: AbilityEffect = { type: 'apply_buff', buffType: 'defense_flat', duration: 2, value: 3, target: 'self' };
      const result = resolver.resolveEffect(effect, caster, null, [caster]);
      expect(result.buffsApplied).toContain('defense_flat');
      expect(caster.buffs).toHaveLength(1);
      expect(caster.buffs[0]).toEqual({ type: 'defense_flat', turnsRemaining: 2, sourcePlayerId: 'p1', value: 3 });
    });

    it('applies buff to all allies', () => {
      const p1 = makeParticipant({ id: 'p1', buffs: [] });
      const p2 = makeParticipant({ id: 'p2', buffs: [] });
      const mob = makeParticipant({ id: 'mob1', type: 'mob', buffs: [] });
      const effect: AbilityEffect = { type: 'apply_buff', buffType: 'defense_flat', duration: 2, value: 3, target: 'all_allies' };
      resolver.resolveEffect(effect, p1, null, [p1, p2, mob]);
      expect(p1.buffs).toHaveLength(1);
      expect(p2.buffs).toHaveLength(1);
      expect(mob.buffs).toHaveLength(0);
    });
  });

  describe('taunt', () => {
    it('applies taunt buff to caster', () => {
      const caster = makeParticipant({ id: 'p1', buffs: [] });
      const effect: AbilityEffect = { type: 'taunt', duration: 2 };
      const result = resolver.resolveEffect(effect, caster, null, [caster]);
      expect(result.buffsApplied).toContain('taunt');
      expect(caster.buffs).toHaveLength(1);
      expect(caster.buffs[0].type).toBe('taunt');
    });
  });

  describe('skip_turn', () => {
    it('applies skip_turn debuff to all enemies', () => {
      const caster = makeParticipant({ id: 'p1' });
      const mob1 = makeParticipant({ id: 'mob1', type: 'mob', buffs: [] });
      const mob2 = makeParticipant({ id: 'mob2', type: 'mob', buffs: [] });
      const effect: AbilityEffect = { type: 'skip_turn', duration: 1, targets: 'all_enemies' };
      resolver.resolveEffect(effect, caster, null, [caster, mob1, mob2]);
      expect(mob1.buffs).toHaveLength(1);
      expect(mob1.buffs[0].type).toBe('skip_turn');
      expect(mob2.buffs).toHaveLength(1);
    });
  });

  describe('prevent_down', () => {
    it('applies prevent_down buff to target', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', buffs: [] });
      const effect: AbilityEffect = { type: 'prevent_down', duration: 1 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(target.buffs).toHaveLength(1);
      expect(target.buffs[0].type).toBe('prevent_down');
    });
  });

  describe('tickBuffs', () => {
    it('decrements buff durations and removes expired', () => {
      const participant = makeParticipant({
        id: 'p1',
        buffs: [
          { type: 'defense_flat', turnsRemaining: 1, sourcePlayerId: 'p1', value: 3 },
          { type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' },
        ],
      });
      resolver.tickBuffs(participant);
      expect(participant.buffs).toHaveLength(1);
      expect(participant.buffs[0].type).toBe('taunt');
      expect(participant.buffs[0].turnsRemaining).toBe(1);
    });
  });
});
