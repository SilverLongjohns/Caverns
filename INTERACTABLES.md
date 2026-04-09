# Interactables System — Design Document

## Overview

Interactables are examinable objects placed in dungeon rooms that reward players for exploring thoroughly rather than rushing between encounters. They appear in the ASCII room view after combat is resolved (or immediately in rooms with no encounter) and give players a reason to linger in every room.

### Design Goals

- Make every room feel like a place, not a node on a graph
- Reward slow, attentive play with loot, intel, and secrets
- Create natural communication moments in multiplayer ("what'd you find?")
- Reinforce biome identity through object flavor and behavior
- Give each class a unique reason to scout

### Core Flow

1. Player enters room
2. If encounter exists → combat screen takes over → combat resolves
3. Player returns to ASCII exploration view
4. Room renders with interactable objects visible (amber-highlighted in ASCII grid)
5. Player selects an interactable → clicks examine
6. Server rolls an outcome → sends narration + mechanical result
7. Interactable is marked examined (dimmed/struck-through) for all players in the room
8. Only the examining player receives the narration and outcome
9. Other players in the room see the object state change but must ask what was found

---

## Data Architecture

### Interactable Slot System

Room chits define **slots** — positions where interactables can be placed. During dungeon generation, slots are filled from biome-specific interactable pools.

```typescript
// Added to existing RoomChit type in shared/src/data/
interface InteractableSlot {
  position: { x: number; y: number };  // grid coordinates in ASCII template
  size: "small" | "medium" | "large";
}

// Room chit extension
interface RoomChit {
  // ...existing fields
  interactableSlots: InteractableSlot[];
}
```

**Slot counts by room type:**

| Room Type  | Slot Count | Typical Sizes            |
|------------|------------|--------------------------|
| dead_end   | 1          | 1 medium                 |
| tunnel     | 1-2        | 1-2 small                |
| chamber    | 2-3        | 1 medium, 1-2 small      |
| cavern     | 2-4        | 1 large, 1-2 medium, 0-1 small |

**Not every room gets interactables.** Target 60-70% of rooms having objects. Empty rooms should exist so players can never assume a room has something — the uncertainty drives examination behavior.

### Interactable Definition

```typescript
interface InteractableDefinition {
  id: string;                          // "fungal_glowing_cluster"
  name: string;                        // "Glowing cluster"
  asciiChar: string;                   // "♧"
  biomes: string[];                    // ["fungal_depths"]
  slotSize: "small" | "medium" | "large";
  requiredClass?: string;              // only this class can interact (null = anyone)
  bonusClass?: string;                 // this class gets improved outcomes
  ambientText: string;                 // woven into room narration on entry
  outcomes: OutcomeTable;
}
```

### Interactable Instance (Runtime)

```typescript
interface InteractableInstance {
  definitionId: string;
  instanceId: string;                  // unique per room, e.g. "int_001"
  position: { x: number; y: number };
  examined: boolean;
  examinedBy?: string;                 // playerId who examined it
}
```

### Room State Extension

```typescript
interface RoomState {
  // ...existing fields
  interactables: InteractableInstance[];
}
```

---

## Outcome System

Each interactable has a weighted outcome table rolled server-side when a player examines it.

### Outcome Types

```typescript
type OutcomeType = "loot" | "hazard" | "intel" | "secret" | "flavor";

interface OutcomeTable {
  weights: Record<OutcomeType, number>;       // relative weights
  bonusClassWeights?: Record<OutcomeType, number>;  // used when bonusClass matches
  outcomes: Record<OutcomeType, OutcomeData>;
}

interface OutcomeData {
  narration: string;                   // rich text shown to the examining player
  // Type-specific payloads:
  loot?: LootOutcome;
  hazard?: HazardOutcome;
  intel?: IntelOutcome;
  secret?: SecretOutcome;
}
```

### Outcome Type Breakdown

#### Loot (default weight: 40)

A consumable, gold, or equipment piece drawn from the biome's existing loot table at a rarity tier appropriate to zone depth. Generally slightly worse than mob drops — this is free loot with no risk.

```typescript
interface LootOutcome {
  source: "biome_table";               // uses existing biome loot weighting
  rarityModifier: number;              // -1 = one tier worse than mob drops, 0 = same
}
```

**Example narration:** *"You kneel beside the cluster. Most are ordinary cave fungi, but one cap shimmers with an oily iridescence. It breaks free easily — a **Luminous Spore Cap**. Useful for brewing, or as a dim light source."*

#### Hazard (default weight: 15)

A small trap or negative effect. Never lethal. Annoying enough to create tension on subsequent examinations but not punishing enough to discourage interaction entirely.

```typescript
interface HazardOutcome {
  type: "damage" | "debuff" | "mob_spawn";
  damage?: number;                     // 5-15 range, scaled by zone
  debuff?: {
    stat: string;                      // "defense" | "initiative" | etc.
    amount: number;
    duration: "combat" | "zone";       // next combat only, or rest of zone
  };
  mobSpawn?: string;                   // mob pool ID — spawns a weak mob
}
```

**Example narration:** *"You pry open the sarcophagus lid. A cloud of ancient dust erupts — something caustic burns your throat. You stagger back coughing. **-8 HP.** The dust settles, revealing nothing of value."*

#### Intel (default weight: 15)

Information about adjacent rooms. Reveals mob presence, encounter difficulty, or environmental conditions in connected rooms. This is the primary mechanical reward for solo scouts — they bring actionable information back to the party.

```typescript
interface IntelOutcome {
  targetRoomId: string;                // an adjacent connected room
  revealType: "mob_presence" | "mob_difficulty" | "environment" | "loot_hint";
  text: string;                        // what the player learns
}
```

**Example narration:** *"Deep parallel gouges in the stone. Fresh. Whatever made these had four claws and was moving fast — toward the northern exit. The scratches get deeper as they go."*

The examining player receives a minimap annotation or text log entry about the adjacent room. This intel is private to them — they choose whether to share it with the party.

#### Secret (default weight: 10)

Reveals a hidden exit leading to a bonus room. The bonus room is generated during dungeon generation as an offshoot, accessible only through this interactable. Bonus rooms have the best loot density in the dungeon but are never on the critical path.

```typescript
interface SecretOutcome {
  hiddenExitDirection: string;         // "A submerged archway to the west"
  bonusRoomId: string;                 // pre-generated during dungeon gen
}
```

**Example narration:** *"A current pulls at your legs — flowing toward the western wall where there shouldn't be an outlet. You feel along the wall underwater and find a submerged archway. The water beyond is warmer. A **hidden passage**."*

When a secret is discovered, the hidden exit appears on the ASCII room display and minimap for all players. The bonus room connects bidirectionally.

#### Flavor (default weight: 15 — but see note)

Pure atmosphere. Lore fragments, environmental storytelling, unsettling moments. No mechanical reward.

```typescript
// No payload — narration carries the full weight
```

**Example narration:** *"The bones are arranged in a deliberate spiral pattern. Not random — someone or something placed these with care. You count the skulls. There are seven. You count again. Eight."*

**Important:** Flavor outcomes must be written well enough that players don't feel cheated. A flavor result that makes someone say "that's creepy" to their party over voice chat is doing its job. If flavor text feels like a waste of time, the writing needs to be better, not the system.

**Note on weights:** The default weights (40/15/15/10/15) are starting points. Tune per-biome — Ossuary Halls might skew toward flavor and hazard (creepy atmosphere, trapped tombs), while Crystal Caverns skews toward loot and secret (valuable minerals, hidden geodes).

### Class Bonus Mechanic

When the examining player's class matches an interactable's `bonusClass`, the outcome table shifts to `bonusClassWeights`. Typical shift: reduce hazard weight to near-zero, increase loot and intel weights.

| Class   | Bonus On                      | Effect                                      |
|---------|-------------------------------|----------------------------------------------|
| Rogue   | Locked/trapped objects        | Skips hazards, finds better loot             |
| Cleric  | Bones, altars, cursed objects | Gets lore (intel) instead of flavor          |
| Ranger  | Tracks, natural features      | Gets intel about adjacent rooms reliably     |
| Fighter | Structural objects (rubble, doors, walls) | Can break through to secrets   |

When `requiredClass` is set, only that class can interact at all. Use sparingly — mostly for dramatic moments like a Fighter smashing through a collapsed wall or a Rogue picking a lock that's clearly beyond anyone else.

---

## Message Protocol

### New Message Types

**Client → Server:**

```typescript
interface ExamineMessage {
  type: "examine";
  interactableId: string;              // instanceId from room state
}
```

**Server → Client (to examining player):**

```typescript
interface ExamineResultMessage {
  type: "examine_result";
  interactableId: string;
  narration: string;                   // rich text, may contain highlighted item names
  outcome: {
    type: OutcomeType;
    loot?: Item;                       // item added to inventory
    damage?: number;                   // HP lost
    debuff?: Debuff;                   // debuff applied
    intel?: {
      targetRoomId: string;
      text: string;
    };
    secret?: {
      exitDirection: string;
      roomId: string;
    };
  };
}
```

**Server → Client (broadcast to all players in room):**

```typescript
interface InteractableStateMessage {
  type: "interactable_state";
  interactableId: string;
  examined: boolean;
  examinedBy: string;                  // playerId
}
```

The broadcast tells other players the object was examined and by whom, but does NOT include the narration or outcome. This is intentional — it forces verbal communication in multiplayer.

---

## ASCII Room Display

### Room Templates

Each room type has a base ASCII template defining walls, exits, and floor area. Interactable slots are placed within the floor area at predefined positions that don't overlap walls or exit tiles.

```
Room Type: dead_end (30x8, 1 exit)
╔════════════════════════════╗
║ . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , ║
║ . , . ` . , . ' . , . ` . ║
║ , . ' .     . ` . , . ' . ║
║ . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , ║
╚═══════════   ══════════════╝
                ^ exit south

Room Type: tunnel (40x6, 2 exits)
╔══════════════════════════════════════╗
║ . , . ` . , . ' . , . ` . , . ' . ,║
  , . ' . , . ` . , . ' . , . ` . , .
  . , . ` . , . ' . , . ` . , . ' . ,║
║ , . ' . , . ` . , . ' . , . ` . , .
║ . , . ` . , . ' . , . ` . , . ' . ,║
╚══════════════════════════════════════╝
^ exit west                   exit east ^

Room Type: chamber (44x12, 2-3 exits)
╔══════════════════   ═══════════════════════╗
║ . , . ` . , . ' . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , ║
║ . , . ` . , . ' . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , ║
  . , . ` . , . ' . , . ` . , . ' . , . ` .
  , . ' . , . ` . , . ' . , . ` . , . ' . ,  
║ . , . ` . , . ' . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , ║
║ . , . ` . , . ' . , . ` . , . ' . , . ` . ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , ║
╚══════════════════   ═══════════════════════╝

Room Type: cavern (50x14, 2-4 exits, irregular walls)
  ╔═════════════════════   ══════════════════════════╗
 ║ . , . ` . , . ' . , . ` . , . ' . , . ` . , . '  ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , .║
║ . , . ` . , . ' . , . ` . , . ' . , . ` . , . ' . , ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , . ║
  . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , . '
  , . ` . , . ' . , . ` . , . ' . , . ` . , . ' . , .
║ . , . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , ║
║ , . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , .║
║ . , . ` . , . ' . , . ` . , . ' . , . ` . , . ' . ,║
 ║ , . ' . , . ` . , . ' . , . ` . , . ' . , . ` . , ║
  ║ . , . ` . , . ' . , . ` . , . ' . , . ` . , . ' ║
   ╚══════════════════   ═══════════════════════════╝
```

### Floor Characters by Biome

| Biome             | Characters        | Notes                              |
|-------------------|-------------------|------------------------------------|
| Shallow Warrens   | `. , ; :`         | Dry, gritty                        |
| Fungal Depths     | `. , \` '`        | Organic, soft                      |
| Crystal Caverns   | `. , * +`         | Occasional sparkle characters      |
| Drowned Passages  | `. ~ , \``        | 30-40% of floor tiles are `~` water |
| Ossuary Halls     | `. , ; :`         | Same as warrens but with bone scatter |
| Magma Rifts       | `. , ^ ~`         | `~` here represents magma, `^` is cooled rock |

### Interactable Display

- Interactable characters render in amber (`#ffaa33`) against the dim green/biome-colored floor
- Hovering an interactable (or selecting its tag) brightens it and adds a subtle glow
- Examined interactables dim and their tag gets struck through
- The player character `@` renders in cyan (`#44dddd`)
- Walls render in faint green, exits in bright green

### Room Revisit State

When a player re-enters a previously explored room:
- Already-examined interactables show as dimmed
- Floor may have changed if combat occurred (scattered debris characters)
- Any discovered secret exits are visible
- New interactables do NOT spawn — the room is static after initial generation

---

## Dungeon Generation Integration

### Interactable Placement During Generation

Interactable placement happens as a post-processing step after room layout, mob assignment, and loot distribution are complete.

```
For each room in the dungeon:
  1. Roll against density threshold (60-70%) — skip if room gets no interactables
  2. Get the room chit's interactableSlots
  3. For each slot:
     a. Query the biome's interactable pool for matching slotSize
     b. Weighted-random select a definition (avoid duplicates within same room)
     c. Create an InteractableInstance with the slot's position
     d. If outcome type is "secret", generate a bonus room:
        - Create a small dead_end room as an offshoot
        - Connect it to this room via a hidden exit (not visible until discovered)
        - Populate with loot from biome table at +1 rarity tier
  4. Attach the InteractableInstance array to the room state
```

### Bonus Room Generation (Secrets)

Not every interactable with a possible "secret" outcome will roll secret at examine time. But the bonus room needs to exist in the dungeon graph at generation time in case it does. This means:

- At generation, identify which interactables have secret in their outcome table
- Pre-generate a bonus room for each one
- If the player examines and rolls a non-secret outcome, the bonus room is simply never revealed
- This wastes a small amount of generation work but keeps the system stateless at examine time

Alternatively, only generate a set number of potential secret rooms per zone (e.g., 1-2) and assign them to specific interactables during placement. This caps the bonus room count and is more predictable.

### Validation Additions

Add to the existing post-generation validation:
- Interactable count per room is within bounds for room type
- No interactable positions overlap each other or wall/exit tiles
- Bonus rooms (if any) are connected to exactly one parent room via hidden exit
- No duplicate interactable definitions within the same room

---

## Biome Interactable Pools

Each biome needs ~15 interactable definitions. Below is the complete pool for Fungal Depths as a reference template, followed by starter lists for the other five biomes.

### Fungal Depths (complete reference pool)

| ID | Name | Char | Size | Bonus Class | Theme |
|----|------|------|------|-------------|-------|
| `fungal_glowing_cluster` | Glowing cluster | ♧ | small | Cleric | Bioluminescent fungi, possible reagent |
| `fungal_spore_vent` | Spore vent | ○ | medium | Ranger | Pressurized vent, hazard risk |
| `fungal_mycelium_corpse` | Overgrown remains | ¤ | medium | Cleric | Body consumed by fungus, loot on corpse |
| `fungal_hollow_stump` | Hollow stump | Ω | large | Rogue | Petrified tree stump, hidden cache |
| `fungal_dripping_cap` | Dripping cap | ♠ | small | — | Large mushroom dripping fluid |
| `fungal_web_sac` | Silk cocoon | § | medium | Fighter | Spider egg sac or prey cocoon |
| `fungal_mossy_pool` | Still pool | ≈ | large | Ranger | Dark water, something beneath surface |
| `fungal_puffball_ring` | Puffball ring | ◊ | small | — | Fairy ring of puffball fungi |
| `fungal_root_tangle` | Root tangle | ∞ | medium | Rogue | Tangled roots concealing objects |
| `fungal_bark_face` | Bark face | ☺ | small | Cleric | Pareidolia or something watching |
| `fungal_rotting_crate` | Rotting crate | ■ | medium | Rogue | Abandoned supplies, partially decayed |
| `fungal_crystal_node` | Embedded crystal | ◆ | small | Fighter | Crystal growing through fungal matter |
| `fungal_burrow` | Animal burrow | ∪ | small | Ranger | Something lives here, tracks visible |
| `fungal_altar_stump` | Carved stump | † | large | Cleric | Ritualistic markings, offering bowl |
| `fungal_hanging_vines` | Curtain of vines | ║ | medium | — | Thick vine curtain, may conceal passage |

### Shallow Warrens (starter list)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `warrens_rubble_pile` | Rubble pile | ▲ | medium | Fighter |
| `warrens_scratched_wall` | Scratched wall | × | small | Ranger |
| `warrens_abandoned_camp` | Abandoned camp | Δ | large | Rogue |
| `warrens_dripping_crack` | Dripping crack | │ | small | — |
| `warrens_rat_nest` | Rat nest | ~ | medium | Ranger |
| `warrens_collapsed_shelf` | Collapsed shelf | ═ | medium | Fighter |
| `warrens_old_torch` | Burnt-out torch | ! | small | — |
| `warrens_loose_stones` | Loose stones | ∙ | small | Rogue |
| `warrens_tool_cache` | Rusted tools | ¥ | medium | Fighter |
| `warrens_carved_marks` | Carved tally marks | # | small | Cleric |
| `warrens_shallow_pit` | Shallow pit | ∩ | large | Ranger |
| `warrens_broken_door` | Broken door | ╫ | medium | Fighter |
| `warrens_discarded_pack` | Discarded pack | □ | medium | Rogue |
| `warrens_mushroom_patch` | Pale mushrooms | , | small | Cleric |
| `warrens_seeping_wall` | Seeping wall | │ | small | — |

### Crystal Caverns (starter list)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `crystal_geode` | Cracked geode | ◆ | medium | Fighter |
| `crystal_vein` | Exposed vein | / | small | — |
| `crystal_formation` | Crystal formation | ▲ | large | Cleric |
| `crystal_reflecting_pool` | Reflecting pool | ≈ | medium | Cleric |
| `crystal_frozen_figure` | Frozen figure | ☺ | medium | Cleric |
| `crystal_resonant_pillar` | Humming pillar | ║ | large | Ranger |
| `crystal_sharp_outcrop` | Sharp outcrop | * | small | — |
| `crystal_hollow_node` | Hollow node | ○ | medium | Rogue |
| `crystal_fractured_floor` | Fractured floor | # | large | Rogue |
| `crystal_light_refraction` | Refracted light | + | small | — |
| `crystal_encased_bones` | Encased remains | ¤ | medium | Cleric |
| `crystal_dust_deposit` | Mineral dust | . | small | Ranger |
| `crystal_singing_shard` | Singing shard | ♪ | small | — |
| `crystal_growth_cluster` | Growth cluster | § | medium | Fighter |
| `crystal_mirror_surface` | Mirror surface | = | large | — |

### Drowned Passages (starter list)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `drowned_submerged_chest` | Submerged chest | ■ | medium | Rogue |
| `drowned_cracked_column` | Cracked column | ║ | large | Fighter |
| `drowned_waterlogged_journal` | Waterlogged journal | □ | small | Cleric |
| `drowned_strange_current` | Strange current | ≈ | medium | Ranger |
| `drowned_barnacle_cluster` | Barnacle cluster | ∙ | small | — |
| `drowned_flooded_alcove` | Flooded alcove | ∩ | medium | Rogue |
| `drowned_anchor_chain` | Rusted chain | % | medium | Fighter |
| `drowned_fish_bones` | Fish bones | ~ | small | — |
| `drowned_statue_base` | Statue base | Ω | large | Cleric |
| `drowned_air_pocket` | Air pocket | ○ | small | — |
| `drowned_waterfall_niche` | Behind the falls | │ | large | Ranger |
| `drowned_floating_debris` | Floating debris | ≈ | small | Ranger |
| `drowned_corroded_gate` | Corroded gate | ╫ | medium | Fighter |
| `drowned_shell_mound` | Shell mound | Δ | medium | — |
| `drowned_tide_mark` | Strange tide mark | - | small | Ranger |

### Ossuary Halls (starter list)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `ossuary_sealed_niche` | Sealed niche | ¶ | medium | Fighter |
| `ossuary_bone_pile` | Bone pile | ¤ | medium | Cleric |
| `ossuary_sarcophagus` | Sarcophagus | ■ | large | Cleric |
| `ossuary_claw_marks` | Claw marks | × | small | Ranger |
| `ossuary_cracked_urn` | Cracked urn | ∪ | small | — |
| `ossuary_warding_circle` | Warding circle | ◊ | medium | Cleric |
| `ossuary_shattered_tablet` | Shattered tablet | □ | small | Cleric |
| `ossuary_hanging_chains` | Hanging chains | % | medium | — |
| `ossuary_collapsed_wall` | Collapsed wall | ▲ | large | Fighter |
| `ossuary_offering_bowl` | Offering bowl | ∩ | small | Cleric |
| `ossuary_dust_trail` | Dust trail | . | small | Ranger |
| `ossuary_iron_gate` | Rusted gate | ╫ | medium | Rogue |
| `ossuary_skull_shelf` | Skull shelf | ═ | large | — |
| `ossuary_candle_stubs` | Melted candles | ! | small | — |
| `ossuary_tapestry_shreds` | Tapestry shreds | § | medium | Cleric |

### Magma Rifts (starter list)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `magma_cooled_flow` | Cooled lava flow | ▲ | large | Fighter |
| `magma_vent` | Steam vent | ○ | medium | Ranger |
| `magma_obsidian_shard` | Obsidian shard | ◆ | small | — |
| `magma_heat_shimmer` | Heat shimmer | ~ | small | — |
| `magma_charred_remains` | Charred remains | ¤ | medium | Cleric |
| `magma_sulfur_deposit` | Sulfur deposit | * | small | Ranger |
| `magma_cracked_basin` | Cracked basin | ∩ | medium | Rogue |
| `magma_forge_remnant` | Forge remnant | Ω | large | Fighter |
| `magma_ember_cluster` | Ember cluster | + | small | — |
| `magma_lava_tube` | Lava tube | ∪ | large | Ranger |
| `magma_slag_heap` | Slag heap | Δ | medium | Fighter |
| `magma_gas_pocket` | Gas pocket | ○ | small | — |
| `magma_petrified_tree` | Petrified trunk | ║ | large | Cleric |
| `magma_metal_vein` | Exposed metal | / | small | Rogue |
| `magma_collapsed_bridge` | Collapsed bridge | ═ | medium | Fighter |

---

## Narration Writing Guidelines

### Voice

Narration is second person, present tense. Short sentences. Concrete sensory details — what you see, hear, smell, feel. No omniscient information. The player only learns what their character would perceive.

**Good:** *"The water is black and perfectly still. Your reflection stares back — then blinks before you do."*

**Bad:** *"This pool is enchanted by ancient magic and contains a hidden artifact."*

### Structure

Each outcome narration should follow this pattern:

1. **Observation** (1-2 sentences) — what the player perceives on approach
2. **Interaction** (1-2 sentences) — what happens when they engage
3. **Result** (1 sentence) — the mechanical outcome, with item names highlighted

For flavor outcomes, skip step 3 and let the narration end on atmosphere.

### Highlighted Items

Use `**item name**` in narration text for discovered items or important terms. The client renders these in amber highlight within the CRT display.

### Hazard Narration

Hazards should feel like consequences of curiosity, not punishment. The player made a reasonable choice and got unlucky — not a "gotcha." Frame the damage source as something the character couldn't have predicted.

**Good:** *"You pry open the lid. A cloud of ancient dust erupts — something caustic burns your throat. You stagger back coughing. The dust settles, revealing nothing of value."*

**Bad:** *"You foolishly open the tomb and take damage."*

### Intel Narration

Intel should be delivered through environmental observation, not magical knowledge. Tracks, sounds, smells, structural clues.

**Good:** *"Deep claw marks in the stone, heading north. Fresh. Whatever made these was moving fast — and it's bigger than anything you've fought so far."*

**Bad:** *"You sense a powerful enemy in the room to the north."*

### Secret Narration

Secrets should feel like genuine discovery moments. Build tension, then reveal.

**Good:** *"A current pulls at your legs — flowing toward the wall where there shouldn't be an outlet. You feel along the stone underwater and find a submerged archway. The water beyond is warmer."*

---

## Server Implementation Notes

### ExamineResolver

Create a new `ExamineResolver` class (parallel to `AbilityResolver` and `ItemEffectResolver`) that handles the examine flow:

```
ExamineResolver.resolve(playerId, interactableId, roomState) → ExamineResult
  1. Validate: interactable exists, not already examined, player is in room, combat is resolved
  2. Check requiredClass — reject if player class doesn't match
  3. Determine outcome weights — use bonusClassWeights if player class matches bonusClass
  4. Weighted random roll on outcome table
  5. Resolve outcome:
     - Loot: roll from biome loot table, add to player inventory
     - Hazard: apply damage/debuff to player
     - Intel: look up adjacent room, generate intel text
     - Secret: reveal hidden exit, update room connections
     - Flavor: no mechanical effect
  6. Mark interactable as examined
  7. Return ExamineResult with narration and outcome data
```

### Broadcast Behavior

- `examine_result` → private, sent only to examining player
- `interactable_state` → broadcast to all players currently in the room
- `player_update` → broadcast if HP/inventory changed (existing message type)
- `room_reveal` update → broadcast if secret exit discovered (updates room connections for all)

### Anti-Spam

Enforce a short cooldown (1-2 seconds) between examine actions per player. This isn't gameplay-critical but prevents rapid-fire clicking through all objects.

---

## Content Volume Summary

| Content Type | Count | Notes |
|--------------|-------|-------|
| Interactable definitions | 90 | 15 per biome × 6 biomes |
| ASCII room templates | 4 | 1 per room type (dead_end, tunnel, chamber, cavern) |
| Outcome narrations | ~450 | 5 outcomes × 90 definitions |
| Interactable slot definitions | 148 | 1 per existing room chit |

### Priority Order for Content Creation

1. ASCII room templates (4 templates — required for display)
2. Interactable slot definitions on room chits (148 chits — position data only, fast to do)
3. Fungal Depths pool (complete — use as reference for writing the rest)
4. Remaining biome pools (5 × 15 = 75 definitions)
5. Outcome narrations (the bulk of the writing work — do per-biome in parallel with playtesting)

---

## Open Questions

- **Interactable respawn on revisit?** Current design says no — rooms are static after generation. Could revisit if playtesters find backtracking too empty.
- **Multiplayer contention?** If two players try to examine the same object simultaneously, server should resolve first-come-first-served and reject the second.
- **Interactable density tuning?** 60-70% is a starting guess. Playtest and adjust. Too many objects and rooms feel cluttered; too few and the system feels sparse.
- **Bonus room loot tier?** Currently "+1 rarity tier above biome baseline." May need tuning to feel rewarding without trivializing mob drop loot.
- **Should examined interactables vanish from ASCII display or remain dimmed?** Dimmed preserves room geography; vanished makes it cleaner. Recommend dimmed.
