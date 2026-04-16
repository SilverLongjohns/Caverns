import configJson from './data/characterCreationConfig.json' with { type: 'json' };

export interface CharacterCreationConfig {
  pointBudget: number;
  perStatMin: number;
  perStatMax: number;
  statIds: string[];
}

export const CHARACTER_CREATION_CONFIG: CharacterCreationConfig = configJson as CharacterCreationConfig;

export type StatPoints = Record<string, number>;

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateStatPoints(points: StatPoints): ValidateResult {
  const { pointBudget, perStatMin, perStatMax, statIds } = CHARACTER_CREATION_CONFIG;
  const allowed = new Set(statIds);
  let total = 0;
  for (const [id, value] of Object.entries(points)) {
    if (!allowed.has(id)) return { ok: false, reason: `unknown stat id: ${id}` };
    if (!Number.isInteger(value)) return { ok: false, reason: `stat ${id} must be an integer` };
    if (value < perStatMin) return { ok: false, reason: `stat ${id} below min (${perStatMin})` };
    if (value > perStatMax) return { ok: false, reason: `stat ${id} above max (${perStatMax})` };
    total += value;
  }
  if (total > pointBudget) return { ok: false, reason: `total ${total} exceeds budget ${pointBudget}` };
  return { ok: true };
}

export function emptyStatPoints(): StatPoints {
  const out: StatPoints = {};
  for (const id of CHARACTER_CREATION_CONFIG.statIds) out[id] = 0;
  return out;
}
