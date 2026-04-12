export interface CombatConfig {
  defenseMultiplierWhenDefending: number;
  fleeDamageDivisor: number;
  initiativeRandomRange: number;
  minDamage: number;
  hazardDamageMin: number;
  hazardDamageRange: number;
}

export interface EnergyConfig {
  maxEnergy: number;
  startingEnergy: number;
  regenPerTurn: number;
}

export interface RarityWeights {
  common: number;
  uncommon: number;
  rare: number;
  legendary: number;
  unique: number;
}

export interface LootConfig {
  timeoutMs: number;
  skullRarityWeights: Record<string, RarityWeights>;
}

export interface PlayerConfig {
  inventorySlots: number;
  consumableSlots: number;
  baseStats: {
    maxHp: number;
    damage: number;
    defense: number;
    initiative: number;
  };
}

export interface TimingConfig {
  victoryDelayMs: number;
  mobTurnDelayMs: number;
  postVictoryLootDelayMs: number;
}

export interface DungeonConfig {
  keyPlacementDepthMin: number;
  keyPlacementDepthMax: number;
  puzzlesPerZone: number;
  interactableDensity: number;
  encounterSpawnChance: number;
}

export interface StatDefinition {
  id: string;
  displayName: string;
  internalStat: string;
  perPoint: number;
}

export interface ProgressionConfig {
  xpPerSkull: Record<string, number>;
  levelThresholds: number[];
  statPointsPerLevel: number;
  statDefinitions: StatDefinition[];
}

export interface EncounterConfig {
  baseline: number;
  step: number;
  maxAdds: number;
  addXpBonus: number;
  detectionRange: number;
  pursuitRange: number;
}
