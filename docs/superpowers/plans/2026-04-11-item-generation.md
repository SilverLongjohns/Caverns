# Item Generation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hand-authored equipment items with a procedural item generator (`@caverns/itemgen`) that produces unique items with material-driven names, stat biases, quality tiers, and bounded random variance.

**Architecture:** A new `@caverns/itemgen` workspace package (mirroring `@caverns/roomgrid`) exports a single `generateItem(request): Item` function. The server calls it at loot-drop time instead of looking up static item IDs. Biome palettes provide materials and name fragments. Consumables remain static.

**Tech Stack:** TypeScript, Vitest, npm workspaces

**Spec:** `docs/superpowers/specs/2026-04-11-item-generation-design.md`

---

### Task 1: Package Scaffold

**Files:**
- Create: `itemgen/package.json`
- Create: `itemgen/tsconfig.json`
- Create: `itemgen/src/index.ts`
- Create: `itemgen/src/types.ts`
- Modify: `package.json` (root — add `itemgen` to workspaces)

- [ ] **Step 1: Create `itemgen/package.json`**

```json
{
  "name": "@caverns/itemgen",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@caverns/shared": "*"
  },
  "devDependencies": {
    "typescript": "^5.5.3",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 2: Create `itemgen/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ES2022",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `itemgen/src/types.ts`**

```ts
import type { EquipmentSlot, ItemStats, Rarity } from '@caverns/shared';

export type Quality = 'crude' | 'standard' | 'fine' | 'superior' | 'masterwork';

export interface MaterialDef {
  id: string;
  name: string;
  statBias: Partial<Record<'damage' | 'defense' | 'maxHp' | 'initiative', number>>;
  slots: EquipmentSlot[];
  tier: 1 | 2 | 3;
}

export interface NameFragments {
  adjectives: string[];
  prefixes: string[];
  suffixes: string[];
  baseTypes: Record<EquipmentSlot, string[]>;
}

export interface BiomePalette {
  biomeId: string;
  materials: MaterialDef[];
  nameFragments: NameFragments;
}

export interface ItemGenerationRequest {
  slot: EquipmentSlot;
  skullRating: 1 | 2 | 3;
  biomeId: string;
  rarity?: Rarity;
  seed?: number;
}
```

- [ ] **Step 4: Create `itemgen/src/index.ts`**

```ts
export type {
  ItemGenerationRequest,
  MaterialDef,
  NameFragments,
  BiomePalette,
  Quality,
} from './types.js';
```

This is a stub — `generateItem` will be added in Task 5 after all sub-modules are built.

- [ ] **Step 5: Add `itemgen` to root workspaces**

In `package.json` (root), add `"itemgen"` to the `workspaces` array:

```json
"workspaces": [
  "shared",
  "server",
  "client",
  "roomgrid",
  "itemgen"
]
```

Also update the `build` script to include itemgen (after shared, before server):

```json
"build": "npm run build --workspace=shared && npm run build --workspace=roomgrid && npm run build --workspace=itemgen && npm run build --workspace=server && npm run build --workspace=client"
```

- [ ] **Step 6: Install dependencies and verify build**

Run: `npm install && cd itemgen && npx tsc --noEmit`
Expected: No errors. The package resolves `@caverns/shared` and compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add itemgen/package.json itemgen/tsconfig.json itemgen/src/types.ts itemgen/src/index.ts package.json
git commit -m "feat(itemgen): scaffold @caverns/itemgen package with types"
```

---

### Task 2: Seeded RNG Utility

The generator needs deterministic randomness for testing. Build a simple seeded PRNG.

**Files:**
- Create: `itemgen/src/rng.ts`
- Create: `itemgen/__tests__/rng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from '../src/rng.js';

describe('createRng', () => {
  it('produces deterministic sequences from the same seed', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it('produces values between 0 and 1', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different sequences from different seeds', () => {
    const rng1 = createRng(1);
    const rng2 = createRng(2);
    const seq1 = Array.from({ length: 5 }, () => rng1());
    const seq2 = Array.from({ length: 5 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  it('uses Math.random when no seed is provided', () => {
    const rng = createRng();
    const v = rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/rng.test.ts`
Expected: FAIL — module `../src/rng.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/rng.ts`:

```ts
/**
 * Mulberry32 PRNG — returns a function that produces deterministic
 * floats in [0, 1) from a 32-bit seed. Falls back to Math.random
 * when no seed is given.
 */
export function createRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;

  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd itemgen && npx vitest run __tests__/rng.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add itemgen/src/rng.ts itemgen/__tests__/rng.test.ts
git commit -m "feat(itemgen): add seeded RNG utility"
```

---

### Task 3: Quality Tier Rolling

**Files:**
- Create: `itemgen/src/quality.ts`
- Create: `itemgen/__tests__/quality.test.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rollQuality, QUALITY_TIERS } from '../src/quality.js';
import { createRng } from '../src/rng.js';

describe('rollQuality', () => {
  it('returns a valid quality tier', () => {
    const rng = createRng(42);
    const quality = rollQuality(rng);
    const validQualities = QUALITY_TIERS.map(t => t.quality);
    expect(validQualities).toContain(quality);
  });

  it('returns deterministic results with same seed', () => {
    const results1 = Array.from({ length: 20 }, () => rollQuality(createRng(99)));
    const results2 = Array.from({ length: 20 }, () => rollQuality(createRng(99)));
    // Same seed on fresh RNG each time → same first roll each time
    expect(results1).toEqual(results2);
  });

  it('returns the correct multiplier for each quality', () => {
    expect(QUALITY_TIERS.find(t => t.quality === 'crude')!.multiplier).toBe(0.8);
    expect(QUALITY_TIERS.find(t => t.quality === 'standard')!.multiplier).toBe(1.0);
    expect(QUALITY_TIERS.find(t => t.quality === 'fine')!.multiplier).toBe(1.15);
    expect(QUALITY_TIERS.find(t => t.quality === 'superior')!.multiplier).toBe(1.3);
    expect(QUALITY_TIERS.find(t => t.quality === 'masterwork')!.multiplier).toBe(1.5);
  });

  it('distributes roughly according to weights over many rolls', () => {
    const rng = createRng(12345);
    const counts: Record<string, number> = {};
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const q = rollQuality(rng);
      counts[q] = (counts[q] ?? 0) + 1;
    }
    // Standard (45%) should be most common, masterwork (2%) should be rarest
    expect(counts['standard']).toBeGreaterThan(counts['crude']);
    expect(counts['crude']).toBeGreaterThan(counts['superior']);
    expect(counts['superior']).toBeGreaterThan(counts['masterwork']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/quality.test.ts`
Expected: FAIL — module `../src/quality.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/quality.ts`:

```ts
import type { Quality } from './types.js';

export interface QualityTier {
  quality: Quality;
  multiplier: number;
  weight: number;
}

export const QUALITY_TIERS: QualityTier[] = [
  { quality: 'crude',      multiplier: 0.8,  weight: 20 },
  { quality: 'standard',   multiplier: 1.0,  weight: 45 },
  { quality: 'fine',        multiplier: 1.15, weight: 25 },
  { quality: 'superior',   multiplier: 1.3,  weight: 8 },
  { quality: 'masterwork', multiplier: 1.5,  weight: 2 },
];

const TOTAL_WEIGHT = QUALITY_TIERS.reduce((sum, t) => sum + t.weight, 0);

export function rollQuality(rng: () => number): Quality {
  let roll = rng() * TOTAL_WEIGHT;
  for (const tier of QUALITY_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) return tier.quality;
  }
  return 'standard';
}

export function getQualityMultiplier(quality: Quality): number {
  return QUALITY_TIERS.find(t => t.quality === quality)!.multiplier;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd itemgen && npx vitest run __tests__/quality.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add itemgen/src/quality.ts itemgen/__tests__/quality.test.ts
git commit -m "feat(itemgen): add quality tier rolling with weighted distribution"
```

---

### Task 4: Material Registry & Dripping Halls Palette

**Files:**
- Create: `itemgen/src/materials.ts`
- Create: `itemgen/src/palettes/dripping-halls.ts`
- Create: `itemgen/__tests__/materials.test.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/materials.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { registerPalette, getPalette, rollMaterial } from '../src/materials.js';
import { createRng } from '../src/rng.js';
import type { BiomePalette } from '../src/types.js';

const testPalette: BiomePalette = {
  biomeId: 'test',
  materials: [
    { id: 'iron', name: 'Iron', statBias: { damage: 1.0 }, slots: ['weapon', 'armor'], tier: 1 },
    { id: 'steel', name: 'Steel', statBias: { damage: 1.2 }, slots: ['weapon', 'armor'], tier: 2 },
    { id: 'mythril', name: 'Mythril', statBias: { damage: 1.5 }, slots: ['weapon'], tier: 3 },
  ],
  nameFragments: {
    adjectives: ['sharp'],
    prefixes: ['Iron'],
    suffixes: ['bane'],
    baseTypes: { weapon: ['sword'], offhand: ['shield'], armor: ['plate'], accessory: ['ring'] },
  },
};

describe('material registry', () => {
  it('registers and retrieves palettes by biome ID', () => {
    registerPalette(testPalette);
    expect(getPalette('test')).toBe(testPalette);
  });

  it('throws on unknown biome ID', () => {
    expect(() => getPalette('nonexistent')).toThrow();
  });
});

describe('rollMaterial', () => {
  it('only returns materials matching the requested slot', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    for (let i = 0; i < 50; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 3, rng);
      expect(mat.slots).toContain('weapon');
    }
  });

  it('skull-1 only rolls tier-1 materials', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 1, rng);
      expect(mat.tier).toBe(1);
    }
  });

  it('skull-3 can roll all tiers', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    const tiers = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 3, rng);
      tiers.add(mat.tier);
    }
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(2)).toBe(true);
    expect(tiers.has(3)).toBe(true);
  });

  it('throws if no materials match the slot', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    // 'accessory' slot has no materials in testPalette
    expect(() => rollMaterial(testPalette, 'accessory', 1, rng)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/materials.test.ts`
Expected: FAIL — module `../src/materials.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/materials.ts`:

```ts
import type { EquipmentSlot } from '@caverns/shared';
import type { BiomePalette, MaterialDef } from './types.js';

const registry = new Map<string, BiomePalette>();

export function registerPalette(palette: BiomePalette): void {
  registry.set(palette.biomeId, palette);
}

export function getPalette(biomeId: string): BiomePalette {
  const palette = registry.get(biomeId);
  if (!palette) throw new Error(`Unknown biome palette: ${biomeId}`);
  return palette;
}

/**
 * Tier roll weights by skull rating.
 * Index: [skullRating][tier] → weight (percentage).
 */
const TIER_WEIGHTS: Record<number, Record<number, number>> = {
  1: { 1: 100, 2: 0,  3: 0 },
  2: { 1: 35,  2: 60, 3: 5 },
  3: { 1: 12,  2: 60, 3: 28 },
};

export function rollMaterial(
  palette: BiomePalette,
  slot: EquipmentSlot,
  skullRating: number,
  rng: () => number,
): MaterialDef {
  const weights = TIER_WEIGHTS[skullRating] ?? TIER_WEIGHTS[1];

  // Filter materials that fit this slot
  const candidates = palette.materials.filter(m => m.slots.includes(slot));
  if (candidates.length === 0) {
    throw new Error(`No materials for slot '${slot}' in biome '${palette.biomeId}'`);
  }

  // First roll: pick a tier
  const tierTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  let tierRoll = rng() * tierTotal;
  let selectedTier = 1;
  for (const [tier, weight] of Object.entries(weights)) {
    tierRoll -= weight;
    if (tierRoll <= 0) {
      selectedTier = Number(tier);
      break;
    }
  }

  // Filter candidates by selected tier
  let tierCandidates = candidates.filter(m => m.tier === selectedTier);

  // Fallback: if no materials at the rolled tier for this slot, pick closest tier
  if (tierCandidates.length === 0) {
    for (const fallbackTier of [selectedTier - 1, selectedTier + 1, 1, 2, 3]) {
      tierCandidates = candidates.filter(m => m.tier === fallbackTier);
      if (tierCandidates.length > 0) break;
    }
  }

  // Pick randomly from tier candidates
  return tierCandidates[Math.floor(rng() * tierCandidates.length)];
}
```

- [ ] **Step 4: Create the Dripping Halls palette**

Create `itemgen/src/palettes/dripping-halls.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const DRIPPING_HALLS_PALETTE: BiomePalette = {
  biomeId: 'fungal',
  materials: [
    // Tier 1
    {
      id: 'bone', name: 'Bone',
      statBias: { damage: 1.2, defense: 0.8 },
      slots: ['weapon', 'offhand', 'accessory'],
      tier: 1,
    },
    {
      id: 'chitin', name: 'Chitin',
      statBias: { defense: 1.2, initiative: 0.8 },
      slots: ['armor', 'offhand'],
      tier: 1,
    },
    // Tier 2
    {
      id: 'mycelium', name: 'Mycelium',
      statBias: { maxHp: 1.3, damage: 1.0, defense: 1.0 },
      slots: ['weapon', 'armor', 'accessory'],
      tier: 2,
    },
    {
      id: 'crystal', name: 'Crystal',
      statBias: { damage: 1.2, initiative: 1.2 },
      slots: ['weapon', 'offhand', 'accessory'],
      tier: 2,
    },
    {
      id: 'sporecap', name: 'Sporecap',
      statBias: { defense: 1.2, maxHp: 1.2, initiative: 0.8 },
      slots: ['armor', 'offhand'],
      tier: 2,
    },
    // Tier 3
    {
      id: 'deepstone', name: 'Deepstone',
      statBias: { defense: 1.3, damage: 1.2 },
      slots: ['weapon', 'armor'],
      tier: 3,
    },
    {
      id: 'biolume', name: 'Biolume',
      statBias: { initiative: 1.3, maxHp: 1.2 },
      slots: ['offhand', 'accessory'],
      tier: 3,
    },
  ],
  nameFragments: {
    adjectives: [
      'gleaming', 'festering', 'whispering', 'pulsing', 'gnarled',
      'luminous', 'rotting', 'calcified', 'dripping', 'encrusted',
      'writhing', 'pallid', 'iridescent', 'thorned', 'hollow',
    ],
    prefixes: [
      'Spore', 'Gloom', 'Bone', 'Dread', 'Rot',
      'Pale', 'Deep', 'Myc', 'Fung', 'Crypt',
      'Dark', 'Blight', 'Murk', 'Wither', 'Shade',
    ],
    suffixes: [
      'bane', 'fang', 'shatter', 'maw', 'grip',
      'thorn', 'bloom', 'root', 'cap', 'stalk',
      'crawl', 'bite', 'rend', 'spore', 'wilt',
    ],
    baseTypes: {
      weapon: ['dagger', 'blade', 'mace', 'staff', 'cleaver', 'maul', 'spear', 'axe'],
      offhand: ['buckler', 'shield', 'orb', 'lantern', 'tome', 'ward'],
      armor: ['wrap', 'vest', 'plate', 'mail', 'hauberk', 'mantle'],
      accessory: ['amulet', 'ring', 'charm', 'pendant', 'circlet', 'brooch'],
    },
  },
};
```

- [ ] **Step 5: Register the palette on import from index**

Update `itemgen/src/index.ts` to auto-register the palette:

```ts
export type {
  ItemGenerationRequest,
  MaterialDef,
  NameFragments,
  BiomePalette,
  Quality,
} from './types.js';
export { registerPalette, getPalette } from './materials.js';
export { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';

// Auto-register built-in palettes
import { registerPalette } from './materials.js';
import { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
registerPalette(DRIPPING_HALLS_PALETTE);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd itemgen && npx vitest run __tests__/materials.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add itemgen/src/materials.ts itemgen/src/palettes/dripping-halls.ts itemgen/__tests__/materials.test.ts itemgen/src/index.ts
git commit -m "feat(itemgen): add material registry, tier gating, and fungal palette"
```

---

### Task 5: Stat Generation

**Files:**
- Create: `itemgen/src/stats.ts`
- Create: `itemgen/__tests__/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateStats, BASE_STAT_RANGES, STAT_CEILINGS } from '../src/stats.js';
import { createRng } from '../src/rng.js';
import type { MaterialDef } from '../src/types.js';
import type { Quality } from '../src/types.js';

const boneMaterial: MaterialDef = {
  id: 'bone', name: 'Bone',
  statBias: { damage: 1.2, defense: 0.8 },
  slots: ['weapon'], tier: 1,
};

const neutralMaterial: MaterialDef = {
  id: 'neutral', name: 'Neutral',
  statBias: {},
  slots: ['weapon', 'offhand', 'armor', 'accessory'], tier: 1,
};

describe('generateStats', () => {
  it('produces weapon stats with damage as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('weapon', 1, neutralMaterial, 'standard', rng);
    expect(stats.damage).toBeGreaterThan(0);
  });

  it('produces offhand stats with defense as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('offhand', 1, neutralMaterial, 'standard', rng);
    expect(stats.defense).toBeGreaterThan(0);
  });

  it('produces armor stats with defense as primary stat', () => {
    const rng = createRng(42);
    const stats = generateStats('armor', 2, neutralMaterial, 'standard', rng);
    expect(stats.defense).toBeGreaterThan(0);
  });

  it('applies material bias — bone weapon should have higher damage', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const boneStats = generateStats('weapon', 1, boneMaterial, 'standard', rng1);
    const neutralStats = generateStats('weapon', 1, neutralMaterial, 'standard', rng2);
    // Bone has 1.2x damage bias so should trend higher (not guaranteed per-roll due to variance,
    // but with same seed the base roll is the same — only the bias differs)
    expect(boneStats.damage!).toBeGreaterThanOrEqual(neutralStats.damage!);
  });

  it('masterwork quality produces higher stats than crude', () => {
    const stats1 = generateStats('weapon', 2, neutralMaterial, 'masterwork', createRng(42));
    const stats2 = generateStats('weapon', 2, neutralMaterial, 'crude', createRng(42));
    expect(stats1.damage!).toBeGreaterThan(stats2.damage!);
  });

  it('skull-3 produces higher stats than skull-1', () => {
    const stats1 = generateStats('weapon', 3, neutralMaterial, 'standard', createRng(42));
    const stats2 = generateStats('weapon', 1, neutralMaterial, 'standard', createRng(42));
    expect(stats1.damage!).toBeGreaterThan(stats2.damage!);
  });

  it('clamps skull-1 stats to not exceed skull-2 floor', () => {
    // Masterwork + high bias should still be clamped
    const highBias: MaterialDef = {
      id: 'high', name: 'High', statBias: { damage: 2.0 }, slots: ['weapon'], tier: 1,
    };
    const rng = createRng(42);
    const stats = generateStats('weapon', 1, highBias, 'masterwork', rng);
    const skull2Floor = BASE_STAT_RANGES.weapon[2].min;
    expect(stats.damage!).toBeLessThanOrEqual(skull2Floor);
  });

  it('is deterministic with the same seed', () => {
    const stats1 = generateStats('weapon', 2, boneMaterial, 'fine', createRng(99));
    const stats2 = generateStats('weapon', 2, boneMaterial, 'fine', createRng(99));
    expect(stats1).toEqual(stats2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/stats.test.ts`
Expected: FAIL — module `../src/stats.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/stats.ts`:

```ts
import type { ItemStats, EquipmentSlot } from '@caverns/shared';
import type { MaterialDef, Quality } from './types.js';
import { getQualityMultiplier } from './quality.js';

interface StatRange {
  min: number;
  max: number;
}

type SlotStatRanges = Record<number, StatRange>; // keyed by skull rating

export const BASE_STAT_RANGES: Record<EquipmentSlot, SlotStatRanges> = {
  weapon:    { 1: { min: 2, max: 4 },  2: { min: 5, max: 8 },   3: { min: 10, max: 14 } },
  offhand:   { 1: { min: 1, max: 2 },  2: { min: 3, max: 4 },   3: { min: 5, max: 7 } },
  armor:     { 1: { min: 1, max: 3 },  2: { min: 3, max: 5 },   3: { min: 5, max: 8 } },
  accessory: { 1: { min: 3, max: 5 },  2: { min: 6, max: 10 },  3: { min: 10, max: 15 } },
};

/** Ceiling = next skull tier's floor. Skull-3 has no ceiling. */
export const STAT_CEILINGS: Record<EquipmentSlot, Record<number, number | null>> = {
  weapon:    { 1: 5,  2: 10, 3: null },
  offhand:   { 1: 3,  2: 5,  3: null },
  armor:     { 1: 3,  2: 5,  3: null },
  accessory: { 1: 6,  2: 10, 3: null },
};

const PRIMARY_STAT: Record<EquipmentSlot, keyof ItemStats> = {
  weapon: 'damage',
  offhand: 'defense',
  armor: 'defense',
  accessory: 'damage', // placeholder — accessories pick a random primary
};

const ACCESSORY_STATS: (keyof ItemStats)[] = ['maxHp', 'damage', 'defense', 'initiative'];

const VARIANCE = 0.15; // +/- 15%

function rollInRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

function applyVariance(value: number, rng: () => number): number {
  const factor = 1 + (rng() * 2 - 1) * VARIANCE;
  return value * factor;
}

export function generateStats(
  slot: EquipmentSlot,
  skullRating: number,
  material: MaterialDef,
  quality: Quality,
  rng: () => number,
): ItemStats {
  const range = BASE_STAT_RANGES[slot][skullRating];
  const ceiling = STAT_CEILINGS[slot][skullRating];
  const qualityMult = getQualityMultiplier(quality);

  // Determine primary stat
  const primaryStat = slot === 'accessory'
    ? ACCESSORY_STATS[Math.floor(rng() * ACCESSORY_STATS.length)]
    : PRIMARY_STAT[slot];

  // Roll base value
  let baseValue = rollInRange(range.min, range.max, rng);

  // Apply material bias
  const bias = material.statBias[primaryStat as keyof typeof material.statBias] ?? 1.0;
  baseValue *= bias;

  // Apply quality multiplier
  baseValue *= qualityMult;

  // Apply variance
  baseValue = applyVariance(baseValue, rng);

  // Round and clamp
  let finalValue = Math.max(1, Math.round(baseValue));
  if (ceiling !== null) {
    finalValue = Math.min(finalValue, ceiling);
  }

  const stats: ItemStats = {};
  stats[primaryStat] = finalValue;

  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd itemgen && npx vitest run __tests__/stats.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add itemgen/src/stats.ts itemgen/__tests__/stats.test.ts
git commit -m "feat(itemgen): add stat generation with material bias, quality scaling, and guardrails"
```

---

### Task 6: Name Generation

**Files:**
- Create: `itemgen/src/naming.ts`
- Create: `itemgen/__tests__/naming.test.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/naming.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateName } from '../src/naming.js';
import { createRng } from '../src/rng.js';
import type { NameFragments, Quality } from '../src/types.js';

const fragments: NameFragments = {
  adjectives: ['gleaming', 'festering', 'whispering'],
  prefixes: ['Spore', 'Gloom', 'Bone'],
  suffixes: ['bane', 'fang', 'shatter'],
  baseTypes: {
    weapon: ['dagger', 'blade', 'mace'],
    offhand: ['buckler', 'shield'],
    armor: ['vest', 'plate'],
    accessory: ['amulet', 'ring'],
  },
};

describe('generateName', () => {
  it('common items use [Quality] [Material] [BaseType] format', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'common', 'fine', 'Bone', fragments, rng);
    // Should be "Fine Bone <baseType>"
    expect(name).toMatch(/^Fine Bone \w+$/);
  });

  it('common items with standard quality omit the quality word', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'common', 'standard', 'Bone', fragments, rng);
    // Should be "Bone <baseType>" — no quality prefix
    expect(name).toMatch(/^Bone \w+$/);
  });

  it('uncommon items use same format as common', () => {
    const rng = createRng(42);
    const name = generateName('armor', 'uncommon', 'superior', 'Chitin', fragments, rng);
    expect(name).toMatch(/^Superior Chitin \w+$/);
  });

  it('rare items use [Adjective] [Material] [BaseType] format', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'rare', 'fine', 'Crystal', fragments, rng);
    // Should be "<Adjective> Crystal <baseType>"
    const parts = name.split(' ');
    expect(parts.length).toBe(3);
    expect(fragments.adjectives.map(a => a.charAt(0).toUpperCase() + a.slice(1)))
      .toContain(parts[0]);
    expect(parts[1]).toBe('Crystal');
  });

  it('legendary items use a compound name', () => {
    const rng = createRng(42);
    const name = generateName('weapon', 'legendary', 'masterwork', 'Deepstone', fragments, rng);
    // Should be a single compound word like "Sporebane"
    expect(name.split(' ').length).toBe(1);
    // Should start with a prefix
    const matchesPrefix = fragments.prefixes.some(p => name.startsWith(p));
    expect(matchesPrefix).toBe(true);
  });

  it('is deterministic with same seed', () => {
    const name1 = generateName('weapon', 'rare', 'fine', 'Bone', fragments, createRng(42));
    const name2 = generateName('weapon', 'rare', 'fine', 'Bone', fragments, createRng(42));
    expect(name1).toBe(name2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/naming.test.ts`
Expected: FAIL — module `../src/naming.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/naming.ts`:

```ts
import type { EquipmentSlot, Rarity } from '@caverns/shared';
import type { NameFragments, Quality } from './types.js';

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const QUALITY_WORDS: Record<Quality, string | null> = {
  crude: 'Crude',
  standard: null,  // omitted
  fine: 'Fine',
  superior: 'Superior',
  masterwork: 'Masterwork',
};

export function generateName(
  slot: EquipmentSlot,
  rarity: Rarity,
  quality: Quality,
  materialName: string,
  fragments: NameFragments,
  rng: () => number,
): string {
  const baseType = capitalize(pick(fragments.baseTypes[slot], rng));

  if (rarity === 'legendary') {
    // Compound name: prefix + suffix → "Sporebane"
    const prefix = pick(fragments.prefixes, rng);
    const suffix = pick(fragments.suffixes, rng);
    return `${prefix}${suffix}`;
  }

  if (rarity === 'rare') {
    // [Adjective] [Material] [BaseType]
    const adjective = capitalize(pick(fragments.adjectives, rng));
    return `${adjective} ${materialName} ${baseType}`;
  }

  // Common / Uncommon: [Quality] [Material] [BaseType]
  const qualityWord = QUALITY_WORDS[quality];
  if (qualityWord) {
    return `${qualityWord} ${materialName} ${baseType}`;
  }
  return `${materialName} ${baseType}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd itemgen && npx vitest run __tests__/naming.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add itemgen/src/naming.ts itemgen/__tests__/naming.test.ts
git commit -m "feat(itemgen): add tiered name generation (descriptive → adjective → compound)"
```

---

### Task 7: `generateItem` — Main Entry Point

Tie all sub-modules together into the public API.

**Files:**
- Create: `itemgen/src/generate.ts`
- Create: `itemgen/__tests__/generate.test.ts`
- Modify: `itemgen/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `itemgen/__tests__/generate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateItem } from '../src/generate.js';
import type { ItemGenerationRequest } from '../src/types.js';

// Ensure palettes are registered
import '../src/index.js';

describe('generateItem', () => {
  it('returns an Item with all required fields', () => {
    const request: ItemGenerationRequest = {
      slot: 'weapon',
      skullRating: 1,
      biomeId: 'fungal',
      seed: 42,
    };
    const item = generateItem(request);
    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(item.description).toBeTruthy();
    expect(item.rarity).toBeTruthy();
    expect(item.slot).toBe('weapon');
    expect(item.stats).toBeDefined();
    expect(item.stats.damage).toBeGreaterThan(0);
  });

  it('respects forced rarity', () => {
    const item = generateItem({
      slot: 'armor',
      skullRating: 2,
      biomeId: 'fungal',
      rarity: 'legendary',
      seed: 42,
    });
    expect(item.rarity).toBe('legendary');
    // Legendary should have a compound name (single word)
    expect(item.name.split(' ').length).toBe(1);
  });

  it('is deterministic with the same seed', () => {
    const request: ItemGenerationRequest = {
      slot: 'weapon',
      skullRating: 2,
      biomeId: 'fungal',
      seed: 99,
    };
    const item1 = generateItem(request);
    const item2 = generateItem(request);
    expect(item1).toEqual(item2);
  });

  it('generates different items with different seeds', () => {
    const base = { slot: 'weapon' as const, skullRating: 2 as const, biomeId: 'fungal' };
    const item1 = generateItem({ ...base, seed: 1 });
    const item2 = generateItem({ ...base, seed: 2 });
    // At minimum the IDs should differ
    expect(item1.id).not.toBe(item2.id);
  });

  it('generates valid items for all equipment slots', () => {
    const slots = ['weapon', 'offhand', 'armor', 'accessory'] as const;
    for (const slot of slots) {
      const item = generateItem({ slot, skullRating: 2, biomeId: 'fungal', seed: 42 });
      expect(item.slot).toBe(slot);
      expect(Object.keys(item.stats).length).toBeGreaterThan(0);
    }
  });

  it('legendary items include descriptive subtitle in description', () => {
    const item = generateItem({
      slot: 'weapon',
      skullRating: 3,
      biomeId: 'fungal',
      rarity: 'legendary',
      seed: 42,
    });
    // Description should contain material and base type info
    expect(item.description.length).toBeGreaterThan(0);
  });

  it('throws on unknown biome', () => {
    expect(() => generateItem({
      slot: 'weapon',
      skullRating: 1,
      biomeId: 'nonexistent',
      seed: 42,
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd itemgen && npx vitest run __tests__/generate.test.ts`
Expected: FAIL — module `../src/generate.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `itemgen/src/generate.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';
import type { Item, Rarity } from '@caverns/shared';
import type { ItemGenerationRequest } from './types.js';
import { createRng } from './rng.js';
import { getPalette, rollMaterial } from './materials.js';
import { rollQuality } from './quality.js';
import { generateStats } from './stats.js';
import { generateName } from './naming.js';

const RARITY_WEIGHTS: { rarity: Rarity; weight: number }[] = [
  { rarity: 'common',    weight: 40 },
  { rarity: 'uncommon',  weight: 35 },
  { rarity: 'rare',      weight: 20 },
  { rarity: 'legendary', weight: 5 },
];

const RARITY_TOTAL = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);

function rollRarity(rng: () => number): Rarity {
  let roll = rng() * RARITY_TOTAL;
  for (const entry of RARITY_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.rarity;
  }
  return 'common';
}

let nextId = 1;

export function generateItem(request: ItemGenerationRequest): Item {
  const { slot, skullRating, biomeId, seed } = request;
  const rng = createRng(seed);
  const palette = getPalette(biomeId);

  // Roll rarity
  const rarity = request.rarity ?? rollRarity(rng);

  // Roll material
  const material = rollMaterial(palette, slot, skullRating, rng);

  // Roll quality
  const quality = rollQuality(rng);

  // Generate stats
  const stats = generateStats(slot, skullRating, material, quality, rng);

  // Generate name
  const name = generateName(slot, rarity, quality, material.name, palette.nameFragments, rng);

  // Build description
  let description: string;
  if (rarity === 'legendary') {
    // Include the descriptive subtitle for legendary items
    const qualityWord = quality === 'standard' ? 'a' : `a ${quality}`;
    const baseTypes = palette.nameFragments.baseTypes[slot];
    const baseType = baseTypes[Math.floor(rng() * baseTypes.length)];
    description = `${name} — ${qualityWord} ${material.name.toLowerCase()} ${baseType}.`;
  } else {
    description = `A ${quality === 'standard' ? '' : quality + ' '}${material.name.toLowerCase()} ${slot}.`;
  }

  // Generate unique ID
  const id = seed !== undefined ? `gen_${seed}_${slot}_${nextId++}` : `gen_${uuidv4()}`;

  return {
    id,
    name,
    description,
    rarity,
    slot,
    stats,
  };
}
```

**Wait** — `uuid` is a dependency we'd need to add. Simpler: just use the RNG to make an ID.

Replace the ID generation with:

```ts
  // Generate unique ID using RNG for determinism
  const idSuffix = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
  const id = `gen_${slot}_${idSuffix}`;
```

So the full `generate.ts` without uuid:

```ts
import type { Item, Rarity } from '@caverns/shared';
import type { ItemGenerationRequest } from './types.js';
import { createRng } from './rng.js';
import { getPalette, rollMaterial } from './materials.js';
import { rollQuality } from './quality.js';
import { generateStats } from './stats.js';
import { generateName } from './naming.js';

const RARITY_WEIGHTS: { rarity: Rarity; weight: number }[] = [
  { rarity: 'common',    weight: 40 },
  { rarity: 'uncommon',  weight: 35 },
  { rarity: 'rare',      weight: 20 },
  { rarity: 'legendary', weight: 5 },
];

const RARITY_TOTAL = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);

function rollRarity(rng: () => number): Rarity {
  let roll = rng() * RARITY_TOTAL;
  for (const entry of RARITY_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.rarity;
  }
  return 'common';
}

export function generateItem(request: ItemGenerationRequest): Item {
  const { slot, skullRating, biomeId, seed } = request;
  const rng = createRng(seed);
  const palette = getPalette(biomeId);

  // Roll rarity
  const rarity = request.rarity ?? rollRarity(rng);

  // Roll material
  const material = rollMaterial(palette, slot, skullRating, rng);

  // Roll quality
  const quality = rollQuality(rng);

  // Generate stats
  const stats = generateStats(slot, skullRating, material, quality, rng);

  // Generate name
  const name = generateName(slot, rarity, quality, material.name, palette.nameFragments, rng);

  // Build description
  let description: string;
  if (rarity === 'legendary') {
    const qualityWord = quality === 'standard' ? 'a' : `a ${quality}`;
    const baseTypes = palette.nameFragments.baseTypes[slot];
    const baseType = baseTypes[Math.floor(rng() * baseTypes.length)];
    description = `${name} — ${qualityWord} ${material.name.toLowerCase()} ${baseType}.`;
  } else {
    description = `A ${quality === 'standard' ? '' : quality + ' '}${material.name.toLowerCase()} ${slot}.`;
  }

  // Generate unique ID
  const idSuffix = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
  const id = `gen_${slot}_${idSuffix}`;

  return { id, name, description, rarity, slot, stats };
}
```

- [ ] **Step 4: Update `itemgen/src/index.ts` to export `generateItem`**

```ts
export type {
  ItemGenerationRequest,
  MaterialDef,
  NameFragments,
  BiomePalette,
  Quality,
} from './types.js';
export { registerPalette, getPalette } from './materials.js';
export { generateItem } from './generate.js';
export { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';

// Auto-register built-in palettes
import { registerPalette } from './materials.js';
import { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
registerPalette(DRIPPING_HALLS_PALETTE);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd itemgen && npx vitest run __tests__/generate.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 6: Run all itemgen tests**

Run: `cd itemgen && npx vitest run`
Expected: All tests across all 4 test files PASS.

- [ ] **Step 7: Commit**

```bash
git add itemgen/src/generate.ts itemgen/__tests__/generate.test.ts itemgen/src/index.ts
git commit -m "feat(itemgen): add generateItem entry point tying all sub-modules together"
```

---

### Task 8: Server Integration — Update Loot Types

Update `MobTemplate.lootTable` and `RoomLoot` in shared types to support generated loot drops alongside consumable references.

**Files:**
- Modify: `shared/src/types.ts` — update `MobTemplate.lootTable` type
- Modify: `shared/src/data/types.ts` — update `MobPoolEntry.lootTable` type

- [ ] **Step 1: Define `LootDrop` type in shared types**

In `shared/src/types.ts`, add the `LootDrop` union type near the `MobTemplate` interface (around line 126):

```ts
export interface GeneratedLootDrop {
  slot: EquipmentSlot;
  skullRating: 1 | 2 | 3;
  rarityWeights?: Partial<Record<Rarity, number>>;
}

export interface ConsumableLootDrop {
  consumableId: string;
}

export type LootDrop = GeneratedLootDrop | ConsumableLootDrop;
```

- [ ] **Step 2: Update `MobTemplate.lootTable` to use `LootDrop[]`**

In `shared/src/types.ts`, change the `MobTemplate` interface:

```ts
export interface MobTemplate {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  lootTable: LootDrop[];
}
```

- [ ] **Step 3: Update `MobPoolEntry.lootTable` in `shared/src/data/types.ts`**

Change `lootTable: string[]` to:

```ts
import type { LootDrop } from '../types.js';

// ...

export interface MobPoolEntry {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  biomes: string[];
  baseStats: {
    maxHp: number;
    damage: number;
    defense: number;
    initiative: number;
  };
  lootTable: LootDrop[];
}
```

- [ ] **Step 4: Add `biomeId` to `DungeonContent`**

In `shared/src/types.ts`, update `DungeonContent`:

```ts
export interface DungeonContent {
  name: string;
  theme: string;
  atmosphere: string;
  biomeId: string;          // ← add this
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];            // consumables only after migration
  bossId: string;
  entranceRoomId: string;
  zoneTransitions?: Record<string, string>;
}
```

- [ ] **Step 5: Verify shared compiles**

Run: `cd shared && npx tsc --noEmit`
Expected: Type errors in `content.ts` and `content.test.ts` (because the static loot tables are still `string[]` — these will be fixed in Task 9). Other files may also have errors — that's expected. Note them for the next task.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/data/types.ts
git commit -m "feat(shared): add LootDrop type and biomeId to DungeonContent"
```

---

### Task 9: Migrate Static Content

Update `content.ts` (the Dripping Halls static dungeon) and `mobPool.json` to use the new `LootDrop` format. Remove equipment items from `items.json`, keeping only consumables.

**Files:**
- Modify: `shared/src/content.ts`
- Modify: `shared/src/data/mobPool.json`
- Modify: `shared/src/data/items.json`
- Modify: `shared/src/content.test.ts`

- [ ] **Step 1: Update `DRIPPING_HALLS` in `content.ts`**

Add `biomeId: 'fungal'` to the dungeon content. Convert mob `lootTable` entries from item ID strings to `LootDrop` objects. Remove all equipment items from the `items` array, keeping only consumables. Remove `RoomLoot` entries that reference equipment (room loot will be generated at drop time — this is handled in the server integration task).

The mobs section becomes:

```ts
mobs: [
  {
    id: 'fungal_crawler',
    name: 'Fungal Crawler',
    description: 'A dog-sized insect coated in phosphorescent spores.',
    skullRating: 1,
    maxHp: 25,
    damage: 8,
    defense: 2,
    initiative: 4,
    lootTable: [
      { slot: 'weapon', skullRating: 1 },
      { slot: 'armor', skullRating: 1 },
    ],
  },
  {
    id: 'cave_lurker',
    name: 'Cave Lurker',
    description: 'A pale, eyeless humanoid that clings to the ceiling and drops on prey.',
    skullRating: 1,
    maxHp: 20,
    damage: 10,
    defense: 1,
    initiative: 6,
    lootTable: [
      { slot: 'weapon', skullRating: 1 },
      { slot: 'armor', skullRating: 1 },
    ],
  },
  {
    id: 'sporecap_brute',
    name: 'Sporecap Brute',
    description: 'A hulking fungal creature with a massive mushroom cap for a head.',
    skullRating: 2,
    maxHp: 60,
    damage: 14,
    defense: 5,
    initiative: 3,
    lootTable: [
      { slot: 'weapon', skullRating: 2 },
      { slot: 'armor', skullRating: 2 },
      { slot: 'accessory', skullRating: 2 },
    ],
  },
  {
    id: 'mycelium_king',
    name: 'The Mycelium King',
    description: 'A towering mass of interwoven fungal tendrils.',
    skullRating: 3,
    maxHp: 200,
    damage: 25,
    defense: 8,
    initiative: 5,
    lootTable: [
      { slot: 'weapon', skullRating: 3 },
      { slot: 'accessory', skullRating: 3 },
      { slot: 'accessory', skullRating: 3 },
    ],
  },
],
```

The `items` array keeps only consumables:

```ts
items: [
  { id: 'leather_scraps', name: 'Leather Scrap Bandage', description: 'Makeshift bandages from old leather.', rarity: 'common', slot: 'consumable', stats: { healAmount: 10 } },
  { id: 'hp_potion', name: 'Health Potion', description: 'A standard healing draught.', rarity: 'uncommon', slot: 'consumable', stats: { healAmount: 25 } },
  { id: 'hp_potion_large', name: 'Greater Health Potion', description: 'A large flask of potent healing liquid.', rarity: 'rare', slot: 'consumable', stats: { healAmount: 40 } },
  { id: 'elixir', name: 'Fungal Elixir', description: 'A shimmering elixir distilled from rare fungi.', rarity: 'rare', slot: 'consumable', stats: { healAmount: 50 } },
  { id: 'throwing_spore', name: 'Volatile Spore Pod', description: 'A bulging spore pod that explodes on impact.', rarity: 'uncommon', slot: 'consumable', stats: { damage: 20 } },
],
```

Room `loot` entries referencing equipment IDs should be removed. Room `loot` entries referencing consumable IDs stay. Rooms that had only equipment loot should have their `loot` property removed entirely.

- [ ] **Step 2: Update `mobPool.json`**

Convert all `lootTable` entries from `string[]` to `LootDrop[]`. Equipment item references become `{ "slot": "<slot>", "skullRating": <N> }`. Consumable references become `{ "consumableId": "<id>" }`.

For example, a mob that had:
```json
"lootTable": ["spore_dagger", "fungal_wrap"]
```
becomes:
```json
"lootTable": [
  { "slot": "weapon", "skullRating": 1 },
  { "slot": "armor", "skullRating": 1 }
]
```

And a mob that had:
```json
"lootTable": ["brute_hammer", "sporecap_plate", "vitality_ring"]
```
becomes:
```json
"lootTable": [
  { "slot": "weapon", "skullRating": 2 },
  { "slot": "armor", "skullRating": 2 },
  { "slot": "accessory", "skullRating": 2 }
]
```

Where a loot table included consumables (e.g. `"hp_potion"`), those become `{ "consumableId": "hp_potion" }`.

- [ ] **Step 3: Update `items.json`**

Remove all equipment items (anything with `slot` of `weapon`, `offhand`, `armor`, or `accessory`). Keep only items with `slot: "consumable"`. This includes potions, bandages, bombs, etc.

- [ ] **Step 4: Update `content.test.ts`**

The test at `shared/src/content.test.ts` validates loot table item IDs exist in the items array. This test needs updating since equipment loot is now generated. Update it to validate that:
- Consumable loot drop IDs (`consumableId`) exist in the items array
- Generated loot drops (`slot` + `skullRating`) have valid values

- [ ] **Step 5: Verify shared compiles**

Run: `cd shared && npx tsc --noEmit`
Expected: No errors in shared. Server may still have errors (fixed in next task).

- [ ] **Step 6: Commit**

```bash
git add shared/src/content.ts shared/src/content.test.ts shared/src/data/mobPool.json shared/src/data/items.json
git commit -m "feat(shared): migrate loot tables to LootDrop format, remove static equipment items"
```

---

### Task 10: Server Integration — Update GameSession Loot Logic

Replace the server's item-lookup loot system with calls to `generateItem()`.

**Files:**
- Modify: `server/package.json` — add `@caverns/itemgen` dependency
- Modify: `server/src/GameSession.ts` — update `rollMobLoot`, `dropLoot`, `handleExtraLootRoll`
- Modify: `server/src/ProceduralGenerator.ts` — update dungeon output to include `biomeId`, remove equipment item collection

- [ ] **Step 1: Add `@caverns/itemgen` dependency to server**

In `server/package.json`, add to `dependencies`:

```json
"@caverns/itemgen": "*"
```

Run: `npm install`

- [ ] **Step 2: Update `GameSession.ts` imports**

Add the import at the top of `GameSession.ts`:

```ts
import { generateItem } from '@caverns/itemgen';
import type { GeneratedLootDrop, ConsumableLootDrop, LootDrop } from '@caverns/shared';
```

- [ ] **Step 3: Add a `biomeId` field to `GameSession`**

The `GameSession` needs to know the dungeon's biome ID to pass to `generateItem`. Add a field and populate it from `DungeonContent.biomeId` during initialization. Check where the dungeon content is loaded/assigned and extract the `biomeId` there.

For procedurally generated dungeons, the `biomeId` should be the last biome in the chain (the "final biome"). Update `ProceduralGenerator.ts` to include `biomeId` in its output.

- [ ] **Step 4: Rewrite `rollMobLoot` to use `generateItem`**

Replace the existing `rollMobLoot` method. The new version takes the `LootDrop[]` loot table and returns generated items:

```ts
private rollMobLoot(lootTable: LootDrop[]): Item[] {
  const items: Item[] = [];
  for (const drop of lootTable) {
    if ('consumableId' in drop) {
      const item = this.items.get(drop.consumableId);
      if (item) items.push({ ...item, id: `${item.id}_${this.nextLootInstanceId++}` });
    } else {
      const generated = generateItem({
        slot: drop.slot,
        skullRating: drop.skullRating,
        biomeId: this.biomeId,
      });
      items.push(generated);
    }
  }
  return items;
}
```

Note: the old `rollMobLoot` picked ONE random item from the table. The new version generates items for each `LootDrop` entry. If you want to preserve the "pick one" behavior, wrap in a random selection. Check the existing call sites to determine the correct behavior and adjust accordingly.

- [ ] **Step 5: Update `dropLoot` to use the new `rollMobLoot`**

The `dropLoot` method currently calls `rollMobLoot` for a single item and collects room loot by ID. Update it:
- Room loot with `itemId` entries that reference consumables: look up in `this.items`
- Mob loot: call the new `rollMobLoot` which handles both generated and consumable drops

- [ ] **Step 6: Update `handleExtraLootRoll` (pickpocket)**

This method also calls `rollMobLoot`. Update it to use the new signature.

- [ ] **Step 7: Update `ProceduralGenerator.ts`**

In the `generateDungeon` function's output:
- Add `biomeId` to the returned `DungeonContent`. Use the final biome's `id`.
- Remove the equipment item collection logic (the `usedItemIds` / `usedItemsList` code that collected equipment). Keep only consumable items in the output `items[]` array.
- Room loot distribution (section 6): instead of picking from `allItems` by rarity, insert `LootDrop` objects with `slot` and `skullRating` into room loot entries. This requires changing the room loot format — rooms should store `LootDrop[]` instead of `{ itemId, location }[]`. OR: keep room loot as-is for consumables and add a separate field for generated drops. Check the existing `Room.loot` type and adapt accordingly.

- [ ] **Step 8: Build and verify**

Run: `npm run build`
Expected: Full build succeeds with no type errors.

- [ ] **Step 9: Run all tests**

Run: `npm test`
Expected: All tests pass. Some server tests may need updating if they reference old loot table formats.

- [ ] **Step 10: Commit**

```bash
git add server/package.json server/src/GameSession.ts server/src/ProceduralGenerator.ts
git commit -m "feat(server): integrate @caverns/itemgen for procedural loot generation"
```

---

### Task 11: Add Additional Biome Palettes

The mob pool has mobs for 6 biomes: starter, fungal, crystal, flooded, bone, volcanic. Task 4 added the fungal palette. Add palettes for the remaining biomes.

**Files:**
- Create: `itemgen/src/palettes/starter.ts`
- Create: `itemgen/src/palettes/crystal.ts`
- Create: `itemgen/src/palettes/flooded.ts`
- Create: `itemgen/src/palettes/bone.ts`
- Create: `itemgen/src/palettes/volcanic.ts`
- Modify: `itemgen/src/index.ts` — auto-register all palettes

- [ ] **Step 1: Create starter palette**

Create `itemgen/src/palettes/starter.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const STARTER_PALETTE: BiomePalette = {
  biomeId: 'starter',
  materials: [
    { id: 'iron', name: 'Iron', statBias: { damage: 1.0, defense: 1.0 }, slots: ['weapon', 'armor', 'offhand'], tier: 1 },
    { id: 'leather', name: 'Leather', statBias: { initiative: 1.1, defense: 0.9 }, slots: ['armor', 'offhand', 'accessory'], tier: 1 },
    { id: 'wood', name: 'Wood', statBias: { damage: 0.9, defense: 1.0 }, slots: ['weapon', 'offhand'], tier: 1 },
    { id: 'steel', name: 'Steel', statBias: { damage: 1.1, defense: 1.1 }, slots: ['weapon', 'armor', 'offhand'], tier: 2 },
    { id: 'bronze', name: 'Bronze', statBias: { defense: 1.2, damage: 1.0 }, slots: ['armor', 'offhand', 'accessory'], tier: 2 },
    { id: 'silver', name: 'Silver', statBias: { initiative: 1.2, maxHp: 1.1 }, slots: ['weapon', 'accessory'], tier: 3 },
    { id: 'mithril', name: 'Mithril', statBias: { damage: 1.2, initiative: 1.2, defense: 1.1 }, slots: ['weapon', 'armor'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'worn', 'polished', 'battered', 'keen', 'sturdy',
      'tarnished', 'tempered', 'heavy', 'balanced', 'ancient',
      'notched', 'honed', 'pitted', 'gleaming', 'rugged',
    ],
    prefixes: [
      'War', 'Stone', 'Iron', 'Grey', 'Rust',
      'Steel', 'Forge', 'Edge', 'Guard', 'Hawk',
      'Wolf', 'Ram', 'Storm', 'Oath', 'Grim',
    ],
    suffixes: [
      'strike', 'guard', 'breaker', 'edge', 'helm',
      'ward', 'fury', 'keep', 'fall', 'born',
      'heart', 'song', 'wrath', 'brand', 'call',
    ],
    baseTypes: {
      weapon: ['sword', 'axe', 'mace', 'dagger', 'spear', 'hammer', 'flail', 'halberd'],
      offhand: ['shield', 'buckler', 'lantern', 'tome', 'parrying dagger', 'ward'],
      armor: ['vest', 'tunic', 'mail', 'plate', 'jerkin', 'brigandine'],
      accessory: ['ring', 'amulet', 'pendant', 'charm', 'brooch', 'locket'],
    },
  },
};
```

- [ ] **Step 2: Create crystal palette**

Create `itemgen/src/palettes/crystal.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const CRYSTAL_PALETTE: BiomePalette = {
  biomeId: 'crystal',
  materials: [
    { id: 'quartz', name: 'Quartz', statBias: { damage: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 1 },
    { id: 'geode', name: 'Geode', statBias: { defense: 1.2 }, slots: ['armor', 'offhand'], tier: 1 },
    { id: 'amethyst', name: 'Amethyst', statBias: { maxHp: 1.2, initiative: 1.1 }, slots: ['weapon', 'accessory'], tier: 2 },
    { id: 'prism', name: 'Prism', statBias: { damage: 1.2, initiative: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'lattice', name: 'Lattice', statBias: { defense: 1.3, initiative: 0.9 }, slots: ['armor', 'offhand'], tier: 2 },
    { id: 'diamond', name: 'Diamond', statBias: { damage: 1.3, defense: 1.2 }, slots: ['weapon', 'armor'], tier: 3 },
    { id: 'resonance', name: 'Resonance', statBias: { initiative: 1.4, maxHp: 1.2 }, slots: ['offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'shimmering', 'fractured', 'prismatic', 'faceted', 'refracted',
      'crystalline', 'luminous', 'resonant', 'angular', 'vitreous',
      'scintillating', 'translucent', 'sharp', 'frozen', 'radiant',
    ],
    prefixes: [
      'Prism', 'Shard', 'Facet', 'Glass', 'Gem',
      'Lux', 'Fracture', 'Gleam', 'Glint', 'Spark',
      'Arc', 'Ray', 'Flint', 'Frost', 'Star',
    ],
    suffixes: [
      'shard', 'point', 'flash', 'gleam', 'cut',
      'prism', 'lance', 'crack', 'flare', 'burst',
      'beam', 'spire', 'gaze', 'edge', 'core',
    ],
    baseTypes: {
      weapon: ['shard blade', 'crystal sword', 'prism dagger', 'geode mace', 'glass spear', 'facet axe'],
      offhand: ['crystal buckler', 'prism focus', 'geode shield', 'shard ward', 'lattice guard'],
      armor: ['crystal mail', 'geode plate', 'lattice vest', 'prism hauberk', 'facet mantle'],
      accessory: ['crystal pendant', 'prism ring', 'geode amulet', 'shard circlet', 'resonance gem'],
    },
  },
};
```

- [ ] **Step 3: Create flooded palette**

Create `itemgen/src/palettes/flooded.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const FLOODED_PALETTE: BiomePalette = {
  biomeId: 'flooded',
  materials: [
    { id: 'driftwood', name: 'Driftwood', statBias: { damage: 0.9, initiative: 1.1 }, slots: ['weapon', 'offhand'], tier: 1 },
    { id: 'barnacle', name: 'Barnacle', statBias: { defense: 1.1, damage: 1.0 }, slots: ['armor', 'offhand'], tier: 1 },
    { id: 'coral', name: 'Coral', statBias: { damage: 1.1, maxHp: 1.1 }, slots: ['weapon', 'armor', 'accessory'], tier: 2 },
    { id: 'pearl', name: 'Pearl', statBias: { maxHp: 1.3, initiative: 1.1 }, slots: ['accessory', 'offhand'], tier: 2 },
    { id: 'brine', name: 'Brine-Forged', statBias: { defense: 1.2, damage: 1.1 }, slots: ['weapon', 'armor'], tier: 2 },
    { id: 'abyssal', name: 'Abyssal', statBias: { damage: 1.3, defense: 1.2 }, slots: ['weapon', 'armor'], tier: 3 },
    { id: 'leviathan', name: 'Leviathan', statBias: { maxHp: 1.3, damage: 1.2 }, slots: ['offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'corroded', 'waterlogged', 'briny', 'barnacled', 'tidal',
      'sunken', 'drowned', 'salt-crusted', 'murky', 'abyssal',
      'flowing', 'submerged', 'brackish', 'pelagic', 'silted',
    ],
    prefixes: [
      'Tide', 'Depth', 'Brine', 'Flood', 'Drown',
      'Kelp', 'Shell', 'Wave', 'Reef', 'Abyss',
      'Mist', 'Riptide', 'Surge', 'Salt', 'Murk',
    ],
    suffixes: [
      'tide', 'current', 'surge', 'spray', 'wake',
      'depth', 'tooth', 'shell', 'fin', 'scale',
      'gulp', 'drown', 'wash', 'reef', 'pool',
    ],
    baseTypes: {
      weapon: ['cutlass', 'harpoon', 'trident', 'coral blade', 'sea pick', 'anchor mace'],
      offhand: ['shell shield', 'driftwood buckler', 'coral ward', 'tide lantern', 'kelp net'],
      armor: ['barnacle mail', 'coral plate', 'kelp wrap', 'shell hauberk', 'brine vest'],
      accessory: ['pearl earring', 'shell pendant', 'coral ring', 'tide charm', 'sea stone brooch'],
    },
  },
};
```

- [ ] **Step 4: Create bone palette**

Create `itemgen/src/palettes/bone.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const BONE_PALETTE: BiomePalette = {
  biomeId: 'bone',
  materials: [
    { id: 'marrow', name: 'Marrow', statBias: { maxHp: 1.2 }, slots: ['accessory', 'offhand'], tier: 1 },
    { id: 'femur', name: 'Femur', statBias: { damage: 1.1, defense: 0.9 }, slots: ['weapon', 'offhand'], tier: 1 },
    { id: 'skull', name: 'Skull', statBias: { defense: 1.2, initiative: 0.9 }, slots: ['armor', 'offhand', 'accessory'], tier: 2 },
    { id: 'rib', name: 'Rib', statBias: { damage: 1.2, initiative: 1.1 }, slots: ['weapon', 'armor'], tier: 2 },
    { id: 'vertebrae', name: 'Vertebrae', statBias: { defense: 1.1, maxHp: 1.2 }, slots: ['armor', 'accessory'], tier: 2 },
    { id: 'ossified', name: 'Ossified', statBias: { defense: 1.3, damage: 1.2 }, slots: ['weapon', 'armor'], tier: 3 },
    { id: 'deathbone', name: 'Deathbone', statBias: { damage: 1.3, maxHp: 1.2 }, slots: ['offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'bleached', 'rattling', 'splintered', 'calcified', 'hollow',
      'cracked', 'ancient', 'cursed', 'grim', 'ossified',
      'spectral', 'weathered', 'jagged', 'ashen', 'lifeless',
    ],
    prefixes: [
      'Bone', 'Death', 'Grave', 'Skull', 'Marrow',
      'Crypt', 'Ash', 'Wraith', 'Ghast', 'Tomb',
      'Dirge', 'Pyre', 'Shade', 'Blight', 'Woe',
    ],
    suffixes: [
      'rattle', 'crack', 'gnaw', 'grind', 'snap',
      'wail', 'howl', 'rot', 'curse', 'grave',
      'dust', 'knell', 'reap', 'mourn', 'chill',
    ],
    baseTypes: {
      weapon: ['bone club', 'femur flail', 'rib blade', 'skull mace', 'spine spear', 'jaw axe'],
      offhand: ['skull cap shield', 'rib buckler', 'bone ward', 'marrow lantern', 'finger bone fetish'],
      armor: ['bone weave', 'rib cage mail', 'skull plate', 'vertebrae vest', 'ossified mantle'],
      accessory: ['finger bone ring', 'vertebrae necklace', 'skull charm', 'marrow pendant', 'death shroud amulet'],
    },
  },
};
```

- [ ] **Step 5: Create volcanic palette**

Create `itemgen/src/palettes/volcanic.ts`:

```ts
import type { BiomePalette } from '../types.js';

export const VOLCANIC_PALETTE: BiomePalette = {
  biomeId: 'volcanic',
  materials: [
    { id: 'slag', name: 'Slag', statBias: { damage: 1.1, initiative: 0.9 }, slots: ['weapon', 'armor'], tier: 1 },
    { id: 'ember', name: 'Ember', statBias: { damage: 1.0, initiative: 1.1 }, slots: ['weapon', 'accessory', 'offhand'], tier: 1 },
    { id: 'obsidian', name: 'Obsidian', statBias: { damage: 1.3, defense: 0.9 }, slots: ['weapon', 'offhand'], tier: 2 },
    { id: 'magma', name: 'Magma-Forged', statBias: { damage: 1.2, defense: 1.1 }, slots: ['weapon', 'armor'], tier: 2 },
    { id: 'cinder', name: 'Cinder', statBias: { defense: 1.2, maxHp: 1.1 }, slots: ['armor', 'offhand', 'accessory'], tier: 2 },
    { id: 'inferno', name: 'Inferno', statBias: { damage: 1.4, initiative: 1.1 }, slots: ['weapon', 'armor'], tier: 3 },
    { id: 'forge_heart', name: 'Forge-Heart', statBias: { maxHp: 1.3, defense: 1.3 }, slots: ['offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'smouldering', 'molten', 'scorched', 'volcanic', 'ashen',
      'blazing', 'charred', 'searing', 'igneous', 'sulfurous',
      'glowing', 'cinderous', 'blistering', 'fuming', 'radiant',
    ],
    prefixes: [
      'Flame', 'Ash', 'Forge', 'Cinder', 'Ember',
      'Scorch', 'Char', 'Magma', 'Blaze', 'Pyre',
      'Inferno', 'Sear', 'Slag', 'Smelt', 'Coal',
    ],
    suffixes: [
      'flame', 'burn', 'forge', 'scorch', 'blaze',
      'pyre', 'core', 'brand', 'sear', 'melt',
      'spark', 'eruption', 'flare', 'cinder', 'ash',
    ],
    baseTypes: {
      weapon: ['cleaver', 'greatsword', 'war axe', 'slag hammer', 'obsidian blade', 'ember spear'],
      offhand: ['cinder buckler', 'magma ward', 'ember lantern', 'obsidian guard', 'forge shield'],
      armor: ['cinder mail', 'volcanic plate', 'magma-forged vest', 'slag hauberk', 'ember mantle'],
      accessory: ['ember band', 'cinderstone pendant', 'magma ring', 'ash charm', 'forge-heart brooch'],
    },
  },
};
```

- [ ] **Step 6: Update `itemgen/src/index.ts` to register all palettes**

```ts
export type {
  ItemGenerationRequest,
  MaterialDef,
  NameFragments,
  BiomePalette,
  Quality,
} from './types.js';
export { registerPalette, getPalette } from './materials.js';
export { generateItem } from './generate.js';
export { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
export { STARTER_PALETTE } from './palettes/starter.js';
export { CRYSTAL_PALETTE } from './palettes/crystal.js';
export { FLOODED_PALETTE } from './palettes/flooded.js';
export { BONE_PALETTE } from './palettes/bone.js';
export { VOLCANIC_PALETTE } from './palettes/volcanic.js';

// Auto-register built-in palettes
import { registerPalette } from './materials.js';
import { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
import { STARTER_PALETTE } from './palettes/starter.js';
import { CRYSTAL_PALETTE } from './palettes/crystal.js';
import { FLOODED_PALETTE } from './palettes/flooded.js';
import { BONE_PALETTE } from './palettes/bone.js';
import { VOLCANIC_PALETTE } from './palettes/volcanic.js';

registerPalette(DRIPPING_HALLS_PALETTE);
registerPalette(STARTER_PALETTE);
registerPalette(CRYSTAL_PALETTE);
registerPalette(FLOODED_PALETTE);
registerPalette(BONE_PALETTE);
registerPalette(VOLCANIC_PALETTE);
```

- [ ] **Step 7: Run all itemgen tests**

Run: `cd itemgen && npx vitest run`
Expected: All tests pass (existing tests use 'fungal' biome which is still registered).

- [ ] **Step 8: Commit**

```bash
git add itemgen/src/palettes/ itemgen/src/index.ts
git commit -m "feat(itemgen): add starter, crystal, flooded, bone, and volcanic biome palettes"
```

---

### Task 12: End-to-End Verification

Build everything, run all tests, and verify the full loot flow works.

**Files:**
- No new files — verification only

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: All workspaces build without errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass across all workspaces.

- [ ] **Step 3: Manual smoke test**

Start the dev server and client. Join a game, enter combat, defeat a mob, and verify:
- Loot drops have generated names (not the old static names)
- Item stats vary between runs
- Consumable drops still work (potions show up correctly)
- Items can be equipped and affect player stats

Run:
```bash
npm run dev:server  # in one terminal
npm run dev:client  # in another terminal
```

- [ ] **Step 4: Commit any fixes**

If any issues were found during testing, fix them and commit.
