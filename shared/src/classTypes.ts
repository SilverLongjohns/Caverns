export interface AbilityEffect {
  type: string;
  [key: string]: unknown;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  energyCost: number;
  targetType: 'none' | 'ally' | 'enemy' | 'area_enemy' | 'area_ally';
  passive: boolean;
  trigger?: string;
  effects: AbilityEffect[];
  range?: number;          // max Chebyshev distance. Omitted = melee/self.
  areaRadius?: number;     // Manhattan radius of AoE. 1 = 3x3 area.
  flankingMultiplier?: number; // if set, replace effect multiplier when caster + ally both adjacent to target
}

export interface ClassDefinition {
  id: string;
  displayName: string;
  description: string;
  baseStats: { maxHp: number; damage: number; defense: number; initiative: number };
  starterWeaponId: string;
  starterOffhandId: string;
  abilities: AbilityDefinition[];
}

export interface ActiveBuff {
  type: string;
  turnsRemaining: number;
  sourcePlayerId: string;
  value?: number;
}
