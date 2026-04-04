import { describe, it, expect } from 'vitest';
import { PlayerManager } from './PlayerManager.js';
import { STARTER_WEAPON, STARTER_POTION } from '@caverns/shared';

describe('PlayerManager', () => {
  function createManager() {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'entrance');
    return pm;
  }

  it('creates a player with starter loadout', () => {
    const pm = createManager();
    const p = pm.getPlayer('p1')!;
    expect(p.name).toBe('Alice');
    expect(p.hp).toBe(50);
    expect(p.maxHp).toBe(50);
    expect(p.equipment.weapon?.id).toBe('starter_sword');
    expect(p.consumables.filter((c) => c !== null)).toHaveLength(2);
    expect(p.consumables[0]?.id).toBe('minor_hp_potion');
  });

  it('computes damage from equipped weapon', () => {
    const pm = createManager();
    const stats = pm.getComputedStats('p1');
    expect(stats.damage).toBe(10);
  });

  it('equips an item to an empty slot', () => {
    const pm = createManager();
    const shield = {
      id: 's1', name: 'Shield', description: '', rarity: 'common' as const,
      slot: 'offhand' as const, stats: { defense: 3 },
    };
    const replaced = pm.equipItem('p1', shield);
    expect(replaced).toBeNull();
    expect(pm.getPlayer('p1')!.equipment.offhand?.id).toBe('s1');
  });

  it('equips an item and returns the replaced item', () => {
    const pm = createManager();
    const sword = {
      id: 'w2', name: 'Better Sword', description: '', rarity: 'uncommon' as const,
      slot: 'weapon' as const, stats: { damage: 12 },
    };
    const replaced = pm.equipItem('p1', sword);
    expect(replaced?.id).toBe('starter_sword');
    expect(pm.getPlayer('p1')!.equipment.weapon?.id).toBe('w2');
  });

  it('adds a consumable to the first empty slot', () => {
    const pm = createManager();
    const potion = {
      id: 'pot1', name: 'Potion', description: '', rarity: 'common' as const,
      slot: 'consumable' as const, stats: { healAmount: 20 },
    };
    const added = pm.addConsumable('p1', potion);
    expect(added).toBe(true);
    expect(pm.getPlayer('p1')!.consumables[2]?.id).toBe('pot1');
  });

  it('uses a consumable to heal', () => {
    const pm = createManager();
    pm.takeDamage('p1', 30);
    expect(pm.getPlayer('p1')!.hp).toBe(20);
    const result = pm.useConsumable('p1', 0);
    expect(result).not.toBeNull();
    expect(result!.healing).toBe(15);
    expect(pm.getPlayer('p1')!.hp).toBe(35);
    expect(pm.getPlayer('p1')!.consumables[0]).toBeNull();
  });

  it('does not overheal past maxHp', () => {
    const pm = createManager();
    pm.takeDamage('p1', 5);
    const result = pm.useConsumable('p1', 0);
    expect(result!.healing).toBe(5);
    expect(pm.getPlayer('p1')!.hp).toBe(50);
  });

  it('downs a player at 0 HP', () => {
    const pm = createManager();
    pm.takeDamage('p1', 999);
    expect(pm.getPlayer('p1')!.hp).toBe(0);
    expect(pm.getPlayer('p1')!.status).toBe('downed');
  });

  it('revives a downed player to 50% HP', () => {
    const pm = createManager();
    pm.takeDamage('p1', 999);
    pm.revivePlayer('p1');
    expect(pm.getPlayer('p1')!.hp).toBe(25);
    expect(pm.getPlayer('p1')!.status).toBe('exploring');
  });

  it('checks if all players are downed', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'entrance');
    pm.addPlayer('p2', 'Bob', 'entrance');
    pm.takeDamage('p1', 999);
    expect(pm.allPlayersDowned()).toBe(false);
    pm.takeDamage('p2', 999);
    expect(pm.allPlayersDowned()).toBe(true);
  });
});
