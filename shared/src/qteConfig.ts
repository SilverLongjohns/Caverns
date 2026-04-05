export const QTE_CONFIG = {
  attack: {
    baseDurationMs: 1000,
    initBonusMs: 50,
    zones: [
      { name: 'normal',  start: 0,    end: 0.45, multiplier: 1.0  },
      { name: 'green',   start: 0.45, end: 0.65, multiplier: 1.5  },
      { name: 'perfect', start: 0.65, end: 0.72, multiplier: 2.0  },
      { name: 'green',   start: 0.72, end: 0.82, multiplier: 1.5  },
      { name: 'red',     start: 0.82, end: 1.00, multiplier: 0.75 },
    ],
  },
  defense: {
    baseDurationMs: 1200,
    initBonusMs: 25,
    perfect:  { min: 0.95, max: 1.05, reduction: 0.75 },
    good:     { min: 0.80, max: 1.20, reduction: 0.50 },
    graze:    { min: 0.65, max: 1.35, reduction: 0.25 },
  },
  defendTimeoutMs: 5000,
} as const;

export const VALID_CRIT_MULTIPLIERS = [0.75, 1.0, 1.5, 2.0] as const;
export const VALID_DAMAGE_REDUCTIONS = [0, 0.25, 0.5, 0.75] as const;

export type CritMultiplier = typeof VALID_CRIT_MULTIPLIERS[number];
export type DamageReduction = typeof VALID_DAMAGE_REDUCTIONS[number];

export function getAttackDurationMs(initiative: number): number {
  return QTE_CONFIG.attack.baseDurationMs + initiative * QTE_CONFIG.attack.initBonusMs;
}

export function getDefenseDurationMs(initiative: number): number {
  return QTE_CONFIG.defense.baseDurationMs + initiative * QTE_CONFIG.defense.initBonusMs;
}

export function clampCritMultiplier(value: number): CritMultiplier {
  let closest: CritMultiplier = 1.0;
  let minDist = Infinity;
  for (const valid of VALID_CRIT_MULTIPLIERS) {
    const dist = Math.abs(value - valid);
    if (dist < minDist) { minDist = dist; closest = valid; }
  }
  return closest;
}

export function clampDamageReduction(value: number): DamageReduction {
  let closest: DamageReduction = 0;
  let minDist = Infinity;
  for (const valid of VALID_DAMAGE_REDUCTIONS) {
    const dist = Math.abs(value - valid);
    if (dist < minDist) { minDist = dist; closest = valid; }
  }
  return closest;
}
