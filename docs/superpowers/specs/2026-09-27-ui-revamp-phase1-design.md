# UI Revamp — Phase 1: Relic Kit + In-Dungeon Screens

**Date:** 2026-09-27
**Branch:** `feature/ui-revamp`
**Status:** Design approved, pending spec review

## Intent

Make Caverns' UI fit its Qud-style relic-tech, retro-future art direction, using PixelLab-generated art. Today the in-game UI is a plain HTML terminal (1px borders, flat bars, text-only coloured buttons) and the CRT overlay does most of the atmospheric work.

The chosen direction ("A1", picked from PixelLab mockups in `art/mockups/ui-revamp/`) keeps the **amber CRT text as the game's voice** and frames it with **salvaged hardware**:
- pixel-art gunmetal bezels around each screen, with a subtle green phosphor glow at the inner edge;
- riveted bronze push-buttons with pixel icons;
- recessed icon sockets and segmented gauges.

It must read as "a salvaged machine you're operating", not as a painted pixel-art game UI. A fully painted UI (direction C) was rejected because it doesn't reflow and pulls away from the text-terminal identity.

**Success looks like:**
- The in-dungeon screens (exploration, arena combat, side column) use the kit consistently.
- Every item and action shows a fitting icon.
- The CRT effects are unchanged.
- No map or arena cells are lost at 1600×1000.
- Later phases (town, world map, login) can reuse the kit without new infrastructure.

## Rollout

| Phase | Scope |
|---|---|
| **1 (this spec)** | Relic kit, item/action icons, in-dungeon screens |
| 2 | Town: `TownView`, `ShopModal`, `StashModal`, `CharacterModal` |
| 3 | `LoginScreen`, `CharacterSelect`, `WorldView`/`WorldMapView` |

Phases 2 and 3 get their own specs.

## 1. The relic kit

### Tokens

`client/src/styles/relic.css` defines a `:root` token block:
- bezel bronze and gunmetal;
- amber text and dim amber;
- teal accent;
- HP red;
- `--screen-glow` (the A1 green, roughly `rgba(70,190,110,.18)`);
- the rarity colours, taken from the existing `.rarity-*` classes in `index.css`: common `#c8b89a`, uncommon `#8888ff`, rare `#ffee77`, legendary `#af6025`, unique `#ff44ff`.

Kit code uses only these tokens. Existing `index.css` rules are left alone except where a phase-1 component is migrated. There is no global recolour.

### Components (`client/src/components/relic/`)

**`RelicPanel`**
- Props: `title?`, `glow?` (default `true`), `className?`, `children`.
- Border: `border-image: url(/ui/relic_frame.png) 24 / 24px stretch`, with `image-rendering: pixelated`. It is always drawn at 1× so the pixels stay crisp.
- Inside: a dark screen background (`background-clip: padding-box`).
- An absolutely positioned `.relic-glow` overlay draws the A1 green: an inset box-shadow plus a faint radial gradient toward the edges. It is static, with no animation.
- `title` is an amber small-caps label set into the top rail.

**`RelicButton`**
- Props: `icon?`, `hot?`, `disabled?`, plus the usual button props.
- CSS-bevelled bronze: an inset highlight and shadow, with a dark outline and a bronze outer ring.
- States:
  - hover: brighter rim;
  - pressed: bevel inverted;
  - disabled: dimmed, no glow;
  - `hot`: lit amber rim and a soft outer glow, used for the selected mode or current action.
- The icon is 24px, `alt=""`. The text label is always present.

**`Gauge`**
- Props: `value`, `max`, `kind: 'hp' | 'xp' | 'resource'`, `label?`.
- A segmented fill (repeating 6px segments with 2px gaps) with a centred readout.
- It keeps today's HP colour shift as HP drops. The segment and colour maths live in a pure helper, `gaugeStyle(value, max, kind)`.

**`IconSocket`**
- Props: `size: 24 | 32`, `rarity?`, `children`.
- A recessed square with a bronze ring. `rarity` recolours the ring.
- When empty, it shows a dim slot glyph.

**`ItemIcon`**
- Props: `item`.
- Resolves `archetypeFor(item)` to `/ui/icons/items/<archetype>.png` and renders it inside the socket.
- If the image fails to load, it swaps to the slot glyph.

### Unchanged

- The global `.crt-overlay`: scanlines at full strength and aggressive flicker, per standing preference.
- The amber phosphor text-shadow.
- ASCII and tile rendering (`TileGridView`), the glyph sprites and the `MiniMap` SVG.

### Assets

- `client/public/ui/relic_frame.png`: the 256×160 PixelLab gunmetal bezel with a hollow centre. It is a copy of `art/mockups/ui-revamp/relic_frame.png`.
- `client/public/ui/icons/items/*.png`: 32×32.
- `client/public/ui/icons/actions/*.png`: 24×24.

## 2. Icons

### Item archetypes

`shared/src/itemArchetypes.ts` exports an `ItemArchetype` union, a keyword table and `archetypeFor(item)`. There are 23 archetypes (`ranged` was added during planning):

| Slot | Archetype | Base types / names mapped to it |
|---|---|---|
| weapon | `blade` | sword, blade, cutlass, rib blade, shard blade, ember blade, coral blade, crystal sword, volcanic sword, deathbone sword |
| weapon | `dagger` | dagger, quartz dagger, obsidian dagger |
| weapon | `blunt` | mace, maul, club, hammer, flail, bone club, femur flail, skull maul, geode maul, slag hammer, inferno maul, driftwood club |
| weapon | `axe` | axe, war axe, cleaver, lattice axe, ossified axe, sea axe |
| weapon | `polearm` | spear, lance, harpoon, trident, marrow spear, prism lance, facet spear, magma spear, brine lance, abyssal spear |
| weapon | `staff` | staff, vertebrae staff, resonance staff |
| weapon | `ranged` | crossbow, bow (Artificer's Repeating Crossbow) |
| offhand | `shield` | shield, buckler, ward, round/kite/tower shield, shell shield, and so on; parrying dagger maps to `dagger` |
| offhand | `focus` | orb, focus, lantern, prism focus, brine focus, forge-heart focus |
| offhand | `tome` | tome, marrow tome, shard tome |
| armor | `armor_light` | wrap, vest, tunic, gambeson, weave, mantle |
| armor | `armor_medium` | mail, hauberk, brigandine, scale |
| armor | `armor_heavy` | plate, cuirass |
| accessory | `ring` | ring, band, earring |
| accessory | `amulet` | amulet, pendant, necklace, talisman |
| accessory | `charm` | charm, brooch |
| accessory | `circlet` | circlet, bracelet |
| consumable | `potion` | Minor Health Potion, Health Potion |
| consumable | `potion_greater` | Greater Health Potion |
| consumable | `bandage` | Leather Scrap Bandage |
| consumable | `elixir` | Fungal Elixir |
| consumable | `bomb` | Volatile Spore Pod |
| consumable | `consumable_misc` | fallback for any other consumable |

The exact keyword lists are the implementation's job. Tests (section 4) pin every biome base type to an archetype.

**Resolution order in `archetypeFor(item)`:**
1. `item.archetype`, if it is a known `ItemArchetype`.
2. Keyword match on `item.name`, longest keyword first, so "war axe" wins over "axe".
3. The slot default: `blade`, `shield`, `armor_light`, `amulet`, `consumable_misc`.

This handles items already saved on characters without a migration.

### Data changes

- `shared/src/types.ts`: `Item` gains `archetype?: ItemArchetype`.
- `itemgen`: set `archetype` from the rolled base type.
  - `generateName` returns the base type it picked, alongside the name.
  - Legendary names don't contain a base type, so legendaries use the base type the description already rolls.
  - **The order of `rng()` calls must not change**, so seeded output stays identical apart from the new field.
- `shared/src/content.ts`: every hand-authored equipment and consumable item gets an explicit `archetype`.
- The server needs no changes: items travel as-is in existing messages.

### Action icons (7)

`move`, `attack`, `defend`, `abilities`, `items`, `flee`, `end_turn`.

Per-ability icons are out of scope for phase 1.

### Generation pipeline

- **Tool:** PixelLab `create_image_pro`, one call per icon. Item icons are 32×32 and action icons 24×24. Each call returns 64 candidates.
- **Style reference:** a portrait from `client/public/portraits/` via its public raw GitHub URL. Use `junk_prophet` for relic items, `templar` for armour and shields, `suturist` for consumables.
- **Prompt template:** `inventory item icon: <subject>, <materials>, strange retro-future relic, centered, dark outline`. Action icons use `game action icon: <subject>, bold simple silhouette, dark outline`.
- **Selection:**
  - I build contact sheets and pick the best candidate for each icon.
  - The user approves one final sheet of all 30 icons before anything is copied into `client/public/ui/icons/`.
- **Record:** `art/ui-icons/chosen.json` stores each icon's prompt, style reference, job id and chosen index, so any icon can be regenerated. Raw candidates and contact sheets go in `art/ui-icons/raw/`.
- **Budget:** about 600 generations (30 calls × 20) plus rerolls. 3,643 were available when this spec was written; the allowance resets 2026-10-23.
- **Reusing mockup picks:** the mockup picks in `art/mockups/ui-revamp/raw/` (`blade_2`, `tonic_1`, `armor_10`, `amulet_9`, `attack_7`, `defend_12`, `flee_14`) may be reused where they fit an archetype.

## 3. In-dungeon screens

Scope: everything under the `in_dungeon` layout in `App.tsx`.

### Main column

**Exploration**
- `Compass` and `RoomView` go in one `RelicPanel` with the glow.
- `TextLog` and `ChatInput` go in a second `RelicPanel`.

**Arena combat**
- `ArenaView`'s grid goes in one `RelicPanel`.
- `TurnOrderBar`: a row of 24px `IconSocket`s holding the existing glyph sprites. The active unit gets the `hot` rim.
- `ArenaUnitPanel`: each unit's HP becomes a `Gauge`.

**Action bars** (`ActionBar`, `ArenaActionBar`)
- A bronze console strip below the screen. It is not a bezel: it is a flat bronze rail with a dark outline.
- Every button is a `RelicButton` with its action icon. The selected mode (move, attack, targeting, abilities, items) uses `hot`.
- The per-action colour borders (green Move, red Attack, blue Defend) are removed.
- The loot prompt shows the item as an `ItemIcon` (with rarity ring), its name in its rarity colour, and need/greed/pass as `RelicButton`s.

### Side column

The side column is three stacked `RelicPanel`s.

**`MiniMap`**
- The SVG is unchanged inside the bezel.

**`PartyPanel`**
- Each member has a 24px portrait socket, their name, and an HP `Gauge`.

**`PlayerHUD`**, laid out like the approved mockup:
- A recessed portrait well, then name, class, level and gold.
- HP, XP and class-resource `Gauge`s.
- Equipment rows: an `IconSocket` with the `ItemIcon`, then the name and stats. Empty slots show a dim glyph.
- Consumable pouch and inventory rows follow the same pattern.
- Equip, drop and use controls become small `RelicButton`s.

### Layout rules

- **Bezels never nest.** Anything inside a `RelicPanel` uses sockets, rails or dashed dividers, never another bezel.
- **Space.** The side column may widen, and the gaps between panels shrink, to absorb the 24px bezel. At a 1600×1000 viewport, the arena and room grids must show the same number of cells as before; the before/after screenshots in section 4 check this.

### Out of scope for phase 1

- **`CombatView`** (the legacy non-grid combat): it picks up shared kit pieces only (buttons, gauges), with no layout rework.
- `DebugPanel`, `SandboxBar`, `MusicPlayer`, `IntroCutscene` and `CombatIntro`.
- Everything outside `in_dungeon` (phases 2 and 3).

## 4. Error handling and testing

### Error handling

- `ItemIcon`: a failed image load swaps to the slot glyph, so no broken image is ever shown.
- `archetypeFor`: an unknown `archetype` string is ignored and resolution falls through to keyword matching, then the slot default.
- `RelicPanel`: if `relic_frame.png` fails to load, the panel shows a bronze CSS double-border fallback.
- Accessibility: every button keeps its text label, and icons are decorative (`alt=""`).
- Performance: one static glow overlay per panel and no new animations. The CRT overlay is untouched.

### Tests (Vitest, test-first)

**shared** — `archetypeFor`:
- an explicit archetype;
- keyword matches covering every base type in every biome palette;
- the longest keyword wins ("war axe" gives `axe`, "parrying dagger" gives `dagger`);
- legendary-style names with no keyword fall back to the slot default;
- an unknown archetype falls through.

A content test asserts that every hand-authored item in `content.ts` has a valid `archetype`.

**itemgen:**
- Every generated item has an `archetype` that is valid for its slot. `dagger` is also valid for offhand, to cover the parrying dagger.
- The existing seeded tests pass unchanged, which proves the rng order is preserved.

**client:**
- Unit tests for `gaugeStyle` and for the icon-path lookup.
- The kit components are presentational and are not unit-tested, which matches the rest of the client.

**Visual check:**
- Take `scripts/sandbox-drive.mjs` screenshots at 1600×1000 of combat on `duel` before and after, and check the visible arena cell count matches.
- Also screenshot an exploration view.
- The user reviews the screenshots.

**Done when:**
- `npm test` passes in all workspaces;
- `tsc --noEmit` passes for `client`, `shared`, `itemgen` and `server`;
- the screenshots have been reviewed.

## Decisions log

- **Direction A1** (relic chrome with a subtle green edge glow) was chosen over B (icons only) and C (full painted pixel UI).
- **Kit approach:** CSS-drawn chrome around PixelLab art, rather than per-state sprite buttons. Generated buttons were weak, and CSS handles button states and reflow for free.
- **Icons per archetype** (23), not per slot and not per biome tint.
- **Rollout:** kit plus in-dungeon screens first; town next; menus and the world map last.
