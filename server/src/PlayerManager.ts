import {
  type Player,
  type Item,
  type ComputedStats,
  type EquipmentSlot,
  createPlayer,
  computePlayerStats,
  CLASS_STARTER_ITEMS,
  getClassDefinition,
  STARTER_POTION,
  CONSUMABLE_SLOTS,
  INVENTORY_SLOTS,
  ENERGY_CONFIG,
  PROGRESSION_CONFIG,
} from '@caverns/shared';

export class PlayerManager {
  private players = new Map<string, Player>();

  addPlayer(id: string, name: string, roomId: string, className: string = 'vanguard'): Player {
    const classDef = getClassDefinition(className);
    const player = createPlayer(id, name, roomId, className);

    // Apply class base stats
    if (classDef) {
      player.maxHp = classDef.baseStats.maxHp;
      player.hp = classDef.baseStats.maxHp;
    }

    // Equip class-specific starter gear
    const starterItems = CLASS_STARTER_ITEMS[className];
    if (starterItems) {
      player.equipment.weapon = { ...starterItems.weapon };
      player.equipment.offhand = { ...starterItems.offhand };
    }

    player.consumables[0] = { ...STARTER_POTION };
    player.consumables[1] = { ...STARTER_POTION };
    this.players.set(id, player);
    return player;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  addHydratedPlayer(player: Player): void {
    this.players.set(player.id, player);
  }

  replacePlayerId(oldId: string, newId: string): boolean {
    const player = this.players.get(oldId);
    if (!player) return false;
    player.id = newId;
    this.players.delete(oldId);
    this.players.set(newId, player);
    return true;
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getPlayersInRoom(roomId: string): Player[] {
    return this.getAllPlayers().filter((p) => p.roomId === roomId);
  }

  getComputedStats(playerId: string): ComputedStats {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    return computePlayerStats(player);
  }

  movePlayer(playerId: string, roomId: string): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.roomId = roomId;
  }

  equipItem(playerId: string, item: Item): Item | null {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const slot = item.slot as EquipmentSlot;
    const replaced = player.equipment[slot];
    player.equipment[slot] = item;
    this.recalcMaxHp(player);
    return replaced;
  }

  addConsumable(playerId: string, item: Item): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const emptyIndex = player.consumables.indexOf(null);
    if (emptyIndex === -1) return false;
    player.consumables[emptyIndex] = item;
    return true;
  }

  addToInventory(playerId: string, item: Item): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const emptyIndex = player.inventory.indexOf(null);
    if (emptyIndex === -1) return false;
    player.inventory[emptyIndex] = item;
    return true;
  }

  removeFromInventory(playerId: string, inventoryIndex: number): Item | null {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const item = player.inventory[inventoryIndex];
    if (!item) return null;
    player.inventory[inventoryIndex] = null;
    return item;
  }

  equipFromInventory(playerId: string, inventoryIndex: number): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const item = player.inventory[inventoryIndex];
    if (!item) return false;
    if (item.slot === 'consumable') {
      const emptyConsumable = player.consumables.indexOf(null);
      if (emptyConsumable === -1) return false;
      player.consumables[emptyConsumable] = item;
      player.inventory[inventoryIndex] = null;
      return true;
    }
    const slot = item.slot as EquipmentSlot;
    const replaced = player.equipment[slot];
    player.equipment[slot] = item;
    player.inventory[inventoryIndex] = replaced;
    this.recalcMaxHp(player);
    return true;
  }

  useConsumable(playerId: string, index: number): { healing?: number; damage?: number } | null {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const item = player.consumables[index];
    if (!item) return null;
    player.consumables[index] = null;
    const result: { healing?: number; damage?: number } = {};
    if (item.stats.healAmount) {
      const missing = player.maxHp - player.hp;
      const healed = Math.min(item.stats.healAmount, missing);
      player.hp += healed;
      result.healing = healed;
    }
    if (item.stats.damage) {
      result.damage = item.stats.damage;
    }
    return result;
  }

  takeDamage(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.hp = Math.max(0, player.hp - amount);
    if (player.hp === 0) {
      player.status = 'downed';
    }
  }

  revivePlayer(playerId: string, hp?: number): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.hp = hp ?? Math.floor(player.maxHp / 2);
    player.status = 'exploring';
  }

  healPlayer(playerId: string, amount: number): number {
    const player = this.players.get(playerId);
    if (!player) return 0;
    const healed = Math.min(amount, player.maxHp - player.hp);
    player.hp += healed;
    return healed;
  }

  setStatus(playerId: string, status: Player['status']): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.status = status;
  }

  allPlayersDowned(): boolean {
    const players = this.getAllPlayers();
    return players.length > 0 && players.every((p) => p.status === 'downed');
  }

  addKeyToAll(keyId: string): void {
    for (const player of this.players.values()) {
      if (!player.keychain.includes(keyId)) {
        player.keychain.push(keyId);
      }
    }
  }

  hasKey(playerId: string, keyId: string): boolean {
    const player = this.players.get(playerId);
    return player?.keychain.includes(keyId) ?? false;
  }

  spendEnergy(playerId: string, cost: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.energy = Math.max(0, player.energy - cost);
  }

  regenEnergy(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const stats = computePlayerStats(player);
    player.energy = Math.min(stats.maxEnergy, player.energy + amount);
  }

  hasEnergy(playerId: string, cost: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    return player.energy >= cost;
  }

  addGold(playerId: string, amount: number): number {
    const player = this.players.get(playerId);
    if (!player) return 0;
    player.gold += amount;
    return player.gold;
  }

  awardXp(playerId: string, amount: number): number {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.xp += amount;
    return player.xp;
  }

  checkLevelUp(playerId: string): number {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const thresholds = PROGRESSION_CONFIG.levelThresholds;
    const maxLevel = thresholds.length;
    let newLevel = player.level;
    while (newLevel < maxLevel && player.xp >= thresholds[newLevel]) {
      newLevel++;
    }
    const levelsGained = newLevel - player.level;
    if (levelsGained > 0) {
      player.level = newLevel;
      player.unspentStatPoints += levelsGained * PROGRESSION_CONFIG.statPointsPerLevel;
    }
    return levelsGained;
  }

  allocateStat(playerId: string, statId: string, points: number): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);

    const statDef = PROGRESSION_CONFIG.statDefinitions.find(s => s.id === statId);
    if (!statDef) return false;
    if (player.unspentStatPoints < points) return false;

    player.statAllocations[statId] = (player.statAllocations[statId] ?? 0) + points;
    player.unspentStatPoints -= points;

    // Recalculate maxHp and adjust current HP
    this.recalcMaxHp(player);

    return true;
  }

  private recalcMaxHp(player: Player): void {
    const stats = computePlayerStats(player);
    const oldMax = player.maxHp;
    player.maxHp = stats.maxHp;
    if (stats.maxHp > oldMax) {
      // Gained maxHp — grant the bonus as current hp too
      player.hp += stats.maxHp - oldMax;
    } else if (player.hp > stats.maxHp) {
      // Lost maxHp — clamp current hp
      player.hp = stats.maxHp;
    }
  }
}
