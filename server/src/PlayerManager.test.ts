import { describe, it, expect } from 'vitest';
import { PlayerManager } from './PlayerManager.js';
import { STARTER_POTION, PROGRESSION_CONFIG } from '@caverns/shared';

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
    expect(p.equipment.weapon?.id).toBe('vanguard_iron_mace');
    expect(p.consumables.filter((c) => c !== null)).toHaveLength(2);
    expect(p.consumables[0]?.id).toBe('minor_hp_potion');
  });

  it('computes damage from equipped weapon', () => {
    const pm = createManager();
    const stats = pm.getComputedStats('p1');
    expect(stats.damage).toBe(7);
  });

  it('equips an item to an occupied slot, replacing existing', () => {
    const pm = createManager();
    const shield = {
      id: 's1', name: 'Shield', description: '', rarity: 'common' as const,
      slot: 'offhand' as const, stats: { defense: 3 },
    };
    const replaced = pm.equipItem('p1', shield);
    expect(replaced?.id).toBe('vanguard_tower_shield');
    expect(pm.getPlayer('p1')!.equipment.offhand?.id).toBe('s1');
  });

  it('equips an item and returns the replaced item', () => {
    const pm = createManager();
    const sword = {
      id: 'w2', name: 'Better Sword', description: '', rarity: 'uncommon' as const,
      slot: 'weapon' as const, stats: { damage: 12 },
    };
    const replaced = pm.equipItem('p1', sword);
    expect(replaced?.id).toBe('vanguard_iron_mace');
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

  it('creates player with class-specific base stats', () => {
    const pm = new PlayerManager();
    const player = pm.addPlayer('p1', 'Alice', 'room1', 'shadowblade');
    expect(player.className).toBe('shadowblade');
    expect(player.maxHp).toBe(35);
    expect(player.hp).toBe(35);
    expect(player.equipment.weapon?.id).toBe('shadowblade_twin_daggers');
    expect(player.equipment.offhand?.id).toBe('shadowblade_smoke_cloak');
  });

  it('initializes player with full energy', () => {
    const pm = new PlayerManager();
    const player = pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    expect(player.energy).toBe(30);
  });

  it('spends energy', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 15);
    const player = pm.getPlayer('p1')!;
    expect(player.energy).toBe(15);
  });

  it('regens energy capped at 30', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 5);
    pm.regenEnergy('p1', 10);
    const player = pm.getPlayer('p1')!;
    expect(player.energy).toBe(30);
  });

  it('hasEnergy returns false when not enough', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 20);
    expect(pm.hasEnergy('p1', 15)).toBe(false);
  });

  it('hasEnergy returns true when enough', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    expect(pm.hasEnergy('p1', 25)).toBe(true);
  });

  it('awards XP and returns new total', () => {
    const pm = createManager();
    const total = pm.awardXp('p1', 10);
    expect(total).toBe(10);
    expect(pm.getPlayer('p1')!.xp).toBe(10);
  });

  it('detects single level-up and grants stat points', () => {
    const pm = createManager();
    pm.awardXp('p1', 30); // threshold for level 2
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(1);
    const p = pm.getPlayer('p1')!;
    expect(p.level).toBe(2);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel);
  });

  it('detects multi-level-up', () => {
    const pm = createManager();
    pm.awardXp('p1', 150); // past level 3 threshold (140)
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(3); // levels 2, 3, 4
    const p = pm.getPlayer('p1')!;
    expect(p.level).toBe(4);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel * 3);
  });

  it('does not level past max level', () => {
    const pm = createManager();
    pm.awardXp('p1', 99999);
    const levelsGained = pm.checkLevelUp('p1');
    const maxLevel = PROGRESSION_CONFIG.levelThresholds.length;
    expect(pm.getPlayer('p1')!.level).toBe(maxLevel);
  });

  it('returns 0 levels gained when XP is below next threshold', () => {
    const pm = createManager();
    pm.awardXp('p1', 5);
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(0);
    expect(pm.getPlayer('p1')!.level).toBe(1);
  });

  it('allocates stat points', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const result = pm.allocateStat('p1', 'vitality', 1);
    expect(result).toBe(true);
    const p = pm.getPlayer('p1')!;
    expect(p.statAllocations['vitality']).toBe(1);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel - 1);
  });

  it('rejects allocation with insufficient points', () => {
    const pm = createManager();
    const result = pm.allocateStat('p1', 'vitality', 1);
    expect(result).toBe(false);
    expect(pm.getPlayer('p1')!.unspentStatPoints).toBe(0);
  });

  it('rejects allocation with invalid stat ID', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const result = pm.allocateStat('p1', 'nonexistent', 1);
    expect(result).toBe(false);
  });

  it('vitality allocation increases current HP', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const hpBefore = pm.getPlayer('p1')!.hp;
    pm.allocateStat('p1', 'vitality', 1);
    const hpAfter = pm.getPlayer('p1')!.hp;
    expect(hpAfter - hpBefore).toBe(5); // perPoint for vitality
  });
});
