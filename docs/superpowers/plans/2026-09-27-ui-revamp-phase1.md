# UI Revamp Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the relic-tech UI kit (bezel panels with a subtle green edge glow, bronze buttons, segmented gauges, icon sockets, archetype item icons) and apply it to every in-dungeon screen.

**Architecture:**
- **Shared:** a new `shared/src/itemArchetypes.ts` resolves any `Item` to one of 23 icon archetypes. The order is explicit field, then whole-word name keywords (filtered by slot), then slot default. Hand-authored items and `itemgen` stamp the explicit field; items saved on characters earlier fall back to keywords.
- **Client:**
  - a CSS-first kit in `client/src/components/relic/` and `client/src/styles/relic.css`, wrapped around PixelLab art (`client/public/ui/`);
  - pure helpers in `client/src/ui/` that are unit-tested;
  - in-dungeon components migrated onto the kit.

**Tech Stack:**
- TypeScript, React 18, Zustand, Vite, Vitest.
- PixelLab MCP (`create_image_pro`) for the art.
- Playwright (`scripts/sandbox-drive.mjs`) for screenshots.

**Spec:** `docs/superpowers/specs/2026-09-27-ui-revamp-phase1-design.md`

**Spec amendment made by this plan:** a 23rd archetype, `ranged` (weapon; `crossbow`, `bow`), because the Artificer's starter weapon is a Repeating Crossbow and no spec archetype fits it. Task 1 adds it and Task 4 generates its icon; update the spec's table in Task 1's commit.

## Global Constraints

**Environment**
- Node runs on Windows, not WSL. Run npm and npx through `cmd.exe /c "..."` from the repo root, for example `cmd.exe /c "npm run test --workspace=shared"`.
- Git: use `git.exe` and stage **explicit paths only** (never `git add -A` or `.`). Commit locally and **never push**. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `client` and `itemgen` import `@caverns/shared` from `shared/dist`. After any change under `shared/src`, run `cmd.exe /c "npm run build --workspace=shared"` before building or testing dependants.

**Preserved behaviour**
- The CRT layer is untouched: `.crt-overlay` scanlines at `rgba(0,0,0,0.15)`, flicker and vignette stay exactly as they are. Do not edit those rules.
- Keep the class names `arena-btn-end`, `arena-btn-attack` and `arena-viewport`. `scripts/sandbox-drive.mjs` clicks and measures them.
- Keep the class name `room-grid` / `room-row` cell structure from `TileGridView`; the driver's `cell()` locator depends on it.

**Art rules**
- The bezel is `client/public/ui/relic_frame.png`: 256×160, a 24px border slice drawn at 1×, `image-rendering: pixelated`.
- The green glow is `--screen-glow: rgba(70, 190, 110, 0.18)` with `--screen-glow-rim: rgba(40, 140, 80, 0.08)`. This is the approved "A1 Subtle" strength; do not strengthen it.
- Rarity colours: common `#c8b89a`, uncommon `#8888ff`, rare `#ffee77`, legendary `#af6025`, unique `#ff44ff`.
- Icon sizes: item icons 32×32 at `client/public/ui/icons/items/<archetype>.png`; action icons 24×24 at `client/public/ui/icons/actions/<action>.png`.

**Item generator**
- `itemgen`'s sequence of `rng()` calls must not change. Seeded output is identical apart from the new `archetype` field.

**Layout**
- Bezels never nest. Inside a `RelicPanel`, use sockets, rails or dashed dividers.
- At a 1600×1000 viewport on sandbox preset `duel`, `.arena-viewport` must show the same number of columns and rows before and after (Task 5 records the baseline, Task 11 checks it).

## Review Focus

1. **Keyword false positives:** names like `Staring Eye Charm`, or one-word legendaries like `Shieldward` and `Quartzlance`, must not match `ring`, `shield` or `lance`. Matching is whole-word only. Test: Task 1.
2. **Cross-slot keyword collisions:** a consumable named `Depth Charge` must not become a weapon, and an offhand `Parrying Dagger` must resolve to `dagger`. Candidates are filtered by slot. Test: Task 1.
3. **Degenerate gauge input:** `maxHp` of 0, HP above max after a buff expires, negative values, or NaN must give a 0–100 width, never NaN or overflow. Test: Task 5.
4. **Solo play:** with no other players, `PartyPanel` must render nothing, not an empty bezel. Check: Task 7.
5. **Long item names:** names like `Masterwork Forge-Heart Brigandine`, with stats, must truncate with an ellipsis inside the 384px side column, not push the Drop button out of view. Check: Task 7 visual step with a long-name fixture.

---

### Task 1: Item archetypes in shared

**Files:**
- Create: `shared/src/itemArchetypes.ts`
- Create: `shared/src/itemArchetypes.test.ts`
- Modify: `shared/src/types.ts:24-34` (the `Item` interface)
- Modify: `shared/src/index.ts` (export)
- Modify: `docs/superpowers/specs/2026-09-27-ui-revamp-phase1-design.md` (add the `ranged` row)

**Interfaces:**
- Produces:
  - `ITEM_ARCHETYPES: readonly ItemArchetype[]`
  - `type ItemArchetype`
  - `isItemArchetype(v: unknown): v is ItemArchetype`
  - `ARCHETYPE_SLOTS: Record<ItemArchetype, readonly ItemSlot[]>`
  - `matchArchetype(slot: ItemSlot, text: string): ItemArchetype | null`
  - `archetypeFor(item: Pick<Item, 'slot' | 'name'> & { archetype?: string }): ItemArchetype`
  - `SLOT_DEFAULT_ARCHETYPE: Record<ItemSlot, ItemArchetype>`
  - `Item.archetype?: ItemArchetype`

- [ ] **Step 1: Write the failing test** — create `shared/src/itemArchetypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ITEM_ARCHETYPES, ARCHETYPE_SLOTS, isItemArchetype, matchArchetype, archetypeFor, SLOT_DEFAULT_ARCHETYPE,
} from './itemArchetypes.js';

describe('ITEM_ARCHETYPES', () => {
  it('has 23 unique archetypes, each valid for at least one slot', () => {
    expect(ITEM_ARCHETYPES).toHaveLength(23);
    expect(new Set(ITEM_ARCHETYPES).size).toBe(23);
    for (const a of ITEM_ARCHETYPES) expect(ARCHETYPE_SLOTS[a].length).toBeGreaterThan(0);
  });

  it('slot defaults are valid for their slot', () => {
    for (const [slot, a] of Object.entries(SLOT_DEFAULT_ARCHETYPE)) {
      expect(ARCHETYPE_SLOTS[a]).toContain(slot);
    }
  });
});

describe('matchArchetype', () => {
  it.each([
    ['weapon', 'Rusty Shortsword', 'blade'],
    ['weapon', 'Crude Iron Sword', 'blade'],
    ['weapon', 'Fine Bone Femur Flail', 'blunt'],
    ['weapon', 'Ember War Axe', 'axe'],
    ['weapon', 'Brine Harpoon', 'polearm'],
    ['weapon', 'Repeating Crossbow', 'ranged'],
    ['offhand', 'Steel Parrying Dagger', 'dagger'],
    ['offhand', 'Pearl Orb', 'focus'],
    ['offhand', 'Marrow Tome', 'tome'],
    ['armor', 'Leviathan Scale', 'armor_medium'],
    ['armor', 'Forge-Heart Cuirass', 'armor_heavy'],
    ['armor', 'Brine Weave', 'armor_light'],
    ['accessory', 'Tide Band', 'ring'],
    ['accessory', 'Pearl Earring', 'ring'],
    ['accessory', 'Vertebrae Necklace', 'amulet'],
    ['accessory', 'Rib Brooch', 'charm'],
    ['accessory', 'Inferno Circlet', 'circlet'],
    ['consumable', 'Greater Health Potion', 'potion_greater'],
    ['consumable', 'Minor Health Potion', 'potion'],
    ['consumable', 'Cave Moss Poultice', 'bandage'],
    ['consumable', 'Spirit Draught', 'elixir'],
    ['consumable', 'Depth Charge', 'bomb'],
  ] as const)('%s "%s" -> %s', (slot, name, expected) => {
    expect(matchArchetype(slot, name)).toBe(expected);
  });

  it('matches whole words only', () => {
    expect(matchArchetype('accessory', 'Staring Eye')).toBeNull();
    expect(matchArchetype('offhand', 'Shieldward')).toBeNull();
    expect(matchArchetype('weapon', 'Quartzlance')).toBeNull();
  });

  it('only considers archetypes valid for the slot', () => {
    // "charge" is a bomb keyword, but bombs are consumables
    expect(matchArchetype('weapon', 'Charge')).toBeNull();
    // "shield" is an offhand keyword
    expect(matchArchetype('armor', 'Shield Plate')).toBe('armor_heavy');
  });

  it('prefers the match that ends latest (the base type ends the name)', () => {
    // both "mantle" and "plate" are armor keywords; the later one is the base type
    expect(matchArchetype('armor', 'Mantle Plate')).toBe('armor_heavy');
    expect(matchArchetype('armor', 'Plate Mantle')).toBe('armor_light');
  });

  it('is case-insensitive and tolerates hyphens and apostrophes', () => {
    expect(matchArchetype('weapon', "EXECUTIONER'S AXE")).toBe('axe');
    expect(matchArchetype('armor', 'Forge-Heart Brigandine')).toBe('armor_medium');
  });
});

describe('archetypeFor', () => {
  it('uses a valid explicit archetype first', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Worldsplitter', archetype: 'blade' })).toBe('blade');
  });

  it('ignores an unknown explicit archetype and falls through', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Iron Mace', archetype: 'laser' })).toBe('blunt');
  });

  it('falls back to the slot default for keyword-less names', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Grimfang' })).toBe('blade');
    expect(archetypeFor({ slot: 'offhand', name: 'Aegis of the Fallen' })).toBe('shield');
    expect(archetypeFor({ slot: 'armor', name: 'Rotbloom' })).toBe('armor_light');
    expect(archetypeFor({ slot: 'accessory', name: 'Oathkeeper' })).toBe('amulet');
    expect(archetypeFor({ slot: 'consumable', name: 'Crushed Crystal Dust' })).toBe('consumable_misc');
  });

  it('isItemArchetype narrows strings', () => {
    expect(isItemArchetype('tome')).toBe(true);
    expect(isItemArchetype('laser')).toBe(false);
    expect(isItemArchetype(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cmd.exe /c "npm run test --workspace=shared -- itemArchetypes"`
Expected: FAIL, "Failed to resolve import ./itemArchetypes.js".

- [ ] **Step 3: Write the implementation** — create `shared/src/itemArchetypes.ts`:

```ts
import type { ItemSlot } from './types.js';

// Icon archetypes: every item resolves to one, and each has a 32x32 icon at
// client/public/ui/icons/items/<archetype>.png.
export const ITEM_ARCHETYPES = [
  'blade', 'dagger', 'blunt', 'axe', 'polearm', 'staff', 'ranged',
  'shield', 'focus', 'tome',
  'armor_light', 'armor_medium', 'armor_heavy',
  'ring', 'amulet', 'charm', 'circlet',
  'potion', 'potion_greater', 'bandage', 'elixir', 'bomb', 'consumable_misc',
] as const;

export type ItemArchetype = (typeof ITEM_ARCHETYPES)[number];

const ARCHETYPE_SET = new Set<string>(ITEM_ARCHETYPES);

export function isItemArchetype(v: unknown): v is ItemArchetype {
  return typeof v === 'string' && ARCHETYPE_SET.has(v);
}

export const ARCHETYPE_SLOTS: Record<ItemArchetype, readonly ItemSlot[]> = {
  blade: ['weapon'], dagger: ['weapon', 'offhand'], blunt: ['weapon'], axe: ['weapon'],
  polearm: ['weapon'], staff: ['weapon'], ranged: ['weapon'],
  shield: ['offhand'], focus: ['offhand'], tome: ['offhand'],
  armor_light: ['armor'], armor_medium: ['armor'], armor_heavy: ['armor'],
  ring: ['accessory'], amulet: ['accessory'], charm: ['accessory'], circlet: ['accessory'],
  potion: ['consumable'], potion_greater: ['consumable'], bandage: ['consumable'],
  elixir: ['consumable'], bomb: ['consumable'], consumable_misc: ['consumable'],
};

export const SLOT_DEFAULT_ARCHETYPE: Record<ItemSlot, ItemArchetype> = {
  weapon: 'blade', offhand: 'shield', armor: 'armor_light', accessory: 'amulet', consumable: 'consumable_misc',
};

// Whole-word keywords (lowercase; multi-word allowed). Covers every base type in itemgen's palettes.
const KEYWORDS: Record<ItemArchetype, readonly string[]> = {
  blade: ['sword', 'blade', 'cutlass', 'katana', 'shortsword'],
  dagger: ['dagger', 'daggers', 'stiletto', 'claws', 'gauntlets'],
  blunt: ['mace', 'maul', 'club', 'hammer', 'flail'],
  axe: ['axe', 'cleaver'],
  polearm: ['spear', 'lance', 'harpoon', 'trident'],
  staff: ['staff'],
  ranged: ['crossbow', 'bow'],
  shield: ['shield', 'buckler', 'ward', 'bulwark', 'guard'],
  focus: ['orb', 'focus', 'lantern', 'symbol', 'horn', 'gauntlet', 'toolkit', 'cloak'],
  tome: ['tome'],
  armor_light: ['wrap', 'vest', 'tunic', 'gambeson', 'weave', 'mantle', 'greaves', 'harness'],
  armor_medium: ['mail', 'hauberk', 'brigandine', 'scale'],
  armor_heavy: ['plate', 'cuirass', 'helm'],
  ring: ['ring', 'band', 'earring'],
  amulet: ['amulet', 'pendant', 'necklace', 'talisman'],
  charm: ['charm', 'brooch', 'plume'],
  circlet: ['circlet', 'bracelet', 'crown'],
  potion: ['potion'],
  potion_greater: ['greater health potion', 'greater potion'],
  bandage: ['bandage', 'salve', 'poultice', 'paste'],
  elixir: ['elixir', 'draught', 'tonic', 'flask'],
  bomb: ['bomb', 'charge', 'grenade', 'pod'],
  consumable_misc: [],
};

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** Keyword match restricted to archetypes valid for `slot`. The match ending latest wins; ties go to the longer keyword. */
export function matchArchetype(slot: ItemSlot, text: string): ItemArchetype | null {
  const w = words(text);
  let best: { archetype: ItemArchetype; end: number; len: number } | null = null;
  for (const archetype of ITEM_ARCHETYPES) {
    if (!ARCHETYPE_SLOTS[archetype].includes(slot)) continue;
    for (const kw of KEYWORDS[archetype]) {
      const k = kw.split(' ');
      for (let i = 0; i + k.length <= w.length; i++) {
        if (!k.every((part, j) => w[i + j] === part)) continue;
        const end = i + k.length;
        if (!best || end > best.end || (end === best.end && k.length > best.len)) {
          best = { archetype, end, len: k.length };
        }
      }
    }
  }
  return best?.archetype ?? null;
}

export function archetypeFor(item: { slot: ItemSlot; name: string; archetype?: string }): ItemArchetype {
  if (isItemArchetype(item.archetype) && ARCHETYPE_SLOTS[item.archetype].includes(item.slot)) return item.archetype;
  return matchArchetype(item.slot, item.name) ?? SLOT_DEFAULT_ARCHETYPE[item.slot];
}
```

- [ ] **Step 4: Add the field and the export.**

In `shared/src/types.ts`, add a type import at the top (next to the existing imports):

```ts
import type { ItemArchetype } from './itemArchetypes.js';
```

In `interface Item`, after `skullRating?: 1 | 2 | 3;`, add:

```ts
  /** Icon archetype. Optional: items saved before it existed resolve via archetypeFor(). */
  archetype?: ItemArchetype;
```

In `shared/src/index.ts`, after `export * from './types.js';`, add:

```ts
export * from './itemArchetypes.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cmd.exe /c "npm run test --workspace=shared"`
Expected: all pass, including `itemArchetypes.test.ts`.

The `'Mantle Plate'` and `'Shield Plate'` cases prove the latest-ending rule and the slot filter. If a case fails, fix `KEYWORDS`, not the test.

- [ ] **Step 6: Build shared and typecheck**

Run: `cmd.exe /c "npm run build --workspace=shared"`
Expected: exit 0.

- [ ] **Step 7: Amend the spec and commit**

In the spec's archetype table, add a row after `staff`: `| weapon | \`ranged\` | crossbow, bow (Artificer's Repeating Crossbow) |`. Also change "22 archetypes" to "23" wherever it appears.

```bash
git.exe add shared/src/itemArchetypes.ts shared/src/itemArchetypes.test.ts shared/src/types.ts shared/src/index.ts docs/superpowers/specs/2026-09-27-ui-revamp-phase1-design.md
git.exe commit -m "Add item icon archetypes with keyword fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Archetypes on hand-authored items

**Files:**
- Modify: `shared/src/content.ts` (`STARTER_WEAPON`, `STARTER_POTION`, `CLASS_STARTER_ITEMS`, `DRIPPING_HALLS.items`)
- Modify: `shared/src/data/items.json` (22 consumables)
- Modify: `shared/src/data/uniqueItems.json` (26 uniques)
- Create: `shared/src/itemArchetypes.content.test.ts`

**Interfaces:**
- Consumes: `isItemArchetype`, `ARCHETYPE_SLOTS` from Task 1.
- Produces: every hand-authored `Item` carries a valid `archetype`. The server reads these JSON files as-is (`server/src/index.ts:47`, `GameSession.ts:61`, `ProceduralGenerator.ts:31`), so no server change is needed.

- [ ] **Step 1: Write the failing test** — create `shared/src/itemArchetypes.content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import items from './data/items.json' with { type: 'json' };
import uniqueItems from './data/uniqueItems.json' with { type: 'json' };
import { STARTER_WEAPON, STARTER_POTION, CLASS_STARTER_ITEMS, DRIPPING_HALLS } from './content.js';
import { isItemArchetype, ARCHETYPE_SLOTS } from './itemArchetypes.js';
import type { ItemSlot } from './types.js';

type Authored = { id: string; slot: string; archetype?: unknown };

const all: Authored[] = [
  ...(items as Authored[]),
  ...(uniqueItems as Authored[]),
  STARTER_WEAPON as Authored,
  STARTER_POTION as Authored,
  ...Object.values(CLASS_STARTER_ITEMS).flatMap((c) => [c.weapon, c.offhand] as Authored[]),
  ...(DRIPPING_HALLS.items as Authored[]),
];

describe('hand-authored item archetypes', () => {
  it.each(all.map((i) => [i.id, i] as const))('%s has a valid archetype for its slot', (_id, item) => {
    expect(isItemArchetype(item.archetype)).toBe(true);
    if (isItemArchetype(item.archetype)) {
      expect(ARCHETYPE_SLOTS[item.archetype]).toContain(item.slot as ItemSlot);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cmd.exe /c "npm run test --workspace=shared -- itemArchetypes.content"`
Expected: FAIL for every item ("expected false to be true").

- [ ] **Step 3: Stamp the JSON files** by running this one-off script from the repo root in WSL. It rewrites the files with 2-space indentation, one object per entry:

```bash
python3 - <<'EOF'
import json
MAP = {
  # items.json (consumables)
  'minor_hp_potion':'potion','leather_scraps':'bandage','hp_potion':'potion','hp_potion_large':'potion_greater',
  'elixir':'elixir','throwing_spore':'bomb','crystal_dust':'consumable_misc','prism_flask':'elixir',
  'crystal_grenade':'bomb','brine_tonic':'elixir','sea_foam_salve':'bandage','depth_charge':'bomb',
  'marrow_paste':'bandage','spirit_draught':'elixir','bone_shard_bomb':'bomb','magma_salve':'bandage',
  'volcanic_tonic':'elixir','fire_bomb':'bomb','superior_elixir':'elixir','crude_bandage':'bandage',
  'cave_moss_poultice':'bandage','rot_gut_flask':'elixir',
  # uniqueItems.json
  'worldsplitter':'blade','lifedrinker':'blade','aegis_of_the_fallen':'shield','mantle_of_thorns':'armor_light',
  'phoenix_plume':'charm','crown_of_command':'circlet','mirror_guard':'shield','berserker_harness':'armor_medium',
  'venom_fang':'dagger','windrunner_greaves':'armor_light','executioners_axe':'axe','ironwall_bulwark':'shield',
  'glass_cannon_ring':'ring','guardian_plate':'armor_heavy','deathward_amulet':'amulet','momentum_blade':'blade',
  'overcharge_gauntlet':'focus','first_strike_dagger':'dagger','siphon_armor_ring':'ring','rally_horn':'focus',
  'undying_fury_helm':'armor_heavy','predator_claws':'dagger','brutal_impact_hammer':'blunt',
  'overwhelm_gauntlets':'dagger','blade_storm_katana':'blade','rampage_cleaver':'axe',
}
for path in ['shared/src/data/items.json', 'shared/src/data/uniqueItems.json']:
    data = json.load(open(path, encoding='utf-8'))
    for it in data:
        it['archetype'] = MAP[it['id']]  # KeyError = an item missing from MAP: add it, don't skip it
    open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
print('ok')
EOF
```

Expected output: `ok`. Then check with `git.exe diff --stat shared/src/data`: only these two files changed, and each entry gained one `"archetype"` line. The script re-serialises the files, so compact one-line `stats` objects become multi-line; that formatting churn is acceptable.

- [ ] **Step 4: Stamp `content.ts`.**

Add `archetype` to each literal:
- `STARTER_WEAPON`: add `archetype: 'blade' as const,` after `slot`.
- `STARTER_POTION`: add `archetype: 'potion' as const,` after `slot`.
- `CLASS_STARTER_ITEMS`, in each item object after `slot: '...'`:

| Item | Archetype |
|---|---|
| `vanguard_iron_mace` | `archetype: 'blunt'` |
| `vanguard_tower_shield` | `archetype: 'shield'` |
| `shadowblade_twin_daggers` | `archetype: 'dagger'` |
| `shadowblade_smoke_cloak` | `archetype: 'focus'` |
| `cleric_blessed_staff` | `archetype: 'staff'` |
| `cleric_holy_symbol` | `archetype: 'focus'` |
| `artificer_repeating_crossbow` | `archetype: 'ranged'` |
| `artificer_toolkit` | `archetype: 'focus'` |

- `DRIPPING_HALLS.items` (the five consumables at `content.ts:218-222`), after `slot: 'consumable'`:

| Item | Archetype |
|---|---|
| `leather_scraps` | `archetype: 'bandage'` |
| `hp_potion` | `archetype: 'potion'` |
| `hp_potion_large` | `archetype: 'potion_greater'` |
| `elixir` | `archetype: 'elixir'` |
| `throwing_spore` | `archetype: 'bomb'` |

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cmd.exe /c "npm run test --workspace=shared"`
Expected: all pass (48 JSON items plus 17 content items).

- [ ] **Step 6: Build, then run the server tests.** The server loads the JSON files, so this proves nothing downstream chokes on the new field.

Run: `cmd.exe /c "npm run build --workspace=shared && npm run test --workspace=server"`
Expected: exit 0, all server tests pass.

- [ ] **Step 7: Commit**

```bash
git.exe add shared/src/content.ts shared/src/data/items.json shared/src/data/uniqueItems.json shared/src/itemArchetypes.content.test.ts
git.exe commit -m "Stamp icon archetypes on all hand-authored items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: itemgen stamps archetypes (rng order preserved)

**Files:**
- Modify: `itemgen/src/naming.ts` (return the chosen base type)
- Modify: `itemgen/src/generate.ts:64-83`
- Create: `itemgen/src/archetype.test.ts`

**Interfaces:**
- Consumes: `matchArchetype`, `ARCHETYPE_SLOTS` from `@caverns/shared` (Task 1; shared must be built).
- Produces:
  - `generateName(...)` now returns `{ name: string; baseType: string }`.
  - `generateItem()` output has `archetype`.

- [ ] **Step 1: Write the golden and palette-coverage tests.** Create `itemgen/src/archetype.test.ts`. The "generated items carry an archetype" test is added in Step 3, so the commit in Step 2 is green:

```ts
import { describe, it, expect } from 'vitest';
import { matchArchetype, ARCHETYPE_SLOTS } from '@caverns/shared';
import type { EquipmentSlot } from '@caverns/shared';
import { generateItem } from './generate.js';
import { getPalette } from './materials.js';
import './index.js'; // registers palettes

const SLOTS: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory'];
const BIOMES = ['fungal', 'starter', 'crystal', 'flooded', 'bone', 'volcanic'];

function sample() {
  const out = [];
  for (const biomeId of BIOMES) for (const slot of SLOTS) for (const seed of [1, 7, 42, 99, 1234])
    for (const rarity of ['common', 'rare', 'legendary'] as const)
      out.push(generateItem({ slot, skullRating: 2, biomeId, seed, rarity }));
  return out;
}

describe('itemgen determinism', () => {
  it('seeded output is unchanged apart from archetype', () => {
    const items = sample().map(({ archetype: _a, ...rest }) => rest);
    expect(items).toMatchSnapshot();
  });
});

describe('itemgen archetypes', () => {
  it('every palette base type maps to an archetype valid for its slot', () => {
    for (const biomeId of BIOMES) {
      const palette = getPalette(biomeId);
      for (const slot of SLOTS) {
        for (const baseType of palette.nameFragments.baseTypes[slot]) {
          const a = matchArchetype(slot, baseType);
          expect(a, `${biomeId}/${slot}/${baseType}`).not.toBeNull();
          expect(ARCHETYPE_SLOTS[a!]).toContain(slot);
        }
      }
    }
  });

});
```

First confirm that `fungal` is the id the dripping-halls palette registers under (`grep -n biomeId itemgen/src/palettes/*.ts`). If it isn't, replace `'fungal'` in `BIOMES` with the actual ids. The existing `generate.test.ts` uses `'fungal'`.

- [ ] **Step 2: Record the golden snapshot against the current code.** This must happen before any code change.

Run: `cmd.exe /c "npm run test --workspace=itemgen -- archetype"`
Expected:
- Both tests PASS, and the determinism test writes `itemgen/src/__snapshots__/archetype.test.ts.snap`.
- If the palette test reports a base type that returned null, add its keyword to `KEYWORDS` in shared, rebuild shared and rerun.

Commit the snapshot now, so later steps are checked against it:

```bash
git.exe add itemgen/src/archetype.test.ts itemgen/src/__snapshots__/archetype.test.ts.snap
git.exe commit -m "Pin itemgen seeded output before archetype stamping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Add the failing archetype test.** Append inside the `describe('itemgen archetypes', ...)` block:

```ts
  it('generated items carry an archetype valid for their slot', () => {
    for (const item of sample()) {
      expect(item.archetype, item.name).toBeDefined();
      expect(ARCHETYPE_SLOTS[item.archetype!]).toContain(item.slot);
    }
  });
```

Run: `cmd.exe /c "npm run test --workspace=itemgen -- archetype"`
Expected: FAIL, "expected undefined to be defined".

- [ ] **Step 3b: Return the base type from `generateName`.** In `itemgen/src/naming.ts`, change the signature and the three returns. Leave the `pick` calls and their order untouched:

```ts
export function generateName(
  slot: EquipmentSlot,
  rarity: Rarity,
  quality: Quality,
  materialName: string,
  fragments: NameFragments,
  rng: () => number,
): { name: string; baseType: string } {
  const rawBaseType = pick(fragments.baseTypes[slot], rng);
  const baseType = capitalize(rawBaseType);

  if (rarity === 'legendary') {
    const prefix = pick(fragments.prefixes, rng);
    const suffix = pick(fragments.suffixes, rng);
    return { name: `${prefix}${suffix}`, baseType: rawBaseType };
  }

  if (rarity === 'rare') {
    const adjective = capitalize(pick(fragments.adjectives, rng));
    return { name: `${adjective} ${materialName} ${baseType}`, baseType: rawBaseType };
  }

  // Common / Uncommon
  const qualityWord = QUALITY_WORDS[quality];
  if (qualityWord) {
    return { name: `${qualityWord} ${materialName} ${baseType}`, baseType: rawBaseType };
  }
  return { name: `${materialName} ${baseType}`, baseType: rawBaseType };
}
```

- [ ] **Step 4: Stamp the archetype in `generate.ts`.**

Add `matchArchetype, SLOT_DEFAULT_ARCHETYPE` to the `@caverns/shared` import (change `import type { Item, Rarity }` into a type import plus a value import):

```ts
import type { Item, Rarity } from '@caverns/shared';
import { matchArchetype, SLOT_DEFAULT_ARCHETYPE } from '@caverns/shared';
```

Replace the block from `// Generate name` to the `return` with:

```ts
  // Generate name
  const { name, baseType: nameBaseType } = generateName(slot, rarity, quality, material.name, palette.nameFragments, rng);

  // Build description. Legendary names carry no base type, so their icon follows the description's base type.
  let description: string;
  let iconBaseType = nameBaseType;
  if (rarity === 'legendary') {
    const qualityWord = quality === 'standard' ? 'a' : `a ${quality}`;
    const baseTypes = palette.nameFragments.baseTypes[slot];
    const baseType = baseTypes[Math.floor(rng() * baseTypes.length)];
    iconBaseType = baseType;
    description = `${name} — ${qualityWord} ${material.name.toLowerCase()} ${baseType}.`;
  } else {
    description = `A ${quality === 'standard' ? '' : quality + ' '}${material.name.toLowerCase()} ${slot}.`;
  }

  // Generate unique ID using RNG for determinism
  const idSuffix = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
  const id = `gen_${slot}_${idSuffix}`;
  const archetype = matchArchetype(slot, iconBaseType) ?? SLOT_DEFAULT_ARCHETYPE[slot];

  return { id, name, description, rarity, slot, stats, skullRating, archetype };
```

- [ ] **Step 5: Run all itemgen tests**

Run: `cmd.exe /c "npm run test --workspace=itemgen"`
Expected: all pass. The snapshot must match unchanged. Never run with `-u` in this task: an updated snapshot would mean the rng order changed.

- [ ] **Step 6: Typecheck dependants and commit**

Run: `cmd.exe /c "npm run build --workspace=itemgen && npm run test --workspace=server"`
Expected: exit 0.

```bash
git.exe add itemgen/src/naming.ts itemgen/src/generate.ts itemgen/src/archetype.test.ts
git.exe commit -m "Stamp icon archetype on generated items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Generate icons and install the bezel (PixelLab)

This task is art production done by the agent with PixelLab MCP tools, not code. It needs **one user approval** (Step 5) before anything lands in `client/public`.

**Files:**
- Create: `client/public/ui/relic_frame.png` (copied from `art/mockups/ui-revamp/relic_frame.png`)
- Create: `client/public/ui/icons/items/<archetype>.png` × 23
- Create: `client/public/ui/icons/actions/<action>.png` × 7 (`move`, `attack`, `defend`, `abilities`, `items`, `flee`, `end_turn`)
- Create: `art/ui-icons/chosen.json`; `art/ui-icons/raw/` and the contact sheets (not committed; `art/` candidates stay untracked, as with other art)

**Interfaces:**
- Produces: the icon files at exactly these paths. Tasks 5–10 reference them via `itemIconSrc()` and `actionIconSrc()`.

- [ ] **Step 1: Install the bezel.**

```bash
mkdir -p client/public/ui/icons/items client/public/ui/icons/actions
cp art/mockups/ui-revamp/relic_frame.png client/public/ui/relic_frame.png
python3 -c "from PIL import Image; im=Image.open('client/public/ui/relic_frame.png'); print(im.size, im.getpixel((128,80))[3])"
```

Expected: `(256, 160) 0` (a transparent centre).

- [ ] **Step 2: Queue generations.** Make one `mcp__pixellab__create_image_pro` call per row below, all in parallel.

Settings:
- Items: `width: 32, height: 32`. Actions: `width: 24, height: 24`.
- `style_image_url`: `https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/portraits/<ref>.png`.
- `description`:
  - items: `inventory item icon: <subject>, strange retro-future relic, centered, dark outline`;
  - actions: `game action icon: <subject>, bold simple silhouette, dark outline`.

| id | ref | subject |
|---|---|---|
| blade | phaseknife | jury-rigged scrap sword, rusted metal blade with a faint teal glowing circuit glyph |
| dagger | phaseknife | short salvaged knife with a wrapped grip and a teal glint on the edge |
| blunt | templar | heavy flanged scrap mace, riveted iron head on a pipe handle |
| axe | junk_prophet | crude cleaver-axe made from a sawn machine plate, rust and bronze |
| polearm | templar | salvaged spear with a pipe shaft and a jagged scrap spearhead |
| staff | suturist | tall staff of bound conduit with a dim glowing lens at the top |
| ranged | junk_prophet | compact mechanical crossbow of brass gears and springs |
| shield | templar | riveted scrap-metal shield plate, gunmetal and amber |
| focus | junk_prophet | small humming relic orb in a brass cage, teal light inside |
| tome | suturist | thick book bound in cracked leather and a corroded brass clasp |
| armor_light | suturist | patched cloth and leather vest with stitched pockets |
| armor_medium | templar | ring-mail shirt of salvaged links over leather |
| armor_heavy | templar | patched scrap-plate chest armor with rivets and a gas-mask hose |
| ring | junk_prophet | small brass ring set with a glowing teal chip |
| amulet | junk_prophet | cracked brass eye-lens amulet on a chain with a glowing teal glyph |
| charm | junk_prophet | dangling charm of wire, a small bone and a circuit fragment |
| circlet | templar | thin dark-iron circlet with a single amber lamp |
| potion | suturist | healing tonic in a scavenged glass ampoule with a corroded brass cap, red liquid |
| potion_greater | suturist | large round flask of glowing red healing liquid with a brass stopper |
| bandage | suturist | rolled stained bandage with a safety pin |
| elixir | suturist | slender vial of shimmering bioluminescent green-teal liquid |
| bomb | junk_prophet | round improvised bomb of scrap metal with a lit fuse |
| consumable_misc | junk_prophet | small cloth pouch of glittering powder tied with wire |
| act_move | junk_prophet | a worn boot footprint with a direction arrow, amber |
| act_attack | junk_prophet | a crossed scrap blade and jagged strike mark, amber and rust |
| act_defend | templar | a riveted scrap-metal shield plate, gunmetal and amber |
| act_abilities | phaseknife | a glowing teal circuit-glyph sigil |
| act_items | suturist | a small satchel with a vial poking out |
| act_flee | junk_prophet | a running boot with motion streaks, worn leather and amber |
| act_end_turn | junk_prophet | an hourglass of brass and cracked glass |

Record each returned `job_id` in a scratch list, keyed by id.

- [ ] **Step 3: Download candidates and build contact sheets.**

As each job completes (use `mcp__pixellab__wait_for_jobs`), download all 64 candidates into `art/ui-icons/raw/` with `curl -sf -o art/ui-icons/raw/<id>_<i>.png "https://api.pixellab.ai/mcp/images/<job_id>/download?index=<i>"` for i = 0–63.

Build a sheet per id at 3× (see the `sheet.py` snippet below) and view it. Save the script as `art/ui-icons/sheet.py`:

```python
"""sheet.py <out.png> <scale> <cols> <files...> - nearest-neighbour upscale with index labels."""
import sys
from PIL import Image, ImageDraw
out, scale, cols, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
imgs = [Image.open(f).convert('RGBA') for f in files]
w = max(i.width for i in imgs) * scale + 8; h = max(i.height for i in imgs) * scale + 20
sheet = Image.new('RGBA', (cols * w, ((len(imgs) + cols - 1) // cols) * h), (18, 14, 10, 255))
d = ImageDraw.Draw(sheet)
for n, im in enumerate(imgs):
    x, y = (n % cols) * w, (n // cols) * h
    sheet.alpha_composite(im.resize((im.width * scale, im.height * scale), Image.NEAREST), (x + 4, y + 16))
    d.text((x + 4, y + 2), str(n), fill=(212, 168, 87, 255))
sheet.save(out)
```

- [ ] **Step 4: Pick one candidate per id.** Criteria:
  - reads clearly at 1× on a dark background;
  - the silhouette is distinct from the other archetypes in the same slot;
  - it fits the relic-tech tone (rust, brass, teal glow; not shiny fantasy);
  - it isn't clipped at the canvas edge.

If no candidate works, reroll that id once with an adjusted subject. You may reuse the earlier mockup picks where they fit: `art/mockups/ui-revamp/raw/blade_2.png` (blade), `tonic_1.png` (potion), `armor_10.png` (armor_heavy), `amulet_9.png` (amulet), `attack_7.png` (act_attack), `defend_12.png` (act_defend), `flee_14.png` (act_flee).

Write `art/ui-icons/chosen.json` as `{ "<id>": { "job_id": "...", "index": N, "ref": "...", "subject": "..." }, ... }`. Mockup reuses use `"job_id": "mockup:<file>"`.

Then build `art/ui-icons/_final.png`, a 4× sheet of the 30 chosen icons (items first, then actions) with their ids as labels.

- [ ] **Step 5: USER APPROVAL GATE.** Show the user `art/ui-icons/_final.png`, using the brainstorm companion if it's still running, or the Read tool. Ask for approval, and list any id they want rerolled. Loop on Steps 2–4 for rejected ids only. **Do not continue until the user approves.**

- [ ] **Step 6: Install the approved icons.**

```bash
# for each item id:   cp art/ui-icons/raw/<id>_<index>.png client/public/ui/icons/items/<id>.png
# for each act_<x> id: cp art/ui-icons/raw/act_<x>_<index>.png client/public/ui/icons/actions/<x>.png
python3 - <<'EOF'
from PIL import Image
import os
for d, size, n in [('client/public/ui/icons/items', 32, 23), ('client/public/ui/icons/actions', 24, 7)]:
    files = sorted(os.listdir(d)); assert len(files) == n, (d, files)
    for f in files: assert Image.open(os.path.join(d, f)).size == (size, size), f
print('ok')
EOF
```

Expected: `ok`.

- [ ] **Step 7: Commit** (public assets only):

```bash
git.exe add client/public/ui/relic_frame.png client/public/ui/icons
git.exe commit -m "Add relic bezel and PixelLab item/action icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Client pure helpers and the baseline screenshots

**Files:**
- Create: `client/src/ui/iconPaths.ts`
- Create: `client/src/ui/gaugeStyle.ts`
- Create: `client/src/ui/iconPaths.test.ts`
- Create: `client/src/ui/gaugeStyle.test.ts`

**Interfaces:**
- Consumes: `archetypeFor`, `ItemSlot`, `Item` from `@caverns/shared`.
- Produces:
  - `RELIC_FRAME_SRC = '/ui/relic_frame.png'`
  - `type ActionIcon = 'move' | 'attack' | 'defend' | 'abilities' | 'items' | 'flee' | 'end_turn'`
  - `itemIconSrc(item: Pick<Item,'slot'|'name'|'archetype'>): string`
  - `actionIconSrc(a: ActionIcon): string`
  - `slotGlyph(slot: ItemSlot): string`
  - `type GaugeKind = 'hp' | 'xp' | 'resource'`
  - `gaugeStyle(value: number, max: number, kind: GaugeKind): { pct: number; color: string }`

- [ ] **Step 1: Capture the baseline screenshots and arena size, before any UI change.**

Start the dev servers in the background with `cmd.exe /c "npm run dev:sandbox"`, and note the client port Vite prints; it's 5173 unless that port is taken. Then run:

```bash
cmd.exe /c "node scripts/sandbox-drive.mjs duel --base http://localhost:<port> --wait my-turn --shot before-combat --out .sandbox/ui-revamp"
```

Record the visible arena size. Save as `.sandbox/arena-size.mjs`:

```js
import { chromium } from 'playwright';
const [base, preset = 'duel'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${base}/?sandbox=${preset}`);
await p.waitForFunction(() => window.__cavernsSandbox?.status === 'my_turn', null, { timeout: 60000 });
const box = await p.locator('.arena-viewport').boundingBox();
console.log(JSON.stringify({ cols: Math.floor((box.width - 2) / 34), rows: Math.floor((box.height - 2) / 50) }));
await b.close();
```

Run: `cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:<port>"`. Write the printed `{cols, rows}` into this plan's Task 11 Step 2 as the baseline.

- [ ] **Step 2: Write the failing tests.** Create `client/src/ui/gaugeStyle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gaugeStyle } from './gaugeStyle.js';

describe('gaugeStyle', () => {
  it('computes percentage', () => {
    expect(gaugeStyle(25, 50, 'hp').pct).toBe(50);
  });

  it('shifts hp colour at 50% and 25%', () => {
    expect(gaugeStyle(40, 50, 'hp').color).toBe('var(--relic-hp-high)');
    expect(gaugeStyle(25, 50, 'hp').color).toBe('var(--relic-hp-mid)');
    expect(gaugeStyle(12, 50, 'hp').color).toBe('var(--relic-hp-low)');
  });

  it('uses fixed colours for xp and resource', () => {
    expect(gaugeStyle(1, 10, 'xp').color).toBe('var(--relic-xp)');
    expect(gaugeStyle(1, 10, 'resource').color).toBe('var(--relic-resource)');
  });

  it('clamps and never returns NaN', () => {
    expect(gaugeStyle(60, 50, 'hp').pct).toBe(100);
    expect(gaugeStyle(-5, 50, 'hp').pct).toBe(0);
    expect(gaugeStyle(10, 0, 'hp').pct).toBe(0);
    expect(gaugeStyle(Number.NaN, 50, 'hp').pct).toBe(0);
    expect(gaugeStyle(10, Number.NaN, 'xp').pct).toBe(0);
  });
});
```

Create `client/src/ui/iconPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ITEM_ARCHETYPES } from '@caverns/shared';
import { itemIconSrc, actionIconSrc, slotGlyph, RELIC_FRAME_SRC } from './iconPaths.js';

describe('iconPaths', () => {
  it('maps items to archetype icons', () => {
    expect(itemIconSrc({ slot: 'weapon', name: 'Iron Mace' })).toBe('/ui/icons/items/blunt.png');
    expect(itemIconSrc({ slot: 'weapon', name: 'Worldsplitter', archetype: 'blade' })).toBe('/ui/icons/items/blade.png');
    expect(itemIconSrc({ slot: 'consumable', name: 'Mystery Goo' })).toBe('/ui/icons/items/consumable_misc.png');
  });

  it('every archetype has a path under /ui/icons/items', () => {
    for (const a of ITEM_ARCHETYPES) {
      expect(itemIconSrc({ slot: 'weapon', name: '', archetype: a } as never)).toMatch(/^\/ui\/icons\/items\/[a-z_]+\.png$/);
    }
  });

  it('maps actions and frame', () => {
    expect(actionIconSrc('end_turn')).toBe('/ui/icons/actions/end_turn.png');
    expect(RELIC_FRAME_SRC).toBe('/ui/relic_frame.png');
  });

  it('has a glyph for every slot', () => {
    for (const s of ['weapon', 'offhand', 'armor', 'accessory', 'consumable'] as const) {
      expect(slotGlyph(s)).toHaveLength(1);
    }
  });
});
```

The second `iconPaths` test passes `slot: 'weapon'` with non-weapon archetypes. `archetypeFor` then falls back to the slot default, so the path is still well-formed; the test only asserts the shape.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cmd.exe /c "cd client && npx vitest run src/ui"`
Expected: FAIL, the modules can't be resolved.

- [ ] **Step 4: Implement both helpers.** Create `client/src/ui/gaugeStyle.ts`:

```ts
export type GaugeKind = 'hp' | 'xp' | 'resource';

/** Fill width (0-100, never NaN) and fill colour (a relic.css token) for a Gauge. */
export function gaugeStyle(value: number, max: number, kind: GaugeKind): { pct: number; color: string } {
  const raw = max > 0 ? (value / max) * 100 : 0;
  const pct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  if (kind === 'xp') return { pct, color: 'var(--relic-xp)' };
  if (kind === 'resource') return { pct, color: 'var(--relic-resource)' };
  const color = pct > 50 ? 'var(--relic-hp-high)' : pct > 25 ? 'var(--relic-hp-mid)' : 'var(--relic-hp-low)';
  return { pct, color };
}
```

Create `client/src/ui/iconPaths.ts`:

```ts
import { archetypeFor } from '@caverns/shared';
import type { Item, ItemSlot } from '@caverns/shared';

export const RELIC_FRAME_SRC = '/ui/relic_frame.png';

export type ActionIcon = 'move' | 'attack' | 'defend' | 'abilities' | 'items' | 'flee' | 'end_turn';

export function itemIconSrc(item: Pick<Item, 'slot' | 'name' | 'archetype'>): string {
  return `/ui/icons/items/${archetypeFor(item)}.png`;
}

export function actionIconSrc(action: ActionIcon): string {
  return `/ui/icons/actions/${action}.png`;
}

// Text stand-ins for empty sockets and failed icon loads.
const SLOT_GLYPHS: Record<ItemSlot, string> = {
  weapon: '†', offhand: '◘', armor: '▣', accessory: '○', consumable: '¡',
};

export function slotGlyph(slot: ItemSlot): string {
  return SLOT_GLYPHS[slot];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cmd.exe /c "cd client && npx vitest run src/ui"`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git.exe add client/src/ui/iconPaths.ts client/src/ui/gaugeStyle.ts client/src/ui/iconPaths.test.ts client/src/ui/gaugeStyle.test.ts
git.exe commit -m "Add icon path and gauge style helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Relic kit components and stylesheet

**Files:**
- Create: `client/src/styles/relic.css`
- Create: `client/src/components/relic/RelicPanel.tsx`
- Create: `client/src/components/relic/RelicButton.tsx`
- Create: `client/src/components/relic/Gauge.tsx`
- Create: `client/src/components/relic/IconSocket.tsx`
- Create: `client/src/components/relic/ItemIcon.tsx`
- Create: `client/src/components/relic/index.ts`
- Modify: `client/src/main.tsx:6` (import relic.css after index.css)

**Interfaces:**
- Consumes: `RELIC_FRAME_SRC`, `itemIconSrc`, `slotGlyph`, `gaugeStyle`, `GaugeKind` (Task 5).
- Produces (all exported from `client/src/components/relic/index.ts`):
  - `RelicPanel({ title?: string; glow?: boolean; className?: string; children: ReactNode })`
  - `RelicButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string | null; hot?: boolean; size?: 'md' | 'sm'; tone?: 'default' | 'danger' })`
  - `Gauge({ value: number; max: number; kind: GaugeKind; text?: string; size?: 'md' | 'sm' })`
  - `IconSocket({ size?: 24 | 32; rarity?: Rarity; hot?: boolean; title?: string; children?: ReactNode })`
  - `ItemIcon({ item: Item })` (always 32)
  - `EmptySocket({ slot: ItemSlot })`

- [ ] **Step 1: Create `client/src/styles/relic.css`:**

```css
/* === Relic kit (UI revamp phase 1): salvaged-hardware chrome around the amber CRT text.
   Loaded after index.css. Does not touch .crt-overlay. === */
:root {
  --relic-bronze: #4a3522;
  --relic-bronze-hi: #7a5530;
  --relic-bronze-lo: #140c06;
  --relic-bronze-face: #2a1c10;
  --relic-screen: #0b0907;
  --relic-amber: #f0c878;
  --relic-amber-hot: #ffd98a;
  --relic-amber-rim: #c08a3a;
  --relic-text: #c8b89a;
  --relic-dim: #6d5f4a;
  --relic-divider: #2e241a;
  --relic-danger: #e06a5a;
  --relic-hp-high: #b8322a;
  --relic-hp-mid: #b8752a;
  --relic-hp-low: #e04040;
  --relic-xp: #c8a24a;
  --relic-resource: #3fa7c9;
  --screen-glow: rgba(70, 190, 110, 0.18);
  --screen-glow-rim: rgba(40, 140, 80, 0.08);
  --rarity-common: #c8b89a;
  --rarity-uncommon: #8888ff;
  --rarity-rare: #ffee77;
  --rarity-legendary: #af6025;
  --rarity-unique: #ff44ff;
}

/* --- Panel: PixelLab bezel as a 9-slice, dark screen, subtle green phosphor edge --- */
.relic-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 24px solid transparent;
  border-image: url('/ui/relic_frame.png') 24 / 24px round;
  image-rendering: pixelated;
  background: var(--relic-screen);
  background-clip: padding-box;
}
.relic-panel--fallback { border: 6px double var(--relic-bronze-hi); border-image: none; }
.relic-panel__screen {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.relic-panel__glow {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  box-shadow: inset 0 0 18px 2px var(--screen-glow);
  background: radial-gradient(ellipse at center, transparent 62%, var(--screen-glow-rim) 100%);
}
.relic-panel__title {
  position: absolute;
  top: -20px;
  left: 12px;
  z-index: 3;
  padding: 0 6px;
  line-height: 16px;
  background: var(--relic-bronze-lo);
  color: var(--relic-amber);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* --- Button: CSS-bevelled bronze --- */
.relic-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 5px;
  font-family: inherit;
  font-size: 0.8rem;
  color: var(--relic-amber);
  background: var(--relic-bronze-face);
  border: 2px solid #000;
  border-radius: 0;
  cursor: pointer;
  box-shadow: inset 2px 2px 0 var(--relic-bronze-hi), inset -2px -2px 0 var(--relic-bronze-lo), 0 0 0 2px var(--relic-bronze);
  text-shadow: 0 0 3px rgba(240, 200, 120, 0.3);
  image-rendering: pixelated;
}
.relic-btn--sm { padding: 1px 7px 2px; font-size: 0.65rem; gap: 4px; }
.relic-btn--danger { color: var(--relic-danger); }
.relic-btn:hover:not(:disabled) {
  box-shadow: inset 2px 2px 0 #9a6d3c, inset -2px -2px 0 var(--relic-bronze-lo), 0 0 0 2px var(--relic-amber-rim);
}
.relic-btn:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: inset 2px 2px 0 var(--relic-bronze-lo), inset -2px -2px 0 var(--relic-bronze-hi), 0 0 0 2px var(--relic-bronze);
}
.relic-btn:focus-visible { outline: 1px dashed var(--relic-amber); outline-offset: 4px; }
.relic-btn:disabled { opacity: 0.4; cursor: not-allowed; text-shadow: none; }
.relic-btn--hot {
  color: var(--relic-amber-hot);
  box-shadow: inset 2px 2px 0 #a8773c, inset -2px -2px 0 var(--relic-bronze-lo), 0 0 0 2px var(--relic-amber-rim), 0 0 8px rgba(240, 170, 60, 0.35);
}
.relic-btn__icon { width: 24px; height: 24px; flex: none; }
.relic-btn--sm .relic-btn__icon { display: none; }

/* --- Gauge: segmented bar --- */
.relic-gauge {
  position: relative;
  height: 18px;
  margin: 6px 2px;
  overflow: hidden;
  background: #1a0c0a;
  border: 2px solid #000;
  box-shadow: 0 0 0 2px var(--relic-bronze);
}
.relic-gauge--xp { background: #14110a; }
.relic-gauge--resource { background: #0a1418; }
.relic-gauge--sm { height: 12px; margin: 4px 2px; }
.relic-gauge__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: repeating-linear-gradient(90deg, var(--gauge-color) 0 6px, transparent 6px 8px);
  transition: width 0.25s steps(8);
}
.relic-gauge__text {
  position: relative;
  display: block;
  text-align: center;
  font-size: 0.7rem;
  line-height: 14px;
  color: #f2d7a8;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
}
.relic-gauge--sm .relic-gauge__text { font-size: 0.6rem; line-height: 8px; }

/* --- Socket: recessed square with a bronze (or rarity) ring --- */
.relic-socket {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: #0f0b08;
  border: 2px solid #000;
  box-shadow: 0 0 0 1px var(--socket-ring, var(--relic-bronze));
}
.relic-socket--32 { width: 36px; height: 36px; }
.relic-socket--24 { width: 28px; height: 28px; }
.relic-socket--uncommon { --socket-ring: var(--rarity-uncommon); }
.relic-socket--rare { --socket-ring: var(--rarity-rare); }
.relic-socket--legendary { --socket-ring: var(--rarity-legendary); }
.relic-socket--unique { --socket-ring: var(--rarity-unique); }
.relic-socket--hot { box-shadow: 0 0 0 2px var(--relic-amber-rim), 0 0 6px rgba(240, 170, 60, 0.4); }
.relic-socket__img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.relic-socket__glyph { font-size: 0.9rem; color: var(--relic-dim); line-height: 1; }

/* --- Bronze rail (turn order, console strips) --- */
.relic-rail {
  background: linear-gradient(#2a1c10, #1a120a);
  border: 2px solid #000;
  box-shadow: inset 0 2px 0 var(--relic-bronze-hi), 0 0 0 1px var(--relic-bronze);
}
```

- [ ] **Step 2: Create the components.**

`client/src/components/relic/RelicPanel.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { RELIC_FRAME_SRC } from '../../ui/iconPaths.js';

// Probe the bezel once per page load; if it can't load, panels fall back to a CSS double border.
let frameProbe: Promise<boolean> | null = null;
function probeFrame(): Promise<boolean> {
  frameProbe ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = RELIC_FRAME_SRC;
  });
  return frameProbe;
}

interface RelicPanelProps {
  title?: string;
  glow?: boolean;
  className?: string;
  children: ReactNode;
}

export function RelicPanel({ title, glow = true, className = '', children }: RelicPanelProps) {
  const [frameOk, setFrameOk] = useState(true);
  useEffect(() => {
    let live = true;
    void probeFrame().then((ok) => { if (live) setFrameOk(ok); });
    return () => { live = false; };
  }, []);

  return (
    <section className={`relic-panel${frameOk ? '' : ' relic-panel--fallback'} ${className}`}>
      {title && <div className="relic-panel__title">{title}</div>}
      <div className="relic-panel__screen">{children}</div>
      {glow && <div className="relic-panel__glow" aria-hidden="true" />}
    </section>
  );
}
```

`client/src/components/relic/RelicButton.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

type RelicButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string | null;
  hot?: boolean;
  size?: 'md' | 'sm';
  tone?: 'default' | 'danger';
};

export function RelicButton({
  icon, hot = false, size = 'md', tone = 'default', className = '', type = 'button', children, ...rest
}: RelicButtonProps) {
  const cls = `relic-btn relic-btn--${size}${hot ? ' relic-btn--hot' : ''}${tone === 'danger' ? ' relic-btn--danger' : ''} ${className}`;
  return (
    <button type={type} className={cls} {...rest}>
      {icon && (
        <img
          className="relic-btn__icon"
          src={icon}
          alt=""
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <span className="relic-btn__label">{children}</span>
    </button>
  );
}
```

`client/src/components/relic/Gauge.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { gaugeStyle, type GaugeKind } from '../../ui/gaugeStyle.js';

interface GaugeProps {
  value: number;
  max: number;
  kind: GaugeKind;
  text?: string;
  size?: 'md' | 'sm';
}

export function Gauge({ value, max, kind, text, size = 'md' }: GaugeProps) {
  const { pct, color } = gaugeStyle(value, max, kind);
  const fill = { width: `${pct}%`, '--gauge-color': color } as CSSProperties;
  return (
    <div className={`relic-gauge relic-gauge--${kind} relic-gauge--${size}`}>
      <div className="relic-gauge__fill" style={fill} />
      <span className="relic-gauge__text">{text ?? `${value} / ${max}`}</span>
    </div>
  );
}
```

`client/src/components/relic/IconSocket.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ItemSlot, Rarity } from '@caverns/shared';
import { slotGlyph } from '../../ui/iconPaths.js';

interface IconSocketProps {
  size?: 24 | 32;
  rarity?: Rarity;
  hot?: boolean;
  title?: string;
  children?: ReactNode;
}

export function IconSocket({ size = 32, rarity, hot = false, title, children }: IconSocketProps) {
  const cls = `relic-socket relic-socket--${size}${rarity ? ` relic-socket--${rarity}` : ''}${hot ? ' relic-socket--hot' : ''}`;
  return <span className={cls} title={title}>{children}</span>;
}

export function EmptySocket({ slot }: { slot: ItemSlot }) {
  return (
    <IconSocket size={32}>
      <span className="relic-socket__glyph" aria-hidden="true">{slotGlyph(slot)}</span>
    </IconSocket>
  );
}
```

`client/src/components/relic/ItemIcon.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Item } from '@caverns/shared';
import { itemIconSrc, slotGlyph } from '../../ui/iconPaths.js';
import { IconSocket } from './IconSocket.js';

export function ItemIcon({ item }: { item: Item }) {
  const src = itemIconSrc(item);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <IconSocket size={32} rarity={item.rarity} title={item.name}>
      {failed ? (
        <span className="relic-socket__glyph" aria-hidden="true">{slotGlyph(item.slot)}</span>
      ) : (
        <img className="relic-socket__img" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </IconSocket>
  );
}
```

`client/src/components/relic/index.ts`:

```ts
export { RelicPanel } from './RelicPanel.js';
export { RelicButton } from './RelicButton.js';
export { Gauge } from './Gauge.js';
export { IconSocket, EmptySocket } from './IconSocket.js';
export { ItemIcon } from './ItemIcon.js';
```

- [ ] **Step 3: Load the stylesheet.** In `client/src/main.tsx`, after `import './styles/index.css';`, add:

```ts
import './styles/relic.css';
```

- [ ] **Step 4: Typecheck and run the client tests**

Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"`
Expected: exit 0 and all client tests pass. Nothing renders the kit yet; Tasks 7–10 are its visual check.

- [ ] **Step 5: Commit**

```bash
git.exe add client/src/styles/relic.css client/src/components/relic client/src/main.tsx
git.exe commit -m "Add relic UI kit: panel, button, gauge, socket, item icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Side column (map, party, character HUD)

**Files:**
- Modify: `client/src/App.tsx:181-189` (the side column)
- Modify: `client/src/components/PartyPanel.tsx` (whole render)
- Modify: `client/src/components/PlayerHUD.tsx` (whole render)
- Modify: `client/src/styles/relic.css` (append the "Side column" section)

**Interfaces:**
- Consumes:
  - `RelicPanel`, `RelicButton`, `Gauge`, `IconSocket`, `EmptySocket`, `ItemIcon` (Task 6);
  - `getClassPortrait` (`client/src/classPortraits.ts`);
  - `getParticipantGlyph` (`client/src/glyphs.ts`).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Wrap the minimap in `App.tsx`.** Add `import { RelicPanel } from './components/relic/index.js';` and change the side column to:

```tsx
          <div className="side-column">
            <RelicPanel className="map-screen" title="Map">
              <MiniMap />
            </RelicPanel>
            <PartyPanel />
            <PlayerHUD
              onEquipItem={actions.equipItem}
              onDropItem={actions.dropItem}
              onUseConsumable={actions.useConsumable}
              onAllocateStat={(statId) => actions.allocateStat(statId, 1)}
            />
          </div>
```

- [ ] **Step 2: Rewrite `PartyPanel`'s render.** Keep `STATUS_ICONS` and the hooks. It returns `null` when solo, so no empty bezel appears (Review Focus 4). Add imports:

```tsx
import { RelicPanel, Gauge, IconSocket } from './relic/index.js';
import { getParticipantGlyph } from '../glyphs.js';
```

Replace the returned JSX with:

```tsx
  return (
    <RelicPanel className="party-screen" title="Party">
      <div className="party-panel">
        {otherPlayers.map((player) => {
          const room = rooms[player.roomId];
          const glyph = getParticipantGlyph({ type: 'player', className: player.className });
          return (
            <div key={player.id} className="party-member">
              <IconSocket size={24} title={player.className}>
                {glyph
                  ? <img className="relic-socket__img" src={glyph} alt="" />
                  : <span className="relic-socket__glyph">{player.name.charAt(0)}</span>}
              </IconSocket>
              <div className="party-member-body">
                <div className="party-member-header">
                  <span>{STATUS_ICONS[player.status] ?? ''} {player.name}</span>
                  <span className="party-room">{room?.name ?? '???'}</span>
                </div>
                <Gauge kind="hp" size="sm" value={player.hp} max={player.maxHp} text={`${player.hp}/${player.maxHp}`} />
              </div>
            </div>
          );
        })}
      </div>
    </RelicPanel>
  );
```

Delete the now-unused `hpPercent` and `hpColor` locals.

- [ ] **Step 3: Rewrite `PlayerHUD`.** Keep `STAT_DISPLAY_NAMES`, `formatStats`, the props interface, the hooks and all derived values (`stats`, the thresholds, `xpIntoLevel`, `xpNeeded`, `isMaxLevel`, `nextThreshold`, `inCombat`). Delete `hpPercent`, `hpColor` and `xpPercent`.

Add imports:

```tsx
import type { Item, ItemStats, ItemSlot } from '@caverns/shared';
import { RelicPanel, RelicButton, Gauge, ItemIcon, EmptySocket } from './relic/index.js';
import { getClassPortrait } from '../classPortraits.js';
```

(Replace the existing `import type { Item, ItemStats }` line.)

Replace `ItemDisplay` with:

```tsx
function ItemDisplay({ item, label, slot }: { item: Item | null; label: string; slot: ItemSlot }) {
  return (
    <div className="equip-slot">
      {item ? <ItemIcon item={item} /> : <EmptySocket slot={slot} />}
      <div className="slot-body">
        <span className="slot-label">{label}</span>
        {item ? (
          <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
        ) : (
          <span className="empty">Empty</span>
        )}
        {item && (
          <span className="item-stats">
            {formatStats(item.stats)}
            {item.effect && <span className="item-effect"> [{item.effect.replace(/_/g, ' ')}]</span>}
          </span>
        )}
      </div>
    </div>
  );
}
```

Replace the returned JSX of `PlayerHUD` with:

```tsx
  const portrait = getClassPortrait(player.className);
  return (
    <RelicPanel className="hud-screen">
      <div className="player-hud">
        <div className="hud-identity">
          {portrait && <img className="hud-portrait" src={portrait} alt="" />}
          <div className="hud-identity-text">
            <h3>{player.name}</h3>
            <div className="hud-class">{player.className}</div>
            <div className="hud-level">Lv {player.level}</div>
            <div className="hud-gold">Gold {player.gold ?? 0}</div>
          </div>
        </div>

        <Gauge kind="hp" value={player.hp} max={player.maxHp} />
        <Gauge
          kind="xp"
          size="sm"
          value={isMaxLevel ? 1 : xpIntoLevel}
          max={isMaxLevel ? 1 : xpNeeded}
          text={isMaxLevel ? 'MAX' : `${player.xp} / ${nextThreshold} XP`}
        />
        <Gauge
          kind="resource"
          size="sm"
          value={player.energy ?? 0}
          max={stats.maxEnergy}
          text={`${player.energy ?? 0}/${stats.maxEnergy} ${STAT_DISPLAY_NAMES['maxEnergy'] ?? 'Energy'}`}
        />

        {player.unspentStatPoints > 0 && (
          <div className="stat-allocation">
            <div className="stat-alloc-header">
              +{player.unspentStatPoints} stat {player.unspentStatPoints === 1 ? 'point' : 'points'}
            </div>
            {PROGRESSION_CONFIG.statDefinitions.map((def) => (
              <div key={def.id} className="stat-alloc-row">
                <span className="stat-alloc-name">{def.displayName}</span>
                <span className="stat-alloc-value">{player.statAllocations[def.id] ?? 0}</span>
                <RelicButton size="sm" onClick={() => onAllocateStat(def.id)}>+</RelicButton>
              </div>
            ))}
          </div>
        )}

        <div className="equipment-grid">
          <ItemDisplay item={player.equipment.weapon} label="Weapon" slot="weapon" />
          <ItemDisplay item={player.equipment.offhand} label="Off-hand" slot="offhand" />
          <ItemDisplay item={player.equipment.armor} label="Armor" slot="armor" />
          <ItemDisplay item={player.equipment.accessory} label="Accessory" slot="accessory" />
        </div>

        <div className="consumables">
          <span className="slot-label">Consumables</span>
          <div className="consumable-grid">
            {player.consumables.map((item, i) => (
              <div key={i} className="consumable-slot">
                {item ? <ItemIcon item={item} /> : <EmptySocket slot="consumable" />}
                {item ? (
                  <div className="slot-body">
                    <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
                    <span className="item-stats">{formatStats(item.stats)}</span>
                  </div>
                ) : (
                  <span className="empty">-</span>
                )}
                {item && !inCombat && (
                  <RelicButton size="sm" onClick={() => onUseConsumable(i)}>Use</RelicButton>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="inventory">
          <span className="slot-label">Inventory</span>
          <div className="inventory-grid">
            {player.inventory.map((item, i) => (
              <div key={i} className="inventory-slot">
                {item ? <ItemIcon item={item} /> : <EmptySocket slot="weapon" />}
                {item ? (
                  <div className="slot-body">
                    <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
                    <span className="item-stats">{formatStats(item.stats)}</span>
                  </div>
                ) : (
                  <span className="empty">-</span>
                )}
                {item && !inCombat && (
                  <div className="slot-actions">
                    <RelicButton size="sm" onClick={() => onEquipItem(i)}>
                      {item.slot === 'consumable' ? 'Stow' : 'Equip'}
                    </RelicButton>
                    <RelicButton size="sm" tone="danger" onClick={() => onDropItem(i)}>Drop</RelicButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {player.keychain.length > 0 && (
          <div className="keychain-section">
            <div className="section-label">Keychain</div>
            <div className="keychain-items">
              {player.keychain.map((keyId) => (
                <span key={keyId} className="key-item" title={keyId}>
                  🗝 {keyId.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </RelicPanel>
  );
```

Empty inventory slots use `EmptySocket slot="weapon"`, which shows `†`. That's intentional: inventory slots accept any item, and one consistent glyph reads as "empty bag slot". The earlier early-`return null` stays above this.

- [ ] **Step 4: Append the side-column CSS to `relic.css`:**

```css
/* === Phase 1 screens: side column === */
.side-column { gap: 4px; background: transparent; }
.side-column > .relic-panel { flex: none; }
.side-column > .hud-screen { flex: 1; }
.map-screen .minimap { background: transparent; border-bottom: none; }
.party-screen .party-panel, .hud-screen .player-hud { background: transparent; border-bottom: none; }
.hud-screen .player-hud { flex: 1; min-height: 0; overflow-y: auto; }

.party-member { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.party-member-body { flex: 1; min-width: 0; }

.hud-identity { display: flex; gap: 10px; margin-bottom: 4px; }
.hud-portrait {
  width: 56px; height: 84px; flex: none;
  border: 2px solid #000; box-shadow: 0 0 0 1px var(--relic-bronze); background: #050403;
  image-rendering: pixelated;
}
.hud-identity-text { min-width: 0; }

.player-hud .equip-slot,
.player-hud .consumable-slot,
.player-hud .inventory-slot {
  display: flex; align-items: center; gap: 8px; justify-content: flex-start;
  padding: 3px 0; border-bottom: 1px dashed var(--relic-divider); font-size: 0.8rem;
}
.slot-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.slot-body .slot-label { font-size: 0.6rem; color: var(--relic-dim); text-transform: uppercase; letter-spacing: 0.08em; }
.slot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot-body .item-stats { font-size: 0.65rem; color: var(--relic-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot-actions { display: flex; gap: 6px; flex: none; }
.player-hud .consumables > .slot-label,
.player-hud .inventory > .slot-label { display: block; margin-top: 8px; font-size: 0.65rem; color: var(--relic-dim); text-transform: uppercase; letter-spacing: 0.08em; }
```

- [ ] **Step 5: Typecheck**

Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."`
Expected: exit 0.

- [ ] **Step 6: Visual check, including the long-name case (Review Focus 5).**

1. With the dev servers running, screenshot combat on `duel` (`--shot task7-combat`). The side column must show three bezels (Map, then the HUD; there is no Party panel solo), sockets with icons, and segmented gauges.
2. For the long-name check, temporarily edit a Vanguard starter item name in `shared/src/content.ts` to `Masterwork Forge-Heart Brigandine Of The Deep`, rebuild shared, screenshot, and confirm the name ends in `…` and nothing overflows the column. Then **revert that edit**; `git.exe diff shared/src/content.ts` must be empty.
3. View both screenshots with the Read tool.

- [ ] **Step 7: Commit**

```bash
git.exe add client/src/App.tsx client/src/components/PartyPanel.tsx client/src/components/PlayerHUD.tsx client/src/styles/relic.css
git.exe commit -m "Move side column onto relic kit: map, party and character HUD

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Exploration main column and ActionBar

**Files:**
- Modify: `client/src/App.tsx:164-178` (the exploration branch)
- Modify: `client/src/components/ActionBar.tsx` (buttons, loot rows)
- Modify: `client/src/styles/relic.css` (append the "Exploration" section)

**Interfaces:**
- Consumes: `RelicPanel`, `RelicButton`, `ItemIcon` (Task 6).

- [ ] **Step 1: Wrap the exploration screens in `App.tsx`:**

```tsx
              <>
                <RelicPanel className="room-screen">
                  <div className="room-area">
                    <Compass exits={availableExits} />
                    <RoomView />
                  </div>
                </RelicPanel>
                <RelicPanel className="log-screen" title="Log">
                  <TextLog />
                  <ChatInput onSend={actions.chat} />
                </RelicPanel>
                <ActionBar
                  onLootChoice={actions.lootChoice}
                  onRevive={actions.revive}
                  onPuzzleAnswer={actions.puzzleAnswer}
                  onInteractAction={actions.interactAction}
                />
              </>
```

- [ ] **Step 2: Move `ActionBar` onto the kit.** Add:

```tsx
import { RelicButton, ItemIcon } from './relic/index.js';
```

Then make these replacements. Keep every handler and condition exactly as it is.

- **Puzzle:** `<button key={i} className="puzzle-btn" onClick={...}>{option}</button>` becomes `<RelicButton key={i} className="puzzle-btn" onClick={() => onPuzzleAnswer(activePuzzle.roomId, i)}>{option}</RelicButton>`.
- **Loot:** replace each `loot-item` div's contents with:

```tsx
          <div key={item.id} className="loot-item">
            <ItemIcon item={item} />
            <div className="slot-body">
              <span className={`slot-name item-name rarity-${item.rarity}`}>{item.name}</span>
              <span className="item-stats">[{item.slot}] {formatStats(item.stats)}</span>
            </div>
            <div className="loot-buttons">
              {(['need', 'greed', 'pass'] as const).map((choice) => {
                const chosen = lootChoices[item.id];
                return (
                  <RelicButton
                    key={choice}
                    hot={chosen === choice}
                    disabled={!!chosen}
                    onClick={() => { setLootChoice(item.id, choice); onLootChoice(item.id, choice); }}
                  >
                    {choice.charAt(0).toUpperCase() + choice.slice(1)}
                  </RelicButton>
                );
              })}
            </div>
          </div>
```

- **Interact:** each `<button className={`interact-btn...`} ...>` becomes a `<RelicButton>` with the same `className`, `disabled`, `onClick` and `title` props and the same children. The Cancel `<button className="interact-btn interact-cancel">` becomes `<RelicButton className="interact-btn interact-cancel" onClick={...}>Cancel</RelicButton>`.
- **Revive:** `<button key={ally.id} onClick={() => onRevive(ally.id)}>` becomes `<RelicButton key={ally.id} onClick={() => onRevive(ally.id)}>`, with the same children.

A disabled chosen loot button now reads as hot at 40% opacity. To keep the choice visible, add `.relic-btn--hot:disabled { opacity: 0.85; }` in Step 3.

- [ ] **Step 3: Append the exploration CSS to `relic.css`:**

```css
/* === Phase 1 screens: exploration === */
.game-layout { gap: 4px; }
.main-column { gap: 4px; }
.room-screen { flex: none; }
.log-screen { flex: 1; }
.log-screen .text-log { background: transparent; }
.log-screen .chat-input { background: transparent; border-top: 1px dashed var(--relic-divider); }

/* Console strip: flat bronze rail under the screens */
.action-bar {
  background: linear-gradient(#2a1c10, #1a120a);
  border-top: 2px solid #000;
  box-shadow: inset 0 2px 0 var(--relic-bronze-hi), 0 -1px 0 var(--relic-bronze);
}
.action-bar .loot-item { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.action-bar .loot-buttons { display: flex; gap: 8px; flex: none; }
.action-bar .puzzle-options, .action-bar .interact-actions, .action-bar .revive-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.relic-btn--hot:disabled { opacity: 0.85; }
```

- [ ] **Step 4: Typecheck and visual check**

Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."`. Expected: exit 0.

Exploration isn't reachable through the sandbox driver. Log in through the normal dev client at `http://localhost:<port>/` in a Playwright script, or ask the user to open it, then screenshot the room screen, the log and a loot prompt if one occurs.

Confirm that:
- the room grid, compass and torch HUD are all visible inside the bezel;
- the log scrolls;
- chat input works.

- [ ] **Step 5: Commit**

```bash
git.exe add client/src/App.tsx client/src/components/ActionBar.tsx client/src/styles/relic.css
git.exe commit -m "Move exploration screens and action bar onto relic kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Arena combat

**Files:**
- Modify: `client/src/components/ArenaView.tsx:379-404` (render wrapper)
- Modify: `client/src/components/TurnOrderBar.tsx` (whole render)
- Modify: `client/src/components/ArenaUnitPanel.tsx` (`UnitHpBar` becomes `Gauge`)
- Modify: `client/src/components/ArenaActionBar.tsx` (buttons)
- Modify: `client/src/styles/relic.css` (append the "Arena" section)

**Interfaces:**
- Consumes: `RelicPanel`, `RelicButton`, `Gauge`, `IconSocket` (Task 6); `actionIconSrc` (Task 5); `getParticipantGlyph`.

- [ ] **Step 1: Wrap the arena in one screen.** In `ArenaView.tsx`, add `import { RelicPanel } from './relic/index.js';` and change the `arena-main` block to:

```tsx
      <RelicPanel className="arena-screen">
        <div className="arena-main">
          <ArenaGrid /* the existing 13 props from ArenaView.tsx:389-401, unchanged */ />
          <ArenaUnitPanel participants={activeCombat.participants} />
        </div>
      </RelicPanel>
```

The `/* ... */` above is shorthand for this plan only: keep every `ArenaGrid` prop (from `grid={arenaGrid}` to `animPath={animPath}`) exactly as it is. Only the wrapping `RelicPanel` is new. The unit panel sits inside the same bezel, divided off, because bezels never nest.

- [ ] **Step 2: Put the turn order in sockets.** Replace `TurnOrderBar`'s return with the following, and add the imports `import { IconSocket } from './relic/index.js';` and `import { getParticipantGlyph } from '../glyphs.js';`:

```tsx
  return (
    <div className="arena-turn-order relic-rail">
      <span className="turn-round">Round {roundNumber}</span>
      {turnOrder.map((id) => {
        const p = participantMap.get(id);
        if (!p) return null;
        const isCurrent = id === currentTurnId;
        const glyph = getParticipantGlyph(p);
        return (
          <span key={id} className={`turn-unit ${p.type === 'player' ? 'turn-player' : 'turn-mob'}${isCurrent ? ' turn-active' : ''}`}>
            <IconSocket size={24} hot={isCurrent} title={p.name}>
              {glyph
                ? <img className="relic-socket__img" src={glyph} alt="" />
                : <span className="relic-socket__glyph">{p.name.charAt(0)}</span>}
            </IconSocket>
            <span className="turn-name">{p.name}</span>
          </span>
        );
      })}
    </div>
  );
```

- [ ] **Step 3: Unit gauges.** In `ArenaUnitPanel.tsx`, add `import { Gauge } from './relic/index.js';`, then replace the `UnitHpBar` function body with:

```tsx
function UnitHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  return <Gauge kind="hp" size="sm" value={hp} max={maxHp} text={`${hp}/${maxHp}`} />;
}
```

- [ ] **Step 4: Arena action bar.** In `ArenaActionBar.tsx`, add:

```tsx
import { RelicButton } from './relic/index.js';
import { actionIconSrc } from '../ui/iconPaths.js';
```

Replace every `<button className="arena-btn ..." ...>` with `<RelicButton>`, keeping `className` (so `arena-btn-end` and `arena-btn-attack` survive for the sandbox driver), `onClick`, `disabled` and the children. Add icons and `hot` as follows:

| Button | Extra props |
|---|---|
| Move | `icon={actionIconSrc('move')}` |
| Attack | `icon={actionIconSrc('attack')}` |
| Defend | `icon={actionIconSrc('defend')}` |
| Abilities | `icon={actionIconSrc('abilities')}` |
| Items | `icon={actionIconSrc('items')}` |
| Flee | `icon={actionIconSrc('flee')}` |
| End Turn | `icon={actionIconSrc('end_turn')} hot={actionTaken && movementRemaining <= 0}` |
| every Back | no icon |

The sub-mode buttons (`ability-btn`, `combat-item-btn`) stay plain `<button>`s in phase 1; their tooltips depend on the existing markup.

`hot` on End Turn is the "current action" cue: it lights up once there's nothing left to do this turn. Selected sub-modes (move, target) are already shown by the prompt text that replaces the button row.

- [ ] **Step 5: Append the arena CSS to `relic.css`:**

```css
/* === Phase 1 screens: arena === */
.arena-view { gap: 4px; background: transparent; }
.arena-turn-order { font-family: inherit; flex-wrap: wrap; gap: 10px; padding: 4px 10px; border-bottom: none; }
.turn-unit { display: inline-flex; align-items: center; gap: 4px; }
.turn-unit .turn-name { font-size: 11px; }
.turn-unit.turn-active .turn-name { color: var(--relic-amber-hot); }
.arena-screen { flex: 1; }
.arena-screen .arena-main { flex: 1; min-height: 0; }
/* The bezel costs the grid 48px of width; the unit panel gives it back (200px -> 152px). */
.arena-screen .arena-unit-panel { width: 152px; border-left: 1px dashed var(--relic-divider); padding: 6px 8px; }
.arena-action-bar {
  font-family: inherit; flex-wrap: wrap; border-top: none;
  background: linear-gradient(#2a1c10, #1a120a);
  box-shadow: inset 0 2px 0 var(--relic-bronze-hi), 0 0 0 1px var(--relic-bronze);
}
```

- [ ] **Step 6: Typecheck, drive and measure**

Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."`. Expected: exit 0.

With the dev servers running:

```bash
cmd.exe /c "node scripts/sandbox-drive.mjs duel --base http://localhost:<port> --wait my-turn --shot task9-combat --attack-nearest --end-turn 2 --shot task9-after --out .sandbox/ui-revamp"
cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:<port>"
```

Expected:
- the driver exits 0, which proves `.arena-btn-attack` and `.arena-btn-end` still work;
- the arena size equals the Task 5 baseline.

If the columns dropped, reduce `.arena-unit-panel` width further, or trim `.arena-turn-order` padding for rows, until they match. Record what you changed.

- [ ] **Step 7: Commit**

```bash
git.exe add client/src/components/ArenaView.tsx client/src/components/TurnOrderBar.tsx client/src/components/ArenaUnitPanel.tsx client/src/components/ArenaActionBar.tsx client/src/styles/relic.css
git.exe commit -m "Move arena combat onto relic kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Legacy CombatView picks up kit buttons

**Files:**
- Modify: `client/src/components/CombatView.tsx:288-381` (button elements only)

**Interfaces:**
- Consumes: `RelicButton` (Task 6); `actionIconSrc` (Task 5).

- [ ] **Step 1: Swap the buttons.** Add `import { RelicButton } from './relic/index.js';` and `import { actionIconSrc } from '../ui/iconPaths.js';`, then replace:

| Current | Becomes |
|---|---|
| `<button onClick={() => setActionState({ mode: 'target', afterSelect: 'attack' })}>Attack</button>` | `<RelicButton icon={actionIconSrc('attack')} onClick={...same...}>Attack</RelicButton>` |
| `<button onClick={handleDefend}>Defend</button>` | `<RelicButton icon={actionIconSrc('defend')} onClick={handleDefend}>Defend</RelicButton>` |
| `<button onClick={() => setActionState({ mode: 'items' })}>Items</button>` | `<RelicButton icon={actionIconSrc('items')} onClick={...same...}>Items</RelicButton>` |
| `<button onClick={() => setActionState({ mode: 'flee' })}>Flee</button>` | `<RelicButton icon={actionIconSrc('flee')} onClick={...same...}>Flee</RelicButton>` |
| `<button key={ally.id} className="revive-btn" ...>` | `<RelicButton key={ally.id} className="revive-btn" ...>`, same children |
| each `<button className="back-btn" ...>Back</button>` | `<RelicButton className="back-btn" ...>Back</RelicButton>` |
| each flee-direction `<button key={dir} ...>` | `<RelicButton key={dir} ...>`, same children |

Leave `ability-btn`, `effect-btn` and `combat-item-btn` untouched.

- [ ] **Step 2: Typecheck**

Run: `cmd.exe /c "cd client && npx tsc --noEmit -p ."`. Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git.exe add client/src/components/CombatView.tsx
git.exe commit -m "Use relic buttons in legacy combat view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification

**Files:** none (verification only; fix-ups go into the owning task's files with their own commit)

- [ ] **Step 1: Full test and type pass**

Run:

```bash
cmd.exe /c "npm run build --workspace=shared && npm run build --workspace=itemgen && npm test && cd client && npx tsc --noEmit -p . && cd ../server && npx tsc --noEmit -p ."
```

Expected: every workspace passes, with no type errors.

- [ ] **Step 2: Arena size matches the baseline**

Baseline from Task 5 Step 1: `{cols: 28, rows: 8}` (recorded 2026-09-27 at 1600×1000, preset `duel`).

Run: `cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:<port>"`
Expected: identical to the baseline.

- [ ] **Step 3: Before/after for the user.** Put `.sandbox/ui-revamp/before-combat.png` and `task9-combat.png` side by side, plus the Task 8 exploration screenshot. Use the brainstorm companion if it's running; otherwise read them with the Read tool and send them to the user.

Check against the approved A1 mockup:
- a bezel on each screen, with a subtle green edge;
- amber text;
- bronze buttons with icons;
- item sockets with rarity rings;
- segmented gauges;
- CRT scanlines and flicker unchanged.

- [ ] **Step 4: Frame-fallback smoke test.** Temporarily rename `client/public/ui/relic_frame.png`, reload, and confirm the panels show the bronze double-border and nothing breaks. Then rename it back; `git.exe status client/public/ui` must be clean.

- [ ] **Step 5: Record memory.** Use `mcp__thinker__memory_store` for anything non-obvious learned during implementation, for example which frame border mode (`round` or `stretch`) looked right, or arena-size adjustments.
