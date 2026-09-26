import mobPool from '../data/mobPool.json' with { type: 'json' };
import biomes from '../data/biomes.json' with { type: 'json' };
import uniqueItems from '../data/uniqueItems.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import { CLASS_DEFINITIONS } from '../classData.js';
import { CLASS_STARTER_ITEMS } from '../content.js';
import { PROGRESSION_CONFIG } from '../data/progression.js';
import type { EquipmentSlot, Item, RoomType } from '../types.js';
import { SANDBOX_PRESETS } from './presets.js';
import {
  SANDBOX_ROOM_TYPES, SANDBOX_MAX_MOBS, SANDBOX_MAX_PARTY,
  type ResolveSetupResult, type SandboxMember, type SandboxOverrides, type SandboxPartyMember,
} from './types.js';

export const SANDBOX_MAX_LEVEL = PROGRESSION_CONFIG.levelThresholds.length;

const MOB_IDS = new Set((mobPool as { id: string }[]).map((m) => m.id));
const BIOME_IDS = new Set((biomes as { id: string }[]).map((b) => b.id));
const ALL_ITEMS: Item[] = [
  ...(uniqueItems as unknown as Item[]),
  ...(items as unknown as Item[]),
  ...Object.values(CLASS_STARTER_ITEMS).flatMap((s) => [s.weapon, s.offhand]),
];

export function findSandboxItem(id: string): Item | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}

const fail = (error: string): ResolveSetupResult => ({ ok: false, error });

export function resolveSetup(presetId: string, overrides: SandboxOverrides = {}): ResolveSetupResult {
  const preset = SANDBOX_PRESETS.find((p) => p.id === presetId);
  if (!preset) return fail(`Unknown sandbox preset "${presetId}". Known presets: ${SANDBOX_PRESETS.map((p) => p.id).join(', ')}`);

  const roomType = overrides.room ?? preset.roomType;
  if (!SANDBOX_ROOM_TYPES.includes(roomType as RoomType)) {
    return fail(`Unknown room type "${roomType}". Use one of: ${SANDBOX_ROOM_TYPES.join(', ')}`);
  }
  const biome = overrides.biome ?? preset.biome;
  if (!BIOME_IDS.has(biome)) return fail(`Unknown biome "${biome}". Use one of: ${[...BIOME_IDS].join(', ')}`);

  const mobs = overrides.mobs ?? preset.mobs;
  if (mobs.length === 0) return fail('A sandbox fight needs at least one mob.');
  if (mobs.length > SANDBOX_MAX_MOBS) return fail(`Too many mobs (${mobs.length}); the limit is ${SANDBOX_MAX_MOBS}.`);
  const badMob = mobs.find((id) => !MOB_IDS.has(id));
  if (badMob) return fail(`Unknown mob "${badMob}" (not in mobPool.json).`);

  const baseParty: SandboxPartyMember[] = overrides.party ? overrides.party.map((className) => ({ className })) : preset.party;
  if (baseParty.length < 1 || baseParty.length > SANDBOX_MAX_PARTY) {
    return fail(`Party size must be between 1 and ${SANDBOX_MAX_PARTY} (got ${baseParty.length}).`);
  }
  const badClass = baseParty.find((m) => !CLASS_DEFINITIONS.some((c) => c.id === m.className));
  if (badClass) return fail(`Unknown class "${badClass.className}". Use one of: ${CLASS_DEFINITIONS.map((c) => c.id).join(', ')}`);

  if (overrides.level !== undefined && !isValidLevel(overrides.level)) {
    return fail(`Level must be a whole number from 1 to ${SANDBOX_MAX_LEVEL} (got ${overrides.level}).`);
  }

  const classCounts = new Map<string, number>();
  for (const m of baseParty) classCounts.set(m.className, (classCounts.get(m.className) ?? 0) + 1);
  const classSeen = new Map<string, number>();
  const party: SandboxMember[] = [];
  for (const m of baseParty) {
    const level = overrides.level ?? (m.level !== undefined ? m.level : 1);
    if (!isValidLevel(level)) return fail(`Level must be a whole number from 1 to ${SANDBOX_MAX_LEVEL} (got ${level}).`);
    const displayName = CLASS_DEFINITIONS.find((c) => c.id === m.className)!.displayName;
    const n = (classSeen.get(m.className) ?? 0) + 1;
    classSeen.set(m.className, n);
    const defaultName = classCounts.get(m.className)! > 1 ? `${displayName} ${n}` : displayName;
    const equipment = m.equipment ?? {};
    for (const [slot, itemId] of Object.entries(equipment) as [EquipmentSlot, string][]) {
      const item = findSandboxItem(itemId);
      if (!item) return fail(`Unknown item "${itemId}".`);
      if (item.slot !== slot) return fail(`Item "${itemId}" is a ${item.slot}, not a ${slot}.`);
    }
    party.push({ className: m.className, level, name: m.name ?? defaultName, equipment: { ...equipment } });
  }

  const seed = overrides.seed ?? preset.seed ?? null;
  if (seed !== null && !Number.isInteger(seed)) return fail(`Seed must be a whole number (got ${seed}).`);

  return { ok: true, setup: { presetId: preset.id, label: preset.label, party, mobs: [...mobs], roomType: roomType as RoomType, biome, seed } };
}

function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= SANDBOX_MAX_LEVEL;
}

export function parseSandboxQuery(search: string): { preset: string; overrides: SandboxOverrides } | null {
  const params = new URLSearchParams(search);
  const preset = params.get('sandbox');
  if (!preset) return null;
  const overrides: SandboxOverrides = {};
  const list = (key: string) => params.get(key)!.split(',').map((s) => s.trim()).filter(Boolean);
  if (params.has('room')) overrides.room = params.get('room')!;
  if (params.has('biome')) overrides.biome = params.get('biome')!;
  if (params.has('mobs')) overrides.mobs = list('mobs');
  if (params.has('party')) overrides.party = list('party');
  if (params.has('level')) overrides.level = Number(params.get('level'));
  if (params.has('seed')) overrides.seed = Number(params.get('seed'));
  return { preset, overrides };
}

export function buildSandboxQuery(preset: string, overrides: SandboxOverrides = {}): string {
  const params = new URLSearchParams({ sandbox: preset });
  if (overrides.room) params.set('room', overrides.room);
  if (overrides.biome) params.set('biome', overrides.biome);
  if (overrides.mobs) params.set('mobs', overrides.mobs.join(','));
  if (overrides.party) params.set('party', overrides.party.join(','));
  if (overrides.level !== undefined) params.set('level', String(overrides.level));
  if (overrides.seed !== undefined) params.set('seed', String(overrides.seed));
  return `?${params.toString()}`;
}
