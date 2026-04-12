# Item Generation System — Design Spec

## Overview

A procedural item generation system for Caverns, packaged as `@caverns/itemgen` — a standalone workspace package following the same pattern as `@caverns/roomgrid`. It replaces all hand-authored equipment items with generated items that have procedural names, material-driven stat biases, quality tiers, and bounded random variance.

Consumables remain static and hand-authored.

## Goals

- Every equipment drop feels unique — no two players get the exact same item
- Item names signal rarity at a glance (descriptive → adjective → compound)
- Materials are biome-specific, so each dungeon has a distinct loot flavor
- Stat variance creates exciting "lucky roll" moments without breaking progression
- The system is biome-agnostic — new dungeons add a palette file, not generator changes

## Package Structure

```
itemgen/
  src/
    index.ts              — public exports: generateItem, types
    generate.ts           — generateItem(request): Item
    types.ts              — ItemGenerationRequest, MaterialDef, NameFragments, etc.
    materials.ts          — material registry + biome palette lookup
    naming.ts             — tiered name generation
    stats.ts              — stat rolling with skull-rating guardrails
    quality.ts            — quality tier rolling
    palettes/
      dripping-halls.ts   — material palette for the fungal biome
  __tests__/
    generate.test.ts
    naming.test.ts
    stats.test.ts
  package.json            — @caverns/itemgen, depends on @caverns/shared
  tsconfig.json
```

## Public API

```ts
function generateItem(request: ItemGenerationRequest): Item

interface ItemGenerationRequest {
  slot: EquipmentSlot;        // weapon, offhand, armor, accessory
  skullRating: 1 | 2 | 3;    // difficulty tier → stat baseline
  biomeId: string;            // selects material palette
  rarity?: Rarity;            // force rarity, or roll if omitted
  seed?: number;              // deterministic generation for testing
}
```

Returns the existing `Item` type from `@caverns/shared`. No new types on the consumer side.

### Default Rarity Weights

When `rarity` is not specified in the request, it is rolled:

| Rarity | Weight |
|--------|--------|
| Common | 40% |
| Uncommon | 35% |
| Rare | 20% |
| Legendary | 5% |

## Materials & Biome Palettes

### MaterialDef

```ts
interface MaterialDef {
  id: string;
  name: string;                    // "chitin", "bone", "mycelium"
  statBias: Partial<ItemStats>;    // multipliers, e.g. { damage: 1.2, initiative: 0.8 }
  slots: EquipmentSlot[];          // which item types this material applies to
  tier: 1 | 2 | 3;                // controls which skull ratings can roll this material
}
```

### BiomePalette

```ts
interface BiomePalette {
  biomeId: string;
  materials: MaterialDef[];
  nameFragments: NameFragments;
}
```

### Dripping Halls Materials

| Material | Stat Bias | Tier | Slots |
|----------|-----------|------|-------|
| Bone | +damage, -defense | 1 | weapon, offhand, accessory |
| Chitin | +defense, -initiative | 1 | armor, offhand |
| Mycelium | +maxHp, balanced | 2 | weapon, armor, accessory |
| Crystal | +damage, +initiative | 2 | weapon, offhand, accessory |
| Sporecap | +defense, +maxHp, -initiative | 2 | armor, offhand |
| Deepstone | +defense, +damage | 3 | weapon, armor |
| Biolume | +initiative, +maxHp | 3 | offhand, accessory |

### Material Tier Gating

Material tier is soft-gated by skull rating. Roll weights:

| Skull Rating | Tier 1 | Tier 2 | Tier 3 |
|-------------|--------|--------|--------|
| Skull 1 | 100% | 0% | 0% |
| Skull 2 | 35% | 60% | 5% |
| Skull 3 | 12% | 60% | 28% |

## Stat Generation Pipeline

Stats are generated in four stages:

### Stage 1 — Base Stats from Skull Rating

| Slot | Skull 1 | Skull 2 | Skull 3 |
|------|---------|---------|---------|
| Weapon | damage: 2-4 | damage: 5-8 | damage: 10-14 |
| Offhand | defense: 1-2 | defense: 3-4 | defense: 5-7 |
| Armor | defense: 1-3 | defense: 3-5 | defense: 5-8 |
| Accessory | primary: 3-5 | primary: 6-10 | primary: 10-15 |

Accessories roll a random primary stat (maxHp, damage, defense, or initiative).

### Stage 2 — Material Bias

Material `statBias` multipliers are applied. E.g. a bone weapon with `damage: 1.2` turns base 3 into 3.6, rounded.

### Stage 3 — Quality Modifier

| Quality | Multiplier | Roll Weight |
|---------|-----------|-------------|
| Crude | 0.8 | 20% |
| Standard | 1.0 | 45% |
| Fine | 1.15 | 25% |
| Superior | 1.3 | 8% |
| Masterwork | 1.5 | 2% |

Applied as a flat multiplier to all stats.

### Stage 4 — Variance

A final +/-15% random jitter on each individual stat, so two identical-recipe items differ slightly.

### Guardrails

After all rolls, stats are clamped to skull-rating floors and ceilings. A skull-1 weapon can never exceed skull-2's floor, and a skull-3 weapon can never roll below skull-2's ceiling. This preserves progression while allowing exciting variance within each tier.

## Name Generation

Names are tiered by rarity:

### Common/Uncommon — Descriptive

Format: `[Quality] [Material] [BaseType]`

Examples: "Crude Bone Dagger", "Chitin Buckler", "Fine Mycelium Staff"

Quality word is omitted for "Standard" tier.

### Rare — Adjective Added

Format: `[Adjective] [Material] [BaseType]`

Examples: "Gleaming Crystal Blade", "Festering Sporecap Plate"

Quality tier influences which adjective pool is drawn from but doesn't appear literally in the name.

### Legendary — Compound Name

Format: `[CompoundName]`

Examples: "Sporebane", "Gloomfang", "Boneshatter"

The descriptive name is stored in the item's `description` field so players can still see what the item actually is (e.g. "Sporebane — a masterwork deepstone greatsword").

### Name Fragments (Biome-Provided)

```ts
interface NameFragments {
  adjectives: string[];                          // "gleaming", "festering", "whispering"
  prefixes: string[];                            // "Spore", "Gloom", "Bone", "Dread"
  suffixes: string[];                            // "bane", "fang", "shatter", "maw"
  baseTypes: Record<EquipmentSlot, string[]>;    // weapon: ["dagger", "blade", "mace", "staff"]
}
```

No duplicate name tracking. The fragment pools are large enough that collisions are rare, and duplicates are harmless.

## Server Integration

### Loot Table Changes

Mob templates and room loot stop referencing fixed item IDs for equipment. They describe what to generate:

```ts
interface LootDrop {
  slot: EquipmentSlot;
  skullRating: 1 | 2 | 3;
  rarityWeights?: Partial<Record<Rarity, number>>;  // optional bias
}
```

Example mob template:
```ts
{
  id: 'fungal_crawler',
  name: 'Fungal Crawler',
  // ...
  lootTable: [
    { slot: 'weapon', skullRating: 1 },
    { slot: 'armor', skullRating: 1 },
  ]
}
```

Consumables keep fixed-ID references. Loot tables can mix both:
```ts
lootTable: [
  { slot: 'weapon', skullRating: 1 },    // generated
  { consumableId: 'hp_potion' },           // static lookup
]
```

### Generation Timing

Items are generated at loot-drop time, not at dungeon creation. The same mob can drop different items each run.

### DungeonContent Changes

- Add `biomeId: string` to `DungeonContent` (the server passes this to `generateItem()`)
- The `items[]` array on `DungeonContent` is reduced to consumable definitions only
- All equipment item definitions are removed from `content.ts`

### Class Starter Items

Class starter items (in `CLASS_STARTER_ITEMS`) remain hand-authored. These are fixed identity items that define class fantasy, not loot drops.

## What's NOT in Scope

- Consumable generation (consumables stay static)
- Artifact lore/engravings/maker attribution (future C-tier extension)
- Persistence or item databases
- Client-side UI changes beyond displaying the generated item fields that already exist on the Item type
