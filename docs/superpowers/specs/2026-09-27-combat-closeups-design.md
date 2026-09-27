# Combat Close-Ups: Darkest Dungeon-Style Cast Moments

**Date:** 2026-09-27
**Branch:** `feature/combat-closeups` (from `main` at `73c91e6`, which includes the UI revamp and the main menu polish)
**Status:** Design approved, pending spec review

## Intent

Combat is flat: an ability or a crit resolves as a log line and an HP bar moving. This adds a **Darkest Dungeon-style close-up**, a brief full-screen beat. The board dims, a band opens, the caster lunges in large against the target, there's an impact flash and recoil, the damage pops, and the ability name sits above. Then it's back to the board.

The user chose direction **A** (a straight Darkest Dungeon close-up with real pose art) from three animated mockups on 2026-09-27. The rejected options were B (CRT-native text and glitch) and C (DD staging inside a CRT feed).

**Triggers** (chosen by the user):
- every player **ability**;
- player **crits** and **kills**;
- enemy **crits** and **kills** on players.

Ordinary hits don't get a close-up. They'll get lighter on-board "attack juice" in a **separate, later spec**, which this spec doesn't cover.

### Hard rule: close-ups are data-driven

Ability names, target types and effects will change. **No code, CSS or test may name a specific ability.** Everything a close-up needs comes from the ability's own data:

| Need | Source |
|---|---|
| Whether an ability triggers | any ability in `CLASS_DEFINITIONS` that isn't `passive` |
| The name shown | the ability's `name` (the `abilityName` the server already sends) |
| Staging | the ability's `targetType` (`none`, `ally`, `enemy`, `area_enemy`, `area_ally`, and any future value falls back to `enemy`) |
| Art and sound | an optional `closeUp` block on the ability's entry in `shared/src/data/classes.json`; missing fields use defaults derived from the result |

Adding, renaming or retyping an ability in `classes.json` must need no code change and no test edit.

## 1. When close-ups fire, and pacing

### The rule

`shared/src/combat/closeUp.ts` exports:
- `closeUpFor(result: CombatActionResultMessage, ctx: { actorType: 'player' | 'mob'; targetType?: 'player' | 'mob'; isPassiveAbility: boolean }): CloseUp | null`;
- `type CloseUp = { kind: 'ability' | 'crit' | 'kill'; durationMs: number }`.

| Result | Close-up |
|---|---|
| `action === 'use_ability'` by a player, ability not passive | `ability` (an ability that kills is still `ability`, with a kill flourish) |
| `action === 'attack'` by a player | `kill` if `targetDowned`, else `crit` if `critMultiplier > 1`, else `null` |
| `action === 'attack'` by a mob on a player | `kill` if `targetDowned`, else `crit` if `critMultiplier > 1`, else `null` |

**Note:** mobs can't crit today (`CombatManager.resolveMobTurn` sets no `critMultiplier`; only player attacks crit, via the attack QTE). So enemy close-ups currently fire on **kills only**. The crit branch stays, so mob crits work automatically if they're added later.
| `defend`, `use_item`, `use_item_effect`, `flee`, a `defendQte` preview, mob-on-mob | `null` |

Durations live in `shared/src/data/closeUpConfig.json`: `{ "abilityMs": 2000, "critMs": 1600, "killMs": 1800, "impactAt": 0.35 }`.

### Server pacing

Wherever the server schedules what happens after a `combat_action_result`, it computes `closeUpFor(...)` from the same shared rule. When it's non-null, it adds `durationMs` to:
- the delay before the next mob turn (on top of `mobTurnDelayMs`);
- the next player's AFK timer.

This applies to the next-turn scheduling in `GameSession` and the arena and combat managers, and to the combat sandbox (`SandboxHost`) and bots. Nothing else about combat logic changes.

### Protocol addition (additive, optional)

Area abilities currently broadcast one combined result with no target list. The area branch of `GameSession`'s ability handler adds:
- `targetIds?: string[]`: every participant hit;
- `downedIds?: string[]`: every participant downed.

Single-target results already carry `targetId` and `targetDowned`. No existing field changes.

### Client timing

- A close-up starts when its result arrives.
- That result's **board update** (the participant HP change, the dying-mob mark, the combat log line) is held and released at the impact beat, `impactAt × durationMs`.
- Results that arrive while a close-up is playing queue behind it.
- **Skip:** Esc, a click or any key during a close-up ends it and releases the held update immediately. The server doesn't speed up.
- **Reduced motion:** a static title card (the name, the number, CRITICAL or KILLED) shows for the same duration, so pacing is identical.

## 2. Staging

Layout follows Darkest Dungeon: **player art is always on the left, enemy art on the right**, whoever is attacking. The attacker lunges toward the other side.

Staging comes from the ability's `targetType` (or, for basic attacks, from who is attacking whom):

| Case | Layout |
|---|---|
| player → enemy (`enemy`, basic attack) | caster on the left, target on the right |
| player → ally (`ally`, `area_ally`) | caster on the left, the ally (or up to 2 allies) beside and slightly behind; no enemy side |
| player alone (`none`) | caster centre-left, with a flourish |
| player → several (`area_enemy`) | caster on the left, up to 3 targets on the right in a staggered line; any more become "+N" |
| mob → player (crit or kill) | mob on the right lunging left at the player on the left |

**Band colour by kind:**
- player ability: a dark tint of the caster's class colour, taken from a new optional `color` field on the class definition in `classes.json` and falling back to amber (class colours currently exist only as scattered overworld CSS, so they're not a usable source);
- crit: amber;
- kill: deep red;
- enemy crit or kill on a player: red-black, with a heavier vignette.

**Timeline** (as fractions of `durationMs`):

| Time | What happens |
|---|---|
| 0–10% | The board dims and the band opens (a vertical scale from the centre line, with a CRT-style power flicker). |
| 10–25% | Actor and targets slide in from opposite edges; the name slams in at the top. |
| `impactAt` (35%) | White flash, a short screen shake, targets recoil (knock-back and tilt), numbers pop; the held board update is released. |
| 35–80% | Hold, with a slow push-in (scale 1.00 → 1.12). |
| 80–100% | Fade, and the band closes. |

**Numbers and stamps:**
- damage in red and healing in green, large and pixel-crisp;
- a subtitle of CRITICAL, KILLED (a stamp over the downed target) or the buffs applied (from `buffsApplied`);
- downed targets drop and desaturate.

**Sound:** a synthesised impact per kind, through `audioEngine.playUi`'s master bus (a new set of UI sounds):
- `crack` for damage and crits;
- `boom` for kills;
- `shimmer` for heals and buffs.

If an ability's data doesn't set a sound, the default comes from the result: healing or buffs with no damage → `shimmer`; `targetDowned` → `boom`; otherwise `crack`.

**How it's built:**
- one `CloseUpOverlay` component mounted in `ArenaView`;
- CSS keyframes driven by a `--closeup-dur` custom property;
- pixel art scaled only by whole-number factors;
- the global `.crt-overlay` stays on top of it.

## 3. Art

### Data

Optional `closeUp` block per ability in `classes.json`:

```json
{ "id": "backstab", "name": "Phase Strike", "targetType": "enemy",
  "closeUp": { "art": "/closeups/abilities/backstab.png", "sound": "crack" } }
```

Every field is optional; a missing block means all defaults. Class-level and mob-level art is resolved by convention from IDs, so it needs no data at all:
- `/closeups/classes/<classId>-attack.png`
- `/closeups/classes/<classId>-hurt.png`
- `/closeups/mobs/<mobTemplateId>.png`

`client/src/combat/closeUpArt.ts` resolves the art for an actor or target in a given role. Fallback chains:
- **player caster:** ability art, then class attack pose, then class portrait (`getClassPortrait`), then the class glyph;
- **player target:** class hurt pose, then class portrait, then the class glyph;
- **mob:** mob sprite, then the mob's glyph (`getParticipantGlyph`), scaled up;
- a load failure at runtime swaps to the next item in the chain.

### Production (PixelLab `create_image_pro`, 160×160, 4 candidates per call)

Uses one fixed prompt template, with the class portrait as the style reference for players and `junk_prophet` for mobs.
- **Players:** per class, an attack pose and a hurt pose; per non-passive ability, a cast pose (8 today). That's 16 images.
- **Mobs:** one full-body sprite per mob template, facing left, used as both attacker and target. That's 45 images.
- **Budget:** about 61 calls × 20 generations, roughly 1,250, plus rerolls. Check the balance before starting.

### Workflow

- The feature ships working with fallbacks only.
- Art lands in batches:
  - players (16);
  - then the mobs biome by biome (starter, fungal, crystal, flooded, bone, volcanic).
- Each batch is approved by the user from a contact sheet before anything is copied into `client/public/closeups/`.
- Prompts and picks go in `art/closeups/chosen.json`.
- A drifting batch is rerolled, never hand-mixed.

## 4. Error handling and testing

### Error handling

- **Late results:** the client queue is capped at 3 pending close-ups. On overflow, the oldest pending close-ups are dropped, **but their board updates are applied immediately and in order**, so the board is never out of sync.
- **Combat ending mid-close-up** (`combat_end`): the close-up completes, or is cut short on skip, before combat end is applied. Held updates always flush first.
- **Disconnect or reconnect:** any held updates are flushed at once.
- **Unknown values:** an unknown `targetType` stages as `enemy`, and an unknown `closeUp.sound` uses the derived default.
- **Missing or broken art:** falls back as in section 3, never a blank slot.
- **Server/client agreement:** the server and client call the same `closeUpFor`, so they can't disagree.

### Tests (Vitest, test-first; none may name a specific ability)

**shared, `closeUpFor`:**
- tests iterate over `CLASS_DEFINITIONS`: every non-passive ability gives `ability`, and every passive gives `null`;
- basic-attack crit gives `crit`, and a kill gives `kill` (kill beats crit);
- an ability kill stays `ability`;
- a mob crit or kill on a player gives `crit`/`kill`, and a mob normal hit gives `null`;
- defend, items, flee, `defendQte` and mob-on-mob give `null`;
- durations come from config.

**shared, data integrity:** every `closeUp.sound` is a known sound, every `closeUp.art` path is under `/closeups/`, and every class `color`, when present, is a valid hex colour.

**server:**
- after a qualifying result, the next-turn delay and the AFK timer grow by exactly `durationMs`; non-qualifying results are unchanged (fake timers);
- area ability results include `targetIds` and `downedIds`;
- the existing seeded simulations stay deterministic.

**client (pure logic):**
- the close-up queue reducer: enqueue, release at impact, skip, the cap of 3 with an in-order flush, flushing on combat end and on disconnect;
- `closeUpArt` resolution, iterating over every class, every non-passive ability and every mob template, each resolving to a non-empty chain;
- `stageFor(targetType, …)`, iterating over every `targetType` present in the data plus an unknown value.

**visual:**
- a sandbox run on a seeded preset that casts an ability and lands a crit, with frame captures at 10%, 35% and 60%;
- a check that the target's HP bar changes only after the impact beat;
- a contact sheet per art batch.

### Done when

- `npm test` passes in every workspace and `tsc` is clean;
- the user has reviewed the sandbox capture;
- the player art batch is approved (mob batches may follow as their own commits).

## Out of scope

- On-board juice for ordinary attacks (separate spec).
- Close-ups for mob abilities (mobs have none today) and for items.
- Settings for turning close-ups off or speeding them up. Skip covers it for now; add a setting later if pacing feels slow.

## Decisions log

- Direction A (a straight DD close-up) chosen over B (CRT-native) and C (hybrid).
- Triggers: player abilities, player crits and kills, enemy crits and kills on players. Normal hits are left to a later attack-juice spec.
- Close-ups come first; attack juice follows.
- Approach 1: a shared rule, the server extends its turn delays, and the client holds board updates until the impact beat. A client-only queue (drift) and a fire-and-forget overlay (spoilers, stacking) were rejected.
- **Data-driven (user requirement):** no specific ability is named in code or tests; staging comes from `targetType`, and art and sound come from optional `closeUp` data with derived defaults.
