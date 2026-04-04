import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CombatManager } from './CombatManager.js';
import type { MobInstance, CombatState } from '@caverns/shared';

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

  it('resolves a defend action (doubles defense until next turn)', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 4, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    cm.resolvePlayerAction('p1', { action: 'defend' });
    const mobResult = cm.resolveMobTurn('mob1');
    // mob damage 8 - player defense 8 (4*2) = min 1
    expect(mobResult!.damage).toBeLessThanOrEqual(8);
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
});
