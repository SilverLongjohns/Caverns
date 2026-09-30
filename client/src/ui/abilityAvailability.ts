import type { AbilityDefinition } from '@caverns/shared';

/** Whether an ability can be used now (ignoring energy): free actions once per turn, others need the turn's action. */
export function abilityAvailable(ability: AbilityDefinition, actionTaken: boolean, freeActionsUsed: readonly string[]): boolean {
  return ability.freeAction ? !freeActionsUsed.includes(ability.id) : !actionTaken;
}
