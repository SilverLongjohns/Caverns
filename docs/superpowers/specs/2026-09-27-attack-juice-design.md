# Attack Juice: Strike Close-Ups and On-Board Hit Feedback

**Date:** 2026-09-27
**Branch:** `feature/attack-juice`, from `feature/combat-closeups` at `0e9bc58`. It builds on the close-up rule, gate and overlay, so it's stacked on that unmerged branch.
**Status:** Design approved section by section; pending spec review.
**Follows:** `docs/superpowers/specs/2026-09-27-combat-closeups-design.md`, which set ordinary hits aside for this "attack juice" spec.

## Intent

In the arena, an ordinary attack has almost no feedback. The side-panel HP gauge moves, a line appears in the 3-line log, and a killed mob disappears after 800ms. The lunge, shake and dissolve juice that exists today only runs in the legacy non-arena `CombatView`.

This spec gives every ordinary hit two things, which play together:

1. **Board juice (option "D"):**
   - the attacker **lunges** toward the target (B's 11px lunge);
   - the target **tears** with an RGB split and skew (C's glitch);
   - a **damage number** slams in and settles (B's numbers).
2. **A strike close-up:** a short, **see-through** Darkest Dungeon beat for every ordinary attack. It lasts 0.9s, uses a thin translucent band and a light dim, and has no title. Abilities, crits and kills keep the existing full, solid close-up, so they still stand out.

The user chose all of this on 2026-09-27 from animated mockups (`.superpowers/brainstorm/.../attack-juice.html` and `attack-closeups.html`).

Rejected alternatives:
- the full close-up on every hit (too slow, and abilities stop standing out);
- close-ups for player hits only;
- sounds for hits;
- an on-board death dissolve.

### Hard rules carried over

- **Data-driven:** no code, CSS or test names a specific ability or mob. Mob art prompts are built from `mobPool.json` by a script.
- **Players are always on the left, mobs always on the right,** in every close-up, whoever is attacking. The attacker lunges toward the other side.

## 1. Rule and pacing

`shared/src/combat/closeUp.ts` gains a fourth kind: `type CloseUpKind = 'ability' | 'crit' | 'kill' | 'strike'`.

| Result | Close-up |
|---|---|
| player `use_ability` (non-passive) | `ability` (unchanged) |
| player `attack` | `kill` if the target is downed, else `crit` if `critMultiplier > 1`, else **`strike`** |
| mob `attack` on a player | `kill` if the target is downed, else `crit` if it crits, else **`strike`** |
| mob hit arriving as `action: 'defend'` (the resolved hit after a defend prompt) | same as mob `attack` |
| the `defendQte` preview (`pendingDamage`, no damage applied yet) | `null` |
| mob-on-mob, `defend` by a player, `use_item`, `use_item_effect`, `flee` | `null` |

`shared/src/data/closeUpConfig.json` gains `"strikeMs": 900`.

**Pacing needs no new server code.** `GameSession.closeUpDelay` already adds the rule's `durationMs` (times `closeUpScale`) to the next mob-turn delay, the delayed turn prompt, the AFK arm and `combat_end`. Strikes add 0.9s per attack, and simulations (scale 0) still run at full speed. The prompt lock from `3bf546d` covers strikes too.

For scale: a round with 2 players and 3 mobs, all attacking, gains about 4.5s.

The client gate (`closeUpGate.ts`) already queues close-ups and holds the board update until the impact beat. For a strike that's 35% of 900ms, about 0.3s. The overflow cap of 3 still applies.

Arena note: the arena has no attack QTE (QTEs are legacy, per the user), so player crits don't occur there today. That's fine; the crit branch stays.

## 2. Board juice

This is a client-only effects layer. It has no protocol or server changes, and it never blocks input, turn flow or message delivery.

- **Source:** every damaging `combat_action_result` as the close-up gate **delivers** it (at impact). The juice plays under every close-up: visible through strikes, hidden behind the solid full band. Since the result is delivered at impact, the juice lines up with the close-up's impact.
- **State:** a pure reducer, `client/src/combat/boardFx.ts`, turns a delivered result plus the current positions into short-lived effects. A small store holds them, and each effect expires after its animation.
- **Rendering:** a layer inside `.arena-world` (so it pans with the camera and sits under the CRT overlay). Effects are placed with the existing `getCellRect` pattern in `ArenaGrid`. The unit sprite (`span.entity-glyph`) gets animation classes; numbers are absolutely positioned spans above the target tile.

| Effect | Look (from the mockup) | Details |
|---|---|---|
| Lunge | about 11px toward the target and back, with a slight scale-up, 300ms, `cubic-bezier(.2,.8,.3,1)` | Direction comes from the attacker and target tiles: 4 directions, picking the dominant axis. |
| Tear | an RGB-split drop shadow plus skew, `steps(6)`, 360ms, starting about 100ms after the lunge starts | On every target hit (area results: every id in `targetIds`). |
| Number | slams in at 1.8× scale, settles, drifts up about 20px and fades over 950ms; outlined Courier, bold | Red (`#ff5a3c`) for damage to a mob, amber (`#ffb000`) for damage to a player, dim grey (`#8c7f6c`) when the damage is 1. Area results show the total once, above the first target. Numbers that start together are offset so they don't overlap. |

- **Walk, then attack:** the server sends a mob's `arena_positions_update` (its walk path) and then its attack. If a walk animation (`animatingId`/`animPath` in `ArenaView`) is still running, that mover's juice waits for the walk to finish, up to the walk's own length (path length × 100ms), never indefinitely.
- **Missing positions:** if the attacker has no tile, there's no lunge. If the target has no tile, the number goes at the target's last known tile, or is skipped when none is known. None of this throws.
- **Reduced motion:** no lunge or tear. The number fades in place without moving.

## 3. Strike close-up visuals

This is the same `CloseUpOverlay` with a `closeup--strike` variant; there's no second overlay system.

- **Band:** about 45% of the screen height, translucent (around 40% opacity). The dim is lighter (about 20%, against 65% for full close-ups). There's no title or subtitle.
- **Motion:** compressed to 0.9s. The actor slides in and lunges toward the other side. At impact (35%) the target gets the **tear** (the same keyframes as the board tear, scaled up) instead of the full close-up's recoil and tilt. The number slams in beside the target, then fades.
- **Staging:** the existing `stageFor` rule applies. When a mob attacks a player, the player (hurt pose) is on the left and the mob on the right, lunging left.
- **Art:** the existing fallback chains:
  - player actor: class attack pose, then portrait, then glyph;
  - player target: hurt pose, then portrait, then glyph;
  - mob: close-up sprite, then the upscaled board glyph.
- **Sound:** strikes are **silent** (hit sounds are out of scope). Full close-ups keep `crack`/`boom`/`shimmer`.
- **Skip:** unchanged from `0e9bc58`. A deliberate key press or a click skips; held keys, modifiers, F-keys and typing in text fields pass through.
- **Reduced motion:** only the number shows, for the same duration.

## 4. Mob close-up art

Every mob now appears in close-ups constantly, so mob sprites are part of this spec.

- **Scope:** all 45 mobs in `shared/src/data/mobPool.json`, one sprite each, used both attacking and being hit (the tear sells the hit).
- **Batches:** one biome at a time. Each is approved by the user from a contact sheet before install:

| Biome | Mobs |
|---|---|
| starter | 10 |
| fungal | 7 |
| crystal | 7 |
| flooded | 7 |
| bone | 7 |
| volcanic | 7 |

- **Generation:** PixelLab `create_image_pro`, 160×160, 4 candidates per call.
  - **Identity:** use `reference_images` of the mob's existing 48px board sprite (`client/public/sprites/glyphs/mobs/<id>.png`, raw GitHub URL on `main`), with `usage: "character identity: this exact creature, same shape and colours"`. Also set it as `style_image_url`.
  - **Prompt:** built by a script from the mob's `name` and `description`: "the SAME creature as the reference image — identical shape and colours — full-body, head to feet, small in frame, side view facing left, menacing ready stance, no text, no letters, no symbols written".
  - Never put mechanics or stat text in prompts.
- **Output:** `client/public/closeups/mobs/<templateId>.png`, the path `artChainFor` already resolves. Picks and prompts are appended to `art/closeups/chosen.json`.
- **Manifest:** the install script writes `client/src/combat/mobCloseUpArt.json` (the list of template ids with art). `artChainFor` includes the mob sprite only when the id is in the manifest, so there are no 404s while batches roll out.
- **Budget:** about 45 × 25 = 1,125 generations plus rerolls. The balance was about 2,300 on 2026-09-27; check it before each batch.
- **The feature ships working with glyph fallbacks.** Art batches can land as their own commits.

## 5. Error handling and testing

### Error handling

- **Strike queue:** strikes queue like other close-ups. On overflow (cap 3), the oldest pending one is dropped, but its board update and board juice still play, in order.
- **Juice is fire-and-forget:** it's decoration after delivery, so a juice failure can never delay or drop a message.
- **Unknown or missing data:** a mob not in the manifest uses the glyph, and an image failing at runtime moves to the next item in the chain. Missing positions degrade as described in section 2.
- **Known, not addressed here:**
  - background-tab timer throttling (a deferred minor from the close-up review);
  - the arena still receives the legacy defend prompt, which resolves after its timeout (QTEs are legacy).

### Tests

Vitest, test-first. None may name an ability or mob; iterate over the data or use made-up ids.

- **shared, `closeUpFor`:**
  - a plain player attack → `strike`, and a plain mob hit on a player → `strike`;
  - the resolved `defend` hit by a mob → `strike`, and the `defendQte` preview → `null`;
  - mob-on-mob, player `defend`, items and flee → `null`;
  - kill beats crit, and crit beats strike;
  - `strike.durationMs === CLOSE_UP_CONFIG.strikeMs`.

  The two existing tests that expect `null` for a normal hit are updated.
- **shared, data:** `strikeMs` is a positive number less than `critMs`.
- **server:**
  - after an ordinary player attack, the next action is delayed by at least `strikeMs + mobTurnDelayMs`;
  - with `closeUpScale: 0`, there's no added delay;
  - existing pacing tests stay green.
- **client, `boardFx` reducer:**
  - a delivered damaging result gives a lunge, a tear and a number;
  - lunge direction comes from positions, in all 4 directions;
  - number colour: mob target red, player target amber, 1 damage grey;
  - area results give a tear per `targetIds` entry and one total number;
  - a missing attacker position gives no lunge, and a missing target position gives only the number (or nothing);
  - a mover's effects wait behind its active walk and are released when the walk ends;
  - effects expire.
- **client, staging:**
  - a `strike` gets the strike layout and tone (no title, translucent band);
  - mob-on-player strikes put the player on the left;
  - mob art resolves via the manifest (in the manifest → sprite first; not in it → glyph).
- **client, data:** every manifest id exists in `mobPool.json`, and its PNG exists under `client/public/closeups/mobs/`.
- **Visual:**
  - a sandbox script does a basic attack in the duel, captures the strike at about 35%, and checks that the target's HP changes only after impact and that a board number appears;
  - it then lets the mob attack and checks that the player is on the left;
  - there's a contact sheet per mob batch.

### Done when

- `npm test` passes in every workspace and `tsc` is clean;
- the user has reviewed the sandbox capture;
- the starter-biome mob batch is approved and installed (the other biomes can follow as their own commits within this plan).

## Out of scope

- Hit sounds and an on-board death dissolve.
- QTEs (legacy).
- A setting to turn per-hit strikes off (skip covers it for now; add a setting if pacing feels slow).
- Healing numbers on the board.
- Mob abilities (mobs have none).

## Decisions log

- The user picked "D": B's lunge, C's RGB-tear target reaction and B's slam-in numbers.
- The user asked for Darkest Dungeon close-ups on every attack. After seeing the pacing mockups, they chose the quick 0.9s strike with a **see-through** band over a full close-up on every hit or on player hits only.
- Mob art is in this spec, biome by biome, with an approval gate per batch.
- Strikes are silent.
- A mockup bug that put the attacking mob on the left was fixed. The rule stays: players on the left, mobs on the right.
