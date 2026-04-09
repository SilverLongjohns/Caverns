import { describe, it, expect } from 'vitest';
import type { EquippedEffect } from '@caverns/shared';
import { ItemEffectResolver, type EffectParticipant } from './ItemEffectResolver';

// --- Test helpers ---

function makeResolver(
  effects: Map<string, EquippedEffect[]> = new Map(),
  usedEffects: Map<string, string[]> = new Map(),
): ItemEffectResolver {
  return new ItemEffectResolver(effects, usedEffects);
}

function makeEffects(
  playerId: string,
  ...effects: { id: string; params: Record<string, number> }[]
): Map<string, EquippedEffect[]> {
  const map = new Map<string, EquippedEffect[]>();
  map.set(
    playerId,
    effects.map(e => ({ effectId: e.id, params: e.params, sourceItemId: `item_${e.id}` })),
  );
  return map;
}

function makeParticipant(overrides: Partial<EffectParticipant> & { id: string }): EffectParticipant {
  return {
    type: 'player', name: 'Test', hp: 50, maxHp: 50,
    damage: 10, defense: 2, initiative: 5, alive: true,
    ...overrides,
  };
}

// --- Tests ---

describe('ItemEffectResolver', () => {
  describe('getEffects / hasEffect', () => {
    it('returns empty effects for unknown participant', () => {
      const resolver = makeResolver();
      expect(resolver.getEffects('unknown-player')).toEqual([]);
      expect(resolver.hasEffect('unknown-player', 'vampiric')).toBe(false);
    });

    it('returns equipped effects for a known player', () => {
      const effects = makeEffects('player1', { id: 'vampiric', params: { drain: 3 } });
      const resolver = makeResolver(effects);
      const result = resolver.getEffects('player1');
      expect(result).toHaveLength(1);
      expect(result[0].effectId).toBe('vampiric');
      expect(result[0].params).toEqual({ drain: 3 });
      expect(result[0].sourceItemId).toBe('item_vampiric');
    });

    it('hasEffect returns true when player has the effect', () => {
      const effects = makeEffects('player1', { id: 'vampiric', params: { drain: 3 } });
      const resolver = makeResolver(effects);
      expect(resolver.hasEffect('player1', 'vampiric')).toBe(true);
      expect(resolver.hasEffect('player1', 'cleave')).toBe(false);
    });

    it('getEffectParams returns params for a known effect', () => {
      const effects = makeEffects('player1', { id: 'momentum', params: { bonusPerStack: 2, maxStacks: 3 } });
      const resolver = makeResolver(effects);
      expect(resolver.getEffectParams('player1', 'momentum')).toEqual({ bonusPerStack: 2, maxStacks: 3 });
    });

    it('getEffectParams returns undefined for unknown effect', () => {
      const resolver = makeResolver();
      expect(resolver.getEffectParams('player1', 'vampiric')).toBeUndefined();
    });
  });

  describe('momentum tracking (trackAction)', () => {
    it('starts with zero momentum stacks', () => {
      const resolver = makeResolver();
      expect(resolver.getState().momentumStacks.get('player1')).toBeUndefined();
    });

    it('accumulates stacks on consecutive attacks: attack, attack = 1 stack, attack = 2 stacks', () => {
      const resolver = makeResolver();
      resolver.trackAction('player1', 'attack'); // first attack, no stack yet
      expect(resolver.getState().momentumStacks.get('player1')).toBe(0);
      resolver.trackAction('player1', 'attack'); // second consecutive attack → 1 stack
      expect(resolver.getState().momentumStacks.get('player1')).toBe(1);
      resolver.trackAction('player1', 'attack'); // third consecutive attack → 2 stacks
      expect(resolver.getState().momentumStacks.get('player1')).toBe(2);
    });

    it('resets momentum stacks to 0 on a non-attack action', () => {
      const resolver = makeResolver();
      resolver.trackAction('player1', 'attack');
      resolver.trackAction('player1', 'attack');
      expect(resolver.getState().momentumStacks.get('player1')).toBe(1);
      resolver.trackAction('player1', 'defend');
      expect(resolver.getState().momentumStacks.get('player1')).toBe(0);
    });

    it('after reset, next attack starts fresh (no stacks until second consecutive attack)', () => {
      const resolver = makeResolver();
      resolver.trackAction('player1', 'attack');
      resolver.trackAction('player1', 'attack'); // 1 stack
      resolver.trackAction('player1', 'defend'); // reset
      resolver.trackAction('player1', 'attack'); // first attack again, 0 stacks
      expect(resolver.getState().momentumStacks.get('player1')).toBe(0);
      resolver.trackAction('player1', 'attack'); // second consecutive → 1 stack
      expect(resolver.getState().momentumStacks.get('player1')).toBe(1);
    });
  });

  describe('rampage damage tracking (trackDamageDealt)', () => {
    it('accumulates total damage dealt', () => {
      const resolver = makeResolver();
      resolver.trackDamageDealt('player1', 10);
      expect(resolver.getState().rampageTotalDamage.get('player1')).toBe(10);
      resolver.trackDamageDealt('player1', 15);
      expect(resolver.getState().rampageTotalDamage.get('player1')).toBe(25);
    });

    it('tracks damage independently per player', () => {
      const resolver = makeResolver();
      resolver.trackDamageDealt('player1', 10);
      resolver.trackDamageDealt('player2', 5);
      expect(resolver.getState().rampageTotalDamage.get('player1')).toBe(10);
      expect(resolver.getState().rampageTotalDamage.get('player2')).toBe(5);
    });
  });

  describe('predator kill tracking (trackKill)', () => {
    it('increments kill count', () => {
      const resolver = makeResolver();
      resolver.trackKill('player1');
      expect(resolver.getState().predatorKills.get('player1')).toBe(1);
      resolver.trackKill('player1');
      expect(resolver.getState().predatorKills.get('player1')).toBe(2);
    });

    it('tracks kills independently per player', () => {
      const resolver = makeResolver();
      resolver.trackKill('player1');
      resolver.trackKill('player2');
      resolver.trackKill('player2');
      expect(resolver.getState().predatorKills.get('player1')).toBe(1);
      expect(resolver.getState().predatorKills.get('player2')).toBe(2);
    });
  });

  describe('consumed dungeon effects (isEffectConsumed / consumeEffect)', () => {
    it('returns false for un-consumed effect', () => {
      const resolver = makeResolver();
      expect(resolver.isEffectConsumed('player1', 'deathward')).toBe(false);
    });

    it('marks effect as consumed and returns true', () => {
      const resolver = makeResolver();
      resolver.consumeEffect('player1', 'deathward');
      expect(resolver.isEffectConsumed('player1', 'deathward')).toBe(true);
    });

    it('does not mark other effects as consumed', () => {
      const resolver = makeResolver();
      resolver.consumeEffect('player1', 'deathward');
      expect(resolver.isEffectConsumed('player1', 'undying')).toBe(false);
    });

    it('does not mark effects consumed for other players', () => {
      const resolver = makeResolver();
      resolver.consumeEffect('player1', 'deathward');
      expect(resolver.isEffectConsumed('player2', 'deathward')).toBe(false);
    });

    it('consuming the same effect twice does not duplicate it', () => {
      const resolver = makeResolver();
      resolver.consumeEffect('player1', 'deathward');
      resolver.consumeEffect('player1', 'deathward');
      const consumed = resolver.getConsumedEffects().get('player1');
      expect(consumed?.filter(e => e === 'deathward')).toHaveLength(1);
    });

    it('pre-populated usedDungeonEffects are recognized as consumed', () => {
      const usedEffects = new Map<string, string[]>([['player1', ['deathward']]]);
      const resolver = makeResolver(new Map(), usedEffects);
      expect(resolver.isEffectConsumed('player1', 'deathward')).toBe(true);
    });

    it('getConsumedEffects returns the full consumed map', () => {
      const resolver = makeResolver();
      resolver.consumeEffect('player1', 'deathward');
      resolver.consumeEffect('player2', 'undying');
      const consumed = resolver.getConsumedEffects();
      expect(consumed.get('player1')).toContain('deathward');
      expect(consumed.get('player2')).toContain('undying');
    });
  });

  describe('siphon stacks (incrementSiphonStacks)', () => {
    it('increments siphon stacks', () => {
      const resolver = makeResolver();
      resolver.incrementSiphonStacks('player1');
      expect(resolver.getState().siphonStacks.get('player1')).toBe(1);
      resolver.incrementSiphonStacks('player1');
      expect(resolver.getState().siphonStacks.get('player1')).toBe(2);
    });
  });
});

describe('ItemEffectResolver — On Attack', () => {
  const attacker = makeParticipant({ id: 'p1', damage: 10, initiative: 15 });
  const target = makeParticipant({ id: 'mob1', type: 'mob', name: 'Goblin', hp: 10, maxHp: 50, initiative: 8 });

  it('vampiric: returns leech healing', () => {
    const effects = makeEffects('p1', { id: 'vampiric', params: { leechPercent: 0.25 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.postDamageEffects).toHaveLength(1);
    expect(result.postDamageEffects[0]).toEqual({ type: 'vampiric', value: 2 });
  });

  it('cleave: returns splash to other enemies', () => {
    const enemy2 = makeParticipant({ id: 'mob2', type: 'mob', name: 'Orc', alive: true });
    const enemy3 = makeParticipant({ id: 'mob3', type: 'mob', name: 'Troll', alive: false });
    const effects = makeEffects('p1', { id: 'cleave', params: { splashPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target, enemy2, enemy3]);
    // Only mob2 is alive and not the primary target
    expect(result.postDamageEffects).toHaveLength(1);
    expect(result.postDamageEffects[0]).toEqual({ type: 'cleave', value: 4, targetId: 'mob2' });
  });

  it('executioner: adds bonus when target below threshold', () => {
    // target hp=10, maxHp=50 → 20% < 30% threshold
    const effects = makeEffects('p1', { id: 'executioner', params: { hpThresholdPercent: 30, bonusDamage: 5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(5);
  });

  it('executioner: no bonus when target above threshold', () => {
    const healthyTarget = makeParticipant({ id: 'mob1', type: 'mob', hp: 40, maxHp: 50 });
    // 80% > 30% threshold
    const effects = makeEffects('p1', { id: 'executioner', params: { hpThresholdPercent: 30, bonusDamage: 5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, healthyTarget, 8, 1.0, [attacker, healthyTarget]);
    expect(result.bonusDamage).toBe(0);
  });

  it('momentum: adds bonus based on stack count', () => {
    const effects = makeEffects('p1', { id: 'momentum', params: { damagePerStack: 2, maxStacks: 5 } });
    const resolver = makeResolver(effects);
    // Set 2 momentum stacks
    resolver.getState().momentumStacks.set('p1', 2);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(4); // 2 stacks * 2
  });

  it('first_strike: bonus when first in turn order', () => {
    const effects = makeEffects('p1', { id: 'first_strike', params: { bonusDamage: 3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target], true);
    expect(result.bonusDamage).toBe(3);
  });

  it('first_strike: no bonus when not first', () => {
    const effects = makeEffects('p1', { id: 'first_strike', params: { bonusDamage: 3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target], false);
    expect(result.bonusDamage).toBe(0);
  });

  it('blade_storm: bonus with higher initiative', () => {
    // attacker initiative=15, target initiative=8, diff=7
    const effects = makeEffects('p1', { id: 'blade_storm', params: { damagePerInitiativeDiff: 1.5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(10); // floor(7 * 1.5) = 10
  });

  it('blade_storm: no bonus when lower initiative', () => {
    const slowAttacker = makeParticipant({ id: 'p1', initiative: 3 });
    const effects = makeEffects('p1', { id: 'blade_storm', params: { damagePerInitiativeDiff: 1.5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(slowAttacker, target, 8, 1.0, [slowAttacker, target]);
    expect(result.bonusDamage).toBe(0);
  });

  it('flurry: bonus hits based on initiative', () => {
    // attacker initiative=15, threshold=5 → 3 hits, floor(8 * 0.3) = 2 per hit
    const effects = makeEffects('p1', { id: 'flurry', params: { hitsPerInitiativeThreshold: 5, bonusHitPercent: 0.3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.flurryHits).toBe(3);
    expect(result.flurryDamagePerHit).toBe(2);
  });

  it('flurry: no hits when initiative below threshold', () => {
    const slowAttacker = makeParticipant({ id: 'p1', initiative: 3 });
    const effects = makeEffects('p1', { id: 'flurry', params: { hitsPerInitiativeThreshold: 5, bonusHitPercent: 0.3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(slowAttacker, target, 8, 1.0, [slowAttacker, target]);
    expect(result.flurryHits).toBeUndefined();
    expect(result.flurryDamagePerHit).toBeUndefined();
  });

  it('brutal_impact: increases crit multiplier on crit', () => {
    // critMultiplier=1.5, attacker.damage=20, critBonusPerDamage=0.02 → 1.5 + 20*0.02 = 1.9
    const strongAttacker = makeParticipant({ id: 'p1', damage: 20 });
    const effects = makeEffects('p1', { id: 'brutal_impact', params: { critBonusPerDamage: 0.02 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(strongAttacker, target, 8, 1.5, [strongAttacker, target]);
    expect(result.modifiedCritMultiplier).toBeCloseTo(1.9);
  });

  it('brutal_impact: no modification at 1.0 crit multiplier', () => {
    const effects = makeEffects('p1', { id: 'brutal_impact', params: { critBonusPerDamage: 0.02 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.modifiedCritMultiplier).toBeUndefined();
  });

  it('venomous: applies poison debuff', () => {
    const effects = makeEffects('p1', { id: 'venomous', params: { poisonDamage: 3, duration: 2 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.postDamageEffects).toHaveLength(1);
    expect(result.postDamageEffects[0]).toEqual({ type: 'venomous', value: 3, targetId: 'mob1', duration: 2 });
  });

  it('overwhelm: reduces defense', () => {
    // attacker.damage=20, defenseReductionPercent=0.15 → floor(20 * 0.15) = 3
    const strongAttacker = makeParticipant({ id: 'p1', damage: 20 });
    const effects = makeEffects('p1', { id: 'overwhelm', params: { defenseReductionPercent: 0.15, duration: 2 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(strongAttacker, target, 8, 1.0, [strongAttacker, target]);
    expect(result.postDamageEffects).toHaveLength(1);
    expect(result.postDamageEffects[0]).toEqual({ type: 'overwhelm', value: 3, targetId: 'mob1', duration: 2 });
  });

  it('rampage: bonus from accumulated damage, capped at maxBonus', () => {
    // totalDamage=250, damagePerPointDealt=0.02 → floor(250 * 0.02) = 5, maxBonus=5
    const effects = makeEffects('p1', { id: 'rampage', params: { damagePerPointDealt: 0.02, maxBonus: 5 } });
    const resolver = makeResolver(effects);
    resolver.getState().rampageTotalDamage.set('p1', 250);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(5);
  });

  it('rampage: caps bonus at maxBonus', () => {
    const effects = makeEffects('p1', { id: 'rampage', params: { damagePerPointDealt: 0.02, maxBonus: 3 } });
    const resolver = makeResolver(effects);
    resolver.getState().rampageTotalDamage.set('p1', 500);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(3); // floor(500*0.02)=10, capped at 3
  });

  it('overcharge: multiplier when active, clears state', () => {
    const effects = makeEffects('p1', { id: 'overcharge', params: { overchargeMultiplier: 2.0 } });
    const resolver = makeResolver(effects);
    resolver.getState().overcharged.add('p1');
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.overchargeMultiplier).toBe(2.0);
    // State should be cleared
    expect(resolver.getState().overcharged.has('p1')).toBe(false);
  });

  it('overcharge: no multiplier when not active', () => {
    const effects = makeEffects('p1', { id: 'overcharge', params: { overchargeMultiplier: 2.0 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.overchargeMultiplier).toBeUndefined();
  });
});

describe('ItemEffectResolver — Defensive', () => {
  const player = makeParticipant({ id: 'p1', hp: 40, maxHp: 100, defense: 5 });
  const attacker = makeParticipant({ id: 'mob1', type: 'mob', name: 'Goblin', damage: 10 });

  it('thorns: returns flat damage back', () => {
    const effects = makeEffects('p1', { id: 'thorns', params: { flatDamage: 7 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(player, attacker, 20, false, [player, attacker]);
    expect(result.reflectDamage).toBe(7);
  });

  it('reflect: percentage when defending', () => {
    const effects = makeEffects('p1', { id: 'reflect', params: { reflectPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(player, attacker, 20, true, [player, attacker]);
    expect(result.reflectDamage).toBe(10); // floor(20 * 0.5)
  });

  it('reflect: no damage when not defending', () => {
    const effects = makeEffects('p1', { id: 'reflect', params: { reflectPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(player, attacker, 20, false, [player, attacker]);
    expect(result.reflectDamage).toBe(0);
  });

  it('deathward: triggers when HP drops below threshold', () => {
    // hp=40, incomingDamage=25 → hpAfterDamage=15, threshold=100*0.2=20
    const target = makeParticipant({ id: 'p1', hp: 40, maxHp: 100 });
    const effects = makeEffects('p1', {
      id: 'deathward',
      params: { hpThresholdPercent: 0.2, deathwardDefense: 10, deathwardDuration: 2 },
    });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(target, attacker, 25, false, [target, attacker]);
    expect(result.deathwardTriggered).toBe(true);
    expect(result.deathwardDefense).toBe(10);
    expect(result.deathwardDuration).toBe(2);
  });

  it('deathward: only triggers once per combat', () => {
    const target = makeParticipant({ id: 'p1', hp: 40, maxHp: 100 });
    const effects = makeEffects('p1', {
      id: 'deathward',
      params: { hpThresholdPercent: 0.2, deathwardDefense: 10, deathwardDuration: 2 },
    });
    const resolver = makeResolver(effects);
    // First trigger
    resolver.resolveOnDamageTaken(target, attacker, 25, false, [target, attacker]);
    // Second attempt — should not trigger
    const result2 = resolver.resolveOnDamageTaken(target, attacker, 25, false, [target, attacker]);
    expect(result2.deathwardTriggered).toBe(false);
    expect(result2.deathwardDefense).toBeUndefined();
  });

  it('guardian: intercepts damage from ally', () => {
    const target = makeParticipant({ id: 'p1', hp: 50, maxHp: 50 });
    const guardian = makeParticipant({ id: 'p2', name: 'Tank', hp: 80, maxHp: 80 });
    const effects = new Map<string, EquippedEffect[]>();
    effects.set('p2', [{ effectId: 'guardian', params: { interceptPercent: 0.3 }, sourceItemId: 'item_guardian' }]);
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(target, attacker, 20, false, [target, guardian, attacker]);
    expect(result.interceptedDamage).toBe(6); // floor(20 * 0.3)
    expect(result.guardianId).toBe('p2');
  });

  it('guardian: does not intercept own damage', () => {
    // The guardian IS the target — should not intercept for self
    const guardian = makeParticipant({ id: 'p2', name: 'Tank', hp: 80, maxHp: 80 });
    const effects = new Map<string, EquippedEffect[]>();
    effects.set('p2', [{ effectId: 'guardian', params: { interceptPercent: 0.3 }, sourceItemId: 'item_guardian' }]);
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDamageTaken(guardian, attacker, 20, false, [guardian, attacker]);
    expect(result.interceptedDamage).toBe(0);
    expect(result.guardianId).toBeUndefined();
  });
});

describe('ItemEffectResolver — Passive/Combat Start', () => {
  it('fortify: bonus defense from maxHp', () => {
    const participant = makeParticipant({ id: 'p1', maxHp: 100 });
    const effects = makeEffects('p1', { id: 'fortify', params: { defensePerHpPercent: 0.08 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolvePassiveStats(participant);
    expect(result.bonusDefense).toBe(8); // floor(100 * 0.08)
  });

  it('glass_cannon: zeroes defense, converts to damage', () => {
    const participant = makeParticipant({ id: 'p1', defense: 10 });
    const effects = makeEffects('p1', { id: 'glass_cannon', params: { damagePerDefense: 2.0 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolvePassiveStats(participant);
    expect(result.bonusDamage).toBe(20); // 10 * 2.0
    expect(result.overrideDefense).toBe(0);
  });

  it('party_buff: bonus damage for allies (not mobs)', () => {
    const p1 = makeParticipant({ id: 'p1', name: 'Bard' });
    const p2 = makeParticipant({ id: 'p2', name: 'Fighter' });
    const mob = makeParticipant({ id: 'mob1', type: 'mob', name: 'Goblin' });
    const effects = makeEffects('p1', { id: 'party_buff', params: { bonusDamage: 3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolvePartyBuffs([p1, p2, mob]);
    expect(result.get('p1')).toBe(3); // buff holder included
    expect(result.get('p2')).toBe(3);
    expect(result.has('mob1')).toBe(false);
  });

  it('berserk: bonus at 50% HP, zero at full HP', () => {
    // 50% HP: floor(12 * (1 - 25/50)) = floor(12 * 0.5) = 6
    const halfHp = makeParticipant({ id: 'p1', hp: 25, maxHp: 50 });
    const effects = makeEffects('p1', { id: 'berserk', params: { maxBonusDamage: 12 } });
    const resolver = makeResolver(effects);
    expect(resolver.resolvePassiveStats(halfHp).bonusDamage).toBe(6);

    // Full HP: floor(12 * (1 - 50/50)) = 0
    const fullHp = makeParticipant({ id: 'p1', hp: 50, maxHp: 50 });
    expect(resolver.resolvePassiveStats(fullHp).bonusDamage).toBe(0);
  });

  it('predator: bonus initiative from kills', () => {
    const participant = makeParticipant({ id: 'p1' });
    const effects = makeEffects('p1', { id: 'predator', params: { initiativePerKill: 3 } });
    const resolver = makeResolver(effects);
    resolver.trackKill('p1');
    resolver.trackKill('p1');
    const result = resolver.resolvePassiveStats(participant);
    expect(result.bonusInitiative).toBe(6); // 2 * 3
  });

  it('siphon_armor: bonus defense from stacks', () => {
    const participant = makeParticipant({ id: 'p1' });
    const effects = makeEffects('p1', { id: 'siphon_armor', params: { defensePerHit: 2 } });
    const resolver = makeResolver(effects);
    resolver.incrementSiphonStacks('p1');
    resolver.incrementSiphonStacks('p1');
    resolver.incrementSiphonStacks('p1');
    const result = resolver.resolvePassiveStats(participant);
    expect(result.bonusDefense).toBe(6); // 3 * 2
  });
});

describe('ItemEffectResolver — Survival', () => {
  it('self_revive: prevents death, returns revive HP', () => {
    const participant = makeParticipant({ id: 'p1', hp: 0, maxHp: 100 });
    const effects = makeEffects('p1', { id: 'self_revive', params: { revivePercent: 0.25 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(true);
    expect(result.effectId).toBe('self_revive');
    expect(result.reviveHp).toBe(25); // floor(100 * 0.25) = 25
  });

  it('self_revive: does not trigger if already consumed', () => {
    const participant = makeParticipant({ id: 'p1', hp: 0, maxHp: 100 });
    const effects = makeEffects('p1', { id: 'self_revive', params: { revivePercent: 0.25 } });
    const usedEffects = new Map<string, string[]>([['p1', ['self_revive']]]);
    const resolver = makeResolver(effects, usedEffects);
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(false);
  });

  it('undying_fury: grants extra turns on death', () => {
    const participant = makeParticipant({ id: 'p1', hp: 0, maxHp: 100 });
    const effects = makeEffects('p1', { id: 'undying_fury', params: { extraTurns: 3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(true);
    expect(result.effectId).toBe('undying_fury');
    expect(result.extraTurns).toBe(3);
    expect(resolver.getState().undyingTurns.get('p1')).toBe(3);
  });

  it('undying_fury: does not trigger if already consumed', () => {
    const participant = makeParticipant({ id: 'p1', hp: 0, maxHp: 100 });
    const effects = makeEffects('p1', { id: 'undying_fury', params: { extraTurns: 3 } });
    const usedEffects = new Map<string, string[]>([['p1', ['undying_fury']]]);
    const resolver = makeResolver(effects, usedEffects);
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(false);
  });

  it('self_revive takes priority over undying_fury when both equipped', () => {
    const participant = makeParticipant({ id: 'p1', hp: 0, maxHp: 100 });
    const effects = new Map<string, import('@caverns/shared').EquippedEffect[]>();
    effects.set('p1', [
      { effectId: 'self_revive', params: { revivePercent: 0.25 }, sourceItemId: 'item_self_revive' },
      { effectId: 'undying_fury', params: { extraTurns: 3 }, sourceItemId: 'item_undying_fury' },
    ]);
    const resolver = makeResolver(effects);
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(true);
    expect(result.effectId).toBe('self_revive');
    expect(result.reviveHp).toBe(25);
  });
});

describe('ItemEffectResolver — Poison Tick', () => {
  it('returns poison damage for poisoned participant', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('p1', [{ damage: 4, turnsRemaining: 2, sourceId: 'mob1' }]);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.poisonDamage).toBe(4);
  });

  it('decrements poison duration, removes expired entries', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('p1', [{ damage: 4, turnsRemaining: 1, sourceId: 'mob1' }]);
    resolver.resolveOnTurnStart('p1');
    // turnsRemaining reaches 0, should be removed
    expect(resolver.getState().poisoned.has('p1')).toBe(false);
  });

  it('stacks multiple poisons', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('p1', [
      { damage: 4, turnsRemaining: 2, sourceId: 'mob1' },
      { damage: 3, turnsRemaining: 1, sourceId: 'mob2' },
    ]);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.poisonDamage).toBe(7); // 4 + 3
    // The 1-turn poison should be removed, 2-turn poison decremented to 1
    const remaining = resolver.getState().poisoned.get('p1');
    expect(remaining).toHaveLength(1);
    expect(remaining![0].damage).toBe(4);
    expect(remaining![0].turnsRemaining).toBe(1);
  });

  it('decrements overwhelm debuffs, removes expired', () => {
    const resolver = makeResolver();
    resolver.getState().overwhelmDebuffs.set('p1', [
      { reduction: 3, turnsRemaining: 1 },
      { reduction: 2, turnsRemaining: 2 },
    ]);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.defenseReduction).toBe(5); // 3 + 2
    const remaining = resolver.getState().overwhelmDebuffs.get('p1');
    expect(remaining).toHaveLength(1);
    expect(remaining![0].reduction).toBe(2);
    expect(remaining![0].turnsRemaining).toBe(1);
  });

  it('undying_fury: decrements turns, signals expiry when reaching 0', () => {
    const resolver = makeResolver();
    resolver.getState().undyingTurns.set('p1', 1);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.undyingExpired).toBe(true);
    expect(resolver.getState().undyingTurns.has('p1')).toBe(false);
  });

  it('undying_fury: decrements without expiry when turns remain', () => {
    const resolver = makeResolver();
    resolver.getState().undyingTurns.set('p1', 3);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.undyingExpired).toBe(false);
    expect(resolver.getState().undyingTurns.get('p1')).toBe(2);
  });
});

describe('ItemEffectResolver — Activated', () => {
  it('overcharge: activates, applies self-damage, sets overcharged state', () => {
    const caster = makeParticipant({ id: 'p1', maxHp: 100 });
    const effects = makeEffects('p1', { id: 'overcharge', params: { selfDamagePercent: 0.15, overchargeMultiplier: 2.0 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveActivatedEffect('p1', 'overcharge', caster, undefined, [caster]);
    expect(result.success).toBe(true);
    expect(result.effectId).toBe('overcharge');
    expect(result.selfDamage).toBe(15); // floor(100 * 0.15)
    expect(resolver.getState().overcharged.has('p1')).toBe(true);
  });

  it('overcharge: fails if player does not have the effect', () => {
    const caster = makeParticipant({ id: 'p1', maxHp: 100 });
    const resolver = makeResolver();
    const result = resolver.resolveActivatedEffect('p1', 'overcharge', caster, undefined, [caster]);
    expect(result.success).toBe(false);
    expect(result.effectId).toBe('overcharge');
  });

  it('revive_once: revives downed ally, marks consumed', () => {
    const caster = makeParticipant({ id: 'p1' });
    const downed = makeParticipant({ id: 'p2', maxHp: 80, hp: 0, alive: false });
    const effects = makeEffects('p1', { id: 'revive_once', params: { revivePercent: 0.3 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveActivatedEffect('p1', 'revive_once', caster, downed, [caster, downed]);
    expect(result.success).toBe(true);
    expect(result.effectId).toBe('revive_once');
    expect(result.reviveHp).toBe(24); // floor(80 * 0.3)
    expect(result.targetIds).toEqual(['p2']);
    expect(resolver.isEffectConsumed('p1', 'revive_once')).toBe(true);
  });

  it('revive_once: fails if already consumed', () => {
    const caster = makeParticipant({ id: 'p1' });
    const downed = makeParticipant({ id: 'p2', maxHp: 80, hp: 0, alive: false });
    const effects = makeEffects('p1', { id: 'revive_once', params: { revivePercent: 0.3 } });
    const usedEffects = new Map<string, string[]>([['p1', ['revive_once']]]);
    const resolver = makeResolver(effects, usedEffects);
    const result = resolver.resolveActivatedEffect('p1', 'revive_once', caster, downed, [caster, downed]);
    expect(result.success).toBe(false);
    expect(result.effectId).toBe('revive_once');
  });

  it('rally: heals all allies based on caster maxHp, returns correct targetIds (players only, not mobs)', () => {
    const caster = makeParticipant({ id: 'p1', maxHp: 100 });
    const ally = makeParticipant({ id: 'p2', maxHp: 60 });
    const mob = makeParticipant({ id: 'mob1', type: 'mob', name: 'Goblin' });
    const effects = makeEffects('p1', { id: 'rally', params: { healPercent: 0.15 } });
    const resolver = makeResolver(effects);
    const result = resolver.resolveActivatedEffect('p1', 'rally', caster, undefined, [caster, ally, mob]);
    expect(result.success).toBe(true);
    expect(result.effectId).toBe('rally');
    expect(result.healing).toBe(15); // floor(100 * 0.15)
    expect(result.targetIds).toContain('p1');
    expect(result.targetIds).toContain('p2');
    expect(result.targetIds).not.toContain('mob1');
  });
});
