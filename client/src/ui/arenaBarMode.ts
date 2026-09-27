import type { AbilityDefinition } from '@caverns/shared';

export type ArenaActionMode =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'move' }
  | { mode: 'target_attack' }
  | { mode: 'items' }
  | { mode: 'target_item'; itemIndex: number }
  | { mode: 'abilities' }
  | { mode: 'target_ability'; ability: AbilityDefinition };

// Modes where the bar is waiting on a click on the arena map. ArenaView owns the map
// interaction and drops back to 'none' once the click is handled (or the turn moves on).
const MAP_TARGETING = new Set<ArenaActionMode['mode']>(['move', 'target_attack', 'target_ability']);

/** What the arena action bar should show, given its own mode and whether the map is still targeting. */
export function effectiveArenaBarMode(
  mode: ArenaActionMode,
  isMyTurn: boolean,
  mapTargeting: boolean,
): ArenaActionMode {
  if (!isMyTurn) return { mode: 'idle' };
  if (mode.mode === 'idle') return { mode: 'main' };
  if (MAP_TARGETING.has(mode.mode) && !mapTargeting) return { mode: 'main' };
  return mode;
}
