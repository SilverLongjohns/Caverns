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
  defaultLootWeights: RarityWeights;
  starterLootWeights: RarityWeights;
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
