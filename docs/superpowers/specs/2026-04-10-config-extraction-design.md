# Config Extraction Design

**Date:** 2026-04-10
**Status:** Approved

## Overview

Extract hardcoded game constants, magic numbers, and tunable values from scattered source files into centralised JSON config files with typed TypeScript loaders. Gameplay configs live in `shared/src/data/`, UI configs live in `client/src/uiconfig/`.

## Principles

- JSON files hold the values, TypeScript loaders provide type safety
- Follows existing pattern: `classes.json` + `classData.ts`
- One config file per domain, one loader per config file
- All shared config interfaces in a single `configTypes.ts`
- QTE config (`qteConfig.ts`) stays untouched

## Gameplay Config Files (`shared/src/data/`)

### combatConfig.json

```json
{
  "defenseMultiplierWhenDefending": 2,
  "fleeDamageDivisor": 2,
  "initiativeRandomRange": 5,
  "minDamage": 1,
  "hazardDamageMin": 5,
  "hazardDamageRange": 11
}
```

**Sources:**
- `CombatManager.ts:172` — `targetDefense * 2`
- `CombatManager.ts:271` — `Math.floor(p.damage / 2)`
- `CombatManager.ts:88` — `Math.random() * 5`
- `CombatManager.ts:173` — `Math.max(1, ...)`
- `InteractionResolver.ts:166` — `5 + Math.floor(Math.random() * 11)`

### energyConfig.json

```json
{
  "maxEnergy": 30,
  "startingEnergy": 30,
  "regenPerTurn": 2
}
```

**Sources:**
- `types.ts:233` — `energy: 30`
- `PlayerManager.ts:198` — `Math.min(30, ...)`
- `GameSession.ts:366` — `regenEnergy(playerId, 2)`

### lootConfig.json

```json
{
  "timeoutMs": 15000,
  "skullRarityWeights": {
    "1": { "common": 5, "uncommon": 2, "rare": 0.5, "legendary": 0.1, "unique": 0 },
    "2": { "common": 3, "uncommon": 3, "rare": 1.5, "legendary": 0.5, "unique": 0.1 },
    "3": { "common": 1, "uncommon": 3, "rare": 3, "legendary": 1.5, "unique": 0.5 }
  },
  "defaultLootWeights": {
    "common": 0.499,
    "uncommon": 0.30,
    "rare": 0.15,
    "legendary": 0.05,
    "unique": 0.001
  },
  "starterLootWeights": {
    "common": 0.70,
    "uncommon": 0.27,
    "rare": 0.025,
    "legendary": 0.005,
    "unique": 0.0
  }
}
```

**Sources:**
- `LootManager.ts:40` — `15000`
- `GameSession.ts:707` — `15000`
- `GameSession.ts:628-631` — skull rarity weights
- `ProceduralGenerator.ts:499-512` — default/starter loot weights

### playerConfig.json

```json
{
  "inventorySlots": 7,
  "consumableSlots": 6,
  "baseStats": {
    "maxHp": 50,
    "damage": 5,
    "defense": 2,
    "initiative": 5
  }
}
```

**Sources:**
- `types.ts:140` — `INVENTORY_SLOTS = 7`
- `types.ts:139` — `CONSUMABLE_SLOTS = 6`
- `types.ts:158-162` — `BASE_STATS`

### timingConfig.json

```json
{
  "victoryDelayMs": 1000,
  "mobTurnDelayMs": 600,
  "postVictoryLootDelayMs": 3000
}
```

**Sources:**
- `GameSession.ts:404` — `1000`
- `GameSession.ts:411` — `600`
- `GameSession.ts:451` — `3000`

### dungeonConfig.json

```json
{
  "keyPlacementDepthMin": 0.6,
  "keyPlacementDepthMax": 0.75,
  "puzzlesPerZone": 1,
  "interactableDensity": 0.65,
  "encounterSpawnChance": 0.25
}
```

**Sources:**
- `ProceduralGenerator.ts:549-551` — key zone 60-75%
- `ProceduralGenerator.ts:575` — puzzle count 1
- `ProceduralGenerator.ts:607` — `INTERACTABLE_DENSITY: 0.65`
- `GameSession.ts:843` — `0.25`

## UI Config Files (`client/src/uiconfig/`)

### logColors.json

```json
{
  "narration": "#c8b89a",
  "combat": "#cc4444",
  "loot": "#d4a857",
  "system": "#7a6e5a",
  "chat": "#88bbdd"
}
```

**Source:** `TextLog.tsx:4-10`

### combatUI.json

```json
{
  "hpThresholdYellow": 0.5,
  "hpThresholdRed": 0.25,
  "hpBlockCount": 10
}
```

**Source:** `CombatView.tsx:37-40`

### mapUI.json

```json
{
  "viewportRadius": 1.5,
  "playerColors": ["#d4a857", "#cc4444", "#5599cc", "#88cc66"]
}
```

**Source:** `MiniMap.tsx:11-14`

## Typed Loaders

### Config type interfaces — `shared/src/data/configTypes.ts`

All gameplay config interfaces in one file:

```ts
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
```

### Loader pattern — one per config file

```ts
// shared/src/data/combatConfig.ts
import type { CombatConfig } from './configTypes.js';
import config from './combatConfig.json' with { type: 'json' };

export const COMBAT_CONFIG: CombatConfig = config;
```

Same pattern for all six gameplay configs.

### UI config type interfaces — `client/src/uiconfig/uiConfigTypes.ts`

```ts
export interface LogColorsConfig {
  narration: string;
  combat: string;
  loot: string;
  system: string;
  chat: string;
}

export interface CombatUIConfig {
  hpThresholdYellow: number;
  hpThresholdRed: number;
  hpBlockCount: number;
}

export interface MapUIConfig {
  viewportRadius: number;
  playerColors: string[];
}
```

### UI loaders — `client/src/uiconfig/`

Same pattern as shared loaders but in the client directory.

## Re-exports and Backwards Compatibility

`shared/src/index.ts` re-exports all gameplay config constants (`COMBAT_CONFIG`, `ENERGY_CONFIG`, etc.) so both server and client can use `import { ENERGY_CONFIG } from '@caverns/shared'`.

The existing `CONSUMABLE_SLOTS`, `INVENTORY_SLOTS`, and `BASE_STATS` in `types.ts` become re-exports from `PLAYER_CONFIG`:

```ts
export const CONSUMABLE_SLOTS = PLAYER_CONFIG.consumableSlots;
export const INVENTORY_SLOTS = PLAYER_CONFIG.inventorySlots;
export const BASE_STATS = PLAYER_CONFIG.baseStats;
```

This keeps all existing import sites working without changes.

## Migration Rules

For each extracted value:
1. Replace the hardcoded literal with a reference to the config constant
2. Remove any duplicated values (e.g., loot timeout in both `LootManager.ts` and `GameSession.ts` both reference `LOOT_CONFIG.timeoutMs`)
3. Do not change any logic or behaviour — only the source of the value changes

## Out of Scope

- QTE config (`qteConfig.ts`) — stays as-is per decision
- Biome data (`biomes.json`) — already in a data file
- Class data (`classes.json`) — already in a data file
- Item data (`items.json`, `uniqueItems.json`) — already in data files
- Mob data (`mobPool.json`) — already in a data file
