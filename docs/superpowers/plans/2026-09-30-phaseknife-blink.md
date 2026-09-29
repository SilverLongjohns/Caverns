# Phaseknife Blink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Phaseknife a data-driven, Speed-scaled teleport ("Blink") that is a free action in arena combat.

**Architecture:** Generic ability schema additions (`targetType: 'tile'`, `freeAction`, `closeUp: false`, effect `teleport`) plus pure shared helpers for range and destination validity, used by both server validation and client highlighting. The server gets a tile-ability branch in `GameSession.handleUseAbility` backed by `ArenaCombatManager.teleport()`; the client adds a tile-targeting mode and a `blink` board effect.

**Tech Stack:** TypeScript monorepo (npm workspaces `shared`, `server`, `client`, `roomgrid`), Vitest, React + Zustand, `ws`.

**Spec:** `docs/superpowers/specs/2026-09-29-phaseknife-blink-design.md`

## Global Constraints

- Abilities are data-driven: **no code or test may name a specific ability or class** (`blink`, `shadowblade`, "Phaseknife"). Tests find abilities by shape (`targetType === 'tile'`, `freeAction`) or use fixtures.
- Blink data exactly: `energyCost: 5`, `targetType: "tile"`, `freeAction: true`, `closeUp: false`, effect `{ "type": "teleport", "baseRange": 1, "perSpeed": 0.34, "requiresLineOfSight": false }`.
- Range = `baseRange + floor(initiative × perSpeed)`, Chebyshev distance. Speed is the internal `initiative` stat.
- Destination: walkable tile (roomgrid `TILE_PROPERTIES[t].walkable`), unoccupied by a living unit, not the caster's own tile; LoS (`hasLineOfSight`) only when `requiresLineOfSight` is true.
- Hazard landing deals 5 (same as walking onto one).
- Free action: no action consumed, no movement spent, turn does not end, once per turn per ability.
- Arena only. Mobs and sandbox bots never use it.
- Node runs on Windows: run tests via `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\<pkg> && npx vitest run <file>"`. Server and client import `@caverns/shared` from `shared/dist` — **after any shared change run** `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run build --workspace=shared"`.
- Git: run through `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && git ..."`, stage explicit paths only, write the message to a file and use `git commit -F <file>` (inline `-m` with spaces breaks through cmd.exe). End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Branch: `feature/phaseknife-blink`.

## Review Focus

1. **Hazard landing downs the caster** — a free-action blink onto a hazard at 5 HP or less must down them and end their turn, not leave a downed player still acting. (Task 3 test.)
2. **Rejected blink costs nothing** — an invalid tile (wall, occupied, out of range, own tile) must not spend energy or mark the ability used. (Task 3 test.)
3. **Blink after the action is taken** — attacking first and then blinking must still work, and the Abilities menu must stay open for it. (Task 3 server test + Task 4 availability helper test.)
4. **Energy exactly at cost** — 5 energy is enough, 4 is not (existing `hasEnergy` check; Task 3 test pins the "not enough" branch for a tile ability).
5. **Close-up opt-out doesn't break close-up data checks** — the existing "every non-passive ability gets a close-up" test and art/sound checks must tolerate `closeUp: false`. (Task 1.)

---

### Task 1: Shared schema, teleport helpers, close-up opt-out

**Files:**
- Modify: `shared/src/classTypes.ts:11-18`
- Create: `shared/src/combat/teleport.ts`
- Create: `shared/src/combat/teleport.test.ts`
- Modify: `shared/src/index.ts` (export teleport)
- Modify: `shared/src/combat/closeUp.ts:15,26,68`
- Modify: `shared/src/combat/closeUp.test.ts:9-17,86-87`
- Modify: `shared/src/messages.ts` (`CombatActionResultMessage`, after `downedIds?`)

**Interfaces:**
- Produces (from `@caverns/shared`):
  - `AbilityDefinition.targetType` includes `'tile'`; `freeAction?: boolean`; `closeUp?: false | { art?: string; sound?: 'crack' | 'boom' | 'shimmer' }`
  - `type TeleportEffect = { type: 'teleport'; baseRange: number; perSpeed: number; requiresLineOfSight: boolean }` (a type alias, not an interface, so it is assignable to `AbilityEffect`'s index signature)
  - `teleportEffectOf(ability: AbilityDefinition): TeleportEffect | undefined`
  - `teleportRange(effect: TeleportEffect, initiative: number): number`
  - `interface TeleportCheck { grid: { width: number; height: number; tiles: string[][] }; from: { x: number; y: number }; effect: TeleportEffect; initiative: number; occupied: Set<string>; isWalkable: (tile: string) => boolean }` (`occupied` holds `"x,y"` keys)
  - `isValidTeleportDestination(c: TeleportCheck, to: { x: number; y: number }): boolean`
  - `teleportDestinations(c: TeleportCheck): { x: number; y: number }[]`
  - `CombatActionResultMessage.teleportFrom?: { x: number; y: number }`, `teleportTo?: { x: number; y: number }`
  - `closeUpFor` ctx gains optional `closeUpDisabled?: boolean`

- [ ] **Step 1: Write the failing teleport tests**

`shared/src/combat/teleport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { teleportRange, isValidTeleportDestination, teleportDestinations, teleportEffectOf, type TeleportEffect, type TeleportCheck } from './teleport.js';
import type { AbilityDefinition } from '../classTypes.js';

// 7x5: border walls, a wall column at x=3 (y=1..3), floor elsewhere
function grid() {
  const tiles: string[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: string[] = [];
    for (let x = 0; x < 7; x++) row.push(y === 0 || y === 4 || x === 0 || x === 6 || x === 3 ? 'wall' : 'floor');
    tiles.push(row);
  }
  return { width: 7, height: 5, tiles };
}
const walkable = (t: string) => t === 'floor' || t === 'hazard' || t === 'water';
const phase: TeleportEffect = { type: 'teleport', baseRange: 1, perSpeed: 0.34, requiresLineOfSight: false };
const sighted: TeleportEffect = { ...phase, requiresLineOfSight: true };
const check = (over: Partial<TeleportCheck> = {}): TeleportCheck => ({
  grid: grid(), from: { x: 2, y: 2 }, effect: phase, initiative: 5, occupied: new Set(), isWalkable: walkable, ...over,
});

describe('teleportRange', () => {
  it('is baseRange + floor(initiative * perSpeed)', () => {
    expect(teleportRange(phase, 5)).toBe(2);   // 1 + floor(1.7)
    expect(teleportRange(phase, 9)).toBe(4);   // 1 + floor(3.06)
    expect(teleportRange(phase, 0)).toBe(1);
  });
});

describe('isValidTeleportDestination', () => {
  it('accepts open floor within range, passing through a wall when LoS is not required', () => {
    expect(isValidTeleportDestination(check(), { x: 4, y: 2 })).toBe(true); // across the x=3 wall, distance 2
  });
  it('rejects out of range', () => {
    expect(isValidTeleportDestination(check(), { x: 5, y: 2 })).toBe(false); // distance 3 > 2
  });
  it('rejects walls and off-grid tiles', () => {
    expect(isValidTeleportDestination(check(), { x: 3, y: 2 })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: -1, y: 2 })).toBe(false);
  });
  it('rejects occupied tiles and the caster\'s own tile', () => {
    expect(isValidTeleportDestination(check({ occupied: new Set(['1,1']) }), { x: 1, y: 1 })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: 2, y: 2 })).toBe(false);
  });
  it('requires line of sight only when the effect says so', () => {
    expect(isValidTeleportDestination(check({ effect: sighted }), { x: 4, y: 2 })).toBe(false);
    expect(isValidTeleportDestination(check({ effect: sighted }), { x: 1, y: 1 })).toBe(true);
  });
});

describe('teleportDestinations', () => {
  it('lists exactly the valid tiles', () => {
    const tiles = teleportDestinations(check({ occupied: new Set(['1,1']) }));
    const keys = tiles.map((t) => `${t.x},${t.y}`).sort();
    expect(keys).toEqual(['1,2', '1,3', '2,1', '2,3', '4,1', '4,2', '4,3'].sort());
  });
});

describe('teleportEffectOf', () => {
  it('returns the first teleport effect, or undefined', () => {
    const base = { id: 'x', name: 'X', description: '', energyCost: 0, passive: false } as const;
    const a: AbilityDefinition = { ...base, targetType: 'tile', effects: [{ type: 'heal' }, phase] };
    const b: AbilityDefinition = { ...base, targetType: 'none', effects: [{ type: 'heal' }] };
    expect(teleportEffectOf(a)).toEqual(phase);
    expect(teleportEffectOf(b)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run src/combat/teleport.test.ts"`
Expected: FAIL — cannot resolve `./teleport.js`.

- [ ] **Step 3: Extend the ability schema**

In `shared/src/classTypes.ts`, change `AbilityDefinition`:

```ts
  targetType: 'none' | 'ally' | 'enemy' | 'area_enemy' | 'area_ally' | 'tile';
  passive: boolean;
  /** Free action: doesn't use the turn's action or end the turn; usable once per turn. */
  freeAction?: boolean;
```

and replace the `closeUp` field with:

```ts
  /** Optional close-up presentation; every field falls back to a derived default. `false` = never a close-up. */
  closeUp?: false | { art?: string; sound?: 'crack' | 'boom' | 'shimmer' };
```

- [ ] **Step 4: Implement the helpers**

`shared/src/combat/teleport.ts`:

```ts
import type { AbilityDefinition } from '../classTypes.js';
import { chebyshev, hasLineOfSight } from './ranged.js';

type Tile = { x: number; y: number };

// A type alias (not an interface) so it stays assignable to AbilityEffect's index signature.
export type TeleportEffect = { type: 'teleport'; baseRange: number; perSpeed: number; requiresLineOfSight: boolean };

export interface TeleportCheck {
  grid: { width: number; height: number; tiles: string[][] };
  from: Tile;
  effect: TeleportEffect;
  initiative: number;
  /** "x,y" keys of tiles holding a living unit (other than the caster). */
  occupied: Set<string>;
  isWalkable: (tile: string) => boolean;
}

export function teleportEffectOf(ability: AbilityDefinition): TeleportEffect | undefined {
  return ability.effects.find((e) => e.type === 'teleport') as TeleportEffect | undefined;
}

/** Tiles (Chebyshev) a teleport reaches: baseRange + floor(initiative × perSpeed). */
export function teleportRange(effect: TeleportEffect, initiative: number): number {
  return effect.baseRange + Math.floor(initiative * effect.perSpeed);
}

export function isValidTeleportDestination(c: TeleportCheck, to: Tile): boolean {
  if (to.x < 0 || to.y < 0 || to.x >= c.grid.width || to.y >= c.grid.height) return false;
  if (to.x === c.from.x && to.y === c.from.y) return false;
  const range = teleportRange(c.effect, c.initiative);
  if (chebyshev(c.from, to) > range) return false;
  if (!c.isWalkable(c.grid.tiles[to.y][to.x])) return false;
  if (c.occupied.has(`${to.x},${to.y}`)) return false;
  if (c.effect.requiresLineOfSight && !hasLineOfSight(c.grid, c.from, to, range)) return false;
  return true;
}

export function teleportDestinations(c: TeleportCheck): Tile[] {
  const range = teleportRange(c.effect, c.initiative);
  const out: Tile[] = [];
  for (let y = c.from.y - range; y <= c.from.y + range; y++) {
    for (let x = c.from.x - range; x <= c.from.x + range; x++) {
      if (isValidTeleportDestination(c, { x, y })) out.push({ x, y });
    }
  }
  return out;
}
```

In `shared/src/index.ts`, after `export * from './combat/ranged.js';` add:

```ts
export * from './combat/teleport.js';
```

- [ ] **Step 5: Run the teleport tests to verify they pass**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run src/combat/teleport.test.ts"`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing close-up opt-out test**

In `shared/src/combat/closeUp.test.ts`, replace the first test (`'every non-passive ability in the data gets an ability close-up; passives never do'`) with:

```ts
  it('every non-passive ability in the data gets an ability close-up unless it opts out; passives never do', () => {
    for (const cls of CLASS_DEFINITIONS) {
      for (const a of cls.abilities) {
        const r = closeUpFor({ action: 'use_ability', abilityId: a.id }, { ...player, isPassiveAbility: a.passive, closeUpDisabled: a.closeUp === false });
        if (a.passive || a.closeUp === false) expect(r, a.id).toBeNull();
        else expect(r, a.id).toEqual({ kind: 'ability', durationMs: CLOSE_UP_CONFIG.abilityMs });
      }
    }
  });
  it('an ability with closeUp: false never gets a close-up, even when it kills', () => {
    expect(closeUpFor({ action: 'use_ability', targetDowned: true }, { ...player, closeUpDisabled: true })).toBeNull();
  });
```

and change the art/sound data check (around lines 86-87) to narrow first:

```ts
        const cu = a.closeUp || undefined;
        if (cu?.sound !== undefined) expect(CLOSE_UP_SOUNDS, a.id).toContain(cu.sound);
        if (cu?.art !== undefined) expect(cu.art, a.id).toMatch(/^\/closeups\//);
```

- [ ] **Step 7: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run src/combat/closeUp.test.ts"`
Expected: FAIL — the new "closeUp: false" test gets `{ kind: 'ability', ... }` instead of `null`.

- [ ] **Step 8: Implement the opt-out**

In `shared/src/combat/closeUp.ts`:

```ts
interface Ctx { actorType: Side; targetType?: Side; isPassiveAbility: boolean; closeUpDisabled?: boolean }
```

In `closeUpFor`, the ability line becomes:

```ts
    if (r.action === 'use_ability') return ctx.isPassiveAbility || ctx.closeUpDisabled ? null : make('ability');
```

In `closeUpForParticipants`, the return becomes:

```ts
  return closeUpFor(r, { actorType: actor.type, targetType, isPassiveAbility: ability?.passive ?? false, closeUpDisabled: ability?.closeUp === false });
```

- [ ] **Step 9: Add the message fields**

In `shared/src/messages.ts`, in `CombatActionResultMessage` directly after `downedIds?: string[];`:

```ts
  /** Teleport abilities: where the caster left and landed. */
  teleportFrom?: { x: number; y: number };
  teleportTo?: { x: number; y: number };
```

- [ ] **Step 10: Run all shared tests, then build shared**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run"`
Expected: PASS.
Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run build --workspace=shared"`
Expected: exits 0.

- [ ] **Step 11: Fix the client's close-up field reads**

`client/src/combat/closeUpStage.ts` reads `ability?.closeUp?.art` (line ~64) and `ability?.closeUp?.sound` (line ~100), which no longer type-check with `false`. At the top of the function that computes these (where `ability` is resolved), add:

```ts
  const abilityCloseUp = ability?.closeUp || undefined;
```

and replace `ability?.closeUp?.art` with `abilityCloseUp?.art` and `ability?.closeUp?.sound` with `abilityCloseUp?.sound`.

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit -p ."`
Expected: no errors in `closeUpStage.ts` (report any pre-existing unrelated errors rather than fixing them).

- [ ] **Step 12: Commit**

Stage: `shared/src/classTypes.ts shared/src/combat/teleport.ts shared/src/combat/teleport.test.ts shared/src/index.ts shared/src/combat/closeUp.ts shared/src/combat/closeUp.test.ts shared/src/messages.ts client/src/combat/closeUpStage.ts`
Message: `Feat: tile-target, free-action and teleport ability schema + shared helpers`

---

### Task 2: ArenaCombatManager — free-action tracking and teleport

**Files:**
- Modify: `server/src/ArenaCombatManager.ts:1-20,67-81,113-123`
- Test: `server/src/ArenaCombatManager.test.ts`

**Interfaces:**
- Consumes: `TeleportEffect`, `isValidTeleportDestination` from `@caverns/shared` (Task 1).
- Produces:
  - `TurnState.freeActionsUsed: Set<string>` (fresh each `startTurn`)
  - `ArenaCombatManager.markFreeActionUsed(id: string, abilityId: string): void`
  - `ArenaCombatManager.teleport(id: string, to: { x: number; y: number }, effect: TeleportEffect): TeleportOutcome` where `type TeleportOutcome = { ok: false } | { ok: true; from: { x: number; y: number }; hazardDamage: number; hp: number; downed: boolean }` (exported)

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('ArenaCombatManager', ...)` block of `server/src/ArenaCombatManager.test.ts` (uses the file's existing `makeGrid`, `makePlayer`, `makeMob`; `makePlayer` has initiative 6 → range 1 + floor(2.04) = 3 with the effect below). Add `type TeleportEffect` to the existing `@caverns/shared` import.

```ts
  describe('teleport', () => {
    const effect: TeleportEffect = { type: 'teleport', baseRange: 1, perSpeed: 0.34, requiresLineOfSight: false };
    const setup = (grid = makeGrid()) => {
      const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } });
      arena.startTurn('p1');
      return arena;
    };

    it('moves the unit without spending movement', () => {
      const arena = setup();
      const before = arena.getTurnState('p1')!.movementRemaining;
      const r = arena.teleport('p1', { x: 4, y: 3 }, effect);
      expect(r).toMatchObject({ ok: true, from: { x: 1, y: 2 }, hazardDamage: 0, downed: false });
      expect(arena.getPosition('p1')).toEqual({ x: 4, y: 3 });
      expect(arena.getTurnState('p1')!.movementRemaining).toBe(before);
    });

    it('refuses an invalid destination and leaves the unit in place', () => {
      const arena = setup();
      expect(arena.teleport('p1', { x: 5, y: 2 }, effect)).toEqual({ ok: false }); // distance 4 > 3
      expect(arena.teleport('p1', { x: 0, y: 2 }, effect)).toEqual({ ok: false }); // wall
      expect(arena.getPosition('p1')).toEqual({ x: 1, y: 2 });
    });

    it('refuses a tile held by a living unit', () => {
      const grid = makeGrid();
      const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 3, y: 2 } });
      arena.startTurn('p1');
      expect(arena.teleport('p1', { x: 3, y: 2 }, effect)).toEqual({ ok: false });
    });

    it('applies hazard damage on landing and reports a down', () => {
      const grid = makeGrid();
      grid.tiles[2][3] = 'hazard';
      const arena = setup(grid);
      const r = arena.teleport('p1', { x: 3, y: 2 }, effect);
      expect(r).toMatchObject({ ok: true, hazardDamage: 5, hp: 45, downed: false });

      const grid2 = makeGrid();
      grid2.tiles[2][3] = 'hazard';
      const arena2 = setup(grid2);
      arena2.getCombatManager().getParticipant('p1')!.hp = 5;
      expect(arena2.teleport('p1', { x: 3, y: 2 }, effect)).toMatchObject({ ok: true, hp: 0, downed: true });
    });

    it('tracks free actions per turn and resets them on the next turn', () => {
      const arena = setup();
      expect(arena.getTurnState('p1')!.freeActionsUsed.has('a')).toBe(false);
      arena.markFreeActionUsed('p1', 'a');
      expect(arena.getTurnState('p1')!.freeActionsUsed.has('a')).toBe(true);
      expect(arena.getTurnState('p1')!.actionTaken).toBe(false);
      arena.startTurn('p1');
      expect(arena.getTurnState('p1')!.freeActionsUsed.has('a')).toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/ArenaCombatManager.test.ts"`
Expected: FAIL — `arena.teleport is not a function`.

- [ ] **Step 3: Implement**

In `server/src/ArenaCombatManager.ts`:

Imports — extend the shared import and add a type import:

```ts
import { chebyshev, hitChance, hasLineOfSight, isValidTeleportDestination, type TeleportEffect } from '@caverns/shared';
```

Below the imports:

```ts
const HAZARD_DAMAGE = 5;
const isWalkableTile = (tile: string) => getMovementCost(tile) !== Infinity;

export type TeleportOutcome =
  | { ok: false }
  | { ok: true; from: { x: number; y: number }; hazardDamage: number; hp: number; downed: boolean };
```

`TurnState`:

```ts
interface TurnState {
  movementRemaining: number;
  actionTaken: boolean;
  /** Free-action ability ids used this turn. */
  freeActionsUsed: Set<string>;
}
```

`startTurn` sets `freeActionsUsed: new Set()` alongside the existing fields. After `markActionTaken`, add:

```ts
  markFreeActionUsed(id: string, abilityId: string): void {
    this.turnStates.get(id)?.freeActionsUsed.add(abilityId);
  }

  /** Teleport a unit to `to` if the effect allows it. No movement points are spent; hazards still bite. */
  teleport(id: string, to: { x: number; y: number }, effect: TeleportEffect): TeleportOutcome {
    const from = this.positions.get(id);
    const participant = this.combatManager.getParticipant(id);
    if (!from || !participant) return { ok: false };
    const valid = isValidTeleportDestination(
      { grid: this.grid, from, effect, initiative: participant.initiative, occupied: this.getOccupied(id), isWalkable: isWalkableTile },
      to,
    );
    if (!valid) return { ok: false };
    this.positions.set(id, { x: to.x, y: to.y });
    let hazardDamage = 0;
    let downed = false;
    if (this.grid.tiles[to.y][to.x] === 'hazard') {
      hazardDamage = HAZARD_DAMAGE;
      downed = this.combatManager.applyDamage(id, hazardDamage)?.targetDowned ?? false;
    }
    return { ok: true, from: { ...from }, hazardDamage, hp: participant.hp, downed };
  }
```

In `handleMove`, replace the literal `hazardDamage = 5;` with `hazardDamage = HAZARD_DAMAGE;`.

- [ ] **Step 4: Run to verify it passes**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/ArenaCombatManager.test.ts"`
Expected: PASS. If `applyDamage` clamps HP differently (e.g. `hp` not 0 on down), adjust only the test's expected `hp` to what `CombatManager.applyDamage` actually produces — `downed: true` is the requirement.

- [ ] **Step 5: Commit**

Stage: `server/src/ArenaCombatManager.ts server/src/ArenaCombatManager.test.ts`
Message: `Feat: arena teleport + per-turn free-action tracking`

---

### Task 3: GameSession tile-ability branch + Blink data

**Files:**
- Modify: `server/src/GameSession.ts` — `handleUseAbility` (starts ~line 2448): action-taken check (~2466-2471) and a new branch before `// --- Area ability`
- Modify: `shared/src/data/classes.json` — `shadowblade.abilities`
- Create: `server/src/GameSession.teleport.test.ts`

**Interfaces:**
- Consumes: `teleportEffectOf` (Task 1); `combat.teleport`, `combat.markFreeActionUsed`, `TurnState.freeActionsUsed` (Task 2).
- Produces (wire behaviour the client relies on), for a valid tile ability, in this order:
  1. `arena_positions_update` `{ positions, movementRemaining }` (no `path`, no `moverId`)
  2. `combat_action_result` `{ action: 'use_ability', actorId, actorName, abilityId, abilityName, teleportFrom, teleportTo, actorHp?, actorDowned? }`
  3. `text_log`, `player_update` (energy)
  - Free action and caster still up → turn continues (no `combat_turn`, no advance).

- [ ] **Step 1: Add the Blink data**

In `shared/src/data/classes.json`, in the `shadowblade` class's `abilities` array, insert between the `backstab` and `pickpocket` entries:

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
      },
```

Rebuild shared: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run build --workspace=shared"`, then run shared tests (`npx vitest run` in `shared`) — the Task 1 close-up data test must still PASS with the new entry.

- [ ] **Step 2: Write the failing server tests**

`server/src/GameSession.teleport.test.ts` (setup mirrors `GameSession.closeUp.test.ts`):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, CLASS_DEFINITIONS, teleportEffectOf, teleportDestinations, type ServerMessage, type SandboxOverrides } from '@caverns/shared';
import { TILE_PROPERTIES, type TileType } from '@caverns/roomgrid';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

// Data-driven: any class with a free-action tile teleport.
const cls = CLASS_DEFINITIONS.find((c) => c.abilities.some((a) => !a.passive && a.targetType === 'tile' && a.freeAction && teleportEffectOf(a)));
const ability = cls?.abilities.find((a) => !a.passive && a.targetType === 'tile' && a.freeAction && teleportEffectOf(a));

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; vi.useRealTimers(); });

function setup(overrides: SandboxOverrides = {}) {
  vi.useFakeTimers();
  restore = installSeededRandom(4242);
  const r = resolveSetup('duel', { party: [cls!.id], ...overrides });
  if (!r.ok) throw new Error(r.error);
  const sent: ServerMessage[] = [];
  const session = new GameSession((m) => sent.push(m), (_to, m) => sent.push(m), buildSandboxContent(r.setup));
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  session.setTiming({ mobTurnDelayMs: 100 });
  session.startGame();
  session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
  for (let i = 0; i < 200 && session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId !== 'p1'; i++) vi.advanceTimersByTime(50);
  vi.advanceTimersByTime(Math.max(CLOSE_UP_CONFIG.abilityMs, CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.shotMs) + 100);
  expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
  return { session, sent };
}

type Internals = { combats: Map<string, { getParticipant(id: string): { hp: number; initiative: number }; getGrid(): { tiles: string[][] }; getTurnState(id: string): { actionTaken: boolean; freeActionsUsed: Set<string> } }> };
const combatOf = (s: GameSession) => (s as unknown as Internals).combats.get(SANDBOX_ROOM_ID)!;
const walkable = (t: string) => TILE_PROPERTIES[t as TileType]?.walkable ?? false;

function destinations(session: GameSession) {
  const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
  const occupied = new Set(Object.entries(snap.positions).filter(([id]) => id !== 'p1').map(([, p]) => `${p.x},${p.y}`));
  return teleportDestinations({
    grid: snap.grid, from: snap.positions.p1, effect: teleportEffectOf(ability!)!,
    initiative: combatOf(session).getParticipant('p1').initiative, occupied, isWalkable: walkable,
  });
}
const playerOf = (s: GameSession) =>
  (s as unknown as { playerManager: { getPlayer(id: string): { energy: number } } }).playerManager.getPlayer('p1');

describe('tile teleport abilities', () => {
  it('data has a free-action tile teleport to test', () => {
    expect(ability, 'classes.json needs a free-action tile teleport ability').toBeDefined();
  });

  it('teleports, spends energy, and keeps the turn going', () => {
    const { session, sent } = setup();
    const to = destinations(session).find((t) => combatOf(session).getGrid().tiles[t.y][t.x] !== 'hazard')!;
    const from = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1;
    const energy0 = playerOf(session).energy;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    const out = sent.slice(before);
    expect(out.filter((m) => m.type === 'error')).toEqual([]);
    expect(playerOf(session).energy).toBe(energy0 - ability!.energyCost);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(to);
    const result = out.find((m) => m.type === 'combat_action_result') as { teleportFrom?: unknown; teleportTo?: unknown; abilityId?: string };
    expect(result).toMatchObject({ abilityId: ability!.id, teleportFrom: from, teleportTo: to });
    vi.advanceTimersByTime(5000);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
    expect(combatOf(session).getTurnState('p1').actionTaken).toBe(false);
    session.dispose();
  });

  it('refuses a second use in the same turn', () => {
    const { session, sent } = setup();
    const [a] = destinations(session);
    session.handleUseAbility('p1', ability!.id, undefined, a.x, a.y);
    const [b] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, b.x, b.y);
    expect(sent.slice(before).some((m) => m.type === 'error')).toBe(true);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(a);
    session.dispose();
  });

  it('still works after the turn\'s action is taken', () => {
    const { session, sent } = setup();
    combatOf(session).getTurnState('p1').actionTaken = true; // test-only: as if the player had already attacked
    const [to] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    expect(sent.slice(before).filter((m) => m.type === 'error')).toEqual([]);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(to);
    session.dispose();
  });

  it('rejects an invalid tile without spending energy or the use', () => {
    const { session, sent } = setup();
    const from = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, from.x, from.y); // own tile is never valid
    const out = sent.slice(before);
    expect(out.some((m) => m.type === 'error')).toBe(true);
    expect(out.some((m) => m.type === 'player_update')).toBe(false);
    expect(combatOf(session).getTurnState('p1').freeActionsUsed.has(ability!.id)).toBe(false);
    session.dispose();
  });

  it('refuses without enough energy', () => {
    const { session, sent } = setup();
    playerOf(session).energy = ability!.energyCost - 1;
    const [to] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    expect(sent.slice(before).some((m) => m.type === 'error')).toBe(true);
    session.dispose();
  });

  it('a hazard landing that downs the caster ends their turn', () => {
    const { session, sent } = setup();
    const combat = combatOf(session);
    const [to] = destinations(session);
    combat.getGrid().tiles[to.y][to.x] = 'hazard'; // test-only terrain edit
    combat.getParticipant('p1').hp = 1;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    const result = sent.slice(before).find((m) => m.type === 'combat_action_result') as { actorDowned?: boolean; actorHp?: number };
    expect(result.actorDowned).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)?.currentTurnId ?? null).not.toBe('p1');
    session.dispose();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/GameSession.teleport.test.ts"`
Expected: FAIL — "teleports…" fails (position unchanged / no `teleportTo`); the data test passes.

- [ ] **Step 4: Implement the free-action gate**

In `handleUseAbility`, replace:

```ts
    // Check if action already taken this turn
    const turnState = combat.getTurnState(playerId);
    if (turnState?.actionTaken) {
      this.sendTo(playerId, { type: 'error', message: 'Action already taken this turn.' });
      return;
    }
```

with:

```ts
    // Free actions are limited to once per turn; everything else needs the turn's action
    const turnState = combat.getTurnState(playerId);
    if (ability.freeAction) {
      if (turnState?.freeActionsUsed.has(ability.id)) {
        this.sendTo(playerId, { type: 'error', message: `${ability.name} already used this turn.` });
        return;
      }
    } else if (turnState?.actionTaken) {
      this.sendTo(playerId, { type: 'error', message: 'Action already taken this turn.' });
      return;
    }
```

(Keep the lines between this check and `const participants = ...` unchanged.)

- [ ] **Step 5: Implement the tile branch**

Add `teleportEffectOf` to the file's `@caverns/shared` import. Insert directly before `// --- Area ability (area_enemy / area_ally) ---`:

```ts
    // --- Tile ability (teleport) ---
    if (ability.targetType === 'tile') {
      const effect = teleportEffectOf(ability);
      if (!effect || targetX === undefined || targetY === undefined) {
        this.sendTo(playerId, { type: 'error', message: `${ability.name} needs a destination tile.` });
        return;
      }
      const moved = combat.teleport(playerId, { x: targetX, y: targetY }, effect);
      if (!moved.ok) {
        this.sendTo(playerId, { type: 'error', message: `Can't ${ability.name} there.` });
        return;
      }
      this.playerManager.spendEnergy(playerId, ability.energyCost);

      this.broadcastToRoom(player.roomId, {
        type: 'arena_positions_update',
        positions: combat.getAllPositions(),
        movementRemaining: turnState?.movementRemaining ?? 0,
      } as any);
      this.broadcastToRoom(player.roomId, {
        type: 'combat_action_result',
        actorId: playerId,
        actorName: player.name,
        action: 'use_ability',
        abilityId: ability.id,
        abilityName: ability.name,
        teleportFrom: moved.from,
        teleportTo: { x: targetX, y: targetY },
        ...(moved.hazardDamage ? { actorHp: moved.hp } : {}),
        ...(moved.downed ? { actorDowned: true } : {}),
      } as any);
      const hazardNote = moved.hazardDamage ? ` and lands in a hazard for ${moved.hazardDamage} damage` : '';
      this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}${hazardNote}!`, logType: 'combat' });

      if (moved.downed) {
        this.playerManager.takeDamage(playerId, 999);
      }

      if (ability.freeAction && !moved.downed) {
        combat.markFreeActionUsed(playerId, ability.id);
        this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
        return;
      }

      combat.markActionTaken(playerId);
      if (!moved.downed) this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
      combat.advanceTurn();
      this.afterCombatTurn(player.roomId, combat, this.closeUpDelay(combat, { action: 'use_ability', actorId: playerId, abilityId: ability.id }));
      return;
    }
```

- [ ] **Step 6: Run to verify it passes, then the full server suite**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/GameSession.teleport.test.ts"`
Expected: PASS (7 tests).
Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run"`
Expected: no new failures. (Three server tests — PlayerManager base stats, WorldSession portal readiness and movement — may already fail on main. If they fail, confirm the failures are unrelated to this change, list them in your report, and don't fix them.)

- [ ] **Step 7: Commit**

Stage: `server/src/GameSession.ts server/src/GameSession.teleport.test.ts shared/src/data/classes.json`
Message: `Feat: Phaseknife Blink — free-action teleport scaled by Speed (server)`

---

### Task 4: Client — tile targeting and free-action availability

**Files:**
- Create: `client/src/ui/abilityAvailability.ts`
- Create: `client/src/ui/abilityAvailability.test.ts`
- Modify: `client/src/store/gameStore.ts` (state field ~82/179; `arena_combat_start` ~530; `combat_turn` ~558; `combat_end` ~626 and the other reset ~676)
- Modify: `client/src/components/ArenaActionBar.tsx`
- Modify: `client/src/components/ArenaView.tsx`

**Interfaces:**
- Consumes: `teleportEffectOf`, `teleportDestinations` (Task 1); server wire behaviour (Task 3).
- Produces:
  - `abilityAvailable(ability: AbilityDefinition, actionTaken: boolean, freeActionsUsed: readonly string[]): boolean`
  - store field `arenaFreeActionsUsed: string[]`
  - `ArenaActionBar` prop `freeActionsUsed: string[]`

- [ ] **Step 1: Write the failing test**

`client/src/ui/abilityAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AbilityDefinition } from '@caverns/shared';
import { abilityAvailable } from './abilityAvailability.js';

const base = { name: 'X', description: '', energyCost: 0, passive: false, effects: [] } as const;
const normal: AbilityDefinition = { ...base, id: 'n', targetType: 'enemy' };
const free: AbilityDefinition = { ...base, id: 'f', targetType: 'tile', freeAction: true };

describe('abilityAvailable', () => {
  it('normal abilities need the turn\'s action', () => {
    expect(abilityAvailable(normal, false, [])).toBe(true);
    expect(abilityAvailable(normal, true, [])).toBe(false);
  });
  it('free actions ignore the action but are once per turn', () => {
    expect(abilityAvailable(free, true, [])).toBe(true);
    expect(abilityAvailable(free, false, ['f'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/ui/abilityAvailability.test.ts"`
Expected: FAIL — cannot resolve `./abilityAvailability.js`.

- [ ] **Step 3: Implement the helper**

`client/src/ui/abilityAvailability.ts`:

```ts
import type { AbilityDefinition } from '@caverns/shared';

/** Whether an ability can be used now (ignoring energy): free actions once per turn, others need the turn's action. */
export function abilityAvailable(ability: AbilityDefinition, actionTaken: boolean, freeActionsUsed: readonly string[]): boolean {
  return ability.freeAction ? !freeActionsUsed.includes(ability.id) : !actionTaken;
}
```

Run the test again — Expected: PASS.

- [ ] **Step 4: Store field**

In `client/src/store/gameStore.ts`:
- In the state interface next to `arenaActionTaken: boolean;` add `arenaFreeActionsUsed: string[];`
- In the initial state next to `arenaActionTaken: false,` add `arenaFreeActionsUsed: [],`
- Everywhere the store sets `arenaActionTaken: false` (the `arena_combat_start`, `combat_turn`, `combat_end` cases and the reset at ~676), also set `arenaFreeActionsUsed: []`. For `combat_turn` that becomes:

```ts
      case 'combat_turn':
        set({ currentTurnId: msg.currentTurnId, arenaActionTaken: false, arenaFreeActionsUsed: [] });
        break;
```

- [ ] **Step 5: ArenaActionBar**

In `client/src/components/ArenaActionBar.tsx`:
- Import: `import { abilityAvailable } from '../ui/abilityAvailability.js';`
- Props: add `/** Free-action ability ids already used this turn. */ freeActionsUsed: string[];` to the interface and destructure it.
- Abilities button: replace `disabled={actionTaken || activeAbilities.length === 0}` with

```tsx
            disabled={!activeAbilities.some((a) => abilityAvailable(a, actionTaken, freeActionsUsed))}>
```

- In the abilities list, replace the `notEnoughEnergy` / `disabled` lines with:

```tsx
              const notEnoughEnergy = !player || player.energy < ability.energyCost;
              const unavailable = !abilityAvailable(ability, actionTaken, freeActionsUsed);
              return (
                <button
                  key={ability.id}
                  className={`ability-btn ${notEnoughEnergy ? 'no-energy' : ''}`}
                  disabled={notEnoughEnergy || unavailable}
```

- Targeting prompt: replace the ternary inside the `target_ability` `waiting-text` span with:

```tsx
            {effectiveMode.ability.targetType === 'tile'
              ? `Click a highlighted tile to ${effectiveMode.ability.name}...`
              : effectiveMode.ability.targetType === 'area_enemy' || effectiveMode.ability.targetType === 'area_ally'
                ? `Click a tile to target ${effectiveMode.ability.name}...`
                : `Click a target for ${effectiveMode.ability.name}...`}
```

- [ ] **Step 6: ArenaView tile mode**

In `client/src/components/ArenaView.tsx`:
- Imports: extend the shared import to `import { hasLineOfSight, rangedProfile, teleportEffectOf, teleportDestinations, type AbilityDefinition } from '@caverns/shared';` and add `import { TILE_PROPERTIES, type TileType } from '@caverns/roomgrid';`
- `type InteractionMode` gains `| 'target_ability_tile'`.
- Read the store: `const arenaFreeActionsUsed = useGameStore((s) => s.arenaFreeActionsUsed);`
- After the `occupied` memo, add:

```tsx
  const teleportTiles = useMemo(() => {
    if (interactionMode !== 'target_ability_tile' || !targetingAbility || !arenaGrid || !myPart) return new Set<string>();
    const effect = teleportEffectOf(targetingAbility);
    const from = arenaPositions[playerId];
    if (!effect || !from) return new Set<string>();
    const tiles = teleportDestinations({
      grid: arenaGrid, from, effect, initiative: myPart.initiative, occupied,
      isWalkable: (t) => TILE_PROPERTIES[t as TileType]?.walkable ?? false,
    });
    return new Set(tiles.map((t) => `${t.x},${t.y}`));
  }, [interactionMode, targetingAbility, arenaGrid, myPart, arenaPositions, playerId, occupied]);
```

- In `tileHighlights`, before `return highlights;`:

```tsx
    for (const key of teleportTiles) highlights.set(key, 'arena-range-highlight');
```

  and add `teleportTiles` to that memo's dependency array.
- In `handleTileClick`, before the `target_ability_area` block:

```tsx
    if (interactionMode === 'target_ability_tile' && targetingAbility) {
      if (!teleportTiles.has(`${x},${y}`)) return;
      onUseAbility(targetingAbility.id, undefined, x, y);
      if (targetingAbility.freeAction) {
        useGameStore.setState((s) => ({ arenaFreeActionsUsed: [...s.arenaFreeActionsUsed, targetingAbility.id] }));
      } else {
        useGameStore.setState({ arenaActionTaken: true });
      }
      setInteractionMode('none');
      setTargetingAbility(null);
      return;
    }
```

  and add `teleportTiles` to its dependency array.
- `onAbilityMode` becomes:

```tsx
        onAbilityMode={(ability) => {
          if (ability.targetType === 'tile') setInteractionMode('target_ability_tile');
          else if (ability.targetType === 'area_enemy' || ability.targetType === 'area_ally') setInteractionMode('target_ability_area');
          else setInteractionMode('target_ability_single');
          setTargetingAbility(ability);
        }}
```

- Pass `freeActionsUsed={arenaFreeActionsUsed}` to `<ArenaActionBar>`.

- [ ] **Step 7: Typecheck and client tests**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit -p . && npx vitest run"`
Expected: no new type errors; tests PASS.

- [ ] **Step 8: Commit**

Stage: `client/src/ui/abilityAvailability.ts client/src/ui/abilityAvailability.test.ts client/src/store/gameStore.ts client/src/components/ArenaActionBar.tsx client/src/components/ArenaView.tsx`
Message: `Feat: tile-targeted and free-action abilities in the arena action bar`

---

### Task 5: Client — blink board effect

**Files:**
- Modify: `client/src/combat/boardFx.ts`
- Modify: `client/src/combat/boardFx.test.ts`
- Modify: `client/src/components/ArenaGrid.tsx:69,79,217-295`
- Modify: `client/src/styles/boardfx.css`

**Interfaces:**
- Consumes: `combat_action_result.teleportFrom/teleportTo` (Task 3).
- Produces: `BoardFx` variant `{ id: number; kind: 'blink'; from: Tile; to: Tile; delayMs: number; until: number }`; `FX_TIMING.blinkMs = 450`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/combat/boardFx.test.ts` (it already imports `fxReceive`, `initialBoardFx`; add `FX_TIMING` to that import if absent):

```ts
describe('blink fx', () => {
  const ctx = { now: 1000, positions: { p1: { x: 4, y: 2 } }, participants: [{ id: 'p1', type: 'player' as const }] };
  it('adds a blink from the origin to the landing tile', () => {
    const s = fxReceive(initialBoardFx(), {
      type: 'combat_action_result', actorId: 'p1', actorName: 'A', action: 'use_ability',
      teleportFrom: { x: 1, y: 2 }, teleportTo: { x: 4, y: 2 },
    } as never, ctx);
    expect(s.fx).toEqual([{ id: 1, kind: 'blink', from: { x: 1, y: 2 }, to: { x: 4, y: 2 }, delayMs: 0, until: 1000 + FX_TIMING.blinkMs }]);
  });
  it('ignores ability results without a teleport', () => {
    const s = fxReceive(initialBoardFx(), { type: 'combat_action_result', actorId: 'p1', actorName: 'A', action: 'use_ability' } as never, ctx);
    expect(s.fx).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx vitest run src/combat/boardFx.test.ts"`
Expected: FAIL — `s.fx` is `[]` in the first test.

- [ ] **Step 3: Implement in boardFx.ts**

- `FX_TIMING`: add `blinkMs: 450,`.
- `BoardFx` union: add `| { id: number; kind: 'blink'; from: Tile; to: Tile; delayMs: number; until: number }`.
- In `fxReceive`, right after `if (msg.type !== 'combat_action_result') return { ...s, lastTile };`:

```ts
  const tp = msg as { teleportFrom?: Tile; teleportTo?: Tile };
  if (tp.teleportFrom && tp.teleportTo) {
    return { ...s, lastTile, fx: [...s.fx, { id: s.nextId, kind: 'blink', from: tp.teleportFrom, to: tp.teleportTo, delayMs: 0, until: ctx.now + FX_TIMING.blinkMs }], nextId: s.nextId + 1 };
  }
```

Run the test — Expected: PASS.

- [ ] **Step 4: Render it in ArenaGrid**

In `client/src/components/ArenaGrid.tsx`:
- `unitFx` loop skip line becomes `if (f.kind === 'number' || f.kind === 'projectile' || f.kind === 'tag' || f.kind === 'blink') continue;`
- `overlayFx` filter/type becomes `'projectile' | 'tag' | 'blink'` (both the type predicate and the condition `|| f.kind === 'blink'`), and `FxOverlay`'s `fx` prop type likewise.
- In `FxOverlay`'s `useLayoutEffect` tile collection, handle blink before the `else`:

```tsx
      if (f.kind === 'projectile' || f.kind === 'blink') {
        tiles.set(`from:${f.id}`, f.from);
        tiles.set(`to:${f.id}`, f.to);
      } else {
        tiles.set(`tag:${f.id}`, f.tile);
      }
```

- In the render map, after the `tag` branch:

```tsx
        if (f.kind === 'blink') {
          const a = rects[`from:${f.id}`];
          const b = rects[`to:${f.id}`];
          if (!a || !b) return null;
          return (
            <Fragment key={f.id}>
              <span className="fx-blink-out" style={{ left: a.left, top: a.top, width: a.width, height: a.height }} />
              <span className="fx-blink-in" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
            </Fragment>
          );
        }
```

  (add `Fragment` to the `react` import).

- [ ] **Step 5: CSS**

Append to `client/src/styles/boardfx.css` (before the `@media (prefers-reduced-motion` block):

```css
.fx-blink-out, .fx-blink-in { position: absolute; z-index: 12; pointer-events: none; box-sizing: border-box; }
.fx-blink-out { border: 1px solid #9dff6a; box-shadow: 0 0 10px 2px #5aff3c, inset 0 0 8px #5aff3c;
  animation: fx-blink-out 450ms steps(6) both; }
@keyframes fx-blink-out { 0% { opacity: .9; transform: scale(1) } 40% { opacity: .5 } 60% { opacity: .8 } 100% { opacity: 0; transform: scale(.2, 1.4) } }
.fx-blink-in { background: radial-gradient(circle, rgba(157, 255, 106, .85) 0%, rgba(90, 255, 60, .25) 45%, transparent 70%);
  animation: fx-blink-in 450ms ease-out both; }
@keyframes fx-blink-in { 0% { opacity: 1; transform: scale(1.8) } 100% { opacity: 0; transform: scale(.8) } }
```

and inside the existing `@media (prefers-reduced-motion: reduce)` block add:

```css
  .fx-blink-out, .fx-blink-in { animation: fx-number-still 450ms both; transform: none; }
```

- [ ] **Step 6: Typecheck + tests**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit -p . && npx vitest run"`
Expected: no new type errors; PASS.

- [ ] **Step 7: Commit**

Stage: `client/src/combat/boardFx.ts client/src/combat/boardFx.test.ts client/src/components/ArenaGrid.tsx client/src/styles/boardfx.css`
Message: `Feat: blink afterimage + arrival flash board effect`

---

### Task 6: In-app verification + docs

**Files:**
- Modify: `CLAUDE.md` ("What's Working" list) — **only the new line**; the user has uncommitted edits in this file, so do not stage it; tell the user instead.

- [ ] **Step 1: Start the sandbox**

Run in background: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run dev:sandbox"` and wait for Vite ready.

- [ ] **Step 2: Drive a duel as the class with the tile ability**

`scripts/sandbox-drive.mjs` has no ability step; drive via clicks. First capture the bar and highlights:

```
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/sandbox-drive.mjs duel?party=shadowblade --wait my-turn --shot 01-turn"
```

Then add a small `--ability <name>` step to `scripts/sandbox-drive.mjs` that clicks the "Abilities" `RelicButton` then the `.ability-btn` whose text starts with `<name>` (follow the pattern of `--reload`), and re-run with `--ability Blink --settle 300 --shot 02-targeting`. Read the screenshot: highlighted tiles should form a ring out to range 2 around the player, including tiles past walls. Then `--click x,y` a highlighted tile, `--settle 500 --shot 03-landed`, and `--attack-nearest` if adjacent (or `--end-turn`) with `--shot 04-after`.

Expected: unit relocates; no full-screen close-up; Move/Attack still enabled after the blink; Blink greyed in the Abilities list until the next turn; energy dropped by 5.

- [ ] **Step 3: Commit the drive-script step**

Stage: `scripts/sandbox-drive.mjs`
Message: `Tools: sandbox-drive --ability step`

- [ ] **Step 4: Docs**

Add to `CLAUDE.md` "What's Working" (leave unstaged; mention to the user):

```
- Free-action & tile abilities: `freeAction` (no action, once/turn), `targetType: 'tile'`, `teleport` effect (range = baseRange + floor(initiative × perSpeed); helpers in `shared/src/combat/teleport.ts`), `closeUp: false` opt-out. Phaseknife Blink is the first user.
```
