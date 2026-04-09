import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CombatManager } from './CombatManager.js';
import type { MobInstance, CombatState, EquippedEffect } from '@caverns/shared';

function makeMob(overrides?: Partial<MobInstance>): MobInstance {
  return {
    instanceId: 'mob1',
    templateId: 'fungal_crawler',
    name: 'Fungal Crawler',
    maxHp: 25,
    hp: 25,
    damage: 8,
    defense: 2,
    initiative: 4,
    ...overrides,
  };
}

describe('CombatManager', () => {
  it('initializes combat with participants and turn order', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 5 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const state = cm.getState();
    expect(state.roomId).toBe('room1');
    expect(state.participants).toHaveLength(2);
    expect(state.turnOrder).toHaveLength(2);
    expect(state.roundNumber).toBe(1);
  });

  it('resolves an attack action', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result).not.toBeNull();
    expect(result!.action).toBe('attack');
    // damage = attacker.damage - target.defense = 10 - 2 = 8
    expect(result!.damage).toBe(8);
  });

  it('resolves a defend action and triggers QTE path when mob attacks defender', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    cm.resolvePlayerAction('p1', { action: 'defend' });
    const mobResult = cm.resolveMobTurn('mob1');
    // defending player triggers QTE path: pendingDamage returned, hp unchanged
    expect(mobResult!.defendQte).toBe(true);
    expect(mobResult!.pendingDamage).toBeDefined();
    expect(mobResult!.targetHp).toBe(50);
  });

  it('kills a mob and marks it dead', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 30, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob({ hp: 5 })];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result!.targetDowned).toBe(true);
    expect(cm.isComplete()).toBe(true);
    expect(cm.getResult()).toBe('victory');
  });

  it('returns flee result and removes player', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 5, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'flee', fleeDirection: 'north' });
    expect(result!.fled).toBe(true);
    expect(result!.damage).toBe(4); // mob.damage / 2
    expect(cm.isComplete()).toBe(true);
    expect(cm.getResult()).toBe('flee');
  });

  it('adds a player mid-combat', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 0, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    cm.addPlayer({ id: 'p2', name: 'Bob', hp: 50, maxHp: 50, damage: 8, defense: 1, initiative: 7 });
    const state = cm.getState();
    expect(state.participants).toHaveLength(3);
  });

  it('advances turns correctly', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob({ initiative: 1 })];
    const cm = new CombatManager('room1', players, mobs);
    // p1 has higher initiative, should go first
    expect(cm.getCurrentTurnId()).toBe('p1');
    cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    cm.advanceTurn();
    expect(cm.getCurrentTurnId()).toBe('mob1');
    cm.resolveMobTurn('mob1');
    cm.advanceTurn();
    expect(cm.getState().roundNumber).toBe(2);
    expect(cm.getCurrentTurnId()).toBe('p1');
  });

  it('applies crit multiplier to attack damage', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1', critMultiplier: 1.5 });
    expect(result!.damage).toBe(12);
    expect(result!.critMultiplier).toBe(1.5);
  });

  it('applies 1.5x crit multiplier to attack damage', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1', critMultiplier: 1.5 });
    expect(result!.damage).toBe(12);
  });

  it('defaults to 1.0x when no critMultiplier provided', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result!.damage).toBe(8);
  });

  it('mob targets player with taunt buff', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
      { id: 'p2', name: 'Bob', hp: 50, maxHp: 50, damage: 8, defense: 2, initiative: 5 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const p1 = cm.getParticipant('p1')!;
    p1.buffs.push({ type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' });
    const result = cm.resolveMobTurn('mob1');
    expect(result!.targetId).toBe('p1');
  });

  it('mob can attack any player when no taunt buff is present', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
      { id: 'p2', name: 'Bob', hp: 50, maxHp: 50, damage: 8, defense: 2, initiative: 5 },
    ];
    const mobs = [makeMob(), makeMob({ instanceId: 'mob2', name: 'Crawler 2' })];
    const cm = new CombatManager('room1', players, mobs);
    const result1 = cm.resolveMobTurn('mob1');
    const result2 = cm.resolveMobTurn('mob2');
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  it('mob skips turn when smoke bombed', () => {
    const players = [{ id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const mob = cm.getParticipant('mob1')!;
    mob.buffs.push({ type: 'skip_turn', turnsRemaining: 1, sourcePlayerId: 'p1' });
    const result = cm.resolveMobTurn('mob1');
    expect(result!.action).toBe('defend');
    expect(mob.buffs.filter(b => b.type === 'skip_turn')).toHaveLength(0);
  });

  it('prevent_down keeps target at 1 HP', () => {
    const players = [{ id: 'p1', name: 'Alice', hp: 5, maxHp: 50, damage: 10, defense: 0, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const p1 = cm.getParticipant('p1')!;
    p1.buffs.push({ type: 'prevent_down', turnsRemaining: 1, sourcePlayerId: 'p1' });
    const dmgResult = cm.applyDamage('p1', 50);
    expect(dmgResult!.targetDowned).toBe(false);
    expect(dmgResult!.newHp).toBe(1);
  });

  it('resolveMobTurn returns pendingDamage when target is defending', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    cm.resolvePlayerAction('p1', { action: 'defend' });
    const result = cm.resolveMobTurn('mob1');
    expect(result!.defendQte).toBe(true);
    expect(result!.pendingDamage).toBeDefined();
    expect(result!.targetHp).toBe(50);
  });
});

describe('CombatManager — Item Effects', () => {
  it('vampiric weapon heals attacker on hit', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'vampiric', params: { leechPercent: 0.5 }, sourceItemId: 'lifedrinker' }]],
    ]);
    const players = [{ id: 'p1', name: 'Alice', hp: 30, maxHp: 50, damage: 10, defense: 2, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result).not.toBeNull();
    // damage = max(1, floor((10 - 2) * 1.0)) = 8
    expect(result!.damage).toBe(8);
    // vampiric: floor(10 * 0.5) = 5, capped by missing hp (20), so healed = 5
    expect(result!.itemEffectHealing).toBe(5);
    // Actor hp should be 30 + 5 = 35
    expect(cm.getParticipant('p1')!.hp).toBe(35);
  });

  it('thorns damages mob when player is attacked', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'thorns', params: { flatDamage: 7 }, sourceItemId: 'mantle' }]],
    ]);
    const players = [{ id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 1 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolveMobTurn('mob1');
    expect(result).not.toBeNull();
    expect(result!.itemEffectDamage).toBe(7);
    // Mob should have taken 7 thorns damage: 25 - 7 = 18
    expect(cm.getParticipant('mob1')!.hp).toBe(18);
  });

  it('self_revive prevents death once', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'self_revive', params: { revivePercent: 0.25 }, sourceItemId: 'phoenix' }]],
    ]);
    const players = [{ id: 'p1', name: 'Alice', hp: 5, maxHp: 100, damage: 10, defense: 0, initiative: 1 }];
    const mobs = [makeMob({ damage: 20 })];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolveMobTurn('mob1');
    expect(result!.targetDowned).toBe(false);
    expect(result!.targetHp).toBe(25); // 25% of 100
    expect(result!.itemEffect).toBe('self_revive');
  });

  it('self_revive does not trigger a second time', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'self_revive', params: { revivePercent: 0.25 }, sourceItemId: 'phoenix' }]],
    ]);
    const players = [{ id: 'p1', name: 'Alice', hp: 5, maxHp: 100, damage: 10, defense: 0, initiative: 1 }];
    const mobs = [makeMob({ damage: 20 })];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    // First hit: revive triggers
    cm.resolveMobTurn('mob1');
    // Set hp low again for second lethal hit
    cm.getParticipant('p1')!.hp = 5;
    const result2 = cm.resolveMobTurn('mob1');
    expect(result2!.targetDowned).toBe(true);
    expect(result2!.itemEffect).toBeUndefined();
  });

  it('backwards compatible: works without playerEffects param', () => {
    const players = [{ id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result!.damage).toBe(8);
    expect(result!.itemEffect).toBeUndefined();
    expect(result!.itemEffectDamage).toBeUndefined();
    expect(result!.itemEffectHealing).toBeUndefined();
  });

  it('getEffectResolver returns the resolver instance', () => {
    const cm = new CombatManager('room1', [], []);
    expect(cm.getEffectResolver()).toBeDefined();
  });

  it('getConsumedEffects returns consumed effects map', () => {
    const used = new Map([['p1', ['self_revive']]]);
    const cm = new CombatManager('room1', [], [], new Map(), used);
    expect(cm.getConsumedEffects().get('p1')).toEqual(['self_revive']);
  });
});
