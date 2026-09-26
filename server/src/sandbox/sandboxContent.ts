import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  computePlayerStats, findSandboxItem, PROGRESSION_CONFIG,
  type DungeonContent, type EquipmentSlot, type MobInstance, type MobPoolEntry,
  type MobTemplate, type Player, type Room, type SandboxMember, type SandboxSetup,
} from '@caverns/shared';
import { PlayerManager } from '../PlayerManager.js';

const here = dirname(fileURLToPath(import.meta.url));
const MOB_POOL: MobPoolEntry[] = JSON.parse(
  readFileSync(resolve(here, '../../../shared/src/data/mobPool.json'), 'utf-8'),
);

export const SANDBOX_ROOM_ID = 'sandbox_arena';

function poolEntry(id: string): MobPoolEntry {
  const entry = MOB_POOL.find((m) => m.id === id);
  if (!entry) throw new Error(`Unknown mob template "${id}"`);
  return entry;
}

function templateFromEntry(e: MobPoolEntry): MobTemplate {
  return {
    id: e.id, name: e.name, description: e.description, skullRating: e.skullRating,
    maxHp: e.baseStats.maxHp, damage: e.baseStats.damage,
    defense: e.baseStats.defense, initiative: e.baseStats.initiative,
    drops: e.drops,
  };
}

export function buildSandboxContent(setup: SandboxSetup): DungeonContent {
  const templates = [...new Set(setup.mobs)].map((id) => templateFromEntry(poolEntry(id)));
  const room: Room = {
    id: SANDBOX_ROOM_ID,
    type: setup.roomType,
    name: setup.label,
    description: 'A sandbox arena.',
    exits: {},
  };
  return {
    name: `Sandbox: ${setup.label}`,
    theme: 'sandbox',
    atmosphere: '',
    biomeId: setup.biome,
    rooms: [room],
    mobs: templates,
    items: [],
    bossId: templates[0].id,
    entranceRoomId: SANDBOX_ROOM_ID,
  };
}

export function buildSandboxMobs(setup: SandboxSetup): MobInstance[] {
  return setup.mobs.map((id, i) => {
    const e = poolEntry(id);
    return {
      instanceId: `${id}_${i}`,
      templateId: id,
      name: e.name,
      maxHp: e.baseStats.maxHp,
      hp: e.baseStats.maxHp,
      damage: e.baseStats.damage,
      defense: e.baseStats.defense,
      initiative: e.baseStats.initiative,
    };
  });
}

/** Build a player the way the game does (class stats + starter gear), then apply level and equipment. */
export function buildSandboxPlayer(id: string, member: SandboxMember, roomId: string): Player {
  const player = new PlayerManager().addPlayer(id, member.name, roomId, member.className);
  for (const [slot, itemId] of Object.entries(member.equipment) as [EquipmentSlot, string][]) {
    const item = findSandboxItem(itemId);
    if (!item) throw new Error(`Unknown item "${itemId}"`);
    player.equipment[slot] = { ...item };
  }
  player.level = member.level;
  player.xp = PROGRESSION_CONFIG.levelThresholds[member.level - 1] ?? 0;
  const defs = PROGRESSION_CONFIG.statDefinitions;
  const points = (member.level - 1) * PROGRESSION_CONFIG.statPointsPerLevel;
  for (let i = 0; i < points; i++) {
    const statId = defs[i % defs.length].id;
    player.statAllocations[statId] = (player.statAllocations[statId] ?? 0) + 1;
  }
  const stats = computePlayerStats(player);
  player.maxHp = stats.maxHp;
  player.hp = stats.maxHp;
  player.energy = stats.maxEnergy;
  return player;
}
