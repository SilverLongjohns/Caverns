import {
  type Player,
  type Item,
  type ComputedStats,
  type EquipmentSlot,
  createPlayer,
  computePlayerStats,
  STARTER_WEAPON,
  STARTER_POTION,
  CONSUMABLE_SLOTS,
  INVENTORY_SLOTS,
} from '@caverns/shared';

export class PlayerManager {
  private players = new Map<string, Player>();

  addPlayer(id: string, name: string, roomId: string): Player {
    const player = createPlayer(id, name, roomId);
    player.equipment.weapon = { ...STARTER_WEAPON };
    player.consumables[0] = { ...STARTER_POTION };
    player.consumables[1] = { ...STARTER_POTION };
    this.players.set(id, player);
    return player;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
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

  revivePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.hp = Math.floor(player.maxHp / 2);
    player.status = 'exploring';
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
