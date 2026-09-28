# Ranged Combat (Trial): Guns, Marksmanship, Shoot and Reload

**Date:** 2026-09-28
**Branch:** `feature/ranged-combat`, stacked on `feature/attack-juice`. It reuses the strike close-up and the board-juice reducer (`client/src/combat/boardFx.ts`).
**Status:** Design approved section by section; pending spec review.
**Follows:** `docs/superpowers/specs/2026-09-27-attack-juice-design.md`.

## Intent

Arena combat today is melee-only for weapons. `validateAttack` requires Manhattan distance 1, and only abilities (`bone_spike`, `scrap_volley`, `smoke_bomb`) reach further. This spec trials **ranged combat for every class**:

- a fifth equipment slot, **`ranged`**, holding a **gun**;
- two new combat actions, **Shoot** and **Reload**;
- a new character stat, **Marksmanship**, which controls **range and accuracy**;
- shots trigger the existing **strike** close-up, with new per-class **ranged-pose** art, and a **tracer projectile** on the board.

It is a trial. All tuning numbers live in one data file (`shared/src/data/rangedConfig.json`), so the feel can be adjusted or the feature pulled back without touching code.

### User decisions (2026-09-28)

- Marksmanship is a **new character stat** (not a per-weapon range roll) that controls **range and accuracy**. Damage comes from the weapon.
- **+1 tile of range per Marksmanship point.**
- **Each weapon has a magazine.** Reload is an action that refills it and ends the turn.
- The ranged weapon goes in a **new slot**, so every character keeps their melee weapon and chooses Attack or Shoot each turn.
- Guns come from **class starters plus loot and shop**.
- **Gun-themed** weapons (no slings or bows). Starter guns are **themed per class**.
- **Players only.** Mobs stay melee.
- Shoot and Reload are **new combat actions**, not abilities. Rejected: modelling a shot as an ability, which would drag in energy, flanking and the 2s ability close-up.

### Hard rules carried over

- **Data-driven:** no code, CSS or test names a specific gun or class. Weapon types, starters and tuning come from data.
- **Players are on the left and mobs on the right** in every close-up. Close-up art faces right and is never mirrored.
- **The server is authoritative.** The client previews range and hit chance using the same shared functions, but the server validates and rolls.

## 1. Rules

### 1.1 Marksmanship

- A new `statDefinitions` entry in `progressionConfig.json`:
  `{ "id": "marksmanship", "displayName": "Marksmanship", "internalStat": "marksmanship", "perPoint": 1 }`.
- `ComputedStats` gains `marksmanship: number`. `computePlayerStats` adds the class base, equipment stats (none today) and allocated points.
- Every class in `classes.json` gets `baseStats.marksmanship: 2`.
- Character creation (`characterCreationConfig.json` `statIds`) and level-up include it, driven by config.

### 1.2 Range and accuracy

These are pure functions in `shared/src/combat/ranged.ts`, and both the client and the server use them.

```
effectiveRange(weaponRange, marksmanship) = weaponRange + marksmanship × rangePerMarksmanship
hitChance(distance, marksmanship) = clamp(
    baseHit + hitPerMarksmanship × marksmanship − falloffPerTile × max(0, distance − falloffStart),
    minHit, maxHit)
```

- **Distance** is Chebyshev, the same as ability `range`.
- The target must be within `effectiveRange` and in **line of sight** (`hasLineOfSight` in `arenaMovement.ts`: walls and chasms block it).
- Adjacent targets can be shot.

`shared/src/data/rangedConfig.json`, with starting values:

```json
{
  "rangePerMarksmanship": 1,
  "baseHit": 0.85,
  "hitPerMarksmanship": 0.03,
  "falloffPerTile": 0.07,
  "falloffStart": 2,
  "minHit": 0.15,
  "maxHit": 0.95
}
```

### 1.3 Shot damage

```
shotDamage = max(minDamage, floor(classBaseDamage + gun.stats.damage − effectiveDefense))
```

- `classBaseDamage` is the class `baseStats.damage` only.
- **Ferocity, melee weapon and offhand damage, and item effects** (vampiric, cleave, flurry, venom and so on) **do not apply** to shots.
- `effectiveDefense` includes the defending ×2 multiplier (`defenseMultiplierWhenDefending`) and defense buffs, exactly as melee does.
- Shots never crit. The arena sends no crit today anyway.
- **In reverse:** the gun's `damage` is **excluded** from `computePlayerStats().damage`. Guns never boost melee.
- A **miss** deals 0 damage.

### 1.4 Magazine and actions

- The gun's `stats.magazine` is its capacity. Per-combat ammo lives on the combat participant (`InternalParticipant.ammo`). It is set to full when combat starts and when a player joins a combat.
- **Shoot** `{ action: 'shoot', targetId }`:
  - It is refused if the player has no gun, ammo is 0, the target is out of range, or there is no line of sight.
  - Otherwise it uses 1 round, rolls the hit using an injectable RNG, and applies damage.
  - Like every action, it **ends the turn**. Moving first is allowed.
- **Reload** `{ action: 'reload' }`:
  - It is refused if the player has no gun or the magazine is full.
  - Otherwise it sets ammo to the magazine size and **ends the turn**. Moving first is allowed.
- Both go through `GameSession.handleCombatAction` (not `handleUseAbility`). They end in the usual `markActionTaken`, `regenEnergy`, `advanceTurn`, `afterCombatTurn` sequence.
- `isDefending` is cleared when the player acts, as with any action.

### 1.5 Weapons

- `EquipmentSlot` gains `'ranged'`. `Equipment` gains `ranged: Item | null`.
- `ItemStats` gains `range?: number` and `magazine?: number`.
- `PlayerManager.equipItem` routes by slot as today. Equipping is still blocked during combat.

Gun types are used for generation. The base values are before the quality multiplier and variance. Range and magazine never roll; damage rolls like any weapon.

| Type | Base range | Magazine | Damage band | Role |
|---|---|---|---|---|
| Scattergun | 1 | 2 | high | brutal up close |
| Sidearm | 2 | 3 | medium | all-rounder |
| Long rifle | 4 | 1 | high | reach, slow rhythm |
| Autogun | 2 | 5 | low | sustained chip damage |

**Class starters.** They are added to `CLASS_STARTER_ITEMS`, and `ClassDefinition` gains `starterRangedId`. The names are placeholders the user may rename.

| Class | Starter gun | Type | Flavour |
|---|---|---|---|
| Templar (`vanguard`) | Censer Blunderbuss | Scattergun | a relic thurible bored into a barrel; belches shrapnel and incense |
| Phaseknife (`shadowblade`) | Hushpistol | Sidearm | a suppressed relic pistol for a quiet opener |
| Suturist (`cleric`) | Needle Rifle | Long rifle | fires surgical bone-needles from the back line |
| Junk Prophet (`artificer`) | Scrap Autogun | Autogun | a crank-fed junk repeater |

- The Junk Prophet's `artificer_repeating_crossbow` leaves the starter kit. New Junk Prophets get a melee starter instead, **Rebar Wrench**, with the same `damage` as the old crossbow.
- The old item definition stays, so existing saves still resolve it.

### 1.6 Loot and shop

- `itemgen` gains a `ranged` slot:
  - gun base types in the biome palettes, mapped to the four gun types above;
  - `BASE_STAT_RANGES.ranged`, which uses the weapon damage bands scaled by type;
  - `range` and `magazine` copied from the type.
- Drop specs and `SHOP_DROP_SPECS` include the `ranged` slot, so guns appear in loot and the shop.
- `itemArchetypes.ts`: the `ranged` archetype's keywords gain `gun`, `rifle`, `pistol`, `scatter`, `autogun` and `blunderbuss`, and it applies to the `ranged` slot, so guns get the existing ranged icon.

### 1.7 Persistence and migration

- Equipment and stat allocations are persisted as JSON on the character (`characterAdapter.ts`), so the new fields round-trip.
- **When a character is loaded:**
  - if `equipment.ranged` is missing or null **and the character has never had one**, the class starter gun is put in it;
  - a missing `statAllocations.marksmanship` is treated as 0.
  - A flag isn't needed: "never had one" means the `ranged` key is absent. A deliberately emptied slot is stored as `null` and is left alone.

### 1.8 Out of scope

- Mob ranged attacks.
- The legacy non-grid `CombatView`, which stays melee-only.
- Ammo items or ammo economy.
- Per-gun accuracy modifiers.
- Gun-specific close-up art (the pose always shows the class starter gun).
- Hit and shot sounds (the strike stays silent).

## 2. Presentation

### 2.1 Protocol

- `CombatActionMessage.action` gains `'shoot' | 'reload'`.
- `CombatActionResultMessage` carries:
  - `actionType: 'shoot' | 'reload'` for the new actions;
  - `hit: boolean` and `hitChance: number` on shots;
  - `damage` (0 on a miss).
- The combat participant info (`CombatPlayerInfo` / combat state) gains `ammo` and `magazine`, so every client can render them.

### 2.2 Close-ups

`closeUpFor` in `shared/src/combat/closeUp.ts`:

| Result | Close-up |
|---|---|
| player `shoot`, target downed | `kill` |
| player `shoot`, hit or miss | `strike` |
| player `reload` | none |

- **Server pacing needs no new code.** `closeUpDelay` reads the shared rule, so a shot adds `strikeMs` (900ms) like a melee attack.
- **The shooter's art chain** (`closeUpStage.artChainFor`) gets a new role, `shoot`:
  `/closeups/classes/<className>-ranged.png`, then `-attack.png`, then the class portrait, then the glyph.
  - The `kill` close-up from a shot also uses the `shoot` role.
  - Missing art degrades gracefully, so the feature works before the art is installed.
- **On a miss,** the strike stage shows no RGB tear on the target, and a dim `MISS` label takes the place of the damage number.

### 2.3 Board effects (`boardFx.ts`)

A new `BoardFx` kind, **`projectile`**, replaces the lunge for shots:

- A phosphor-green pixel bolt travels from the shooter's tile to the target's at `projectileMsPerTile` (70ms), capped at `projectileMaxMs` (350ms). Both values go in `FX_TIMING`.
- The shooter gets a 2px **recoil** kick, directed away from the target.
- **Hit:** when the bolt arrives, the existing `tear` and `number` play on the target.
- **Miss:** the bolt carries on 1–2 tiles past the target, fading. A dim `MISS` number floats from the target's tile, and there is no tear.
- **Reload:** no projectile. A short `RELOAD` tag floats above the unit.
- **Reduced motion:** no travel and no recoil, just a brief flash on the target, matching how strikes are kept light.
- The effect waits behind the attacker's walk animation, the same as the lunge does today.
- The text log gains flavour lines for shots, misses and reloads, e.g. "Brakka cranks the Scrap Autogun."

### 2.4 Ranged-pose art

- **Four images:** `client/public/closeups/classes/{vanguard,shadowblade,cleric,artificer}-ranged.png`. Each is 160×160, a single frame, facing right.
- **Recipe** (the same as the existing attack and hurt poses; see `docs/superpowers/plans/2026-09-27-combat-closeups.md` Task 7):
  - `mcp__pixellab__create_image_pro`, 4 candidates per class;
  - the class portrait as the identity reference;
  - check the credit balance first.
- **Prompt pattern:** "the SAME character as the reference image — identical helmet, armour… — full-body, side view facing right, aiming and firing <starter gun description>, bright muzzle flash, no text, no letters, no symbols written".
- **Approval gate:** a contact sheet of the candidates goes to the user, who picks. Picks are then installed and recorded in `art/closeups/chosen.json`, with raw candidates in `art/closeups/raw/`.

## 3. UI

- **`ArenaActionBar`:**
  - **Shoot** shows ammo (`Shoot 2/3`). It is disabled with no gun or no ammo.
  - **Reload** is disabled with no gun or a full magazine.
  - A new bar mode, `target_shoot`, goes in `arenaBarMode.ts`, with the prompt "Choose a target to shoot (range N)".
- **`ArenaView`:**
  - A new `InteractionMode` `shoot` reuses the ability range highlight: tiles within `effectiveRange` that are in line of sight.
  - Targetable enemies show a **hit %** label (shared `hitChance`). It shows on hover by default; this can be switched to always-on after playtesting.
  - Clicking an invalid tile does nothing, as with abilities.
- **`ArenaUnitPanel`** shows the active unit's ammo.
- **`PlayerHUD`:**
  - The equipment list gains the **Ranged** slot, showing damage, range and magazine.
  - Equipping a gun from the inventory swaps the old gun back into the inventory.
- **Item stat display** in the shop, stash, tooltips and `ItemIcon`/relic components shows `range` and `magazine` when present.
- **Character sheet, character creation and level-up** show **Marksmanship**. These are driven by config and are mostly data.

## 4. Bots (sandbox `autoPlayer.ts`)

In this order:

1. Attack an adjacent enemy.
2. Otherwise, if loaded and an enemy is in range with line of sight, **shoot** the one with the highest hit chance.
3. Otherwise, if the magazine is not full and no enemy is adjacent, **reload**.
4. Otherwise, the existing approach logic.

This keeps the balance simulations exercising the feature.

## 5. Testing (Vitest, test-first)

- **shared:**
  - `effectiveRange` and `hitChance`, including the caps and the falloff start;
  - the `closeUpFor` rows for shoot and reload;
  - content integrity: every class has a valid `starterRangedId` pointing at a `ranged`-slot item with `range` and `magazine`;
  - gun names match the `ranged` archetype;
  - `computePlayerStats` excludes gun damage and includes Marksmanship.
- **server:**
  - Shot damage uses class base + gun − defense, and ignores Ferocity, melee gear and item effects.
  - Defending doubles defense against shots.
  - Hit and miss, using an injected RNG.
  - Ammo goes down on a shot and refills on reload.
  - Shooting is refused with an empty magazine, out of range, without line of sight, or without a gun. Reloading is refused when full.
  - Shoot and reload each end the turn.
  - Close-up pacing for shot, kill and reload (`GameSession.closeUp.test.ts`).
  - A joiner starts loaded.
  - Load migration: a starter gun when the `ranged` key is absent, and none when it is `null`.
  - The bot shoots and reloads.
- **itemgen:**
  - `ranged`-slot generation produces valid guns;
  - snapshot changes are reviewed and updated deliberately.
- **client:**
  - `boardFx`: projectile timing, the miss overshoot and number, reload tag, reduced motion, and waiting behind a walk;
  - `closeUpStage`: `shoot` art chain and fallbacks, and the miss stage;
  - `arenaBarMode`: the shoot and reload modes.
- **Balance:** a sandbox simulation run before and after. If fights become trivial or much longer, adjust `rangedConfig.json` and the gun damage bands (not code).
