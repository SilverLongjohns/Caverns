import type { Player } from '@caverns/shared';
import { computePlayerStats } from '@caverns/shared';
import type { CharactersTable } from './db/types.js';

export type CharacterSnapshot = Pick<
  CharactersTable,
  'name' | 'class' | 'level' | 'xp' | 'stat_allocations' | 'equipment' |
  'inventory' | 'consumables' | 'gold' | 'keychain'
>;

export function playerFromCharacter(
  character: CharactersTable,
  connectionId: string,
  roomId: string,
): Player {
  const player: Player = {
    id: connectionId,
    name: character.name,
    className: character.class,
    maxHp: 0,
    hp: 0,
    roomId,
    equipment: character.equipment,
    consumables: character.consumables,
    inventory: character.inventory,
    status: 'exploring',
    keychain: [...character.keychain],
    energy: 0,
    usedEffects: [],
    xp: character.xp,
    level: character.level,
    unspentStatPoints: 0,
    statAllocations: { ...character.stat_allocations },
    gold: character.gold,
  };
  const stats = computePlayerStats(player);
  player.maxHp = stats.maxHp;
  player.hp = stats.maxHp;
  player.energy = stats.maxEnergy;
  return player;
}

export function characterSnapshotFromPlayer(p: Player): CharacterSnapshot {
  return {
    name: p.name,
    class: p.className,
    level: p.level,
    xp: p.xp,
    stat_allocations: p.statAllocations,
    equipment: p.equipment,
    inventory: p.inventory,
    consumables: p.consumables,
    gold: p.gold,
    keychain: p.keychain,
  };
}
