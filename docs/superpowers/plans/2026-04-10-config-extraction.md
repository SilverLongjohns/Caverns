# Config Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all hardcoded game constants into centralised JSON config files with typed TypeScript loaders.

**Architecture:** JSON data files hold tunable values, thin TypeScript loaders provide typed exports. Gameplay configs in `shared/src/data/`, UI configs in `client/src/uiconfig/`. Existing constants (`CONSUMABLE_SLOTS`, `INVENTORY_SLOTS`, `BASE_STATS`) become re-exports for backwards compatibility.

**Tech Stack:** TypeScript, JSON, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-config-extraction-design.md`

---

### Task 1: Create config type interfaces

**Files:**
- Create: `shared/src/data/configTypes.ts`

- [ ] **Step 1: Create configTypes.ts with all gameplay config interfaces**

```ts
// shared/src/data/configTypes.ts

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

- [ ] **Step 2: Commit**

```bash
git add shared/src/data/configTypes.ts
git commit -m "feat: add config type interfaces"
```

---

### Task 2: Create JSON config files and loaders for combat, energy, and player

**Files:**
- Create: `shared/src/data/combatConfig.json`
- Create: `shared/src/data/combatConfig.ts`
- Create: `shared/src/data/energyConfig.json`
- Create: `shared/src/data/energyConfig.ts`
- Create: `shared/src/data/playerConfig.json`
- Create: `shared/src/data/playerConfig.ts`

- [ ] **Step 1: Create combatConfig.json**

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

- [ ] **Step 2: Create combatConfig.ts loader**

```ts
import type { CombatConfig } from './configTypes.js';
import config from './combatConfig.json' with { type: 'json' };

export const COMBAT_CONFIG: CombatConfig = config;
```

- [ ] **Step 3: Create energyConfig.json**

```json
{
  "maxEnergy": 30,
  "startingEnergy": 30,
  "regenPerTurn": 2
}
```

- [ ] **Step 4: Create energyConfig.ts loader**

```ts
import type { EnergyConfig } from './configTypes.js';
import config from './energyConfig.json' with { type: 'json' };

export const ENERGY_CONFIG: EnergyConfig = config;
```

- [ ] **Step 5: Create playerConfig.json**

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

- [ ] **Step 6: Create playerConfig.ts loader**

```ts
import type { PlayerConfig } from './configTypes.js';
import config from './playerConfig.json' with { type: 'json' };

export const PLAYER_CONFIG: PlayerConfig = config;
```

- [ ] **Step 7: Commit**

```bash
git add shared/src/data/combatConfig.json shared/src/data/combatConfig.ts shared/src/data/energyConfig.json shared/src/data/energyConfig.ts shared/src/data/playerConfig.json shared/src/data/playerConfig.ts
git commit -m "feat: add combat, energy, and player config files with loaders"
```

---

### Task 3: Create JSON config files and loaders for loot, timing, and dungeon

**Files:**
- Create: `shared/src/data/lootConfig.json`
- Create: `shared/src/data/lootConfig.ts`
- Create: `shared/src/data/timingConfig.json`
- Create: `shared/src/data/timingConfig.ts`
- Create: `shared/src/data/dungeonConfig.json`
- Create: `shared/src/data/dungeonConfig.ts`

- [ ] **Step 1: Create lootConfig.json**

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

- [ ] **Step 2: Create lootConfig.ts loader**

```ts
import type { LootConfig } from './configTypes.js';
import config from './lootConfig.json' with { type: 'json' };

export const LOOT_CONFIG: LootConfig = config;
```

- [ ] **Step 3: Create timingConfig.json**

```json
{
  "victoryDelayMs": 1000,
  "mobTurnDelayMs": 600,
  "postVictoryLootDelayMs": 3000
}
```

- [ ] **Step 4: Create timingConfig.ts loader**

```ts
import type { TimingConfig } from './configTypes.js';
import config from './timingConfig.json' with { type: 'json' };

export const TIMING_CONFIG: TimingConfig = config;
```

- [ ] **Step 5: Create dungeonConfig.json**

```json
{
  "keyPlacementDepthMin": 0.6,
  "keyPlacementDepthMax": 0.75,
  "puzzlesPerZone": 1,
  "interactableDensity": 0.65,
  "encounterSpawnChance": 0.25
}
```

- [ ] **Step 6: Create dungeonConfig.ts loader**

```ts
import type { DungeonConfig } from './configTypes.js';
import config from './dungeonConfig.json' with { type: 'json' };

export const DUNGEON_CONFIG: DungeonConfig = config;
```

- [ ] **Step 7: Commit**

```bash
git add shared/src/data/lootConfig.json shared/src/data/lootConfig.ts shared/src/data/timingConfig.json shared/src/data/timingConfig.ts shared/src/data/dungeonConfig.json shared/src/data/dungeonConfig.ts
git commit -m "feat: add loot, timing, and dungeon config files with loaders"
```

---

### Task 4: Export configs from shared/src/index.ts and update backwards-compat re-exports

**Files:**
- Modify: `shared/src/index.ts`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Add config re-exports to shared/src/index.ts**

Add these lines to the end of `shared/src/index.ts`:

```ts
export * from './data/configTypes.js';
export { COMBAT_CONFIG } from './data/combatConfig.js';
export { ENERGY_CONFIG } from './data/energyConfig.js';
export { PLAYER_CONFIG } from './data/playerConfig.js';
export { LOOT_CONFIG } from './data/lootConfig.js';
export { TIMING_CONFIG } from './data/timingConfig.js';
export { DUNGEON_CONFIG } from './data/dungeonConfig.js';
```

- [ ] **Step 2: Update types.ts to re-export from PLAYER_CONFIG**

In `shared/src/types.ts`, replace the hardcoded constants with re-exports. Change:

```ts
export const CONSUMABLE_SLOTS = 6;
export const INVENTORY_SLOTS = 7;
```

To:

```ts
import { PLAYER_CONFIG } from './data/playerConfig.js';

export const CONSUMABLE_SLOTS = PLAYER_CONFIG.consumableSlots;
export const INVENTORY_SLOTS = PLAYER_CONFIG.inventorySlots;
```

And replace:

```ts
export const BASE_STATS = {
  maxHp: 50,
  damage: 5,
  defense: 2,
  initiative: 5,
};
```

With:

```ts
export const BASE_STATS = PLAYER_CONFIG.baseStats;
```

- [ ] **Step 2b: Update createPlayer to use ENERGY_CONFIG**

In `shared/src/types.ts`, add `ENERGY_CONFIG` to the imports:

```ts
import { ENERGY_CONFIG } from './data/energyConfig.js';
```

In the `createPlayer` function, replace `energy: 30` with:

```ts
    energy: ENERGY_CONFIG.startingEnergy,
```

- [ ] **Step 3: Verify shared compiles**

Run: `npx vitest run shared/`
Expected: All shared tests PASS (the values haven't changed, just the source).

- [ ] **Step 4: Commit**

```bash
git add shared/src/index.ts shared/src/types.ts
git commit -m "feat: export configs from shared index, re-export player constants for backwards compat"
```

---

### Task 5: Migrate CombatManager to use COMBAT_CONFIG

**Files:**
- Modify: `server/src/CombatManager.ts`

- [ ] **Step 1: Add import**

Add to the top of `server/src/CombatManager.ts`:

```ts
import { COMBAT_CONFIG } from '@caverns/shared';
```

- [ ] **Step 2: Replace defense multiplier**

In `server/src/CombatManager.ts`, find this line (around line 172):

```ts
        const effectiveDefense = target.isDefending ? targetDefense * 2 : targetDefense;
```

Replace with:

```ts
        const effectiveDefense = target.isDefending ? targetDefense * COMBAT_CONFIG.defenseMultiplierWhenDefending : targetDefense;
```

- [ ] **Step 3: Replace min damage**

In the same area (around line 173), find:

```ts
        const damage = Math.max(1, Math.floor((actorDamage - effectiveDefense) * finalMultiplier * overchargeMultiplier));
```

Replace `1` with `COMBAT_CONFIG.minDamage`:

```ts
        const damage = Math.max(COMBAT_CONFIG.minDamage, Math.floor((actorDamage - effectiveDefense) * finalMultiplier * overchargeMultiplier));
```

- [ ] **Step 4: Replace flee damage divisor**

Find (around line 271):

```ts
          if (p.type === 'mob' && p.alive) totalOpportunityDamage += Math.floor(p.damage / 2);
```

Replace with:

```ts
          if (p.type === 'mob' && p.alive) totalOpportunityDamage += Math.floor(p.damage / COMBAT_CONFIG.fleeDamageDivisor);
```

- [ ] **Step 5: Replace initiative random range**

Find (around line 88):

```ts
    alive.sort((a, b) => b.initiative + Math.random() * 5 - (a.initiative + Math.random() * 5));
```

Replace with:

```ts
    alive.sort((a, b) => b.initiative + Math.random() * COMBAT_CONFIG.initiativeRandomRange - (a.initiative + Math.random() * COMBAT_CONFIG.initiativeRandomRange));
```

- [ ] **Step 6: Replace mob defense multiplier**

Search CombatManager for the mob turn defense calculation. Find (around line 320-322):

```ts
    const effectiveDefense = target.isDefending
      ? Math.floor((target.defense + bonusDefense) * defenseMultiplier * 2)
      : Math.floor((target.defense + bonusDefense) * defenseMultiplier);
```

Replace `* 2` with `* COMBAT_CONFIG.defenseMultiplierWhenDefending`:

```ts
    const effectiveDefense = target.isDefending
      ? Math.floor((target.defense + bonusDefense) * defenseMultiplier * COMBAT_CONFIG.defenseMultiplierWhenDefending)
      : Math.floor((target.defense + bonusDefense) * defenseMultiplier);
```

Also find the min damage for mob attacks (around line 324):

```ts
    const rawDamage = Math.max(1, mob.damage - effectiveDefense);
```

Replace with:

```ts
    const rawDamage = Math.max(COMBAT_CONFIG.minDamage, mob.damage - effectiveDefense);
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run server/src/CombatManager.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/CombatManager.ts
git commit -m "refactor: use COMBAT_CONFIG in CombatManager"
```

---

### Task 6: Migrate PlayerManager and GameSession energy values to ENERGY_CONFIG

**Files:**
- Modify: `server/src/PlayerManager.ts`
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Update PlayerManager imports**

In `server/src/PlayerManager.ts`, add `ENERGY_CONFIG` to the import from `@caverns/shared`:

```ts
import {
  // ... existing imports ...
  ENERGY_CONFIG,
} from '@caverns/shared';
```

- [ ] **Step 2: Replace energy cap in regenEnergy**

Find (around line 198):

```ts
    player.energy = Math.min(30, player.energy + amount);
```

Replace with:

```ts
    player.energy = Math.min(ENERGY_CONFIG.maxEnergy, player.energy + amount);
```

- [ ] **Step 3: Update GameSession imports**

In `server/src/GameSession.ts`, add `ENERGY_CONFIG` to the import from `@caverns/shared`.

- [ ] **Step 4: Replace energy regen amount in GameSession**

Find all occurrences of `this.playerManager.regenEnergy(playerId, 2)` in `server/src/GameSession.ts`. There are two:

Around line 366 (in `handleCombatAction`):
```ts
    this.playerManager.regenEnergy(playerId, 2);
```

Around line 1191 (in `handleUseAbility`):
```ts
    this.playerManager.regenEnergy(playerId, 2);
```

Replace both with:
```ts
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run server/src/PlayerManager.test.ts server/src/GameSession.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/PlayerManager.ts server/src/GameSession.ts
git commit -m "refactor: use ENERGY_CONFIG in PlayerManager and GameSession"
```

---

### Task 7: Migrate GameSession loot, timing, and dungeon values

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/LootManager.ts`

- [ ] **Step 1: Add config imports to GameSession**

In `server/src/GameSession.ts`, add to the `@caverns/shared` import:

```ts
  LOOT_CONFIG,
  TIMING_CONFIG,
  DUNGEON_CONFIG,
```

- [ ] **Step 2: Replace SKULL_RARITY_WEIGHTS static property**

Find and delete the static property (around lines 628-632):

```ts
  private static SKULL_RARITY_WEIGHTS: Record<number, Record<string, number>> = {
    1: { common: 5, uncommon: 2, rare: 0.5, legendary: 0.1, unique: 0 },
    2: { common: 3, uncommon: 3, rare: 1.5, legendary: 0.5, unique: 0.1 },
    3: { common: 1, uncommon: 3, rare: 3, legendary: 1.5, unique: 0.5 },
  };
```

In `rollMobLoot` (around lines 635-636), replace:

```ts
    const weights = GameSession.SKULL_RARITY_WEIGHTS[skullRating]
      ?? GameSession.SKULL_RARITY_WEIGHTS[2];
```

With:

```ts
    const weights = LOOT_CONFIG.skullRarityWeights[String(skullRating)]
      ?? LOOT_CONFIG.skullRarityWeights['2'];
```

- [ ] **Step 3: Replace loot timeout in GameSession**

Find (around line 707):

```ts
      this.broadcastToRoom(roomId, { type: 'loot_prompt', items: regularItems, timeout: 15000 });
```

Replace with:

```ts
      this.broadcastToRoom(roomId, { type: 'loot_prompt', items: regularItems, timeout: LOOT_CONFIG.timeoutMs });
```

- [ ] **Step 4: Replace timing values in afterCombatTurn**

Find victory delay (around line 404):

```ts
      const delay = result === 'victory' ? 1000 : 0;
```

Replace with:

```ts
      const delay = result === 'victory' ? TIMING_CONFIG.victoryDelayMs : 0;
```

Find mob turn delay (around line 411):

```ts
      setTimeout(() => this.processMobTurn(roomId, combat), 600);
```

Replace with:

```ts
      setTimeout(() => this.processMobTurn(roomId, combat), TIMING_CONFIG.mobTurnDelayMs);
```

Find post-victory loot delay (around line 448-451):

```ts
        setTimeout(() => {
          this.broadcast({ type: 'game_over', result: 'victory' });
          this.onGameOver?.();
        }, 3000);
```

Replace `3000` with `TIMING_CONFIG.postVictoryLootDelayMs`:

```ts
        setTimeout(() => {
          this.broadcast({ type: 'game_over', result: 'victory' });
          this.onGameOver?.();
        }, TIMING_CONFIG.postVictoryLootDelayMs);
```

- [ ] **Step 5: Replace encounter spawn chance**

Find (around line 843):

```ts
      if (Math.random() < 0.25) {
```

Replace with:

```ts
      if (Math.random() < DUNGEON_CONFIG.encounterSpawnChance) {
```

- [ ] **Step 6: Update LootManager timeout**

In `server/src/LootManager.ts`, add import:

```ts
import { LOOT_CONFIG } from '@caverns/shared';
```

Find (around line 40):

```ts
      timer: setTimeout(() => this.resolveRound(), 15000),
```

Replace with:

```ts
      timer: setTimeout(() => this.resolveRound(), LOOT_CONFIG.timeoutMs),
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run server/`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/GameSession.ts server/src/LootManager.ts
git commit -m "refactor: use LOOT_CONFIG, TIMING_CONFIG, DUNGEON_CONFIG in GameSession and LootManager"
```

---

### Task 8: Migrate InteractionResolver hazard damage to COMBAT_CONFIG

**Files:**
- Modify: `server/src/InteractionResolver.ts`

- [ ] **Step 1: Add import**

Add to `server/src/InteractionResolver.ts`:

```ts
import { COMBAT_CONFIG } from '@caverns/shared';
```

- [ ] **Step 2: Replace hazard damage**

Find (around line 166):

```ts
    const damage = 5 + Math.floor(Math.random() * 11);
```

Replace with:

```ts
    const damage = COMBAT_CONFIG.hazardDamageMin + Math.floor(Math.random() * COMBAT_CONFIG.hazardDamageRange);
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run server/src/InteractionResolver.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/InteractionResolver.ts
git commit -m "refactor: use COMBAT_CONFIG for hazard damage in InteractionResolver"
```

---

### Task 9: Migrate ProceduralGenerator to use LOOT_CONFIG and DUNGEON_CONFIG

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

- [ ] **Step 1: Add imports**

Add to `server/src/ProceduralGenerator.ts`:

```ts
import { LOOT_CONFIG, DUNGEON_CONFIG } from '@caverns/shared';
```

- [ ] **Step 2: Replace loot rarity weights**

Find the two weight arrays (around lines 499-513):

```ts
  const defaultRarityWeights: { rarity: Rarity; weight: number }[] = [
    { rarity: 'common', weight: 0.499 },
    { rarity: 'uncommon', weight: 0.30 },
    { rarity: 'rare', weight: 0.15 },
    { rarity: 'legendary', weight: 0.05 },
    { rarity: 'unique', weight: 0.001 },
  ];

  const starterRarityWeights: { rarity: Rarity; weight: number }[] = [
    { rarity: 'common', weight: 0.70 },
    { rarity: 'uncommon', weight: 0.27 },
    { rarity: 'rare', weight: 0.025 },
    { rarity: 'legendary', weight: 0.005 },
    { rarity: 'unique', weight: 0.0 },
  ];
```

Replace with:

```ts
  const defaultRarityWeights: { rarity: Rarity; weight: number }[] = (Object.entries(LOOT_CONFIG.defaultLootWeights) as [Rarity, number][])
    .map(([rarity, weight]) => ({ rarity, weight }));

  const starterRarityWeights: { rarity: Rarity; weight: number }[] = (Object.entries(LOOT_CONFIG.starterLootWeights) as [Rarity, number][])
    .map(([rarity, weight]) => ({ rarity, weight }));
```

- [ ] **Step 3: Replace key placement depth**

Find (around lines 549-551):

```ts
  const targetZoneMin = Math.floor(zoneCount * 0.6);
  const targetZoneMax = Math.floor(zoneCount * 0.75);
```

Replace with:

```ts
  const targetZoneMin = Math.floor(zoneCount * DUNGEON_CONFIG.keyPlacementDepthMin);
  const targetZoneMax = Math.floor(zoneCount * DUNGEON_CONFIG.keyPlacementDepthMax);
```

- [ ] **Step 4: Replace puzzles per zone**

Find (around line 575):

```ts
    const puzzleCount = 1; // one puzzle per zone to avoid oversaturation
```

Replace with:

```ts
    const puzzleCount = DUNGEON_CONFIG.puzzlesPerZone;
```

- [ ] **Step 5: Replace interactable density**

Find (around line 607):

```ts
  const INTERACTABLE_DENSITY = 0.65;
```

Replace with (and update the usage on line 617):

Delete the `const INTERACTABLE_DENSITY = 0.65;` line.

Find:

```ts
    if (Math.random() > INTERACTABLE_DENSITY) continue;
```

Replace with:

```ts
    if (Math.random() > DUNGEON_CONFIG.interactableDensity) continue;
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run server/src/ProceduralGenerator.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/ProceduralGenerator.ts
git commit -m "refactor: use LOOT_CONFIG and DUNGEON_CONFIG in ProceduralGenerator"
```

---

### Task 10: Create UI config files and loaders

**Files:**
- Create: `client/src/uiconfig/uiConfigTypes.ts`
- Create: `client/src/uiconfig/logColors.json`
- Create: `client/src/uiconfig/logColors.ts`
- Create: `client/src/uiconfig/combatUI.json`
- Create: `client/src/uiconfig/combatUI.ts`
- Create: `client/src/uiconfig/mapUI.json`
- Create: `client/src/uiconfig/mapUI.ts`

- [ ] **Step 1: Create uiConfigTypes.ts**

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

- [ ] **Step 2: Create logColors.json**

```json
{
  "narration": "#c8b89a",
  "combat": "#cc4444",
  "loot": "#d4a857",
  "system": "#7a6e5a",
  "chat": "#88bbdd"
}
```

- [ ] **Step 3: Create logColors.ts loader**

```ts
import type { LogColorsConfig } from './uiConfigTypes.js';
import config from './logColors.json' with { type: 'json' };

export const LOG_COLORS_CONFIG: LogColorsConfig = config;
```

- [ ] **Step 4: Create combatUI.json**

```json
{
  "hpThresholdYellow": 0.5,
  "hpThresholdRed": 0.25,
  "hpBlockCount": 10
}
```

- [ ] **Step 5: Create combatUI.ts loader**

```ts
import type { CombatUIConfig } from './uiConfigTypes.js';
import config from './combatUI.json' with { type: 'json' };

export const COMBAT_UI_CONFIG: CombatUIConfig = config;
```

- [ ] **Step 6: Create mapUI.json**

```json
{
  "viewportRadius": 1.5,
  "playerColors": ["#d4a857", "#cc4444", "#5599cc", "#88cc66"]
}
```

- [ ] **Step 7: Create mapUI.ts loader**

```ts
import type { MapUIConfig } from './uiConfigTypes.js';
import config from './mapUI.json' with { type: 'json' };

export const MAP_UI_CONFIG: MapUIConfig = config;
```

- [ ] **Step 8: Commit**

```bash
git add client/src/uiconfig/
git commit -m "feat: add UI config files and loaders"
```

---

### Task 11: Migrate client components to use UI configs and ENERGY_CONFIG

**Files:**
- Modify: `client/src/components/TextLog.tsx`
- Modify: `client/src/components/CombatView.tsx`
- Modify: `client/src/components/MiniMap.tsx`
- Modify: `client/src/components/PlayerHUD.tsx`

- [ ] **Step 1: Migrate TextLog.tsx**

In `client/src/components/TextLog.tsx`, replace:

```ts
const LOG_COLORS: Record<string, string> = {
  narration: '#c8b89a',
  combat: '#cc4444',
  loot: '#d4a857',
  system: '#7a6e5a',
  chat: '#88bbdd',
};
```

With:

```ts
import { LOG_COLORS_CONFIG } from '../uiconfig/logColors.js';

const LOG_COLORS: Record<string, string> = LOG_COLORS_CONFIG;
```

- [ ] **Step 2: Migrate CombatView.tsx HP thresholds and block count**

In `client/src/components/CombatView.tsx`, add import:

```ts
import { COMBAT_UI_CONFIG } from '../uiconfig/combatUI.js';
```

Find the `CharHpBar` function (around line 36-49). Replace:

```ts
  const totalBlocks = 10;
  const filledBlocks = Math.round((hp / maxHp) * totalBlocks);
  const percent = (hp / maxHp) * 100;
  const colorClass = percent > 50 ? '' : percent > 25 ? 'hp-yellow' : 'hp-red';
```

With:

```ts
  const totalBlocks = COMBAT_UI_CONFIG.hpBlockCount;
  const filledBlocks = Math.round((hp / maxHp) * totalBlocks);
  const percent = hp / maxHp;
  const colorClass = percent > COMBAT_UI_CONFIG.hpThresholdYellow ? '' : percent > COMBAT_UI_CONFIG.hpThresholdRed ? 'hp-yellow' : 'hp-red';
```

- [ ] **Step 3: Migrate CombatView.tsx energy display**

Add import:

```ts
import { ENERGY_CONFIG } from '@caverns/shared';
```

Find (around line 298):

```ts
<div className="energy-display">Energy: {player.energy ?? 0}/30</div>
```

Replace with:

```ts
<div className="energy-display">Energy: {player.energy ?? 0}/{ENERGY_CONFIG.maxEnergy}</div>
```

- [ ] **Step 4: Migrate MiniMap.tsx**

In `client/src/components/MiniMap.tsx`, add import:

```ts
import { MAP_UI_CONFIG } from '../uiconfig/mapUI.js';
```

Replace:

```ts
const VIEWPORT_RADIUS_X = 1.5;
const VIEWPORT_RADIUS_Y = 1.5;

const PLAYER_COLORS = ['#d4a857', '#cc4444', '#5599cc', '#88cc66'];
```

With:

```ts
const VIEWPORT_RADIUS_X = MAP_UI_CONFIG.viewportRadius;
const VIEWPORT_RADIUS_Y = MAP_UI_CONFIG.viewportRadius;

const PLAYER_COLORS = MAP_UI_CONFIG.playerColors;
```

- [ ] **Step 5: Migrate PlayerHUD.tsx energy display**

In `client/src/components/PlayerHUD.tsx`, add import:

```ts
import { ENERGY_CONFIG } from '@caverns/shared';
```

Find the energy bar rendering (around lines 59-60):

```tsx
        <div className="energy-bar" style={{ width: `${((player.energy ?? 0) / 30) * 100}%` }} />
        <span className="energy-text">{player.energy ?? 0}/30 Energy</span>
```

Replace with:

```tsx
        <div className="energy-bar" style={{ width: `${((player.energy ?? 0) / ENERGY_CONFIG.maxEnergy) * 100}%` }} />
        <span className="energy-text">{player.energy ?? 0}/{ENERGY_CONFIG.maxEnergy} Energy</span>
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TextLog.tsx client/src/components/CombatView.tsx client/src/components/MiniMap.tsx client/src/components/PlayerHUD.tsx
git commit -m "refactor: migrate client components to use UI configs and ENERGY_CONFIG"
```

---

### Task 12: Run full test suite and verify build

- [ ] **Step 1: Build shared package**

Run: `npm run build --workspace=@caverns/shared`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Verify no remaining hardcoded values**

Search for the old hardcoded values to confirm they've been replaced:

- `SKULL_RARITY_WEIGHTS` should not exist as a static property in GameSession
- `INTERACTABLE_DENSITY` should not exist as a local const in ProceduralGenerator
- `15000` should not appear in LootManager or GameSession loot code
- `Math.random() * 5` in CombatManager should reference config
- `/ 30` in client energy display should reference ENERGY_CONFIG

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: verify config extraction complete"
```
