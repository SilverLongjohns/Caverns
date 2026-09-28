import { PROGRESSION_CONFIG, type ItemStats } from '@caverns/shared';

const STAT_DISPLAY_NAMES: Record<string, string> = {};
for (const def of PROGRESSION_CONFIG.statDefinitions) STAT_DISPLAY_NAMES[def.internalStat] = def.displayName;

/** One-line stat summary for any item (gear, guns, consumables). */
export function formatItemStats(stats: ItemStats): string {
  const parts: string[] = [];
  // Guns (range/magazine present) never feed melee damage/Ferocity — their `damage` is
  // shot damage, consumed only by the ranged profile (see shared/src/combat/ranged.ts).
  const isGun = stats.range !== undefined || stats.magazine !== undefined;
  if (stats.damage) parts.push(isGun ? `+${stats.damage} shot dmg` : `+${stats.damage} ${STAT_DISPLAY_NAMES['damage'] ?? 'dmg'}`);
  if (stats.defense) parts.push(`+${stats.defense} ${STAT_DISPLAY_NAMES['defense'] ?? 'def'}`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} ${STAT_DISPLAY_NAMES['maxHp'] ?? 'hp'}`);
  if (stats.initiative) parts.push(`+${stats.initiative} ${STAT_DISPLAY_NAMES['initiative'] ?? 'init'}`);
  if (stats.range) parts.push(`range ${stats.range}`);
  if (stats.magazine) parts.push(`${stats.magazine} rds`);
  if (stats.healAmount) parts.push(`heals ${stats.healAmount}`);
  return parts.join(', ');
}
