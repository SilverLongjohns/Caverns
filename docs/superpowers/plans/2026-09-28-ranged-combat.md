# Ranged Combat (Trial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every class can carry a gun in a new `ranged` slot and use two new arena actions: **Shoot** (range and hit chance come from the new Marksmanship stat) and **Reload** (refills the magazine and ends the turn). Shots play the strike close-up with per-class ranged-pose art, plus a tracer projectile on the board.

**Architecture:**
- A shared module `shared/src/combat/ranged.ts` holds the pure maths and profile helpers. It also takes over line of sight from the server, so the client preview and the server check can never disagree:
  - `effectiveRange` and `hitChance`;
  - `rangedProfile(player)`, which precomputes shot damage, range and magazine;
  - `withStarterRanged` (migration);
  - `hasLineOfSight`, which **moves here** from `server/src/arenaMovement.ts`.
- The server adds `resolveShot` and `reload` to `CombatManager`, where ammo lives on the participant.
- `ArenaCombatManager` adds `checkShot`, `shoot` and `reload`, which cover range, line of sight and the dice roll.
- `GameSession.handleRangedAction` follows the same lifecycle as `handleCombatAction`.
- The client adds a `projectile` board effect, a `shoot` art role, and a Shoot/Reload targeting mode.

**Tech Stack:** TypeScript monorepo (npm workspaces `shared`, `server`, `client`, `itemgen`, `roomgrid`), Vitest, React + Zustand, `ws`, PixelLab MCP for art.

**Spec:** `docs/superpowers/specs/2026-09-28-ranged-combat-design.md` (read it first).

**How to run things** (Node is installed on Windows, not WSL; run everything through `cmd.exe`):
- Shared tests: `cmd.exe /c "cd shared && npx vitest run <file>"`
- **After changing `shared/`**, rebuild it before running server or client tests: `cmd.exe /c "npm run build --workspace=shared"`
- Server tests: `cmd.exe /c "cd server && npx vitest run <file>"`. For the full suite, redirect to a log and read the tail and every `×` line: `cmd.exe /c "cd server && npx vitest run" > .sandbox/server.log 2>&1`
- Client tests plus typecheck: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
- itemgen: `cmd.exe /c "cd itemgen && npx vitest run"`
- Commit through Windows git, with explicit paths only (never `-A`, never push): `git.exe add <paths> && git.exe commit -m "..." -- <paths>`. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The working tree has many unrelated modified files (line-ending noise). **Never stage anything you did not touch.**

## Global Constraints

- **Data-driven:** no code, CSS or test may name a specific gun, class or mob. Weapon types, starters and tuning come from `rangedConfig.json`, `classes.json` and `content.ts`. Tests iterate over data.
- **Tuning lives in `shared/src/data/rangedConfig.json`.** Starting values:
  - `rangePerMarksmanship` 1, `baseHit` 0.85, `hitPerMarksmanship` 0.03;
  - `falloffPerTile` 0.07, `falloffStart` 2;
  - `minHit` 0.15, `maxHit` 0.95.
- **Marksmanship base is 2 for every class.** It gets a `statDefinitions` entry with `perPoint` 1.
- **Distance is Chebyshev,** the same as ability `range`. Line of sight is blocked by `wall` and `chasm`.
- **Shot damage** = `max(COMBAT_CONFIG.minDamage, floor(classBaseDamage + gunDamage − effectiveDefense))`.
  - Ferocity, melee or offhand damage, item effects and crits never apply to shots.
  - Gun damage never adds to melee `damage`.
- **Shoot and Reload each end the turn.** Moving first is allowed. Ammo starts full in every combat, including for players who join mid-combat.
- **Mobs never shoot.** The legacy `CombatView` stays melee-only.
- **Close-ups:**
  - A shot that downs its target is `kill`; any other shot, hit or miss, is `strike`; reload gets none.
  - Close-up art faces right and is never mirrored. Players are always on the left.
- **Reduced motion:** the projectile does not travel and there is no recoil, only a brief flash on the target.

## Review Focus

These are inputs the spec implies but that no feature test would naturally cover. Each has a pinned test in the task named.

1. **An old save with `equipment.ranged` absent** must get the starter gun. **A save with `ranged: null`** (deliberately emptied) must stay empty. Both are pinned in Task 3.
2. **Shooting at a target that died earlier in the same round, or one that isn't in this combat,** is refused, with no crash and no turn consumed. Pinned in Task 6.
3. **Firing or reloading with no gun equipped** (for example after the player drops it between combats) is refused with an error, and the turn is not consumed. Pinned in Tasks 6 and 7.
4. **A player joining mid-combat** starts with a full magazine, and their ammo appears in combat state. Pinned in Task 5.
5. **A miss must not show a damage number, tear or kill anywhere:** in the board effects, the close-up stage, or the store's HP patch. Pinned in Tasks 9 and 10.

---

## File Map

| File | Responsibility |
|---|---|
| `shared/src/data/rangedConfig.json` (new) | tuning numbers plus `gunTypes` |
| `shared/src/combat/ranged.ts` (new) | `RANGED_CONFIG`, `GUN_TYPES`, `chebyshev`, `effectiveRange`, `hitChance`, `hasLineOfSight`, `rangedProfile`, `withStarterRanged` |
| `shared/src/types.ts` | `ranged` slot, `ItemStats.range/magazine`, `Equipment.ranged`, `ComputedStats.marksmanship`, `CombatParticipant.ammo/magazine` |
| `shared/src/content.ts` | class starter guns, Rebar Wrench |
| `shared/src/combat/closeUp.ts` | `shoot` and `reload` rows |
| `shared/src/messages.ts` | `shoot`/`reload` actions, `hit`, `hitChance`, `ammo` on results, `marksmanship` on the panel view |
| `itemgen/src/*` | `ranged` slot generation |
| `server/src/CombatManager.ts` | participant `ranged`/`ammo`, `resolveShot`, `reload` |
| `server/src/ArenaCombatManager.ts` | `checkShot`, `shoot`, `reload` |
| `server/src/arenaMovement.ts` | re-exports `hasLineOfSight` from shared |
| `server/src/GameSession.ts` | `combatPlayerInfo` helper, `handleRangedAction`, narration, `ArenaSnapshot` ranged fields |
| `server/src/index.ts` | routing, panel view |
| `server/src/sandbox/autoPlayer.ts` + `sandboxSession.ts` | bots shoot and reload |
| `client/src/combat/boardFx.ts` + `boardFxStore` + `ArenaGrid.tsx` + `styles/boardfx.css` | projectile, recoil, miss, reload tag |
| `client/src/combat/closeUpStage.ts` + `CloseUpOverlay.tsx` + `styles/closeup.css` | `shoot` role, miss stage |
| `client/src/ui/arenaBarMode.ts`, `ArenaActionBar.tsx`, `ArenaView.tsx` | Shoot/Reload UI and targeting |
| `client/src/ui/itemStatText.ts` (new) | one `formatItemStats` for the HUD, modal and bar (replaces three copies) |
| `client/src/components/PlayerHUD.tsx`, `CharacterModal.tsx`, `ArenaUnitPanel.tsx`, `CharacterCreateModal.tsx` | ranged slot, Marksmanship, ammo |
| `client/public/closeups/classes/<class>-ranged.png`, `client/public/ui/icons/actions/{shoot,reload}.png` | art |

---

### Task 1: Shared ranged maths and line of sight

**Files:**
- Create: `shared/src/data/rangedConfig.json`
- Create: `shared/src/combat/ranged.ts`
- Create: `shared/src/combat/ranged.test.ts`
- Modify: `shared/src/index.ts` (add `export * from './combat/ranged.js';`)
- Modify: `server/src/arenaMovement.ts:188-230` (replace the body of `hasLineOfSight` with a re-export)
- Modify: `client/src/components/ArenaView.tsx:73-100` (delete the duplicated `hasLineOfSight`, and import it from `@caverns/shared`)

**Interfaces:**
- Produces:
  - `RANGED_CONFIG: RangedConfig`
  - `GUN_TYPES: Record<string, { range: number; magazine: number; damageMult: number }>`
  - `chebyshev(a: Tile, b: Tile): number`
  - `effectiveRange(weaponRange: number, marksmanship: number): number`
  - `hitChance(distance: number, marksmanship: number): number` (a value in 0..1)
  - `hasLineOfSight(grid: { tiles: string[][] }, from: Tile, to: Tile, maxRange: number): boolean`
  - where `type Tile = { x: number; y: number }`

- [ ] **Step 1: Create the config.** In `shared/src/data/rangedConfig.json`:

```json
{
  "rangePerMarksmanship": 1,
  "baseHit": 0.85,
  "hitPerMarksmanship": 0.03,
  "falloffPerTile": 0.07,
  "falloffStart": 2,
  "minHit": 0.15,
  "maxHit": 0.95,
  "gunTypes": {
    "scattergun": { "range": 1, "magazine": 2, "damageMult": 1.3 },
    "sidearm":    { "range": 2, "magazine": 3, "damageMult": 1.0 },
    "long rifle": { "range": 4, "magazine": 1, "damageMult": 1.3 },
    "autogun":    { "range": 2, "magazine": 5, "damageMult": 0.6 }
  }
}
```

- [ ] **Step 2: Write the failing test.** In `shared/src/combat/ranged.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RANGED_CONFIG, GUN_TYPES, chebyshev, effectiveRange, hitChance, hasLineOfSight } from './ranged.js';

const open = (w: number, h: number) => ({ width: w, height: h, tiles: Array.from({ length: h }, () => Array(w).fill('floor')) });

describe('ranged maths', () => {
  it('chebyshev distance', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
  it('effective range adds rangePerMarksmanship per point', () => {
    expect(effectiveRange(2, 0)).toBe(2);
    expect(effectiveRange(2, 3)).toBe(2 + 3 * RANGED_CONFIG.rangePerMarksmanship);
  });
  it('hit chance: base + marksmanship, falloff only beyond falloffStart', () => {
    const c = RANGED_CONFIG;
    expect(hitChance(c.falloffStart, 0)).toBeCloseTo(c.baseHit);
    expect(hitChance(1, 0)).toBeCloseTo(c.baseHit);
    expect(hitChance(c.falloffStart + 2, 1)).toBeCloseTo(c.baseHit + c.hitPerMarksmanship - 2 * c.falloffPerTile);
  });
  it('hit chance is clamped to [minHit, maxHit]', () => {
    expect(hitChance(1, 100)).toBe(RANGED_CONFIG.maxHit);
    expect(hitChance(100, 0)).toBe(RANGED_CONFIG.minHit);
  });
  it('every gun type has positive range, magazine and damageMult', () => {
    expect(Object.keys(GUN_TYPES).length).toBeGreaterThan(0);
    for (const [id, g] of Object.entries(GUN_TYPES)) {
      expect(g.range, id).toBeGreaterThan(0);
      expect(g.magazine, id).toBeGreaterThan(0);
      expect(g.damageMult, id).toBeGreaterThan(0);
    }
  });
});

describe('hasLineOfSight', () => {
  it('clear line within range', () => {
    expect(hasLineOfSight(open(8, 8), { x: 1, y: 1 }, { x: 5, y: 3 }, 4)).toBe(true);
  });
  it('out of range (chebyshev)', () => {
    expect(hasLineOfSight(open(8, 8), { x: 1, y: 1 }, { x: 6, y: 1 }, 4)).toBe(false);
  });
  it('wall and chasm block, but end tiles are not checked', () => {
    const g = open(8, 3);
    g.tiles[1][3] = 'wall';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
    g.tiles[1][3] = 'chasm';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
    g.tiles[1][3] = 'floor'; g.tiles[1][5] = 'wall';
    expect(hasLineOfSight(g, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and check it fails.** Run `cmd.exe /c "cd shared && npx vitest run src/combat/ranged.test.ts"`. Expected: FAIL, because `./ranged.js` cannot be resolved.

- [ ] **Step 4: Implement it.** In `shared/src/combat/ranged.ts`. The `hasLineOfSight` body is moved verbatim from `server/src/arenaMovement.ts:193-230`.

```ts
import rangedConfig from '../data/rangedConfig.json' with { type: 'json' };

type Tile = { x: number; y: number };
export interface GunType { range: number; magazine: number; damageMult: number }
export interface RangedConfig {
  rangePerMarksmanship: number; baseHit: number; hitPerMarksmanship: number;
  falloffPerTile: number; falloffStart: number; minHit: number; maxHit: number;
  gunTypes: Record<string, GunType>;
}

export const RANGED_CONFIG: RangedConfig = rangedConfig;
export const GUN_TYPES: Record<string, GunType> = RANGED_CONFIG.gunTypes;

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function effectiveRange(weaponRange: number, marksmanship: number): number {
  return weaponRange + marksmanship * RANGED_CONFIG.rangePerMarksmanship;
}

/** Chance (0..1) that a shot at `distance` tiles lands. */
export function hitChance(distance: number, marksmanship: number): number {
  const c = RANGED_CONFIG;
  const raw = c.baseHit + c.hitPerMarksmanship * marksmanship - c.falloffPerTile * Math.max(0, distance - c.falloffStart);
  return Math.min(c.maxHit, Math.max(c.minHit, raw));
}

/**
 * Bresenham line-of-sight check, shared by server validation and client targeting.
 * True if `to` is within `maxRange` (Chebyshev) and no intermediate tile is wall or chasm. End tiles are not checked.
 */
export function hasLineOfSight(grid: { tiles: string[][] }, from: Tile, to: Tile, maxRange: number): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (Math.max(dx, dy) > maxRange) return false;
  if (dx === 0 && dy === 0) return true;
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = from.x;
  let y = from.y;
  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === to.x && y === to.y) break;
    const tile = grid.tiles[y]?.[x];
    if (!tile || tile === 'wall' || tile === 'chasm') return false;
  }
  return true;
}
```

Add `export * from './combat/ranged.js';` to `shared/src/index.ts`, next to the existing `closeUp` export.

- [ ] **Step 5: Run it and check it passes.** Same command as step 3. Expected: PASS.

- [ ] **Step 6: De-duplicate the other two copies.**
  - In `server/src/arenaMovement.ts`, delete the `hasLineOfSight` function (its doc comment and body) and add `export { hasLineOfSight } from '@caverns/shared';`. Callers keep importing from `./arenaMovement.js`.
  - In `client/src/components/ArenaView.tsx`, delete the local `hasLineOfSight` (the "duplicated from server" block) and add `hasLineOfSight` to an import from `@caverns/shared`.
  - Then rebuild shared and run: `cmd.exe /c "npm run build --workspace=shared && cd server && npx vitest run src/arenaMovement.test.ts src/GameSession.test.ts && cd ../client && npx tsc --noEmit -p ."`. Expected: PASS, no type errors.

- [ ] **Step 7: Commit.**

```bash
git.exe add shared/src/data/rangedConfig.json shared/src/combat/ranged.ts shared/src/combat/ranged.test.ts shared/src/index.ts server/src/arenaMovement.ts client/src/components/ArenaView.tsx
git.exe commit -m "Add shared ranged maths; move line of sight to shared" -- <same paths>
```

---

### Task 2: Ranged slot, Marksmanship stat, and gun-proof stats

**Files:**
- Modify: `shared/src/types.ts:14-23` (slot and stats), `:216-221` (`Equipment`), `:249-288` (`ComputedStats`, `computePlayerStats`), `:342-354` (`CombatParticipant`), `createPlayer`
- Modify: `shared/src/classTypes.ts:26` (`baseStats` gains `marksmanship`)
- Modify: `shared/src/data/classes.json` (every class: `"marksmanship": 2` in `baseStats`)
- Modify: `shared/src/data/playerConfig.json` (`baseStats.marksmanship: 2`) and `shared/src/data/configTypes.ts:32` (type)
- Modify: `shared/src/data/progressionConfig.json` (new stat definition)
- Modify: `shared/src/data/characterCreationConfig.json` (`statIds` gains `"marksmanship"`)
- Modify: `shared/src/itemArchetypes.ts` (`ranged` slot, gun keywords)
- Modify: `shared/src/pricing.ts` (`SLOT_BASE.ranged`)
- Modify: `client/src/ui/iconPaths.ts:18` (`SLOT_GLYPHS.ranged`)
- Modify: `server/src/CharacterRepository.ts:9-17` and `server/src/PlayerManager.ts` equipment literals, if TypeScript flags them (Task 3 fills them properly)
- Test: `shared/src/types.test.ts`, `shared/src/itemArchetypes.test.ts`

**Interfaces:**
- Produces:
  - `EquipmentSlot` includes `'ranged'`;
  - `ItemStats.range?: number`, `ItemStats.magazine?: number`;
  - `Equipment.ranged: Item | null`;
  - `ComputedStats.marksmanship: number`;
  - `CombatParticipant.ammo?: number`, `CombatParticipant.magazine?: number`.

Note: this makes itemgen's `Record<EquipmentSlot, …>` tables fail typecheck until Task 4. Vitest does not typecheck, so tests still run. Do not "fix" itemgen here.

- [ ] **Step 1: Write the failing tests.** Append to `shared/src/types.test.ts`:

```ts
import { computePlayerStats, createPlayer, CLASS_DEFINITIONS, PROGRESSION_CONFIG } from './index.js';

describe('ranged slot and marksmanship', () => {
  const gun = { id: 'g', name: 'Test Sidearm', description: '', rarity: 'common' as const, slot: 'ranged' as const, stats: { damage: 7, range: 2, magazine: 3 } };
  it('a new player has an empty ranged slot', () => {
    expect(createPlayer('p', 'P', 'r', CLASS_DEFINITIONS[0].id).equipment.ranged).toBeNull();
  });
  it('gun damage never adds to melee damage', () => {
    const p = createPlayer('p', 'P', 'r', CLASS_DEFINITIONS[0].id);
    const before = computePlayerStats(p).damage;
    p.equipment.ranged = gun;
    expect(computePlayerStats(p).damage).toBe(before);
  });
  it('marksmanship = class base + allocated points', () => {
    const cls = CLASS_DEFINITIONS[0];
    const p = createPlayer('p', 'P', 'r', cls.id);
    expect(computePlayerStats(p).marksmanship).toBe(cls.baseStats.marksmanship);
    const def = PROGRESSION_CONFIG.statDefinitions.find((d) => d.internalStat === 'marksmanship')!;
    p.statAllocations[def.id] = 3;
    expect(computePlayerStats(p).marksmanship).toBe(cls.baseStats.marksmanship + 3 * def.perPoint);
  });
  it('every class has a marksmanship base', () => {
    for (const c of CLASS_DEFINITIONS) expect(c.baseStats.marksmanship, c.id).toBeGreaterThanOrEqual(0);
  });
});
```

Append to `shared/src/itemArchetypes.test.ts`:

```ts
import { GUN_TYPES } from './combat/ranged.js';
it('every gun type name resolves to the ranged archetype in the ranged slot', () => {
  for (const name of Object.keys(GUN_TYPES)) {
    expect(archetypeFor({ slot: 'ranged', name: `Rusty ${name}` }), name).toBe('ranged');
  }
});
```

(Add `archetypeFor` to that file's import if it isn't already imported.)

- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd shared && npx vitest run src/types.test.ts src/itemArchetypes.test.ts"`. Expected: FAIL (`equipment.ranged` is undefined, `marksmanship` is undefined, and the archetype is `blade`).

- [ ] **Step 3: Implement it.**

`shared/src/types.ts`:

```ts
export type EquipmentSlot = 'weapon' | 'offhand' | 'armor' | 'accessory' | 'ranged';

export interface ItemStats {
  damage?: number;
  defense?: number;
  maxHp?: number;
  initiative?: number;
  healAmount?: number;
  /** Guns only: base range in tiles (Marksmanship adds to it). */
  range?: number;
  /** Guns only: shots per reload. */
  magazine?: number;
}

export interface Equipment {
  weapon: Item | null;
  offhand: Item | null;
  armor: Item | null;
  accessory: Item | null;
  ranged: Item | null;
}

export interface ComputedStats {
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  maxEnergy: number;
  marksmanship: number;
}
```

In `computePlayerStats`:
- Keep the `slots` array as the four non-ranged slots. The gun's damage must never reach melee, so **leave `player.equipment.ranged` out of that loop** and add a comment: `// The ranged slot is deliberately excluded: gun damage only applies to shots (see rangedProfile).`
- The `base` spread now carries `marksmanship`.
- Guard against old saves with `stats.marksmanship ??= 0;` straight after the spread.

In `createPlayer`, set `equipment: { weapon: null, offhand: null, armor: null, accessory: null, ranged: null }`.

In `CombatParticipant`, add:

```ts
  /** Players with a gun: rounds left and magazine size. */
  ammo?: number;
  magazine?: number;
```

`shared/src/classTypes.ts`: `baseStats: { maxHp: number; damage: number; defense: number; initiative: number; marksmanship: number };`

`classes.json`: every class `baseStats` becomes `{ "maxHp": 50, "damage": 5, "defense": 2, "initiative": 5, "marksmanship": 2 }`.

`playerConfig.json`: add `"marksmanship": 2` to `baseStats`. Also add `marksmanship: number` to the `baseStats` type at `configTypes.ts:32`.

`progressionConfig.json` `statDefinitions`: append `{ "id": "marksmanship", "displayName": "Marksmanship", "internalStat": "marksmanship", "perPoint": 1 }`.

`characterCreationConfig.json`: `"statIds": ["vitality", "ferocity", "toughness", "speed", "tactics", "marksmanship"]`.

`itemArchetypes.ts`:
- `ARCHETYPE_SLOTS.ranged: ['weapon', 'ranged']`
- `SLOT_DEFAULT_ARCHETYPE` gains `ranged: 'ranged'`
- `KEYWORDS.ranged: ['crossbow', 'bow', 'gun', 'autogun', 'rifle', 'pistol', 'sidearm', 'scattergun', 'blunderbuss', 'hushpistol', 'repeater']`
- The existing whole-word matcher then handles `long rifle` via `rifle`.

`pricing.ts`: `SLOT_BASE.ranged: 40`.

`client/src/ui/iconPaths.ts` `SLOT_GLYPHS`: add `ranged: '¬'`.

For any other `Record<EquipmentSlot | ItemSlot, …>` that `tsc` flags in `shared/`, `server/` or `client/`, add a `ranged` entry mirroring `weapon`. Leave `itemgen` alone; it is Task 4. For equipment object literals the server flags (`CharacterRepository.starterEquipment`), add `ranged: null` for now.

- [ ] **Step 4: Run them and check they pass.** Same command as step 2. Expected: PASS. Then run the whole shared suite: `cmd.exe /c "cd shared && npx vitest run"`. Expected: PASS. If `characterCreation` or `classData` data-integrity tests assert exact stat lists, update the expectation to the config-driven list.

- [ ] **Step 5: Rebuild and typecheck consumers.** Run `cmd.exe /c "npm run build --workspace=shared && cd server && npx tsc --noEmit -p . && cd ../client && npx tsc --noEmit -p ."`. Expected: no errors in server or client. (itemgen errors are expected until Task 4.)

- [ ] **Step 6: Commit** every touched path, with the message "Add ranged equipment slot and Marksmanship stat".

---

### Task 3: Class starter guns, `rangedProfile`, and save migration

**Files:**
- Modify: `shared/src/content.ts:23-72` (`CLASS_STARTER_ITEMS` gains `ranged`; artificer weapon becomes the Rebar Wrench; the crossbow definition is kept, exported as `LEGACY_REPEATING_CROSSBOW`)
- Modify: `shared/src/classTypes.ts` (`starterRangedId: string`) and `shared/src/data/classes.json` (`starterRangedId` per class, and artificer `starterWeaponId: "artificer_rebar_wrench"`)
- Modify: `shared/src/combat/ranged.ts` (add `rangedProfile`, `withStarterRanged`)
- Modify: `shared/src/sandbox/resolveSetup.ts:22` and `shared/src/itemArchetypes.content.test.ts:15` (include `c.ranged` and the legacy crossbow)
- Modify: `server/src/PlayerManager.ts:30-35`, `server/src/CharacterRepository.ts:9-17`, `server/src/characterAdapter.ts:25`, `server/src/index.ts:88-120`
- Test: `shared/src/combat/ranged.test.ts`, `shared/src/content.test.ts`, `server/src/characterAdapter.test.ts`

**Interfaces:**
- Consumes: `GUN_TYPES`, `effectiveRange`, `computePlayerStats`, `getClassDefinition`.
- Produces:
  - `interface RangedProfile { shotDamage: number; range: number; magazine: number; marksmanship: number }`
  - `rangedProfile(player: Pick<Player, 'className' | 'equipment' | 'statAllocations'>): RangedProfile | null`
  - `withStarterRanged(equipment: Equipment, className: string): Equipment`, which fills `ranged` only when the key is **absent**.
  - `CLASS_STARTER_ITEMS: Record<string, { weapon: Item; offhand: Item; ranged: Item }>`

- [ ] **Step 1: Write the failing tests.** Append to `shared/src/combat/ranged.test.ts`:

```ts
import { rangedProfile, withStarterRanged } from './ranged.js';
import { CLASS_STARTER_ITEMS } from '../content.js';
import { CLASS_DEFINITIONS } from '../classData.js';
import { createPlayer, computePlayerStats } from '../types.js';

describe('class starter guns', () => {
  it('every class has a ranged-slot starter gun with range and magazine, matching starterRangedId', () => {
    for (const c of CLASS_DEFINITIONS) {
      const gun = CLASS_STARTER_ITEMS[c.id]?.ranged;
      expect(gun, c.id).toBeDefined();
      expect(gun.id).toBe(c.starterRangedId);
      expect(gun.slot).toBe('ranged');
      expect(gun.stats.range).toBeGreaterThan(0);
      expect(gun.stats.magazine).toBeGreaterThan(0);
      expect(gun.stats.damage).toBeGreaterThan(0);
    }
  });
});

describe('rangedProfile', () => {
  it('null without a gun', () => {
    const p = createPlayer('p', 'P', 'r', CLASS_DEFINITIONS[0].id);
    expect(rangedProfile(p)).toBeNull();
  });
  it('shot damage = class base damage + gun damage (ignores melee gear and ferocity)', () => {
    const cls = CLASS_DEFINITIONS[0];
    const p = createPlayer('p', 'P', 'r', cls.id);
    p.equipment.ranged = { ...CLASS_STARTER_ITEMS[cls.id].ranged };
    p.equipment.weapon = { ...CLASS_STARTER_ITEMS[cls.id].weapon, stats: { damage: 99 } };
    p.statAllocations.ferocity = 5;
    const prof = rangedProfile(p)!;
    expect(prof.shotDamage).toBe(cls.baseStats.damage + p.equipment.ranged.stats.damage!);
    expect(prof.magazine).toBe(p.equipment.ranged.stats.magazine);
    expect(prof.marksmanship).toBe(computePlayerStats(p).marksmanship);
    expect(prof.range).toBe(p.equipment.ranged.stats.range! + prof.marksmanship);
  });
});

describe('withStarterRanged (save migration)', () => {
  const cls = CLASS_DEFINITIONS[0].id;
  const base = { weapon: null, offhand: null, armor: null, accessory: null };
  it('adds the class starter gun when the ranged key is absent (pre-ranged save)', () => {
    const eq = withStarterRanged(base as never, cls);
    expect(eq.ranged?.id).toBe(CLASS_STARTER_ITEMS[cls].ranged.id);
    expect(eq.ranged).not.toBe(CLASS_STARTER_ITEMS[cls].ranged); // a copy, not the shared object
  });
  it('leaves a deliberately emptied slot (null) empty', () => {
    expect(withStarterRanged({ ...base, ranged: null }, cls).ranged).toBeNull();
  });
  it('keeps an equipped gun', () => {
    const gun = { ...CLASS_STARTER_ITEMS[cls].ranged, id: 'mine' };
    expect(withStarterRanged({ ...base, ranged: gun }, cls).ranged?.id).toBe('mine');
  });
  it('unknown class: absent key becomes null', () => {
    expect(withStarterRanged(base as never, 'nope').ranged).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and check it fails.** Run `cmd.exe /c "cd shared && npx vitest run src/combat/ranged.test.ts"`. Expected: FAIL (`ranged` is undefined on the starters, and there are no exports).

- [ ] **Step 3: Implement the content.** In `shared/src/content.ts`:
  - Change the type to `Record<string, { weapon: Item; offhand: Item; ranged: Item }>`.
  - Add a `ranged` entry to each class. The artificer's `weapon` becomes the wrench.
  - Move the crossbow object out into `export const LEGACY_REPEATING_CROSSBOW: Item = { id: 'artificer_repeating_crossbow', … }` (unchanged fields), so old saves and sandbox lookups still resolve.

```ts
// vanguard
    ranged: {
      id: 'vanguard_censer_blunderbuss', name: 'Censer Blunderbuss',
      description: 'A relic thurible bored into a barrel. Belches shrapnel and incense.',
      rarity: 'common', slot: 'ranged', archetype: 'ranged', stats: { damage: 3, range: 1, magazine: 2 },
    },
// shadowblade
    ranged: {
      id: 'shadowblade_hushpistol', name: 'Hushpistol',
      description: 'A suppressed relic sidearm for a quiet opener.',
      rarity: 'common', slot: 'ranged', archetype: 'ranged', stats: { damage: 3, range: 2, magazine: 3 },
    },
// cleric
    ranged: {
      id: 'cleric_needle_rifle', name: 'Needle Rifle',
      description: 'Fires surgical bone-needles from the back line.',
      rarity: 'common', slot: 'ranged', archetype: 'ranged', stats: { damage: 4, range: 4, magazine: 1 },
    },
// artificer
    weapon: {
      id: 'artificer_rebar_wrench', name: 'Rebar Wrench',
      description: 'A length of rebar bent into a wrench. Fixes things; breaks things.',
      rarity: 'common', slot: 'weapon', archetype: 'blunt', stats: { damage: 3 },
    },
    ranged: {
      id: 'artificer_scrap_autogun', name: 'Scrap Autogun',
      description: 'A crank-fed junk repeater. Many weak shots.',
      rarity: 'common', slot: 'ranged', archetype: 'ranged', stats: { damage: 1, range: 2, magazine: 5 },
    },
```

The wrench name has no archetype keyword, so the explicit `archetype: 'blunt'` carries it. If the archetype content test demands a keyword match, add `wrench` to `KEYWORDS.blunt`.

`classes.json`:
- Add `"starterRangedId"` to every class, set to the ids above.
- Change the artificer's `"starterWeaponId"` to `"artificer_rebar_wrench"`.

`classTypes.ts`: add `starterRangedId: string;`.

`shared/src/sandbox/resolveSetup.ts:22` becomes `...Object.values(CLASS_STARTER_ITEMS).flatMap((s) => [s.weapon, s.offhand, s.ranged]), LEGACY_REPEATING_CROSSBOW,`. Make the same change in `itemArchetypes.content.test.ts:15`, adding `c.ranged` and the legacy item.

- [ ] **Step 4: Implement the helpers.** Append to `shared/src/combat/ranged.ts`:

```ts
import type { Equipment, Player } from '../types.js';
import { computePlayerStats } from '../types.js';
import { getClassDefinition } from '../classData.js';
import { CLASS_STARTER_ITEMS } from '../content.js';
import { COMBAT_CONFIG } from '../data/combat.js';

export interface RangedProfile { shotDamage: number; range: number; magazine: number; marksmanship: number }

/** Everything a shot needs, precomputed from the player's gun and stats. Null without a usable gun. */
export function rangedProfile(player: Pick<Player, 'className' | 'equipment' | 'statAllocations'>): RangedProfile | null {
  const gun = player.equipment.ranged;
  if (!gun || !gun.stats.magazine || !gun.stats.range) return null;
  const { marksmanship } = computePlayerStats(player as Player);
  const classDamage = getClassDefinition(player.className)?.baseStats.damage ?? 0;
  return {
    shotDamage: Math.max(COMBAT_CONFIG.minDamage, classDamage + (gun.stats.damage ?? 0)),
    range: effectiveRange(gun.stats.range, marksmanship),
    magazine: gun.stats.magazine,
    marksmanship,
  };
}

/** Save migration: a save from before the ranged slot (key absent) gets the class starter gun. `null` means deliberately empty. */
export function withStarterRanged(equipment: Equipment, className: string): Equipment {
  if ('ranged' in equipment) return equipment;
  const gun = CLASS_STARTER_ITEMS[className]?.ranged;
  return { ...equipment, ranged: gun ? { ...gun } : null };
}
```

`COMBAT_CONFIG` is exported from `shared/src/data/combat.ts`; check the path with `grep -n COMBAT_CONFIG shared/src/data/combat.ts`. If importing `content.js` from `combat/ranged.ts` creates an import cycle warning (content → types → classData), it is still safe, because these are functions called at runtime, not at module load.

- [ ] **Step 5: Run it and check it passes.** Run `cmd.exe /c "cd shared && npx vitest run"`. Expected: PASS.

- [ ] **Step 6: Wire the server (test-first for the migration).** Append to `server/src/characterAdapter.test.ts`, following that file's existing character fixture (reuse its `makeCharacter`-style helper or an existing row literal, and set `equipment` explicitly):

```ts
import { CLASS_STARTER_ITEMS } from '@caverns/shared';
it('pre-ranged save (no ranged key) gets the class starter gun', () => {
  const ch = { ...baseCharacter, class: 'vanguard', equipment: { weapon: null, offhand: null, armor: null, accessory: null } };
  expect(playerFromCharacter(ch as never, 'c1', 'r1').equipment.ranged?.id).toBe(CLASS_STARTER_ITEMS.vanguard.ranged.id);
});
it('a save with ranged: null stays empty', () => {
  const ch = { ...baseCharacter, class: 'vanguard', equipment: { weapon: null, offhand: null, armor: null, accessory: null, ranged: null } };
  expect(playerFromCharacter(ch as never, 'c1', 'r1').equipment.ranged).toBeNull();
});
```

(`baseCharacter` stands for whatever row fixture the file already uses. If there isn't one, build a full `CharactersTable` literal from the fields `playerFromCharacter` reads.)

Run `cmd.exe /c "npm run build --workspace=shared && cd server && npx vitest run src/characterAdapter.test.ts"`. Expected: FAIL.

Then implement:
- `characterAdapter.ts:25`: `equipment: withStarterRanged(character.equipment, character.class),`
- `index.ts` `buildCharacterPanelView`: `const equipment = withStarterRanged(ch.equipment, ch.class);` Use it both in `tempPlayer` and in the returned `equipment`.
- `CharacterRepository.starterEquipment`: `ranged: starter ? { ...starter.ranged } : null,`
- `PlayerManager.addPlayer`: after the offhand line, add `player.equipment.ranged = { ...starterItems.ranged };`

Run the test again. Expected: PASS. Then run the full server suite to a log and check that nothing else regressed. Sandbox or sim tests that snapshot stats may shift, because `buildSandboxPlayer` now round-robins points across six stats. If a regression test asserts exact outcomes, re-derive the expectation and say why in the commit message.

- [ ] **Step 7: Commit** with the message "Add class starter guns, rangedProfile and pre-ranged save migration".

---

### Task 4: Guns in loot and the shop (itemgen)

**Files:**
- Modify: `itemgen/src/stats.ts` (`BASE_STAT_RANGES`, `STAT_CEILINGS`, `PRIMARY_STAT` gain `ranged`)
- Modify: `itemgen/src/materials.ts:22-33` (ranged uses weapon materials)
- Modify: `itemgen/src/generate.ts` (apply the gun type after naming)
- Modify: every `itemgen/src/palettes/*.ts` (`baseTypes.ranged`)
- Modify: `shared/src/dropSpecs.ts` (mob specs add a ranged entry), `shared/src/data/shops.ts:24-27`, `server/src/GameSession.ts:2095`
- Test: `itemgen/src/generate.test.ts` (and review the snapshots)

**Interfaces:**
- Consumes: `GUN_TYPES` from `@caverns/shared`.
- Produces: `generateItem({ slot: 'ranged', … })` returns an `Item` with `slot: 'ranged'`, `archetype: 'ranged'`, and `stats: { damage, range, magazine }`.

- [ ] **Step 1: Write the failing test.** Append to `itemgen/src/generate.test.ts`:

```ts
import { GUN_TYPES } from '@caverns/shared';
describe('ranged generation', () => {
  it('produces valid guns across biomes, skulls and seeds', () => {
    for (const biomeId of ['starter', 'fungal', 'crystal', 'flooded', 'bone', 'volcanic']) {
      for (const skullRating of [1, 2, 3] as const) {
        for (let seed = 1; seed <= 20; seed++) {
          const item = generateItem({ slot: 'ranged', skullRating, biomeId, seed });
          expect(item.slot).toBe('ranged');
          expect(item.archetype).toBe('ranged');
          expect(item.stats.damage).toBeGreaterThanOrEqual(1);
          const type = Object.values(GUN_TYPES).find((g) => g.range === item.stats.range && g.magazine === item.stats.magazine);
          expect(type, `${biomeId}/${skullRating}/${seed}: ${item.name}`).toBeDefined();
        }
      }
    }
  });
});
```

(If the palette biome ids differ, use the ids that `getPalette` accepts; see `itemgen/src/materials.ts`.)

- [ ] **Step 2: Run it and check it fails.** Run `cmd.exe /c "cd itemgen && npx vitest run src/generate.test.ts"`. Expected: FAIL (there is no `ranged` in `BASE_STAT_RANGES`, and `baseTypes.ranged` is undefined).

- [ ] **Step 3: Implement it.**

`stats.ts`:

```ts
  ranged:    { 1: { min: 2, max: 4 },  2: { min: 5, max: 8 },   3: { min: 10, max: 14 } },
// STAT_CEILINGS
  ranged:    { 1: 5,  2: 10, 3: null },
// PRIMARY_STAT
  ranged: 'damage',
```

`materials.ts` `rollMaterial`: guns reuse the weapon materials, so no palette needs new material rows.

```ts
  // Guns are forged from the same stock as melee weapons.
  const materialSlot: EquipmentSlot = slot === 'ranged' ? 'weapon' : slot;
  const candidates = palette.materials.filter(m => m.slots.includes(materialSlot));
```

Every palette: add `ranged: ['scattergun', 'sidearm', 'long rifle', 'autogun'],` to `nameFragments.baseTypes`. Every palette uses the same four gun-type keys, because the type is looked up by base type.

`generate.ts`: after the name and `iconBaseType` are known, and before `return`:

```ts
  if (slot === 'ranged') {
    const gun = GUN_TYPES[iconBaseType];
    if (!gun) throw new Error(`Ranged base type '${iconBaseType}' has no GUN_TYPES entry`);
    stats.damage = Math.max(1, Math.round((stats.damage ?? 1) * gun.damageMult));
    stats.range = gun.range;
    stats.magazine = gun.magazine;
  }
```

Import `GUN_TYPES` from `@caverns/shared`. `iconBaseType` must be the exact palette base type. If `generateNameParts` returns a transformed base type (for example capitalised), use the raw one it picked. Check `naming.ts:29` (`rawBaseType`) and return it alongside the name if needed.

- [ ] **Step 4: Run it and check it passes,** then run the full itemgen suite: `cmd.exe /c "cd itemgen && npx vitest run && npx tsc --noEmit -p ."`. Snapshot tests may fail only because `rollMaterial` or the palettes changed. **Inspect every snapshot diff:** only `ranged` additions, or changes caused by the new palette arrays, are acceptable. Then update them with `npx vitest run -u` and say so in the commit message.

- [ ] **Step 5: Add the drops.**
  - `shared/src/dropSpecs.ts`: in `fungal_mob_common` and `fungal_mob_elite` (and any other mob spec whose first pool lists `weapon`/`armor`/`accessory` generated entries), add `{ type: 'generated', slot: 'ranged', skullOffset: 0, weight: 1 }`.
  - `shops.ts` `SHOP_DROP_SPECS`: add `{ type: 'generated', slot: 'ranged', skullRating: 1, weight: 2 },`.
  - `GameSession.ts:2095`: `const slots: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory', 'ranged'];`
  - Run `cmd.exe /c "cd shared && npx vitest run src/dropSpecs.test.ts src/data/shops.test.ts"`. If a test pins exact weights, update it to include the ranged entry.

- [ ] **Step 6: Commit** with the message "Generate guns in loot and shops".

---

### Task 5: CombatManager shots, reload and ammo

**Files:**
- Modify: `server/src/CombatManager.ts` (`CombatPlayerInfo`, `InternalParticipant`, constructor, `addPlayer`, new `resolveShot`/`reload`/`getRanged`, `getState`)
- Modify: `shared/src/messages.ts:22-34,473-501` (the action unions gain `shoot`/`reload`; results gain `hit`, `hitChance`, `ammo`)
- Test: `server/src/CombatManager.test.ts`

**Interfaces:**
- Consumes: `RangedProfile` from shared.
- Produces:
  - `CombatPlayerInfo.ranged?: RangedProfile | null`
  - `CombatManager.getRanged(id): { profile: RangedProfile; ammo: number } | null`
  - `CombatManager.resolveShot(actorId: string, targetId: string, hit: boolean, hitChance: number): Partial<CombatActionResultMessage> | null`
  - `CombatManager.reload(actorId: string): Partial<CombatActionResultMessage> | null`
  - Result fields: `action: 'shoot' | 'reload'`, `hit?: boolean`, `hitChance?: number`, `ammo?: number`
  - `CombatParticipant.ammo/magazine` are filled in by `getState()`.

- [ ] **Step 1: Extend the protocol types** (no test of their own; they are exercised below). In `shared/src/messages.ts`:
  - `CombatActionMessage.action` and `CombatActionResultMessage.action` both gain `| 'shoot' | 'reload'`.
  - Add to `CombatActionResultMessage`:

```ts
  /** Shots: whether it landed, and the chance it had (0..1). */
  hit?: boolean;
  hitChance?: number;
  /** Shoot/reload: the actor's rounds left afterwards. */
  ammo?: number;
```

  Rebuild shared.

- [ ] **Step 2: Write the failing tests.** Append to `server/src/CombatManager.test.ts`, reusing that file's player and mob fixture helpers (adapt the names):

```ts
import { COMBAT_CONFIG, type RangedProfile } from '@caverns/shared';

const prof: RangedProfile = { shotDamage: 9, range: 4, magazine: 2, marksmanship: 2 };
const gunner = (over = {}) => ({ id: 'p1', name: 'Gunner', hp: 50, maxHp: 50, damage: 30, defense: 2, initiative: 6, className: 'vanguard', ranged: prof, ...over });
const mob = (over = {}) => ({ instanceId: 'm1', templateId: 't', name: 'Mob', maxHp: 40, hp: 40, damage: 5, defense: 3, initiative: 1, ...over });

describe('ranged: resolveShot / reload', () => {
  it('starts with a full magazine; state exposes ammo and magazine', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    expect(cm.getRanged('p1')).toEqual({ profile: prof, ammo: 2 });
    const p = cm.getState().participants.find((x) => x.id === 'p1')!;
    expect(p.ammo).toBe(2); expect(p.magazine).toBe(2);
  });
  it('a hit deals shotDamage - defense, ignoring melee damage', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    const r = cm.resolveShot('p1', 'm1', true, 0.8)!;
    expect(r).toMatchObject({ action: 'shoot', hit: true, hitChance: 0.8, damage: 9 - 3, targetHp: 40 - 6, ammo: 1 });
  });
  it('defending doubles defense against shots', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    (cm.getParticipant('m1') as { isDefending: boolean }).isDefending = true;
    expect(cm.resolveShot('p1', 'm1', true, 1)!.damage).toBe(Math.max(COMBAT_CONFIG.minDamage, 9 - 3 * COMBAT_CONFIG.defenseMultiplierWhenDefending));
  });
  it('a miss deals 0, still spends a round, never downs', () => {
    const cm = new CombatManager('r', [gunner()], [mob({ hp: 1 })]);
    const r = cm.resolveShot('p1', 'm1', false, 0.3)!;
    expect(r).toMatchObject({ action: 'shoot', hit: false, damage: 0, targetDowned: false, ammo: 1, targetHp: 1 });
  });
  it('downs the target at 0 HP', () => {
    const cm = new CombatManager('r', [gunner()], [mob({ hp: 2 })]);
    expect(cm.resolveShot('p1', 'm1', true, 1)!.targetDowned).toBe(true);
    expect(cm.getParticipant('m1')!.alive).toBe(false);
  });
  it('refuses with no ammo, no gun, dead or unknown target', () => {
    const cm = new CombatManager('r', [gunner({ ranged: { ...prof, magazine: 1 } })], [mob()]);
    expect(cm.resolveShot('p1', 'm1', true, 1)).not.toBeNull();
    expect(cm.resolveShot('p1', 'm1', true, 1)).toBeNull();          // empty
    const bare = new CombatManager('r', [gunner({ ranged: null })], [mob()]);
    expect(bare.resolveShot('p1', 'm1', true, 1)).toBeNull();        // no gun
    expect(cm.resolveShot('p1', 'nope', true, 1)).toBeNull();        // unknown target
  });
  it('reload refills; refused when full or without a gun', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    expect(cm.reload('p1')).toBeNull();                              // full
    cm.resolveShot('p1', 'm1', false, 0.5);
    expect(cm.reload('p1')).toMatchObject({ action: 'reload', actorId: 'p1', ammo: 2 });
    expect(new CombatManager('r', [gunner({ ranged: null })], [mob()]).reload('p1')).toBeNull();
  });
  it('a mid-combat joiner starts loaded', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    cm.addPlayer(gunner({ id: 'p2', name: 'Late' }));
    expect(cm.getRanged('p2')?.ammo).toBe(prof.magazine);
    expect(cm.getState().participants.find((p) => p.id === 'p2')!.ammo).toBe(prof.magazine);
  });
  it('shooting clears the actor\'s defend stance', () => {
    const cm = new CombatManager('r', [gunner()], [mob()]);
    cm.resolvePlayerAction('p1', { action: 'defend' });
    cm.resolveShot('p1', 'm1', true, 1);
    expect((cm.getParticipant('p1') as { isDefending: boolean }).isDefending).toBe(false);
  });
});
```

- [ ] **Step 3: Run them and check they fail.** Run `cmd.exe /c "cd server && npx vitest run src/CombatManager.test.ts"`. Expected: FAIL (`getRanged` is not a function).

- [ ] **Step 4: Implement it.** In `server/src/CombatManager.ts`:
  - Add `ranged?: RangedProfile | null;` to `CombatPlayerInfo`.
  - Add `ranged: RangedProfile | null; ammo: number;` to `InternalParticipant`.
  - In the constructor's player loop and in `addPlayer`, add `ranged: p.ranged ?? null, ammo: p.ranged?.magazine ?? 0,`.
  - In the mob loop, add `ranged: null, ammo: 0,`.

Then add these methods after `resolvePlayerAction`:

```ts
  getRanged(id: string): { profile: RangedProfile; ammo: number } | null {
    const p = this.participants.get(id);
    return p?.ranged ? { profile: p.ranged, ammo: p.ammo } : null;
  }

  /** A gun shot. Range/LoS are the arena's job; `hit` is rolled by the caller. Gun damage only: no melee gear, crits or item effects. */
  resolveShot(actorId: string, targetId: string, hit: boolean, hitChance: number): Partial<CombatActionResultMessage> | null {
    const actor = this.participants.get(actorId);
    const target = this.participants.get(targetId);
    if (!actor?.alive || !actor.ranged || actor.ammo <= 0 || !target?.alive) return null;
    actor.isDefending = false;
    actor.ammo -= 1;
    let damage = 0;
    if (hit) {
      const mods = this.effectResolver.resolvePassiveStats(target);
      const defense = mods.overrideDefense !== undefined ? 0 : target.defense + mods.bonusDefense;
      const effective = target.isDefending ? defense * COMBAT_CONFIG.defenseMultiplierWhenDefending : defense;
      damage = Math.max(COMBAT_CONFIG.minDamage, Math.floor(actor.ranged.shotDamage - effective));
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) target.alive = false;
    }
    return {
      actorId, actorName: actor.name, action: 'shoot',
      targetId: target.id, targetName: target.name, damage,
      targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned: !target.alive,
      hit, hitChance, ammo: actor.ammo,
    };
  }

  reload(actorId: string): Partial<CombatActionResultMessage> | null {
    const actor = this.participants.get(actorId);
    if (!actor?.alive || !actor.ranged || actor.ammo >= actor.ranged.magazine) return null;
    actor.isDefending = false;
    actor.ammo = actor.ranged.magazine;
    return { actorId, actorName: actor.name, action: 'reload', ammo: actor.ammo };
  }
```

In `getState()`, add to each mapped participant: `...(p.ranged ? { ammo: p.ammo, magazine: p.ranged.magazine } : {}),`.

- [ ] **Step 5: Run it and check it passes.** Same command as step 3. Expected: PASS.

- [ ] **Step 6: Commit** `server/src/CombatManager.ts`, `server/src/CombatManager.test.ts` and `shared/src/messages.ts`, with the message "CombatManager: gun shots, reload and ammo".

---

### Task 6: Arena range, line of sight and the dice roll

**Files:**
- Modify: `server/src/ArenaCombatManager.ts` (new `checkShot`, `shoot`, `reload`)
- Test: `server/src/ArenaCombatManager.test.ts`

**Interfaces:**
- Consumes: `CombatManager.getRanged/resolveShot/reload`, and `chebyshev`, `hitChance`, `hasLineOfSight` from shared.
- Produces:
  - `type ShotCheck = { ok: true; distance: number; hitChance: number } | { ok: false; reason: string }`
  - `ArenaCombatManager.checkShot(attackerId: string, targetId: string): ShotCheck`
  - `ArenaCombatManager.shoot(attackerId: string, targetId: string, rng: () => number = Math.random): { ok: true; result: Partial<CombatActionResultMessage> } | { ok: false; reason: string }`
  - `ArenaCombatManager.reload(id: string): { ok: true; result: Partial<CombatActionResultMessage> } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing tests.** Append to `server/src/ArenaCombatManager.test.ts`, which uses the file's `makeGrid()` (an 8×6 open arena with a wall border) and `makeMob()`:

```ts
import { hitChance, type RangedProfile } from '@caverns/shared';

const prof: RangedProfile = { shotDamage: 9, range: 3, magazine: 2, marksmanship: 2 };
const gunner = (): CombatPlayerInfo => ({ ...makePlayer(), ranged: prof });

describe('ArenaCombatManager ranged', () => {
  it('in range with LoS: ok, with the shared hit chance', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toEqual({ ok: true, distance: 3, hitChance: hitChance(3, prof.marksmanship) });
  });
  it('out of range is refused', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 5, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('a wall in between blocks the shot', () => {
    const g = makeGrid(); g.tiles[2][3] = 'wall';
    const a = new ArenaCombatManager('r', g, [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('adjacent targets can be shot', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(a.checkShot('p1', 'mob1').ok).toBe(true);
  });
  it('refuses: no gun, empty, own side, dead or unknown target', () => {
    const noGun = new ArenaCombatManager('r', makeGrid(), [makePlayer()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(noGun.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
    const a = new ArenaCombatManager('r', makeGrid(), [gunner(), { ...makePlayer('p2') }], [makeMob()], { p1: { x: 1, y: 2 }, p2: { x: 1, y: 3 }, mob1: { x: 2, y: 2 } });
    expect(a.checkShot('p1', 'p2')).toMatchObject({ ok: false });
    expect(a.checkShot('p1', 'ghost')).toMatchObject({ ok: false });
    a.getCombatManager().applyDamage('mob1', 999);
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('shoot rolls against hitChance with the injected rng', () => {
    const pos = { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } };
    const hc = hitChance(3, prof.marksmanship);
    const hitA = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], pos);
    const hit = hitA.shoot('p1', 'mob1', () => hc - 0.01);
    expect(hit.ok && hit.result.hit).toBe(true);
    const missA = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], pos);
    const miss = missA.shoot('p1', 'mob1', () => hc);
    expect(miss.ok && miss.result.hit).toBe(false);
    expect(miss.ok && miss.result.damage).toBe(0);
  });
  it('a refused shot spends no ammo', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } });
    expect(a.shoot('p1', 'mob1').ok).toBe(false);
    expect(a.getCombatManager().getRanged('p1')!.ammo).toBe(prof.magazine);
  });
  it('reload wraps CombatManager.reload with a reason when refused', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(a.reload('p1')).toMatchObject({ ok: false });
    a.shoot('p1', 'mob1', () => 0);
    expect(a.reload('p1')).toMatchObject({ ok: true, result: { action: 'reload', ammo: prof.magazine } });
  });
});
```

- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd server && npx vitest run src/ArenaCombatManager.test.ts"`. Expected: FAIL.

- [ ] **Step 3: Implement it.** In `server/src/ArenaCombatManager.ts`, import `chebyshev`, `hitChance` and `hasLineOfSight` from `@caverns/shared`, and add:

```ts
export type ShotCheck = { ok: true; distance: number; hitChance: number } | { ok: false; reason: string };
type ArenaActionOutcome = { ok: true; result: Partial<CombatActionResultMessage> } | { ok: false; reason: string };

  checkShot(attackerId: string, targetId: string): ShotCheck {
    const gun = this.combatManager.getRanged(attackerId);
    if (!gun) return { ok: false, reason: 'You have no gun equipped.' };
    if (gun.ammo <= 0) return { ok: false, reason: 'Out of ammo — reload first.' };
    const attacker = this.combatManager.getParticipant(attackerId);
    const target = this.combatManager.getParticipant(targetId);
    if (!target?.alive || target.type === attacker?.type) return { ok: false, reason: 'Not a valid target.' };
    const from = this.positions.get(attackerId);
    const to = this.positions.get(targetId);
    if (!from || !to) return { ok: false, reason: 'Not a valid target.' };
    if (!hasLineOfSight(this.grid, from, to, gun.profile.range)) return { ok: false, reason: 'Target is out of range or line of sight.' };
    const distance = chebyshev(from, to);
    return { ok: true, distance, hitChance: hitChance(distance, gun.profile.marksmanship) };
  }

  shoot(attackerId: string, targetId: string, rng: () => number = Math.random): ArenaActionOutcome {
    const check = this.checkShot(attackerId, targetId);
    if (!check.ok) return check;
    const result = this.combatManager.resolveShot(attackerId, targetId, rng() < check.hitChance, check.hitChance);
    return result ? { ok: true, result } : { ok: false, reason: 'Cannot shoot now.' };
  }

  reload(id: string): ArenaActionOutcome {
    const gun = this.combatManager.getRanged(id);
    if (!gun) return { ok: false, reason: 'You have no gun equipped.' };
    const result = this.combatManager.reload(id);
    return result ? { ok: true, result } : { ok: false, reason: 'Already fully loaded.' };
  }
```

`ArenaCombatManager` forwards `getState()` and `addPlayer` to `CombatManager` (see lines 245+). Check that its `addPlayer` passes `CombatPlayerInfo` through unchanged, so `ranged` survives.

- [ ] **Step 4: Run it and check it passes.** Same command as step 2. Expected: PASS.

- [ ] **Step 5: Commit** with the message "Arena: shot range, line of sight and hit roll".

---

### Task 7: GameSession actions, routing, narration and close-up rule

**Files:**
- Modify: `shared/src/combat/closeUp.ts` (the `shoot` row) and `shared/src/combat/closeUp.test.ts`
- Modify: `server/src/GameSession.ts` (a `combatPlayerInfo` helper used at `:824` and `:903`; new `handleRangedAction`; `narrateCombatAction` cases)
- Modify: `server/src/index.ts:1103-1111` (routing)
- Test: `server/src/GameSession.ranged.test.ts` (new), `server/src/GameSession.closeUp.test.ts`

**Interfaces:**
- Consumes: `rangedProfile`, and `ArenaCombatManager.shoot/reload`.
- Produces: `GameSession.handleRangedAction(playerId: string, action: 'shoot' | 'reload', targetId?: string): void`.

- [ ] **Step 1: Close-up rule, test-first.** Append to the `closeUpFor` describe in `shared/src/combat/closeUp.test.ts`:

```ts
  it('player shots: kill if it downs, otherwise strike (hit or miss); reload never', () => {
    expect(closeUpFor({ action: 'shoot', hit: true, targetDowned: true }, player)).toEqual({ kind: 'kill', durationMs: CLOSE_UP_CONFIG.killMs });
    expect(closeUpFor({ action: 'shoot', hit: true }, player)).toEqual({ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs });
    expect(closeUpFor({ action: 'shoot', hit: false, damage: 0 }, player)?.kind).toBe('strike');
    expect(closeUpFor({ action: 'reload' }, player)).toBeNull();
  });
```

Run `cmd.exe /c "cd shared && npx vitest run src/combat/closeUp.test.ts"`. Expected: FAIL.

In `closeUpFor`'s player branch, straight after the `attack` block, add:

```ts
    if (r.action === 'shoot') return make(r.targetDowned ? 'kill' : 'strike');
```

Run again. Expected: PASS. Rebuild shared.

- [ ] **Step 2: Write the failing session tests.** Create `server/src/GameSession.ranged.test.ts`, copying `setup`, `toPlayerTurn` and `closeIn` verbatim from `GameSession.closeUp.test.ts:1-58`, then:

```ts
import { rangedProfile } from '@caverns/shared';

const results = (sent: ServerMessage[], from: number) =>
  sent.slice(from).filter((m) => m.type === 'combat_action_result') as Extract<ServerMessage, { type: 'combat_action_result' }>[];
const errors = (sent: ServerMessage[], from: number) => sent.slice(from).filter((m) => m.type === 'error');

describe('GameSession ranged actions', () => {
  it('the duel player enters combat loaded (starter gun)', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session } = setup();
      const cm = (session as unknown as { combats: Map<string, { getCombatManager(): { getRanged(id: string): unknown } }> }).combats.get(SANDBOX_ROOM_ID)!;
      expect(cm.getCombatManager().getRanged('p1')).toMatchObject({ ammo: expect.any(Number) });
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('shoot (in reach) broadcasts a shoot result and ends the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      const r = results(sent, before);
      expect(r[0]).toMatchObject({ action: 'shoot', actorId: 'p1', targetId: mob.id, hit: expect.any(Boolean) });
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).not.toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('reload when full is refused with an error and does not end the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      toPlayerTurn(session);
      const before = sent.length;
      session.handleRangedAction('p1', 'reload');
      expect(errors(sent, before).length).toBe(1);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('no gun: shoot and reload are refused without consuming the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const r = resolveSetup('duel', {});
      if (!r.ok) throw new Error(r.error);
      const sent: ServerMessage[] = [];
      const session = new GameSession((m) => sent.push(m), (_t, m) => sent.push(m), buildSandboxContent(r.setup));
      const p = buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID);
      p.equipment.ranged = null;
      session.addPrebuiltPlayer(p);
      session.setTiming({ mobTurnDelayMs: MOB_DELAY });
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
      toPlayerTurn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((x) => x.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      session.handleRangedAction('p1', 'reload');
      expect(errors(sent, before).length).toBe(2);
      expect(results(sent, before).length).toBe(0);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('shoot then reload restores the magazine', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      session.handleRangedAction('p1', 'shoot', mob.id);
      toPlayerTurn(session);
      const before = sent.length;
      session.handleRangedAction('p1', 'reload');
      const r = results(sent, before);
      const player = session.getPlayerManager?.().getPlayer('p1');
      expect(r[0]).toMatchObject({ action: 'reload', actorId: 'p1' });
      if (player) expect(r[0].ammo).toBe(rangedProfile(player)!.magazine);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
});
```

If the duel mob dies to the first shot, or the player is downed first (seed-dependent), pick another seed that keeps the fight going, and write the chosen seed in a comment. If `GameSession` has no `getPlayerManager`, drop that line and compare against the result from the earlier shot's `magazine` via the snapshot (next step).

Append to `GameSession.closeUp.test.ts`:

```ts
  it('a shot holds the next turn for the strike close-up', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      const res = sent.slice(before).find((m) => m.type === 'combat_action_result') as { targetDowned?: boolean };
      const expected = res?.targetDowned ? CLOSE_UP_CONFIG.killMs : CLOSE_UP_CONFIG.strikeMs;
      expect(msUntilNextAction(sent, before)).toBeGreaterThanOrEqual(expected);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
```

Run `cmd.exe /c "cd server && npx vitest run src/GameSession.ranged.test.ts src/GameSession.closeUp.test.ts"`. Expected: FAIL (`handleRangedAction` is not a function).

- [ ] **Step 3: Implement it.** In `server/src/GameSession.ts`, add a private helper and use it at both construction sites (`startCombat:824-827` and `joinExistingCombat:903-907`):

```ts
  /** What a player brings into combat: computed stats plus their gun profile. */
  private combatPlayerInfo(p: Player): CombatPlayerInfo {
    const stats = this.playerManager.getComputedStats(p.id);
    return {
      id: p.id, name: p.name, hp: p.hp, maxHp: stats.maxHp,
      damage: stats.damage, defense: stats.defense, initiative: stats.initiative,
      className: p.className, ranged: rangedProfile(p),
    };
  }
```

In `startCombat`: `const combatPlayers = playersInRoom.map((p) => this.combatPlayerInfo(p));`. In `joinExistingCombat`: `combat.addPlayer(this.combatPlayerInfo(player), getPlayerEquippedEffects(player), [...(player.usedEffects ?? [])]);` (remove the now-unused `stats` local).

Add the handler after `handleCombatAction`:

```ts
  handleRangedAction(playerId: string, action: 'shoot' | 'reload', targetId?: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !this.canActNow(player.roomId, combat, playerId)) return;
    const outcome = action === 'shoot'
      ? (targetId ? combat.shoot(playerId, targetId) : { ok: false as const, reason: 'No target.' })
      : combat.reload(playerId);
    if (!outcome.ok) {
      this.sendTo(playerId, { type: 'error', message: outcome.reason });
      return;
    }
    combat.cancelAfkTimer();
    const roomId = player.roomId;
    this.broadcastToRoom(roomId, { type: 'combat_action_result', ...outcome.result } as any);
    const closeUpMs = this.closeUpDelay(combat, outcome.result);
    this.narrateCombatAction(roomId, outcome.result);
    combat.markActionTaken(playerId);
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    combat.advanceTurn();
    this.afterCombatTurn(roomId, combat, closeUpMs);
  }
```

Import `rangedProfile` (and `Player`, if it isn't already imported) from `@caverns/shared`.

In `narrateCombatAction`, add cases. The gun name comes from the player's equipment, so no name is hard-coded:

```ts
      case 'shoot': {
        message = result.hit
          ? `${result.actorName} shoots ${result.targetName} for ${result.damage} damage!`
          : `${result.actorName}'s shot at ${result.targetName} goes wide.`;
        if (result.targetDowned) message += ` ${result.targetName} goes down!`;
        break;
      }
      case 'reload': {
        const gun = this.playerManager.getPlayer(result.actorId)?.equipment.ranged?.name ?? 'weapon';
        message = `${result.actorName} reloads the ${gun}.`;
        break;
      }
```

In `server/src/index.ts`, in the `combat_action` routing, add before the final `else`:

```ts
        } else if (msg.action === 'shoot' || msg.action === 'reload') {
          getGameSession(playerId)?.handleRangedAction(playerId, msg.action, msg.targetId);
```

- [ ] **Step 4: Run it and check it passes.** Same command as step 2. Expected: PASS. Then run the full server suite to a log (`.sandbox/server.log`) and read the tail and every `×` line. Expected: all green.

- [ ] **Step 5: Commit** the shared close-up files, `GameSession.ts`, `index.ts` and both test files, with the message "GameSession: shoot and reload actions, narration and strike close-ups".

---

### Task 8: Bots shoot and reload (sandbox)

**Files:**
- Modify: `server/src/GameSession.ts:87-94,236-250` (`ArenaSnapshot` participants gain `ammo?`, `magazine?`, `range?`, `marksmanship?`)
- Modify: `server/src/sandbox/autoPlayer.ts`
- Modify: `server/src/sandbox/sandboxSession.ts:70-98`
- Test: `server/src/sandbox/autoPlayer.test.ts`

**Interfaces:**
- Consumes: `hasLineOfSight`, `hitChance` and `chebyshev` from shared.
- Produces:
  - `BotAction` gains `{ type: 'shoot'; targetId: string } | { type: 'reload' }`.
  - `ArenaSnapshot.participants[i]` gains `ranged?: { ammo: number; magazine: number; range: number; marksmanship: number }`.

- [ ] **Step 1: Write the failing tests.** Append to `server/src/sandbox/autoPlayer.test.ts`, building a snapshot literal like that file's existing tests do:

```ts
const grid = { width: 10, height: 5, tiles: Array.from({ length: 5 }, () => Array(10).fill('floor')) };
const snapOf = (ranged: { ammo: number; magazine: number; range: number; marksmanship: number } | undefined, mobX: number) => ({
  grid, currentTurnId: 'p1', roundNumber: 1, movementRemaining: 0,
  positions: { p1: { x: 1, y: 2 }, m1: { x: mobX, y: 2 } },
  participants: [{ id: 'p1', type: 'player' as const, hp: 50, ranged }, { id: 'm1', type: 'mob' as const, hp: 10 }],
});
describe('bot ranged', () => {
  it('shoots a non-adjacent enemy in range when loaded', () => {
    expect(decideTurn(snapOf({ ammo: 2, magazine: 2, range: 5, marksmanship: 2 }, 4), 'p1')[0]).toEqual({ type: 'shoot', targetId: 'm1' });
  });
  it('still melees an adjacent enemy', () => {
    expect(decideTurn(snapOf({ ammo: 2, magazine: 2, range: 5, marksmanship: 2 }, 2), 'p1')[0]).toEqual({ type: 'attack', targetId: 'm1' });
  });
  it('reloads when empty and nothing is adjacent', () => {
    expect(decideTurn(snapOf({ ammo: 0, magazine: 2, range: 5, marksmanship: 2 }, 4), 'p1')[0]).toEqual({ type: 'reload' });
  });
  it('mobs (no ranged) keep the old behaviour', () => {
    expect(decideTurn(snapOf(undefined, 4), 'p1').some((a) => a.type === 'shoot' || a.type === 'reload')).toBe(false);
  });
});
```

Run `cmd.exe /c "cd server && npx vitest run src/sandbox/autoPlayer.test.ts"`. Expected: FAIL.

- [ ] **Step 2: Implement it.**

`GameSession.getArenaSnapshot` participants map:

```ts
        .map((p) => {
          const gun = combat.getCombatManager().getRanged(p.id);
          return { id: p.id, type: p.type, hp: p.hp,
            ...(gun ? { ranged: { ammo: gun.ammo, magazine: gun.profile.magazine, range: gun.profile.range, marksmanship: gun.profile.marksmanship } } : {}) };
        }),
```

Add `ranged?: { ammo: number; magazine: number; range: number; marksmanship: number }` to the `ArenaSnapshot` participant type.

`autoPlayer.ts`: extend `BotAction`, and after the `adjacent` check (and before the movement logic) add:

```ts
  const gun = self.ranged;
  if (gun && gun.ammo > 0) {
    const shots = enemies
      .map((e) => ({ e, pos: snap.positions[e.id] }))
      .filter(({ pos }) => hasLineOfSight(snap.grid, selfPos, pos, gun.range))
      .map(({ e, pos }) => ({ id: e.id, chance: hitChance(chebyshev(selfPos, pos), gun.marksmanship) }))
      .sort((a, b) => b.chance - a.chance || (a.id < b.id ? -1 : 1));
    if (shots.length > 0) return [{ type: 'shoot', targetId: shots[0].id }, END];
  }
  if (gun && gun.ammo < gun.magazine) return [{ type: 'reload' }, END];
```

Update the doc comment: "melee if adjacent, else shoot the likeliest hit, else reload, else close in."

`sandboxSession.ts` `apply`:

```ts
    else if (action.type === 'shoot') session.handleRangedAction(botId, 'shoot', action.targetId);
    else if (action.type === 'reload') session.handleRangedAction(botId, 'reload');
```

and in `step`, change `if (action.type === 'attack') attacked = true;` to `if (action.type === 'attack' || action.type === 'shoot' || action.type === 'reload') attacked = true;`.

- [ ] **Step 3: Run it and check it passes,** then run the full server suite to a log. `botTurnRegression` and `simulate` tests may shift outcomes. Re-derive any exact expectations and note why in the commit.

- [ ] **Step 4: Commit** with the message "Sandbox bots shoot and reload".

---

### Task 9: Client store, actions and board-effect reducer

**Files:**
- Modify: `client/src/hooks/useGameActions.ts:22-26` (`combatAction` accepts `'shoot' | 'reload'`)
- Modify: `client/src/store/gameStore.ts:513-535` (patch `ammo`; only a *hit* changes HP)
- Modify: `client/src/combat/boardFx.ts`
- Test: `client/src/combat/boardFx.test.ts`

**Interfaces:**
- Produces:
  - `FX_TIMING.projectileMsPerTile = 70`, `FX_TIMING.projectileMaxMs = 350`, `FX_TIMING.recoilMs = 180`, `FX_TIMING.tagMs = 900`
  - `BoardFx` gains:
    - `{ kind: 'projectile'; from: Tile; to: Tile; hit: boolean; delayMs; travelMs; until }`
    - `{ kind: 'recoil'; unitId; dir: FxDir; delayMs; until }` (dir points **away** from the target)
    - `{ kind: 'tag'; tile: Tile; text: 'MISS' | 'RELOAD'; delayMs; until }`
  - For a shoot result, `fxReceive` emits recoil + projectile, then on a hit the existing tear + number at arrival, or on a miss a `MISS` tag at arrival. For a reload result it emits a `RELOAD` tag.

- [ ] **Step 1: Write the failing tests.** Append to `client/src/combat/boardFx.test.ts`, reusing its existing `ctx` helper, or create one:

```ts
import { FX_TIMING, fxReceive, initialBoardFx } from './boardFx.js';

const ctx = (now = 1000) => ({
  now,
  positions: { p1: { x: 1, y: 1 }, m1: { x: 4, y: 1 } },
  participants: [{ id: 'p1', type: 'player' as const }, { id: 'm1', type: 'mob' as const }],
});
const shot = (over: Record<string, unknown>) => ({ type: 'combat_action_result', action: 'shoot', actorId: 'p1', actorName: 'P', targetId: 'm1', ...over }) as never;

describe('boardFx: shots', () => {
  it('hit: recoil away from target, projectile, then tear + number when it lands', () => {
    const s = fxReceive(initialBoardFx(), shot({ hit: true, damage: 6 }), ctx());
    const travel = Math.min(3 * FX_TIMING.projectileMsPerTile, FX_TIMING.projectileMaxMs);
    expect(s.fx.find((f) => f.kind === 'recoil')).toMatchObject({ unitId: 'p1', dir: 'left' });
    expect(s.fx.find((f) => f.kind === 'projectile')).toMatchObject({ from: { x: 1, y: 1 }, to: { x: 4, y: 1 }, hit: true, travelMs: travel });
    expect(s.fx.find((f) => f.kind === 'tear')).toMatchObject({ unitId: 'm1', delayMs: travel });
    expect(s.fx.find((f) => f.kind === 'number')).toMatchObject({ value: 6, delayMs: travel });
    expect(s.fx.some((f) => f.kind === 'lunge')).toBe(false);
  });
  it('travel time is capped', () => {
    const far = { ...ctx(), positions: { p1: { x: 0, y: 0 }, m1: { x: 20, y: 0 } } };
    expect(fxReceive(initialBoardFx(), shot({ hit: true, damage: 1 }), far).fx.find((f) => f.kind === 'projectile')).toMatchObject({ travelMs: FX_TIMING.projectileMaxMs });
  });
  it('miss: projectile with hit false, a MISS tag, and no tear or number', () => {
    const s = fxReceive(initialBoardFx(), shot({ hit: false, damage: 0 }), ctx());
    expect(s.fx.find((f) => f.kind === 'projectile')).toMatchObject({ hit: false });
    expect(s.fx.find((f) => f.kind === 'tag')).toMatchObject({ text: 'MISS', tile: { x: 4, y: 1 } });
    expect(s.fx.some((f) => f.kind === 'tear' || f.kind === 'number')).toBe(false);
  });
  it('waits behind the shooter\'s walk', () => {
    let s = fxReceive(initialBoardFx(), { type: 'arena_positions_update', moverId: 'p1', path: [{ x: 1, y: 1 }, { x: 2, y: 1 }] } as never, ctx(1000));
    s = fxReceive(s, shot({ hit: true, damage: 3 }), ctx(1000));
    const walk = 2 * FX_TIMING.walkStepMs + FX_TIMING.walkTailMs;
    expect(s.fx.find((f) => f.kind === 'projectile')!.delayMs).toBe(walk);
  });
  it('reload: a RELOAD tag on the actor, nothing else', () => {
    const s = fxReceive(initialBoardFx(), { type: 'combat_action_result', action: 'reload', actorId: 'p1', actorName: 'P', ammo: 3 } as never, ctx());
    expect(s.fx).toHaveLength(1);
    expect(s.fx[0]).toMatchObject({ kind: 'tag', text: 'RELOAD', tile: { x: 1, y: 1 } });
  });
  it('melee attacks still lunge (unchanged)', () => {
    const s = fxReceive(initialBoardFx(), { type: 'combat_action_result', action: 'attack', actorId: 'p1', actorName: 'P', targetId: 'm1', damage: 4 } as never, ctx());
    expect(s.fx.some((f) => f.kind === 'lunge')).toBe(true);
  });
});
```

Run `cmd.exe /c "cd client && npx vitest run src/combat/boardFx.test.ts"`. Expected: FAIL.

- [ ] **Step 2: Implement the reducer.** In `client/src/combat/boardFx.ts`:
  - Extend `FX_TIMING` with `projectileMsPerTile: 70, projectileMaxMs: 350, recoilMs: 180, tagMs: 900`.
  - Add the three `BoardFx` members listed under Interfaces (each with `id`, `delayMs` and `until`).
  - Add `const OPPOSITE: Record<FxDir, FxDir> = { up: 'down', down: 'up', left: 'right', right: 'left' };`.

In `fxReceive`, immediately after the `combat_action_result` type guard (before the `damage <= 0` early return), add:

```ts
  const res = msg as { action?: string; actorId: string; targetId?: string; hit?: boolean; damage?: number };
  const wait0 = Math.max(0, (s.walkUntil[res.actorId] ?? 0) - ctx.now);
  if (res.action === 'reload') {
    const at = ctx.positions[res.actorId] ?? s.lastTile[res.actorId];
    if (!at) return { ...s, lastTile };
    return { ...s, lastTile, fx: [...s.fx, { id: s.nextId, kind: 'tag', tile: at, text: 'RELOAD', delayMs: wait0, until: ctx.now + wait0 + FX_TIMING.tagMs }], nextId: s.nextId + 1 };
  }
  if (res.action === 'shoot') {
    const from = ctx.positions[res.actorId];
    const to = res.targetId ? (ctx.positions[res.targetId] ?? s.lastTile[res.targetId]) : undefined;
    if (!from || !to) return { ...s, lastTile };
    const travelMs = Math.min(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * FX_TIMING.projectileMsPerTile, FX_TIMING.projectileMaxMs);
    const landAt = wait0 + travelMs;
    const fx = [...s.fx];
    let id = s.nextId;
    const dir = lungeDir(from, to);
    if (dir) fx.push({ id: id++, kind: 'recoil', unitId: res.actorId, dir: OPPOSITE[dir], delayMs: 0, until: ctx.now + wait0 + FX_TIMING.recoilMs });
    fx.push({ id: id++, kind: 'projectile', from, to, hit: !!res.hit, delayMs: wait0, travelMs, until: ctx.now + landAt + FX_TIMING.hitDelayMs + 120 });
    if (!res.hit) {
      fx.push({ id: id++, kind: 'tag', tile: to, text: 'MISS', delayMs: landAt, until: ctx.now + landAt + FX_TIMING.tagMs });
      return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
    }
    if (res.targetId && ctx.positions[res.targetId]) fx.push({ id: id++, kind: 'tear', unitId: res.targetId, delayMs: landAt, until: ctx.now + landAt + FX_TIMING.tearMs });
    const value = res.damage ?? 0;
    if (value > 0) {
      const offset = s.fx.filter((f) => f.kind === 'number' && f.until > ctx.now && f.tile.x === to.x && f.tile.y === to.y).length;
      fx.push({ id: id++, kind: 'number', tile: to, value, tone: value === 1 ? 'chip' : 'mob', offset, delayMs: landAt, until: ctx.now + landAt + FX_TIMING.numberMs });
    }
    return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
  }
```

(The recoil uses `delayMs: 0` for the same reason as the lunge: a walking unit's cell mounts only when the walk ends.)

`ArenaGrid.tsx:86-91` iterates non-number effects and assumes `unitId`. Change its skip to `if (f.kind === 'number' || f.kind === 'projectile' || f.kind === 'tag') continue;`, and add a `recoil` branch: `else if (f.kind === 'recoil') { cur.cls += ` fx-recoil fx-recoil-${f.dir}`; cur.style['--fx-recoil-delay'] = `${f.delayMs}ms`; }`. Rendering of projectiles and tags comes in Task 11.

- [ ] **Step 3: Update the store and actions.**
  - `useGameActions.ts`: widen the `combatAction` `action` type to `'attack' | 'defend' | 'use_item' | 'flee' | 'shoot' | 'reload'`.
  - `ArenaView.tsx` `ArenaViewProps.onCombatAction`: widen the same union.
  - `gameStore.ts` `combat_action_result`: in the participants map, add a line before `return p`:

```ts
            if (p.id === msg.actorId && msg.ammo !== undefined) return { ...p, ammo: msg.ammo };
```

  Keep the order so a shot's target HP patch (`msg.targetHp`) still applies. A miss sends `targetHp` unchanged, so no HP moves.

- [ ] **Step 4: Run it and check it passes.** Run `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`. Expected: PASS, no type errors.

- [ ] **Step 5: Commit** with the message "Board FX: shot projectile, recoil, MISS and RELOAD tags".

---

### Task 10: Ranged close-up stage (shoot art, miss)

**Files:**
- Modify: `client/src/combat/closeUpStage.ts` (the `shoot` role, and `Stage.miss`)
- Modify: `client/src/components/CloseUpOverlay.tsx` (render MISS)
- Modify: `client/src/styles/closeup.css` (`.closeup--miss`: no target tear; a dim MISS)
- Test: `client/src/combat/closeUpStage.test.ts`

**Interfaces:**
- Produces:
  - `artChainFor(p, role: 'attack' | 'hurt' | 'cast' | 'shoot', abilityArt?)`
  - `Stage.miss: boolean`

- [ ] **Step 1: Write the failing tests.** Append to `client/src/combat/closeUpStage.test.ts`, following that file's existing `ActiveCloseUp` fixture style:

```ts
import { CLOSE_UP_CONFIG, CLASS_DEFINITIONS } from '@caverns/shared';
const cls = CLASS_DEFINITIONS[0].id;
const parts = [
  { id: 'p1', type: 'player' as const, name: 'P', hp: 10, maxHp: 10, initiative: 1, className: cls },
  { id: 'm1', type: 'mob' as const, name: 'M', hp: 10, maxHp: 10, initiative: 1, templateId: 'x' },
];
const active = (r: Record<string, unknown>, kind: 'strike' | 'kill' = 'strike') => ({
  id: 1, result: { actorId: 'p1', actorName: 'P', targetId: 'm1', ...r }, participants: parts,
  closeUp: { kind, durationMs: kind === 'kill' ? CLOSE_UP_CONFIG.killMs : CLOSE_UP_CONFIG.strikeMs },
}) as never;

describe('ranged close-ups', () => {
  it('shoot role: ranged pose first, then the attack pose, portrait, glyph', () => {
    const chain = artChainFor({ type: 'player', className: cls }, 'shoot');
    expect(chain[0]).toBe(`/closeups/classes/${cls}-ranged.png`);
    expect(chain[1]).toBe(`/closeups/classes/${cls}-attack.png`);
  });
  it('a shot stages the shooter with the shoot chain (strike and kill)', () => {
    expect(stageFor(active({ action: 'shoot', hit: true, damage: 4 })).left[0].art[0]).toBe(`/closeups/classes/${cls}-ranged.png`);
    expect(stageFor(active({ action: 'shoot', hit: true, damage: 4, targetDowned: true }, 'kill')).left[0].art[0]).toBe(`/closeups/classes/${cls}-ranged.png`);
  });
  it('a miss: miss flag, no damage number, target not downed', () => {
    const st = stageFor(active({ action: 'shoot', hit: false, damage: 0 }));
    expect(st.miss).toBe(true);
    expect(st.number).toBeNull();
    expect(st.right[0].downed).toBe(false);
  });
  it('melee attacks are unchanged (attack pose, no miss)', () => {
    const st = stageFor(active({ action: 'attack', damage: 4 }));
    expect(st.left[0].art[0]).toBe(`/closeups/classes/${cls}-attack.png`);
    expect(st.miss).toBe(false);
  });
});
```

Run `cmd.exe /c "cd client && npx vitest run src/combat/closeUpStage.test.ts"`. Expected: FAIL.

- [ ] **Step 2: Implement it.** In `closeUpStage.ts`:

```ts
export function artChainFor(
  p: { type: 'player' | 'mob'; className?: string; templateId?: string },
  role: 'attack' | 'hurt' | 'cast' | 'shoot',
  abilityArt?: string,
): string[] {
  const chain: string[] = [];
  if (p.type === 'mob') {
    if (p.templateId && mobCloseUps.has(p.templateId)) chain.push(`/closeups/mobs/${p.templateId}.png`);
  } else {
    if (role === 'cast' && abilityArt) chain.push(abilityArt);
    if (role === 'shoot' && p.className) chain.push(`/closeups/classes/${p.className}-ranged.png`);
    if (p.className) chain.push(`/closeups/classes/${p.className}-${role === 'hurt' ? 'hurt' : 'attack'}.png`);
    const portrait = p.className ? getClassPortrait(p.className) : null;
    if (portrait) chain.push(portrait);
  }
  const glyph = getParticipantGlyph({ type: p.type, className: p.className, templateId: p.templateId });
  if (glyph) chain.push(glyph);
  return chain;
}
```

In `stageFor`:
- Widen `toStage`'s `role` parameter type to include `'shoot'`.
- Set `const casterRole = r.action === 'use_ability' ? 'cast' : r.action === 'shoot' ? 'shoot' : 'attack';`.
- Add `const miss = r.action === 'shoot' && r.hit === false;`.
- `number` must be `null` on a miss. The existing `damage ? …` already gives null for `damage: 0`; leave it, and the test pins it.
- Add `miss` to the returned object and to the `Stage` interface (`miss: boolean`).

`CloseUpOverlay.tsx`:
- Add `${stage.miss ? ' closeup--miss' : ''}` to the root `className`.
- Render MISS where the number goes: `{stage.miss && <div className="closeup__number closeup__number--miss"><span>MISS</span></div>}`. This sits alongside the existing number block, which is empty on a miss.

`closeup.css` (append near `.closeup--strike`):

```css
/* A missed shot: the target doesn't tear; a dim MISS stands in for the number. */
.closeup--miss .closeup__side--right .closeup-fig { animation-name: none; }
.closeup__number--miss { color: #8c7f6c; text-shadow: none; letter-spacing: .2em; }
```

Check the actual selector that applies the RGB tear to the struck figure in `closeup.css` (`grep -n "tear\|hurt" client/src/styles/closeup.css`), and target that selector under `.closeup--miss` so only the tear is disabled, not the entry slide.

- [ ] **Step 3: Run it and check it passes.** Run `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`. Expected: PASS.

- [ ] **Step 4: Commit** with the message "Close-ups: ranged pose for shots and a MISS stage".

---

### Task 11: Shoot/Reload UI, targeting and on-board rendering

**Files:**
- Modify: `client/src/ui/arenaBarMode.ts` (`target_shoot`) and `client/src/ui/arenaBarMode.test.ts`
- Modify: `client/src/ui/iconPaths.ts:6` (`ActionIcon` gains `'shoot' | 'reload'`)
- Create: `client/public/ui/icons/actions/shoot.png` and `reload.png` as placeholders: copies of `attack.png` and `items.png`, replaced in Task 13
- Modify: `client/src/components/ArenaActionBar.tsx` (buttons, mode, props)
- Modify: `client/src/components/ArenaView.tsx` (`InteractionMode` `'shoot'`, highlights, hit % labels, click handling)
- Modify: `client/src/components/ArenaGrid.tsx` (render `projectile` and `tag` effects; `hitLabels` prop)
- Modify: `client/src/styles/boardfx.css` (recoil, projectile, tag, hit label, reduced motion)
- Test: `client/src/ui/arenaBarMode.test.ts`, plus a new pure helper test `client/src/ui/shotTargets.test.ts`

**Interfaces:**
- Consumes: `hasLineOfSight`, `hitChance` and `chebyshev` from shared; `CombatParticipant.ammo/magazine`; `rangedProfile`.
- Produces: `shotTargets(grid, myPos, range, marksmanship, enemies: { id: string; pos: Tile }[]): Map<string, number>` (enemy id → hit chance) in `client/src/ui/shotTargets.ts`.

- [ ] **Step 1: Write the failing tests.** `client/src/ui/shotTargets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hitChance } from '@caverns/shared';
import { shotTargets } from './shotTargets.js';

const grid = { width: 8, height: 3, tiles: Array.from({ length: 3 }, () => Array(8).fill('floor')) };
describe('shotTargets', () => {
  it('maps in-range, in-LoS enemies to their hit chance', () => {
    const m = shotTargets(grid, { x: 0, y: 1 }, 3, 2, [{ id: 'a', pos: { x: 3, y: 1 } }, { id: 'b', pos: { x: 6, y: 1 } }]);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toBeCloseTo(hitChance(3, 2));
  });
  it('excludes blocked targets', () => {
    const g = { ...grid, tiles: grid.tiles.map((r) => [...r]) }; g.tiles[1][1] = 'wall';
    expect(shotTargets(g, { x: 0, y: 1 }, 5, 2, [{ id: 'a', pos: { x: 3, y: 1 } }]).size).toBe(0);
  });
});
```

Append to `client/src/ui/arenaBarMode.test.ts`:

```ts
it('target_shoot drops back to main when the map is no longer targeting', () => {
  expect(effectiveArenaBarMode({ mode: 'target_shoot' }, true, false)).toEqual({ mode: 'main' });
  expect(effectiveArenaBarMode({ mode: 'target_shoot' }, true, true)).toEqual({ mode: 'target_shoot' });
});
```

Run `cmd.exe /c "cd client && npx vitest run src/ui"`. Expected: FAIL.

- [ ] **Step 2: Implement the pure bits.**

`client/src/ui/shotTargets.ts`:

```ts
import { chebyshev, hasLineOfSight, hitChance } from '@caverns/shared';

type Tile = { x: number; y: number };
/** Enemies a shot can reach from `myPos`, with the shared hit chance for each. */
export function shotTargets(grid: { tiles: string[][] }, myPos: Tile, range: number, marksmanship: number, enemies: { id: string; pos: Tile }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of enemies) {
    if (hasLineOfSight(grid, myPos, e.pos, range)) out.set(e.id, hitChance(chebyshev(myPos, e.pos), marksmanship));
  }
  return out;
}
```

`arenaBarMode.ts`: add `| { mode: 'target_shoot' }` to the union and `'target_shoot'` to `MAP_TARGETING`. `iconPaths.ts`: `ActionIcon` gains `'shoot' | 'reload'`. Create the two placeholder PNGs by copying `attack.png` → `shoot.png` and `items.png` → `reload.png` in `client/public/ui/icons/actions/`.

Run step 1's command. Expected: PASS.

- [ ] **Step 3: Action bar.** In `ArenaActionBar.tsx`:
  - Add props `ammo: number | null` (null means no gun), `magazine: number`, `onShootMode: () => void`, `onReload: () => void`.
  - In `main` mode, after the Attack button:

```tsx
          {ammo !== null && (
            <>
              <RelicButton className="arena-btn arena-btn-shoot" icon={actionIconSrc('shoot')}
                onClick={() => { setMode({ mode: 'target_shoot' }); onShootMode(); }}
                disabled={actionTaken || ammo <= 0}>
                Shoot {ammo}/{magazine}
              </RelicButton>
              <RelicButton className="arena-btn" icon={actionIconSrc('reload')} onClick={onReload}
                disabled={actionTaken || ammo >= magazine}>
                Reload
              </RelicButton>
            </>
          )}
```

  - Add a targeting panel next to `target_attack`:

```tsx
      {effectiveMode.mode === 'target_shoot' && (
        <>
          <span className="waiting-text">Choose a target to shoot...</span>
          <RelicButton className="arena-btn" onClick={handleBackToMain}>Back</RelicButton>
        </>
      )}
```

- [ ] **Step 4: ArenaView.**
  - `InteractionMode` gains `'shoot'`.
  - Compute the local player's gun from the store: `const me = useGameStore((s) => s.players[s.playerId]);` and `const gun = useMemo(() => (me ? rangedProfile(me) : null), [me]);`.
  - Take `ammo` from the combat participant: `const myPart = activeCombat?.participants.find((p) => p.id === playerId);`.
  - Build the targets:

```ts
  const shootable = useMemo(() => {
    const myPos = arenaPositions[playerId];
    if (interactionMode !== 'shoot' || !gun || !arenaGrid || !myPos || !activeCombat) return new Map<string, number>();
    const enemies = activeCombat.participants.filter((p) => p.type === 'mob' && p.hp > 0 && arenaPositions[p.id]).map((p) => ({ id: p.id, pos: arenaPositions[p.id] }));
    return shotTargets(arenaGrid, myPos, gun.range, gun.marksmanship, enemies);
  }, [interactionMode, gun, arenaGrid, arenaPositions, playerId, activeCombat]);
```

  - In `tileHighlights`, add: for each `id` in `shootable`, `highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight')`. Add `shootable` to the deps.
  - In `handleTileClick`, add:

```ts
    if (interactionMode === 'shoot') {
      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (pos.x === x && pos.y === y && shootable.has(id)) {
          onCombatAction('shoot', id);
          useGameStore.setState({ arenaActionTaken: true });
          setInteractionMode('none');
          return;
        }
      }
    }
```

  - Add `shootable` to its deps.
  - Pass `isTargeting` as true for `'shoot'` too, and pass `hitLabels={interactionMode === 'shoot' ? shootable : undefined}` to `ArenaGrid`.
  - Wire the action bar: `ammo={myPart?.ammo ?? (gun ? gun.magazine : null)}`, `magazine={gun?.magazine ?? 0}`, `onShootMode={() => setInteractionMode('shoot')}`, `onReload={() => { onCombatAction('reload'); useGameStore.setState({ arenaActionTaken: true }); }}`.

- [ ] **Step 5: ArenaGrid rendering.**
  - Add the prop `hitLabels?: Map<string, number>`.
  - Next to `FxNumbers`, add an `FxOverlay` component that reuses the `getCellRect` positioning pattern from `FxNumbers`:
    - **`projectile`:** a `<span className="fx-bolt">` absolutely positioned at the `from` cell centre. Set the inline CSS vars `--fx-dx`/`--fx-dy` to the pixel delta to the `to` cell, and `--fx-travel`/`--fx-delay` from `travelMs` and `delayMs`. On a miss, extend the delta by 1.5 cells along the same direction (`dx * (1 + 1.5 / tiles)`, where `tiles` = Chebyshev distance) and add `fx-bolt--miss`.
    - **`tag`:** a `<span className="fx-tag fx-tag--miss|--reload">` above the cell, with `animationDelay: delayMs`.
    - **Hit labels:** when `hitLabels` is set, render `<span className="fx-hit">{Math.round(chance * 100)}%</span>` above each target cell. These are always visible while targeting, which keeps it simple; the spec's hover-only variant can come after playtesting.

Filter the effects with `fx.filter((f) => f.kind === 'projectile' || f.kind === 'tag')`.

Append to `client/src/styles/boardfx.css`:

```css
.glyph-grid .fx-recoil .entity-glyph { animation: fx-recoil-right 180ms ease-out var(--fx-recoil-delay, 0ms) both; }
.glyph-grid .fx-recoil-left .entity-glyph { animation-name: fx-recoil-left; }
.glyph-grid .fx-recoil-up .entity-glyph { animation-name: fx-recoil-up; }
.glyph-grid .fx-recoil-down .entity-glyph { animation-name: fx-recoil-down; }
@keyframes fx-recoil-right { 30% { transform: translateX(2px) } 100% { transform: none } }
@keyframes fx-recoil-left { 30% { transform: translateX(-2px) } 100% { transform: none } }
@keyframes fx-recoil-up { 30% { transform: translateY(-2px) } 100% { transform: none } }
@keyframes fx-recoil-down { 30% { transform: translateY(2px) } 100% { transform: none } }
.fx-bolt { position: absolute; z-index: 12; width: 4px; height: 4px; margin: -2px 0 0 -2px; pointer-events: none;
  background: #9dff6a; box-shadow: 0 0 6px 2px #5aff3c; opacity: 0;
  animation: fx-bolt var(--fx-travel, 200ms) linear var(--fx-delay, 0ms) both; }
@keyframes fx-bolt { 0% { opacity: 1; transform: translate(0, 0) } 99% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--fx-dx), var(--fx-dy)) } }
.fx-bolt--miss { animation-name: fx-bolt-miss; }
@keyframes fx-bolt-miss { 0% { opacity: 1; transform: translate(0, 0) } 70% { opacity: .8 } 100% { opacity: 0; transform: translate(var(--fx-dx), var(--fx-dy)) } }
.fx-tag { position: absolute; z-index: 12; pointer-events: none; text-align: center; font: 700 11px 'Courier New', monospace;
  letter-spacing: .15em; opacity: 0; animation: fx-number 900ms ease-out both; }
.fx-tag--miss { color: #8c7f6c; }
.fx-tag--reload { color: #9dff6a; text-shadow: 0 0 4px #5aff3c; }
.fx-hit { position: absolute; z-index: 11; pointer-events: none; text-align: center; font: 700 10px 'Courier New', monospace; color: #9dff6a; text-shadow: 0 0 3px #000; }
@media (prefers-reduced-motion: reduce) {
  .glyph-grid .fx-recoil .entity-glyph { animation: none; }
  .fx-bolt { animation: fx-bolt-still 160ms steps(1) calc(var(--fx-delay, 0ms) + var(--fx-travel, 0ms)) both; transform: translate(var(--fx-dx), var(--fx-dy)); }
  .fx-tag { animation-name: fx-number-still; }
}
@keyframes fx-bolt-still { 0% { opacity: 1 } 100% { opacity: 0 } }
```

(Under reduced motion the bolt does not travel. It flashes once at the target cell when the shot lands.)

- [ ] **Step 6: Verify.** Run `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`. Expected: PASS. Then **run the app** (the `run` skill, or `npm run dev:server` + `npm run dev:client` from a Windows terminal), start a solo game, trigger a fight, and check each of these:
  - Shoot shows the ammo count, highlights reachable enemies, and shows hit %.
  - Clicking fires; the bolt travels; the close-up plays; the ammo count drops.
  - Reload is disabled while full, and after reloading a RELOAD tag appears.
  - A miss shows the bolt overshooting and MISS.

  Take a screenshot and report what you saw.

- [ ] **Step 7: Commit** every touched path, including the two placeholder PNGs, with the message "Arena UI: Shoot/Reload, shot targeting with hit %, bolt and tags".

---

### Task 12: HUD, character sheet and ammo display

**Files:**
- Create: `client/src/ui/itemStatText.ts` and `client/src/ui/itemStatText.test.ts`
- Modify: `client/src/components/PlayerHUD.tsx:12-20,114-119`, `CharacterModal.tsx:13-21,84-114`, `ActionBar.tsx:~5-15` (replace the three local `formatStats` copies)
- Modify: `client/src/components/ArenaUnitPanel.tsx` (ammo per player)
- Modify: `client/src/components/CharacterCreateModal.tsx:93-94` (starter gun row)
- Modify: `shared/src/messages.ts:730-746` (`CharacterPanelView.marksmanship`) and `server/src/index.ts` `buildCharacterPanelView` (`marksmanship: stats.marksmanship`)

**Interfaces:**
- Produces: `formatItemStats(stats: ItemStats): string` in `client/src/ui/itemStatText.ts`.

- [ ] **Step 1: Write the failing test.** `client/src/ui/itemStatText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatItemStats } from './itemStatText.js';
describe('formatItemStats', () => {
  it('guns show damage, range and magazine', () => {
    expect(formatItemStats({ damage: 3, range: 2, magazine: 5 })).toMatch(/\+3 .*range 2.*5 rds/);
  });
  it('melee items unchanged', () => {
    expect(formatItemStats({ damage: 2, initiative: 1 })).toMatch(/\+2 .*\+1 /);
    expect(formatItemStats({ healAmount: 15 })).toBe('heals 15');
  });
});
```

Run `cmd.exe /c "cd client && npx vitest run src/ui/itemStatText.test.ts"`. Expected: FAIL.

- [ ] **Step 2: Implement it.** The body is moved from `PlayerHUD.tsx:7-20`, plus the gun fields:

```ts
import { PROGRESSION_CONFIG, type ItemStats } from '@caverns/shared';

const STAT_DISPLAY_NAMES: Record<string, string> = {};
for (const def of PROGRESSION_CONFIG.statDefinitions) STAT_DISPLAY_NAMES[def.internalStat] = def.displayName;

/** One-line stat summary for any item (gear, guns, consumables). */
export function formatItemStats(stats: ItemStats): string {
  const parts: string[] = [];
  if (stats.damage) parts.push(`+${stats.damage} ${STAT_DISPLAY_NAMES['damage'] ?? 'dmg'}`);
  if (stats.defense) parts.push(`+${stats.defense} ${STAT_DISPLAY_NAMES['defense'] ?? 'def'}`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} ${STAT_DISPLAY_NAMES['maxHp'] ?? 'hp'}`);
  if (stats.initiative) parts.push(`+${stats.initiative} ${STAT_DISPLAY_NAMES['initiative'] ?? 'init'}`);
  if (stats.range) parts.push(`range ${stats.range}`);
  if (stats.magazine) parts.push(`${stats.magazine} rds`);
  if (stats.healAmount) parts.push(`heals ${stats.healAmount}`);
  return parts.join(', ');
}
```

  - Replace the local `formatStats` in `PlayerHUD.tsx` and `CharacterModal.tsx` with this import, and delete their local copies. Keep each file's own `STAT_DISPLAY_NAMES` only if it is still used for the stat rows.
  - Do the same in `ActionBar.tsx` **only** if its local function has the same semantics; if it differs, leave it alone.
  - Check `ShopModal.tsx`/`StashModal.tsx` with `grep -n "stats\." client/src/components/ShopModal.tsx client/src/components/StashModal.tsx`. If they format stats inline, switch them to `formatItemStats` too.

- [ ] **Step 3: Slots, stats and ammo.**
  - `PlayerHUD.tsx`: after the Accessory row, add `<ItemDisplay item={player.equipment.ranged ?? null} label="Ranged" slot="ranged" />`.
  - `CharacterModal.tsx`:
    - Add `<EquipSlot item={panel.equipment.ranged ?? null} label="Ranged" />`.
    - In the stats block, add `<div className="char-stat">{STAT_DISPLAY_NAMES['marksmanship'] ?? 'Marksmanship'}: {panel.marksmanship}</div>`.
    - Add `marksmanship: number` to `CharacterPanelView`, and `marksmanship: stats.marksmanship` in `buildCharacterPanelView`. Rebuild shared.
  - `ArenaUnitPanel.tsx`, in the player entry: `{p.magazine !== undefined && <span className="arena-unit-ammo">{p.ammo}/{p.magazine} rds</span>}`.
  - `CharacterCreateModal.tsx`, after the offhand row: `<div className="char-create-gear-row"><ItemIcon item={starterItems.ranged} /><span>{starterItems.ranged.name}</span></div>`.
  - Add a small CSS rule for `.arena-unit-ammo` next to `.arena-unit-class` (find it with `grep -rn "arena-unit-class" client/src/styles`), using the same font and colour as `arena-unit-class`.
  - `?? null` guards the brief window where a client holds pre-ranged player data.

- [ ] **Step 4: Verify.** Run `cmd.exe /c "npm run build --workspace=shared && cd client && npx vitest run && npx tsc --noEmit -p . && cd ../server && npx tsc --noEmit -p ."`. Expected: PASS. Run the app and check each of these:
  - the HUD Ranged slot shows the starter gun with range and rounds;
  - the character sheet shows Marksmanship;
  - equipping a looted gun from the inventory swaps the old gun into the inventory;
  - character creation lists the gun and lets you allocate Marksmanship.

- [ ] **Step 5: Commit** with the message "HUD: ranged slot, Marksmanship, ammo; one shared item stat formatter".

---

### Task 13: Ranged-pose art and action icons (PixelLab, user-approved)

**Files:**
- Create: `client/public/closeups/classes/{vanguard,shadowblade,cleric,artificer}-ranged.png` (160×160, facing right)
- Replace: `client/public/ui/icons/actions/shoot.png` and `reload.png` (the same size as the existing action icons; check with `file client/public/ui/icons/actions/attack.png`)
- Modify: `art/closeups/chosen.json`, `art/closeups/jobs.txt`; raw candidates go in `art/closeups/raw/`
- Reference: `docs/superpowers/plans/2026-09-27-combat-closeups.md` Task 7 (lines ~1254-1305) for the exact recipe and contact-sheet script

**This task has a user approval gate. Do not install any art until the user has picked from the contact sheet.**

- [ ] **Step 1: Check the budget.** Load the PixelLab tools with `ToolSearch("select:mcp__pixellab__get_balance,mcp__pixellab__create_image_pro,mcp__pixellab__get_image,mcp__pixellab__wait_for_jobs")` and call `get_balance`. You need 4 poses × 1 call, plus 2 icons × 1 call. Report the balance to the user before spending.

- [ ] **Step 2: Generate the poses.** For each class, call `create_image_pro` at 160×160 with 4 candidates:
  - Reference image: `https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/portraits/<portrait>.png`, where the portrait file comes from `client/src/classPortraits.ts`.
  - Prompt pattern (v2), with `<gun>` filled from `CLASS_STARTER_ITEMS[class].ranged.name` and `.description`:

    > the SAME character as the reference image — identical helmet, armour, colours and silhouette — full-body, side view facing right, braced and firing <gun>: <description>, bright muzzle flash at the barrel, dark background, no text, no letters, no symbols written

  - Submit all 4 at once; the limit is 10 concurrent jobs. Record the job ids in `art/closeups/jobs.txt` under keys `<class>-ranged`. Download all candidates to `art/closeups/raw/<class>-ranged-<n>.png`.

- [ ] **Step 3: Generate the icons.** Two `create_image_pro` calls at the action-icon size, styled like the existing `attack.png` (pass it as the style reference via its raw GitHub URL):
  - "a relic pistol, side view, icon" (shoot)
  - "a curved magazine with a circular reload arrow, icon" (reload)

  Save the candidates in `art/closeups/raw/icon-{shoot,reload}-<n>.png`.

- [ ] **Step 4: Build the contact sheet.** Reuse the contact-sheet script from the combat-closeups plan to write `art/closeups/_ranged.png` (candidates labelled `<class>-ranged-<n>`). Publish or open it for the user, and **ask the user to pick one per class and one per icon (or request rerolls)**. Stop here until they answer.

- [ ] **Step 5: Install the picks.**
  - Copy the chosen files to `client/public/closeups/classes/<class>-ranged.png` and `client/public/ui/icons/actions/{shoot,reload}.png`.
  - Add a `chosen.json` entry per pick with the same fields as the existing entries (`job_id`, `index`, `ref`, `styleRef`, `prompt`, `version`, `identity_ref`, `file`).
  - Run the app, fire a shot, and confirm the close-up shows the new pose (not the melee fallback). Take a screenshot.

- [ ] **Step 6: Commit** the installed PNGs, `chosen.json`, `jobs.txt`, the contact sheet and the raw candidates, with the message "Art: per-class ranged close-up poses and Shoot/Reload icons".

---

### Task 14: Balance check, docs and memory

**Files:**
- Modify: `shared/src/data/rangedConfig.json` (only if the sim shows a problem)
- Modify: `CLAUDE.md` (Project Status, Key Design Decisions, Message Protocol)

- [ ] **Step 1: Before/after simulation.**
  - On this branch, run the sim with bots that can shoot: `cmd.exe /c "npm run sim -- --help"` to find the flags. Then run the standard party scenario for ~200 fights and record the win rate, average rounds, and average party HP lost.
  - For the baseline, `git.exe stash` is **not** safe given the dirty tree. Instead, check out `feature/attack-juice` in a **temporary copy**: `git.exe worktree` is disallowed by user preference, so use `git.exe archive feature/attack-juice | tar -x -C ../caverns-baseline`, then install and run the same sim there.
  - Report both tables to the user.
  - If the win rate rose by more than ~10 points or the average rounds fell by more than ~25%, reduce `baseHit` by 0.05 or the gun `damageMult` values, re-run, and report again.
  - Change only `rangedConfig.json`.

- [ ] **Step 2: Update `CLAUDE.md`.**
  - Under "What's Working", add a line: "Ranged combat (trial): guns in a 5th `ranged` slot; Shoot (Marksmanship → range + hit chance) and Reload actions; tuning in `shared/src/data/rangedConfig.json`."
  - Under "Key Design Decisions", note that gun damage = class base + gun, and never mixes with melee.
  - Add `shoot`/`reload` to the protocol list.

- [ ] **Step 3: Memory.** Store a thinker `decision` memory (feature `ranged-combat`) with:
  - where the tuning lives;
  - that `hasLineOfSight` now lives in shared;
  - the old-save migration rule (absent key vs `null`);
  - the sim results.

- [ ] **Step 4: Full verification.** Run all suites (shared, itemgen, server to a log, client with tsc). Expected: all green. Then commit `CLAUDE.md` (and `rangedConfig.json` if tuned) with the message "Ranged combat: balance pass and docs".
