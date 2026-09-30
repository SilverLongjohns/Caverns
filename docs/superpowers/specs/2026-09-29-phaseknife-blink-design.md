# Phaseknife Blink — Design

Date: 2026-09-29
Status: approved in chat, awaiting spec review

## Goal

First step of the ability revamp (current abilities were placeholders). Give the
Phaseknife (`shadowblade` class) a teleport, **Blink**, whose range scales with
Speed. It should enable the class fantasy — "slips in, opens a throat, and is
gone" — e.g. blink into a flank, then Phase Strike, in the same turn.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Turn economy | **Free action**: costs energy only, never the action or movement. Once per turn. |
| Range | Tunable per-ability formula: `baseRange + floor(initiative × perSpeed)` |
| Passes through | Anything (walls, units). Destination must be open, unoccupied floor. Built as a `requiresLineOfSight` flag; Phaseknife sets it `false`. |
| Hazards | Landing on a hazard tile deals its normal on-enter damage (5). |
| Energy cost | 5 (max 30, regen 2/turn, start full → blink + Phase Strike possible on the opener). |
| Presentation | No full-screen close-up; on-board afterimage + arrival flash only. |
| Scope | Arena combat only. Mobs and sandbox bots do not use it. |

## Rule carried over

Abilities are data-driven. No code or test names a specific ability or class;
behaviour comes from generic fields (`targetType`, `freeAction`, `closeUp`,
effect `type`). Tests use fixture abilities.

## 1. Data

`shared/src/data/classes.json`, added to `shadowblade.abilities` (Phaseknife ends
with Phase Strike, Blink, Glean):

```json
{
  "id": "blink",
  "name": "Blink",
  "description": "Phase to an open tile within range. Costs no action or movement; once per turn. Range grows with Speed.",
  "energyCost": 5,
  "targetType": "tile",
  "passive": false,
  "freeAction": true,
  "closeUp": false,
  "effects": [
    { "type": "teleport", "baseRange": 1, "perSpeed": 0.34, "requiresLineOfSight": false }
  ]
}
```

At base Speed (initiative 5): range = 1 + floor(1.7) = 2. At initiative 9: 1 + 3 = 4.

`shared/src/classTypes.ts` — `AbilityDefinition` changes:
- `targetType` union gains `'tile'`.
- `freeAction?: boolean` — does not consume the turn's action, does not end the
  turn; limited to one use per turn per ability.
- `closeUp?: false | { art?; sound? }` — `false` disables the close-up.

A typed `TeleportEffect` (`type: 'teleport'`, `baseRange`, `perSpeed`,
`requiresLineOfSight`) is exported for the helpers below.

## 2. Shared helpers

New `shared/src/combat/teleport.ts`:
- `teleportRange(effect, initiative): number` — the formula above.
- `isValidTeleportDestination(grid, from, to, effect, initiative, occupied): boolean`
  — within Chebyshev range, not the caster's own tile, walkable floor (not wall),
  not in `occupied`, and `hasLineOfSight(grid, from, to, range)` when the flag is set.
- `teleportDestinations(...)`: list of valid tiles (client highlight).

Client highlight and server validation both use these, so they cannot drift.

## 3. Server

`ArenaCombatManager`:
- `TurnState` gains `freeActionsUsed: Set<string>`, created fresh in `startTurn`
  (so it resets every turn).
- `teleport(id, to): { hazardDamage }` — sets position directly, no movement
  points spent; applies the same hazard rule as `moveParticipant`.

`GameSession.handleUseAbility`:
- The "action already taken" check is skipped for `freeAction` abilities;
  instead reject if `freeActionsUsed` already has the ability id
  ("Already used this turn.").
- New branch for `targetType === 'tile'` with a `teleport` effect:
  1. require `targetX/targetY`; validate with `isValidTeleportDestination`
     (error reply "Can't blink there." style message using the ability name).
  2. spend energy, `combat.teleport(...)`, apply hazard damage via PlayerManager.
  3. broadcast `combat_action_result` with `action: 'use_ability'`, `abilityId`,
     and new optional `teleportFrom` / `teleportTo` fields; broadcast a position
     update so all clients' boards move the unit; text log narration.
  4. if `freeAction`: add to `freeActionsUsed`, do **not** `markActionTaken`,
     do **not** regen energy or advance the turn; send the turn state
     (movement remaining unchanged) so the client stays in the player's turn.
     Otherwise follow the normal end-of-action path.
- A downed-by-hazard caster follows existing hazard-down handling.

`shared/src/messages.ts`: `CombatActionResultMessage` gains optional
`teleportFrom?: {x,y}`, `teleportTo?: {x,y}`.

`shared/src/combat/closeUp.ts`: `closeUpFor` returns `null` for an ability
whose definition has `closeUp: false` (ctx gains a flag alongside
`isPassiveAbility`), so no close-up delay is added server-side either.

## 4. Client

- `ArenaActionBar`: `targetType: 'tile'` enters the existing `target_ability`
  mode with prompt "Click a tile to {name}...". Button disabled when the
  ability id is in this turn's used free actions (tracked client-side from
  our own results, cleared on our next turn start). After a free action the
  bar stays in main mode.
- `ArenaView`/grid: while targeting a tile ability, highlight
  `teleportDestinations(...)`; clicking a highlighted tile sends
  `use_ability` with `targetX/targetY`.
- Board: new `BoardFx` kind `blink` — fading phosphor afterimage of the unit
  glyph at `teleportFrom`, bright flash at `teleportTo`. The unit snaps (no
  path tween).
- `sfxDirector`: map the teleport result to an existing cue (e.g. shimmer)
  if one fits; no new audio generation in this scope.

## 5. Testing

Unit (Vitest), with fixture abilities, not the real Blink:
- `teleportRange` formula; `isValidTeleportDestination`: in range, out of
  range, wall, occupied, own tile, LoS flag on (blocked by wall) vs off
  (passes).
- Server: free-action tile ability moves the caster, spends energy, does not
  end the turn or mark action taken; second use same turn rejected; attack
  still allowed after; flag resets next turn; hazard landing deals damage;
  invalid destination rejected with no energy spent.
- `closeUpFor` returns null for `closeUp: false`.

App check: sandbox duel via `scripts/sandbox-drive.mjs` as Phaseknife —
blink adjacent to the mob, then Phase Strike; screenshot.

## Out of scope

Mob/bot use of Blink, exploration-mode blinking, new SFX takes, revamping the
other Phaseknife abilities.
