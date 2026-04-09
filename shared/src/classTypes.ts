export interface AbilityEffect {
  type: string;
  [key: string]: unknown;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  targetType: 'none' | 'ally' | 'enemy';
  passive: boolean;
  trigger?: string;
  effects: AbilityEffect[];
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

export interface AbilityCooldown {
  abilityId: string;
  turnsRemaining: number;
}

export interface ActiveBuff {
  type: string;
  turnsRemaining: number;
  sourcePlayerId: string;
  value?: number;
}
