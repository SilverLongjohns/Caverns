# Combat Close-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Darkest Dungeon-style full-screen close-ups for player abilities, player crits and kills, and enemy kills and crits on players. They're paced by the server and gated on the client so the board never spoils the moment. Everything is data-driven from `classes.json`.

**Architecture:**
- **The rule:** a pure function in `shared`, `closeUpForParticipants(result, participants)`, decides whether a `combat_action_result` earns a close-up and how long it lasts.
- **The server** adds that duration, scaled by a new `SessionTiming.closeUpScale` (0 in simulations), in its single scheduling point, `afterCombatTurn`.
- **The client:** every server message passes through a pure-reducer "close-up gate" in `useWebSocket`. The gate holds messages from a qualifying result until its impact beat, while an app-level `CloseUpOverlay` plays the staged moment. Staging, art and sound are resolved from ability data (`targetType`, optional `closeUp`) with fallbacks.

**Tech Stack:** TypeScript, Vitest (fake timers on the server), React 18 + Zustand, CSS keyframes, Web Audio (the existing `AudioEngine.playUi`), Playwright (`.sandbox` checks), PixelLab MCP (art).

**Spec:** `docs/superpowers/specs/2026-09-27-combat-closeups-design.md`

**Spec clarifications made by this plan** (based on the code as it stands):
- **AFK timer.** The spec says "extend the AFK timer". In the code, `armAfkTimer` is only armed inside `broadcastTurnPrompt`, and only for disconnected players. Delaying the *turn prompt* by the close-up's duration delays the timer with it, so there's no separate AFK change.
- **Mob hits through the defend QTE.** `resolveDefend` broadcasts the landed hit as `action: 'defend'` with the mob as `actorId`. The rule treats a `defend` result whose actor is a mob and whose target is a player exactly like a mob attack. A player's own Defend is still `null`.
- **Missing targets.** If a result's target can't be found in the participants (e.g. already removed), the target type is assumed to be the opposite side of the actor.
- **The overlay lives in `App.tsx`,** next to `CombatIntro` (fixed, full-screen), not inside `ArenaView`. So it survives `combat_end` unmounting the arena.

## Global Constraints

**Data-driven (user requirement)**
- No code, CSS or test may name a specific ability ID or ability name.
- Triggers come from `!ability.passive`, staging from `targetType`, the name from `abilityName` or the ability's `name`, and art and sound from the optional `closeUp` block.
- Tests iterate over `CLASS_DEFINITIONS`.

**Timing** (config file `shared/src/data/closeUpConfig.json`, exactly):

```json
{ "abilityMs": 2000, "critMs": 1600, "killMs": 1800, "impactAt": 0.35, "maxQueued": 3 }
```

**Values**
- Sounds: `'crack' | 'boom' | 'shimmer'`, added to the existing `UiSound` union. They're synthesised, with no asset files.
- Art paths: `/closeups/abilities/<file>` (from data), `/closeups/classes/<classId>-attack.png`, `/closeups/classes/<classId>-hurt.png`, `/closeups/mobs/<templateId>.png`.
- Player art on the left, enemy art on the right.

**Server**
- `SessionTiming` gains `closeUpScale: number` (default `1`). `simulate.ts` sets it to `0`.
- The existing seeded sims must stay deterministic and fast.

**Environment and git**
- Node runs on Windows: use `cmd.exe /c "..."` from the repo root.
- Git: `git.exe`, explicit paths, local commits, never push. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `shared` changes need `cmd.exe /c "npm run build --workspace=shared"` before `server` or `client` see them.
- The dev client used for checks is at `http://localhost:5175` (sandbox: `/?sandbox=duel`). If it's down, start it with `cmd.exe /c "npm run dev:sandbox"` in the background.

**Styling**
- Don't touch `.crt-overlay`; the close-up sits under it.

## Review Focus

1. **A second qualifying result arrives while a close-up is playing** (e.g. a mob kill right after a player ability). It must play next, in order, and the board must end up exactly as the server says. Test: Task 3 (gate reducer: a queued close-up, messages in order).
2. **Combat ends mid close-up** (a kill that wins the fight). The overlay finishes, the arena unmounts behind it, and `combat_end` is applied only after the held messages. Test: Task 3 (a buffered `combat_end` keeps its position) and Task 6 (the overlay is mounted in `App`, outside `ArenaView`).
3. **A skip keypress that is also a game key** (e.g. Enter, or arrow keys panning the arena). Skipping consumes the key only while an overlay is showing, and never triggers the key's normal action. Test: Task 6 (the handler calls `stopPropagation`/`preventDefault` only when active).
4. **Disconnect or reconnect mid close-up.** Held messages are flushed, the overlay closes, and nothing is lost or duplicated. Test: Task 3 (`flush`) and the Task 3 wiring (`onclose` calls `flush`).
5. **An ability with a new or odd `targetType`, or with no `closeUp` block,** e.g. after a designer edits `classes.json`. It still stages (unknown values → `enemy`) and has art (fallback chain) and a sound (derived). Test: Task 4 (`stageFor` with an unknown `targetType`; art resolution iterating over all data with the `closeUp` blocks removed).

---

### Task 1: The shared close-up rule, config and data fields

**Files:**
- Create: `shared/src/data/closeUpConfig.json`
- Create: `shared/src/combat/closeUp.ts`
- Create: `shared/src/combat/closeUp.test.ts`
- Modify: `shared/src/classTypes.ts` (add `closeUp` to `AbilityDefinition`, `color` to `ClassDefinition`)
- Modify: `shared/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `CLOSE_UP_CONFIG: { abilityMs: number; critMs: number; killMs: number; impactAt: number; maxQueued: number }`
  - `type CloseUpKind = 'ability' | 'crit' | 'kill'`
  - `interface CloseUp { kind: CloseUpKind; durationMs: number }`
  - `type CloseUpSound = 'crack' | 'boom' | 'shimmer'`
  - `CLOSE_UP_SOUNDS: readonly CloseUpSound[]`
  - `closeUpFor(result: Partial<CombatActionResultMessage>, ctx: { actorType: 'player' | 'mob'; targetType?: 'player' | 'mob'; isPassiveAbility: boolean }): CloseUp | null`
  - `closeUpForParticipants(result: Partial<CombatActionResultMessage>, participants: Pick<CombatParticipant, 'id' | 'type' | 'className'>[]): CloseUp | null`
  - `findAbility(abilityId: string | undefined, className?: string): AbilityDefinition | undefined`
  - `AbilityDefinition.closeUp?: { art?: string; sound?: CloseUpSound }`
  - `ClassDefinition.color?: string`

- [ ] **Step 1: Write the failing tests** — `shared/src/combat/closeUp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS } from '../classData.js';
import { CLOSE_UP_CONFIG, CLOSE_UP_SOUNDS, closeUpFor, closeUpForParticipants, findAbility } from './closeUp.js';

const player = { actorType: 'player' as const, targetType: 'mob' as const, isPassiveAbility: false };
const mobHit = { actorType: 'mob' as const, targetType: 'player' as const, isPassiveAbility: false };

describe('closeUpFor', () => {
  it('every non-passive ability in the data gets an ability close-up; passives never do', () => {
    for (const cls of CLASS_DEFINITIONS) {
      for (const a of cls.abilities) {
        const r = closeUpFor({ action: 'use_ability', abilityId: a.id }, { ...player, isPassiveAbility: a.passive });
        if (a.passive) expect(r, a.id).toBeNull();
        else expect(r, a.id).toEqual({ kind: 'ability', durationMs: CLOSE_UP_CONFIG.abilityMs });
      }
    }
  });
  it('an ability that kills is still an ability close-up', () => {
    expect(closeUpFor({ action: 'use_ability', targetDowned: true }, player)?.kind).toBe('ability');
  });
  it('player basic attacks: kill beats crit, plain hits get nothing', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true, critMultiplier: 2 }, player))
      .toEqual({ kind: 'kill', durationMs: CLOSE_UP_CONFIG.killMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1.5 }, player))
      .toEqual({ kind: 'crit', durationMs: CLOSE_UP_CONFIG.critMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1 }, player)).toBeNull();
    expect(closeUpFor({ action: 'attack' }, player)).toBeNull();
  });
  it('mob hits on players: kill or crit only, including hits landed through the defend QTE', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true }, mobHit)?.kind).toBe('kill');
    expect(closeUpFor({ action: 'attack', critMultiplier: 2 }, mobHit)?.kind).toBe('crit');
    expect(closeUpFor({ action: 'attack' }, mobHit)).toBeNull();
    expect(closeUpFor({ action: 'defend', targetDowned: true }, mobHit)?.kind).toBe('kill');
  });
  it('never fires for defend, items, flee, the defend-QTE preview, or mob-on-mob', () => {
    expect(closeUpFor({ action: 'defend' }, { ...player, targetType: undefined })).toBeNull();
    expect(closeUpFor({ action: 'use_item', targetDowned: true }, player)).toBeNull();
    expect(closeUpFor({ action: 'use_item_effect', targetDowned: true }, player)).toBeNull();
    expect(closeUpFor({ action: 'flee' }, player)).toBeNull();
    expect(closeUpFor({ action: 'attack', defendQte: true, targetDowned: true }, mobHit)).toBeNull();
    expect(closeUpFor({ action: 'attack', targetDowned: true }, { ...mobHit, targetType: 'mob' })).toBeNull();
  });
});

describe('closeUpForParticipants', () => {
  const firstActive = CLASS_DEFINITIONS.flatMap((c) => c.abilities.map((a) => ({ c, a }))).find(({ a }) => !a.passive)!;
  const parts = [
    { id: 'p1', type: 'player' as const, className: firstActive.c.id },
    { id: 'm1', type: 'mob' as const },
  ];
  it('resolves actor and target sides from participants', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'm1', targetId: 'p1', targetDowned: true }, parts)?.kind).toBe('kill');
    expect(closeUpForParticipants({ action: 'use_ability', actorId: 'p1', abilityId: firstActive.a.id }, parts)?.kind).toBe('ability');
  });
  it('assumes the opposite side when the target is missing', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'p1', targetId: 'gone', targetDowned: true }, parts)?.kind).toBe('kill');
  });
  it('returns null for an unknown actor', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'ghost', critMultiplier: 3 }, parts)).toBeNull();
  });
});

describe('data integrity', () => {
  it('every closeUp block in the data is valid', () => {
    for (const cls of CLASS_DEFINITIONS) {
      if (cls.color !== undefined) expect(cls.color, cls.id).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const a of cls.abilities) {
        if (a.closeUp?.sound !== undefined) expect(CLOSE_UP_SOUNDS, a.id).toContain(a.closeUp.sound);
        if (a.closeUp?.art !== undefined) expect(a.closeUp.art, a.id).toMatch(/^\/closeups\//);
      }
    }
  });
  it('findAbility finds any ability by id, optionally within a class', () => {
    for (const cls of CLASS_DEFINITIONS) for (const a of cls.abilities) {
      expect(findAbility(a.id)?.id).toBe(a.id);
      expect(findAbility(a.id, cls.id)?.id).toBe(a.id);
    }
    expect(findAbility('does-not-exist')).toBeUndefined();
    expect(findAbility(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**
Run: `cmd.exe /c "npm run test --workspace=shared -- closeUp"`
Expected: FAIL, "Cannot find module './closeUp.js'".

- [ ] **Step 3: Implement.**

`shared/src/data/closeUpConfig.json`:

```json
{ "abilityMs": 2000, "critMs": 1600, "killMs": 1800, "impactAt": 0.35, "maxQueued": 3 }
```

In `shared/src/classTypes.ts`, inside `interface AbilityDefinition`, after `flankingMultiplier?: number;`:

```ts
  /** Optional close-up presentation; every field falls back to a derived default. */
  closeUp?: { art?: string; sound?: 'crack' | 'boom' | 'shimmer' };
```

And inside `interface ClassDefinition`, after `abilities: AbilityDefinition[];`:

```ts
  /** Optional class colour (#rrggbb), used to tint ability close-ups. */
  color?: string;
```

`shared/src/combat/closeUp.ts`:

```ts
import closeUpConfig from '../data/closeUpConfig.json' with { type: 'json' };
import { CLASS_DEFINITIONS } from '../classData.js';
import type { AbilityDefinition } from '../classTypes.js';
import type { CombatActionResultMessage } from '../messages.js';
import type { CombatParticipant } from '../types.js';

export const CLOSE_UP_CONFIG: { abilityMs: number; critMs: number; killMs: number; impactAt: number; maxQueued: number } = closeUpConfig;

export type CloseUpKind = 'ability' | 'crit' | 'kill';
export interface CloseUp { kind: CloseUpKind; durationMs: number }
export type CloseUpSound = 'crack' | 'boom' | 'shimmer';
export const CLOSE_UP_SOUNDS: readonly CloseUpSound[] = ['crack', 'boom', 'shimmer'];

type Side = 'player' | 'mob';
interface Ctx { actorType: Side; targetType?: Side; isPassiveAbility: boolean }

const make = (kind: CloseUpKind): CloseUp => ({
  kind,
  durationMs: kind === 'ability' ? CLOSE_UP_CONFIG.abilityMs : kind === 'crit' ? CLOSE_UP_CONFIG.critMs : CLOSE_UP_CONFIG.killMs,
});

/** Whether a combat result earns a close-up. Data-driven: never names an ability. */
export function closeUpFor(r: Partial<CombatActionResultMessage>, ctx: Ctx): CloseUp | null {
  if (r.defendQte) return null; // preview of an incoming hit, not the hit itself
  if (ctx.actorType === 'player') {
    if (r.action === 'use_ability') return ctx.isPassiveAbility ? null : make('ability');
    if (r.action === 'attack') {
      if (r.targetDowned) return make('kill');
      if ((r.critMultiplier ?? 1) > 1) return make('crit');
    }
    return null;
  }
  // Mob actor: only hits that land on a player. A mob hit resolved through the defend QTE arrives as 'defend'.
  if (ctx.targetType !== 'player') return null;
  if (r.action !== 'attack' && r.action !== 'defend') return null;
  if (r.targetDowned) return make('kill');
  if ((r.critMultiplier ?? 1) > 1) return make('crit');
  return null;
}

export function findAbility(abilityId: string | undefined, className?: string): AbilityDefinition | undefined {
  if (!abilityId) return undefined;
  const classes = className ? CLASS_DEFINITIONS.filter((c) => c.id === className) : CLASS_DEFINITIONS;
  for (const c of classes) {
    const a = c.abilities.find((x) => x.id === abilityId);
    if (a) return a;
  }
  return className ? findAbility(abilityId) : undefined;
}

/** closeUpFor with sides and passivity resolved from the combat's participants. */
export function closeUpForParticipants(
  r: Partial<CombatActionResultMessage>,
  participants: Pick<CombatParticipant, 'id' | 'type' | 'className'>[],
): CloseUp | null {
  const actor = participants.find((p) => p.id === r.actorId);
  if (!actor) return null;
  const target = r.targetId ? participants.find((p) => p.id === r.targetId) : undefined;
  const targetType: Side | undefined = target ? target.type : r.targetId ? (actor.type === 'player' ? 'mob' : 'player') : undefined;
  const ability = findAbility(r.abilityId, actor.className);
  return closeUpFor(r, { actorType: actor.type, targetType, isPassiveAbility: ability?.passive ?? false });
}
```

In `shared/src/index.ts`, after `export * from './classData.js';`, add:

```ts
export * from './combat/closeUp.js';
```

- [ ] **Step 4: Run the tests to verify they pass, then build.**
Run: `cmd.exe /c "npm run test --workspace=shared && npm run build --workspace=shared"`
Expected: all pass; the build exits 0.

- [ ] **Step 5: Commit.**

```bash
git.exe add shared/src/data/closeUpConfig.json shared/src/combat/closeUp.ts shared/src/combat/closeUp.test.ts shared/src/classTypes.ts shared/src/index.ts
git.exe commit -m "Add data-driven combat close-up rule and config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server pacing and area target lists

**Files:**
- Modify: `server/src/GameSession.ts`:
  - `SessionTiming` (76–81) and its defaults (140–145);
  - `afterCombatTurn` (1094–1111);
  - the result broadcasts at 991 (`handleCombatAction`), 1080 (`resolveDefend`), 1283 (`processMobTurn`), 2212 (area ability) and 2316 (single ability), plus their `afterCombatTurn` calls.
- Modify: `server/src/sandbox/simulate.ts:54-58` (timing)
- Test: `server/src/GameSession.closeUp.test.ts` (new)

**Interfaces:**
- Consumes: `closeUpForParticipants`, `CLOSE_UP_CONFIG` from `@caverns/shared` (Task 1).
- Produces:
  - `SessionTiming.closeUpScale: number` (default 1);
  - `afterCombatTurn(roomId, combat, extraDelayMs = 0)`;
  - the area `combat_action_result` gains `targetIds: string[]` and `downedIds: string[]`;
  - `CombatActionResultMessage` gains `targetIds?: string[]; downedIds?: string[]` (in `shared/src/messages.ts`).

- [ ] **Step 1: Add the message fields.** In `shared/src/messages.ts`, `CombatActionResultMessage`, after `itemEffectHealing?: number;`:

```ts
  /** Area abilities: every participant hit, and every participant downed. */
  targetIds?: string[];
  downedIds?: string[];
```

Then run: `cmd.exe /c "npm run build --workspace=shared"`.

- [ ] **Step 2: Write the failing tests** — `server/src/GameSession.closeUp.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, getClassDefinition, type ServerMessage } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

function setup() {
  const r = resolveSetup('duel', {});
  if (!r.ok) throw new Error(r.error);
  const sent: ServerMessage[] = [];
  const session = new GameSession((m) => sent.push(m), (_to, m) => sent.push(m), buildSandboxContent(r.setup));
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  session.setTiming({ mobTurnDelayMs: 100 });
  session.startGame();
  session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
  return { session, sent };
}

/** Let mob turns play out (fake timers) until it's p1's turn. */
function toPlayerTurn(session: GameSession) {
  for (let i = 0; i < 20 && session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId !== 'p1'; i++) vi.advanceTimersByTime(1000);
  expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
}

describe('close-up pacing', () => {
  it('delays the next turn by the close-up duration after a qualifying ability', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      toPlayerTurn(session);
      const p1 = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.id === 'p1')!;
      const ability = getClassDefinition(p1.className!)!.abilities.find((a) => !a.passive && a.targetType === 'none');
      if (!ability) return; // data-driven: class has no self ability; the attack test below still covers pacing
      const before = sent.length;
      session.handleUseAbility('p1', ability.id);
      const nextActionAfter = () => sent.slice(before).findIndex((m) =>
        m.type === 'combat_turn' || (m.type === 'combat_action_result' && (m as { actorId?: string }).actorId !== 'p1'));
      vi.advanceTimersByTime(CLOSE_UP_CONFIG.abilityMs - 1);
      expect(nextActionAfter()).toBe(-1);
      vi.advanceTimersByTime(100 + 2);
      expect(nextActionAfter()).toBeGreaterThanOrEqual(0);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('adds no delay when closeUpScale is 0 (simulations)', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      session.setTiming({ closeUpScale: 0 });
      toPlayerTurn(session);
      const p1 = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.id === 'p1')!;
      const ability = getClassDefinition(p1.className!)!.abilities.find((a) => !a.passive && a.targetType === 'none');
      if (!ability) return;
      const before = sent.length;
      session.handleUseAbility('p1', ability.id);
      vi.advanceTimersByTime(101);
      expect(sent.slice(before).some((m) => m.type === 'combat_turn' || (m.type === 'combat_action_result' && (m as { actorId?: string }).actorId !== 'p1'))).toBe(true);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('adds no delay for results that do not qualify (end turn)', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      toPlayerTurn(session);
      const before = sent.length;
      session.handleArenaEndTurn('p1');
      vi.advanceTimersByTime(101);
      expect(sent.slice(before).some((m) => m.type === 'combat_turn' || m.type === 'combat_action_result' || m.type === 'arena_positions_update')).toBe(true);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
});
```

The ability is found from the data at runtime (the duel player's class, the first non-passive `targetType: 'none'` ability). It's never named.

- [ ] **Step 3: Run the tests to verify they fail.**
Run: `cmd.exe /c "npm run test --workspace=server -- GameSession.closeUp"`
Expected:
- the first test FAILS (the next action arrives within about 100ms, not after the close-up);
- the `closeUpScale` test FAILS to type-check or run (the field doesn't exist);
- the third passes.

If the duel player's class has no `targetType: 'none'` ability, the first two return early and pass vacuously. In that case, change the finder to the first non-passive ability of **any** `targetType` and pass the mob's id as the target: `session.handleUseAbility('p1', ability.id, 'tunnel_rat_0')`. Record a ruling.

- [ ] **Step 4: Implement.**

In `SessionTiming`, add `closeUpScale: number;`. In the defaults object, add `closeUpScale: 1,`.

Add a private helper in `GameSession` next to `afterCombatTurn`:

```ts
  /** Extra pause for a combat close-up after this result (0 when it doesn't qualify or in simulations). */
  private closeUpDelay(combat: ArenaCombatManager, result: Partial<CombatActionResultMessage>): number {
    if (!this.timing.closeUpScale) return 0;
    const cu = closeUpForParticipants(result, combat.getState().participants);
    return cu ? Math.round(cu.durationMs * this.timing.closeUpScale) : 0;
  }
```

Import `closeUpForParticipants` and the `CombatActionResultMessage` type from `@caverns/shared`, if they aren't imported already.

Change `afterCombatTurn` to take the extra delay:

```ts
  private afterCombatTurn(roomId: string, combat: ArenaCombatManager, extraDelayMs = 0): void {
    if (this.disposed) return;
    if (combat.isComplete()) {
      const result = combat.getResult();
      // Delay combat end on victory so the client disintegration animation plays (and any close-up finishes)
      const delay = (result === 'victory' ? this.timing.victoryDelayMs : 0) + extraDelayMs;
      setTimeout(() => this.finishCombat(roomId, result as 'victory' | 'flee' | 'wipe'), delay);
      return;
    }
    const currentId = combat.getCurrentTurnId();
    combat.startTurn(currentId);
    if (combat.isMobTurn(currentId)) {
      // Delay mob turns so attack animations (and close-ups) play out before the next action
      setTimeout(() => this.processMobTurn(roomId, combat), this.timing.mobTurnDelayMs + extraDelayMs);
    } else if (extraDelayMs > 0) {
      setTimeout(() => { if (!this.disposed && this.combats.get(roomId) === combat) this.broadcastTurnPrompt(combat); }, extraDelayMs);
    } else {
      this.broadcastTurnPrompt(combat);
    }
  }
```

Keep any existing body lines not shown here, such as the `disposed` check and guards, as they are. Only the three changes matter: the added `+ extraDelayMs` terms and the delayed-prompt branch.

At each qualifying broadcast site, compute the delay from the object that was broadcast and pass it to the `afterCombatTurn` call that follows:
- **`handleCombatAction` (991):** introduce `const closeUpMs = this.closeUpDelay(combat, { ...result, action: result.action });` straight after the broadcast. Change `this.afterCombatTurn(combatRoomId, combat);` (1063) to `this.afterCombatTurn(combatRoomId, combat, closeUpMs);`.
- **`resolveDefend` (1080):** `let closeUpMs = 0;` before `if (damageResult)`, and inside it after the broadcast, `closeUpMs = this.closeUpDelay(combat, { ...damageResult, action: 'defend' });`. Then `this.afterCombatTurn(roomId, combat, closeUpMs);`.
- **`processMobTurn` normal result (1283):** `const closeUpMs = this.closeUpDelay(combat, result);` after the broadcast; pass it to the `afterCombatTurn` at 1293.
- **Area ability (2212):** add `targetIds: hitTargets.map((t: { id: string }) => t.id), downedIds: downedTargets,` to the broadcast object. After the broadcast, `const closeUpMs = this.closeUpDelay(combat, { action: 'use_ability', actorId: playerId, abilityId: ability.id });`. Pass it to the `afterCombatTurn` at 2249.
- **Single-target ability (2316):** `const closeUpMs = this.closeUpDelay(combat, { action: 'use_ability', actorId: playerId, abilityId: ability.id, targetId, targetDowned: result.targetDowned });` after the broadcast; pass it at 2347.

**Important:** compute `closeUpDelay` **immediately after the broadcast and before any downed-participant removal**, so the target is still in the participants. Where `combat` is named differently in a handler (e.g. obtained via `this.combats.get(...)`), use that variable.

In `server/src/sandbox/simulate.ts`, add `closeUpScale: 0` to the `timing` object (54–58).

- [ ] **Step 5: Run the tests to verify they pass, plus the whole server suite.**
Run: `cmd.exe /c "npm run test --workspace=server"`
Expected:
- the 3 new tests pass;
- `simulate.test.ts`, `botTurnRegression.test.ts` and `GameSession.sandbox.test.ts` still pass;
- the total is 431 plus the new ones, with 0 failed.

- [ ] **Step 6: Commit.**

```bash
git.exe add shared/src/messages.ts server/src/GameSession.ts server/src/GameSession.closeUp.test.ts server/src/sandbox/simulate.ts
git.exe commit -m "Pace combat turns around close-ups; send area target lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The client close-up gate

**Files:**
- Create: `client/src/combat/closeUpGate.ts` (pure reducer and driver)
- Create: `client/src/combat/closeUpGate.test.ts`
- Create: `client/src/combat/closeUpStore.ts` (Zustand store the overlay reads)
- Modify: `client/src/hooks/useWebSocket.ts:34-43` (route messages through the gate; flush on close)

**Interfaces:**
- Consumes: `closeUpForParticipants`, `CLOSE_UP_CONFIG`, `CloseUp` (Task 1).
- Produces:
  - `interface ActiveCloseUp { id: number; closeUp: CloseUp; result: CombatActionResultMessage; participants: CombatParticipant[] }`
  - `type GateState = { held: ServerMessage[]; current: ActiveCloseUp | null; queue: ActiveCloseUp[]; phase: 'idle' | 'pre' | 'post'; nextId: number }`
  - `gateReceive(state, msg, closeUp: CloseUp | null, participants): { state; deliver: ServerMessage[] }`
  - `gateImpact(state)`, `gateEnd(state)`, `gateSkip(state)`, `gateFlush(state)`, each returning `{ state; deliver }`
  - `useCloseUpStore` with `{ current: ActiveCloseUp | null; skip: () => void }`
  - `routeServerMessage(msg: ServerMessage): void` (used by `useWebSocket`)
  - `flushCloseUps(): void`

**Semantics:**
- **`idle`:** messages pass straight through. A qualifying result starts a close-up: it becomes `current`, the phase becomes `pre`, and **the result itself is held**.
- **`pre`** (before impact): every incoming message is held; a qualifying result is also queued (a new `ActiveCloseUp`, held in its place in the stream).
- **`impact`:** delivers held messages up to, but not including, the next queued close-up's result; the phase becomes `post`.
- **`post`:** messages are delivered as they arrive, unless there's a queue, in which case they stay held behind it.
- **`end`:** the next queued close-up becomes current (`pre`, holding its own result and everything after it), otherwise `idle`.
- **`skip` = impact + end.**
- **`flush`:** delivers everything held, clears the current close-up and the queue, and returns to `idle`.
- **Queue cap `CLOSE_UP_CONFIG.maxQueued`:** when exceeded, the **oldest queued** close-up is dropped; its messages stay in the held stream in order, so they're delivered at the next impact.

- [ ] **Step 1: Write the failing tests** — `client/src/combat/closeUpGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { initialGate, gateReceive, gateImpact, gateEnd, gateSkip, gateFlush } from './closeUpGate.js';

const cu = { kind: 'ability' as const, durationMs: 2000 };
const res = (id: string) => ({ type: 'combat_action_result', actorId: id, actorName: id, action: 'use_ability' }) as ServerMessage;
const log = (m: string) => ({ type: 'text_log', message: m, logType: 'combat' }) as ServerMessage;
const types = (ms: ServerMessage[]) => ms.map((m) => (m.type === 'text_log' ? `log:${(m as { message: string }).message}` : m.type === 'combat_action_result' ? `res:${(m as { actorId: string }).actorId}` : m.type));

describe('close-up gate', () => {
  it('passes messages straight through when idle', () => {
    const r = gateReceive(initialGate(), log('a'), null, []);
    expect(types(r.deliver)).toEqual(['log:a']);
    expect(r.state.current).toBeNull();
  });

  it('holds the qualifying result and what follows until impact, then flows', () => {
    let s = initialGate();
    let r = gateReceive(s, res('p1'), cu, []); s = r.state;
    expect(r.deliver).toEqual([]);
    expect(s.current?.result).toMatchObject({ actorId: 'p1' });
    r = gateReceive(s, log('p1 hits'), null, []); s = r.state;
    expect(r.deliver).toEqual([]);
    r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:p1', 'log:p1 hits']);
    r = gateReceive(s, log('after'), null, []); s = r.state;
    expect(types(r.deliver)).toEqual(['log:after']);
    r = gateEnd(s);
    expect(r.state.current).toBeNull();
  });

  it('queues a second close-up and keeps everything in order', () => {
    let s = initialGate();
    s = gateReceive(s, res('p1'), cu, []).state;
    s = gateReceive(s, log('one'), null, []).state;
    s = gateReceive(s, res('m1'), cu, []).state;
    s = gateReceive(s, log('two'), null, []).state;
    let r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:p1', 'log:one']);
    r = gateReceive(s, log('three'), null, []); s = r.state;
    expect(r.deliver).toEqual([]); // held behind the queued close-up
    r = gateEnd(s); s = r.state;
    expect(s.current?.result).toMatchObject({ actorId: 'm1' });
    r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:m1', 'log:two', 'log:three']);
  });

  it('skip releases the held messages at once', () => {
    let s = gateReceive(initialGate(), res('p1'), cu, []).state;
    s = gateReceive(s, { type: 'combat_end', result: 'victory' } as ServerMessage, null, []).state;
    const r = gateSkip(s);
    expect(types(r.deliver)).toEqual(['res:p1', 'combat_end']);
    expect(r.state.current).toBeNull();
  });

  it('flush delivers everything and resets', () => {
    let s = gateReceive(initialGate(), res('p1'), cu, []).state;
    s = gateReceive(s, res('m1'), cu, []).state;
    s = gateReceive(s, log('x'), null, []).state;
    const r = gateFlush(s);
    expect(types(r.deliver)).toEqual(['res:p1', 'res:m1', 'log:x']);
    expect(r.state).toMatchObject({ current: null, queue: [], held: [], phase: 'idle' });
  });

  it('drops the oldest queued close-up past the cap but keeps its messages in order', () => {
    let s = gateReceive(initialGate(), res('a'), cu, []).state;
    for (const id of ['b', 'c', 'd', 'e']) s = gateReceive(s, res(id), cu, []).state; // 4 queued, cap 3
    expect(s.queue.map((q) => q.result.actorId)).toEqual(['c', 'd', 'e']);
    const r = gateImpact(s);
    expect(types(r.deliver)).toEqual(['res:a', 'res:b']); // b's close-up dropped; its result still arrives, in order
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat"`
Expected: FAIL, the module can't be resolved.

- [ ] **Step 3: Implement** `client/src/combat/closeUpGate.ts`:

```ts
import { CLOSE_UP_CONFIG, type CloseUp, type CombatActionResultMessage, type CombatParticipant, type ServerMessage } from '@caverns/shared';

export interface ActiveCloseUp { id: number; closeUp: CloseUp; result: CombatActionResultMessage; participants: CombatParticipant[] }
export interface GateState { held: ServerMessage[]; current: ActiveCloseUp | null; queue: ActiveCloseUp[]; phase: 'idle' | 'pre' | 'post'; nextId: number }
type Out = { state: GateState; deliver: ServerMessage[] };

export function initialGate(): GateState {
  return { held: [], current: null, queue: [], phase: 'idle', nextId: 1 };
}

/** Index in `held` of a queued close-up's own result (everything from there on waits for it). */
function barrier(s: GateState): number {
  if (!s.queue.length) return s.held.length;
  const i = s.held.indexOf(s.queue[0].result as ServerMessage);
  return i < 0 ? s.held.length : i;
}

export function gateReceive(s: GateState, msg: ServerMessage, closeUp: CloseUp | null, participants: CombatParticipant[]): Out {
  if (closeUp && msg.type === 'combat_action_result') {
    const cu: ActiveCloseUp = { id: s.nextId, closeUp, result: msg as CombatActionResultMessage, participants };
    if (s.phase === 'idle') {
      return { state: { ...s, current: cu, phase: 'pre', held: [msg], nextId: s.nextId + 1 }, deliver: [] };
    }
    let queue = [...s.queue, cu];
    if (queue.length > CLOSE_UP_CONFIG.maxQueued) queue = queue.slice(queue.length - CLOSE_UP_CONFIG.maxQueued);
    return { state: { ...s, queue, held: [...s.held, msg], nextId: s.nextId + 1 }, deliver: [] };
  }
  if (s.phase === 'idle') return { state: s, deliver: [msg] };
  if (s.phase === 'post' && !s.queue.length) return { state: s, deliver: [msg] };
  return { state: { ...s, held: [...s.held, msg] }, deliver: [] };
}

export function gateImpact(s: GateState): Out {
  if (s.phase !== 'pre') return { state: s, deliver: [] };
  const cut = barrier(s);
  return { state: { ...s, phase: 'post', held: s.held.slice(cut) }, deliver: s.held.slice(0, cut) };
}

export function gateEnd(s: GateState): Out {
  if (!s.current) return { state: s, deliver: [] };
  const [next, ...rest] = s.queue;
  if (next) return { state: { ...s, current: next, queue: rest, phase: 'pre' }, deliver: [] };
  // Nothing queued: anything still held (only possible after a flush race) goes out now.
  return { state: { ...s, current: null, phase: 'idle', held: [] }, deliver: s.held };
}

export function gateSkip(s: GateState): Out {
  const a = gateImpact(s);
  const b = gateEnd(a.state);
  return { state: b.state, deliver: [...a.deliver, ...b.deliver] };
}

export function gateFlush(s: GateState): Out {
  return { state: initialGate(), deliver: s.held };
}
```

Note: `gateImpact` after the `gateEnd` that promotes a queued close-up correctly delivers from the start of `held`, because the promoted close-up's result is now the first held item. The barrier moves on to the *next* queued item.

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat"` → Expected: PASS (6).

- [ ] **Step 5: The store and the driver.** Create `client/src/combat/closeUpStore.ts`:

```ts
import { create } from 'zustand';
import { closeUpForParticipants, CLOSE_UP_CONFIG, type ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { initialGate, gateReceive, gateImpact, gateEnd, gateSkip, gateFlush, type ActiveCloseUp, type GateState } from './closeUpGate.js';

interface CloseUpUi { current: ActiveCloseUp | null; skip: () => void }
export const useCloseUpStore = create<CloseUpUi>(() => ({ current: null, skip: () => skipCloseUp() }));

let gate: GateState = initialGate();
let timers: number[] = [];
const deliver = (msgs: ServerMessage[]) => { for (const m of msgs) useGameStore.getState().handleServerMessage(m); };
const clearTimers = () => { timers.forEach((t) => window.clearTimeout(t)); timers = []; };

function publish(): void {
  useCloseUpStore.setState({ current: gate.current });
}

function schedule(): void {
  clearTimers();
  const cur = gate.current;
  if (!cur) return;
  const d = cur.closeUp.durationMs;
  if (gate.phase === 'pre') timers.push(window.setTimeout(() => apply(gateImpact(gate)), d * CLOSE_UP_CONFIG.impactAt));
  timers.push(window.setTimeout(() => { apply(gateEnd(gate)); schedule(); }, d));
}

function apply(out: { state: GateState; deliver: ServerMessage[] }): void {
  const prevId = gate.current?.id;
  gate = out.state;
  deliver(out.deliver);
  if (gate.current?.id !== prevId) publish();
}

/** Every server message goes through here (see useWebSocket). */
export function routeServerMessage(msg: ServerMessage): void {
  const wasIdle = gate.phase === 'idle';
  const participants = useGameStore.getState().activeCombat?.participants ?? [];
  const cu = msg.type === 'combat_action_result' ? closeUpForParticipants(msg, participants) : null;
  apply(gateReceive(gate, msg, cu, participants.map((p) => ({ ...p }))));
  if (wasIdle && gate.phase === 'pre') schedule();
}

export function skipCloseUp(): void {
  if (!gate.current) return;
  apply(gateSkip(gate));
  schedule();
}

export function flushCloseUps(): void {
  clearTimers();
  apply(gateFlush(gate));
  publish();
}
```

In `client/src/hooks/useWebSocket.ts`:
- import `routeServerMessage` and `flushCloseUps` from `'../combat/closeUpStore.js'`;
- in `ws.onmessage`, replace `handleServerMessage(msg);` with `routeServerMessage(msg);` (keep `recordSandboxEvent(msg);` before it, unchanged);
- in the socket's close handler (`ws.onclose`), add `flushCloseUps();` as the first statement.

If `handleServerMessage` becomes unused in that file, remove its import or destructuring.

- [ ] **Step 6: Typecheck and run the client suite.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"` → Expected: exit 0; all pass.

- [ ] **Step 7: Commit.**

```bash
git.exe add client/src/combat/closeUpGate.ts client/src/combat/closeUpGate.test.ts client/src/combat/closeUpStore.ts client/src/hooks/useWebSocket.ts
git.exe commit -m "Gate server messages around combat close-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Staging and art resolution (pure)

**Files:**
- Create: `client/src/combat/closeUpStage.ts`
- Create: `client/src/combat/closeUpStage.test.ts`

**Interfaces:**
- Consumes: `ActiveCloseUp` (Task 3); `findAbility`, `getClassDefinition`, `CLASS_DEFINITIONS` from shared; `getClassPortrait` (`client/src/classPortraits.ts`); `getParticipantGlyph` (`client/src/glyphs.ts`).
- Produces:
  - `interface StageActor { id: string; name: string; side: 'left' | 'right'; art: string[] /* fallback chain */; downed: boolean; isActor: boolean }`
  - `interface Stage { layout: 'versus' | 'allies' | 'solo'; left: StageActor[]; right: StageActor[]; extra: number /* "+N" */; title: string; subtitle: string; number: { value: number; kind: 'damage' | 'heal' } | null; band: string /* CSS colour */; tone: 'player' | 'enemy'; sound: 'crack' | 'boom' | 'shimmer' }`
  - `stageFor(active: ActiveCloseUp): Stage`
  - `artChainFor(p: { type: 'player' | 'mob'; className?: string; templateId?: string }, role: 'attack' | 'hurt' | 'cast', abilityArt?: string): string[]`

- [ ] **Step 1: Write the failing tests** — `client/src/combat/closeUpStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS, CLOSE_UP_CONFIG, type CombatParticipant } from '@caverns/shared';
import { stageFor, artChainFor } from './closeUpStage.js';

const cls = CLASS_DEFINITIONS[0];
const hero: CombatParticipant = { id: 'p1', type: 'player', name: 'Hero', hp: 30, maxHp: 50, initiative: 5, className: cls.id };
const ally: CombatParticipant = { id: 'p2', type: 'player', name: 'Ally', hp: 20, maxHp: 50, initiative: 5, className: CLASS_DEFINITIONS[1].id };
const mob = (i: number): CombatParticipant => ({ id: `m${i}`, type: 'mob', name: `Rat ${i}`, hp: 10, maxHp: 15, initiative: 3, templateId: 'tunnel_rat' });
const parts = [hero, ally, mob(1), mob(2), mob(3), mob(4), mob(5)];
const active = (result: object, kind: 'ability' | 'crit' | 'kill' = 'ability') => ({
  id: 1, closeUp: { kind, durationMs: CLOSE_UP_CONFIG.abilityMs }, participants: parts,
  result: { type: 'combat_action_result', actorName: 'x', ...result } as never,
});

describe('artChainFor', () => {
  it('every class, role and mob resolves to a non-empty chain ending in a stand-in', () => {
    for (const c of CLASS_DEFINITIONS) for (const role of ['attack', 'hurt', 'cast'] as const) {
      const chain = artChainFor({ type: 'player', className: c.id }, role);
      expect(chain.length, `${c.id}/${role}`).toBeGreaterThan(1);
      expect(chain[0]).toMatch(/^\/closeups\/classes\//);
    }
    expect(artChainFor({ type: 'mob', templateId: 'tunnel_rat' }, 'attack')).toEqual(['/closeups/mobs/tunnel_rat.png', '/sprites/glyphs/mobs/tunnel_rat.png']);
  });
  it('an ability art path from data goes first', () => {
    expect(artChainFor({ type: 'player', className: cls.id }, 'cast', '/closeups/abilities/x.png')[0]).toBe('/closeups/abilities/x.png');
  });
});

describe('stageFor (data-driven over every ability)', () => {
  it('stages every non-passive ability without naming it', () => {
    for (const c of CLASS_DEFINITIONS) for (const a of c.abilities.filter((x) => !x.passive)) {
      const caster = { ...hero, className: c.id };
      const s = stageFor({ ...active({ action: 'use_ability', actorId: 'p1', abilityId: a.id, abilityName: a.name, targetId: a.targetType === 'ally' ? 'p2' : a.targetType === 'enemy' ? 'm1' : undefined, targetIds: a.targetType.startsWith('area') ? ['m1', 'm2'] : undefined }), participants: [caster, ally, mob(1), mob(2)] });
      expect(s.title, a.id).toBe(a.name.toUpperCase());
      expect(s.left[0]?.id, a.id).toBe('p1');
      if (a.targetType === 'none') expect(s.layout, a.id).toBe('solo');
      if (a.targetType === 'ally' || a.targetType === 'area_ally') expect(s.layout, a.id).toBe('allies');
      if (a.targetType === 'enemy' || a.targetType === 'area_enemy') expect(s.layout, a.id).toBe('versus');
    }
  });
  it('area hits show at most 3 targets plus "+N"', () => {
    const s = stageFor(active({ action: 'use_ability', actorId: 'p1', abilityId: cls.abilities[0].id, abilityName: 'Blast', targetIds: ['m1', 'm2', 'm3', 'm4', 'm5'], downedIds: ['m2'] }));
    expect(s.right).toHaveLength(3);
    expect(s.extra).toBe(2);
    expect(s.right.find((a) => a.id === 'm2')?.downed).toBe(true);
  });
  it('an unknown targetType stages as versus', () => {
    const s = stageFor({ ...active({ action: 'use_ability', actorId: 'p1', abilityId: '__nope__', abilityName: 'Odd', targetId: 'm1' }) });
    expect(s.layout).toBe('versus');
  });
  it('mob kill on a player: mob on the right, player on the left, enemy tone', () => {
    const s = stageFor(active({ action: 'attack', actorId: 'm1', targetId: 'p1', targetDowned: true, damage: 12 }, 'kill'));
    expect(s.left[0].id).toBe('p1');
    expect(s.right[0].id).toBe('m1');
    expect(s.right[0].isActor).toBe(true);
    expect(s.tone).toBe('enemy');
    expect(s.subtitle).toBe('KILLED');
    expect(s.sound).toBe('boom');
  });
  it('player crit: CRITICAL, crack, damage number', () => {
    const s = stageFor(active({ action: 'attack', actorId: 'p1', targetId: 'm1', critMultiplier: 2, damage: 14 }, 'crit'));
    expect(s.subtitle).toBe('CRITICAL');
    expect(s.number).toEqual({ value: 14, kind: 'damage' });
    expect(s.sound).toBe('crack');
  });
  it('healing with no damage defaults to shimmer and a heal number', () => {
    const s = stageFor(active({ action: 'use_ability', actorId: 'p1', abilityId: '__heal__', abilityName: 'Mend', targetId: 'p2', healing: 9 }));
    expect(s.number).toEqual({ value: 9, kind: 'heal' });
    expect(s.sound).toBe('shimmer');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat/closeUpStage"` → Expected: FAIL, the module can't be resolved.

- [ ] **Step 3: Implement** `client/src/combat/closeUpStage.ts`:

```ts
import { findAbility, getClassDefinition, type CombatParticipant } from '@caverns/shared';
import type { ActiveCloseUp } from './closeUpGate.js';
import { getClassPortrait } from '../classPortraits.js';
import { getParticipantGlyph } from '../glyphs.js';

export interface StageActor { id: string; name: string; side: 'left' | 'right'; art: string[]; downed: boolean; isActor: boolean }
export interface Stage {
  layout: 'versus' | 'allies' | 'solo';
  left: StageActor[]; right: StageActor[]; extra: number;
  title: string; subtitle: string;
  number: { value: number; kind: 'damage' | 'heal' } | null;
  band: string; tone: 'player' | 'enemy'; sound: 'crack' | 'boom' | 'shimmer';
}

const MAX_TARGETS = 3;
const BAND = { crit: '#6b4a12', kill: '#5a0f0a', enemy: '#2a0808', fallback: '#4a3218' };

export function artChainFor(
  p: { type: 'player' | 'mob'; className?: string; templateId?: string },
  role: 'attack' | 'hurt' | 'cast',
  abilityArt?: string,
): string[] {
  const chain: string[] = [];
  if (p.type === 'mob') {
    if (p.templateId) chain.push(`/closeups/mobs/${p.templateId}.png`);
  } else {
    if (role === 'cast' && abilityArt) chain.push(abilityArt);
    if (p.className) chain.push(`/closeups/classes/${p.className}-${role === 'hurt' ? 'hurt' : 'attack'}.png`);
    const portrait = p.className ? getClassPortrait(p.className) : null;
    if (portrait) chain.push(portrait);
  }
  const glyph = getParticipantGlyph({ type: p.type, className: p.className, templateId: p.templateId });
  if (glyph) chain.push(glyph);
  return chain;
}

const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.35).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
};

export function stageFor(active: ActiveCloseUp): Stage {
  const { result: r, participants, closeUp } = active;
  const byId = new Map(participants.map((p) => [p.id, p]));
  const actor = byId.get(r.actorId);
  const actorIsMob = actor?.type === 'mob';
  const ability = findAbility(r.abilityId, actor?.className);
  const targetType = ability?.targetType ?? 'enemy';

  const downed = new Set([...(r.downedIds ?? []), ...(r.targetDowned && r.targetId ? [r.targetId] : [])]);
  const toStage = (p: CombatParticipant | undefined, side: 'left' | 'right', isActor: boolean, role: 'attack' | 'hurt' | 'cast'): StageActor | null =>
    p ? { id: p.id, name: p.name, side, art: artChainFor(p, role, ability?.closeUp?.art), downed: downed.has(p.id), isActor } : null;

  const targetIds = r.targetIds ?? (r.targetId ? [r.targetId] : []);
  let layout: Stage['layout'] = 'versus';
  let left: StageActor[] = [];
  let right: StageActor[] = [];
  let extra = 0;

  if (actorIsMob) {
    // Enemy hit on a player: player (hurt) left, mob (attacking) right.
    left = [toStage(byId.get(r.targetId ?? ''), 'left', false, 'hurt')].filter(Boolean) as StageActor[];
    right = [toStage(actor, 'right', true, 'attack')].filter(Boolean) as StageActor[];
  } else {
    const casterRole = r.action === 'use_ability' ? 'cast' : 'attack';
    const caster = toStage(actor, 'left', true, casterRole);
    if (r.action === 'use_ability' && (targetType === 'ally' || targetType === 'area_ally')) {
      layout = 'allies';
      const allies = targetIds.filter((id) => id !== r.actorId).slice(0, 2).map((id) => toStage(byId.get(id), 'left', false, 'hurt'));
      left = [caster, ...allies].filter(Boolean) as StageActor[];
    } else if (r.action === 'use_ability' && targetType === 'none') {
      layout = 'solo';
      left = [caster].filter(Boolean) as StageActor[];
    } else {
      left = [caster].filter(Boolean) as StageActor[];
      const targets = targetIds.map((id) => toStage(byId.get(id), 'right', false, 'hurt')).filter(Boolean) as StageActor[];
      right = targets.slice(0, MAX_TARGETS);
      extra = Math.max(0, targets.length - MAX_TARGETS);
    }
  }

  const damage = r.damage ?? r.pendingDamage;
  const number = damage ? { value: damage, kind: 'damage' as const } : r.healing ? { value: r.healing, kind: 'heal' as const } : null;
  const anyDowned = downed.size > 0;
  const subtitle = anyDowned ? 'KILLED' : closeUp.kind === 'crit' ? 'CRITICAL' : (r.buffsApplied ?? []).join(' · ').toUpperCase();
  const derivedSound: Stage['sound'] = anyDowned ? 'boom' : (!damage && (r.healing || (r.buffsApplied ?? []).length)) ? 'shimmer' : 'crack';
  const sound = ability?.closeUp?.sound ?? derivedSound;
  const title = (r.abilityName ?? ability?.name ?? (closeUp.kind === 'kill' ? 'Killing Blow' : 'Critical Strike')).toUpperCase();

  const classColor = actor?.className ? getClassDefinition(actor.className)?.color : undefined;
  const band = actorIsMob ? BAND.enemy : closeUp.kind === 'kill' ? BAND.kill : closeUp.kind === 'crit' ? BAND.crit : classColor ? shade(classColor) : BAND.fallback;

  return { layout, left, right, extra, title, subtitle, number, band, tone: actorIsMob ? 'enemy' : 'player', sound };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat && npx tsc --noEmit -p ."` → Expected: PASS; `tsc` clean.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/combat/closeUpStage.ts client/src/combat/closeUpStage.test.ts
git.exe commit -m "Resolve close-up staging and art from ability data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Impact sounds

**Files:**
- Modify: `client/src/audio/uiSounds.ts` (extend `UiSound`, synth)
- Modify: `client/src/audio/uiSounds.test.ts`

**Interfaces:**
- Produces: `UiSound = 'click' | 'tick' | 'power' | 'crack' | 'boom' | 'shimmer'`. `audioEngine.playUi` accepts them unchanged; throttling only applies to `'tick'`.

- [ ] **Step 1: Write the failing test.** Append to `client/src/audio/uiSounds.test.ts`:

```ts
import { synthUiSound, type UiSound } from './uiSounds.js';

describe('synthUiSound', () => {
  it('synthesises every UI sound, including close-up impacts, without throwing', () => {
    const nodes: string[] = [];
    const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
    const node = (kind: string) => { nodes.push(kind); return { type: '', frequency: param(), gain: param(), Q: param(), connect(n: unknown) { return n; }, start() {}, stop() {} }; };
    const ctx = { currentTime: 0, sampleRate: 48000, createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'),
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }), createBufferSource: () => ({ ...node('src'), buffer: null }) };
    for (const s of ['click', 'tick', 'power', 'crack', 'boom', 'shimmer'] as UiSound[]) {
      nodes.length = 0;
      expect(() => synthUiSound(ctx as never, {} as never, s)).not.toThrow();
      expect(nodes.length, s).toBeGreaterThan(0);
    }
  });
});
```

(If `describe`/`it`/`expect` aren't imported at the top of the file already, add them to its existing vitest import.)

- [ ] **Step 2: Run the test to verify it fails.**
Run: `cmd.exe /c "cd client && npx vitest run src/audio/uiSounds"`
Expected: FAIL; for `'crack'`, `'boom'` and `'shimmer'` the function falls through to the `power` branch, so the type check fails. If Vitest still runs it, the test fails on the missing type or behaviour. Record whichever failure you see.

- [ ] **Step 3: Implement.**
- In `uiSounds.ts`, change the union to `export type UiSound = 'click' | 'tick' | 'power' | 'crack' | 'boom' | 'shimmer';`.
- In `synthUiSound`, replace the final `else { …power… }` with `else if (sound === 'power') { …existing power body… }`.
- Then append:

```ts
  } else if (sound === 'crack') {
    // sharp noise burst through a bandpass + a bright square snap
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.1);
    blip(ctx, dest, 2400, 0.03, 0.08);
  } else if (sound === 'boom') {
    // low falling sine thump with a tail
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.62);
  } else {
    // shimmer: two detuned rising triangles
    for (const f of [660, 663]) {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 2, t + 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + 0.47);
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `cmd.exe /c "cd client && npx vitest run src/audio && npx tsc --noEmit -p ."` → Expected: PASS; `tsc` clean.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/audio/uiSounds.ts client/src/audio/uiSounds.test.ts
git.exe commit -m "Add synthesised crack, boom and shimmer impact sounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `CloseUpOverlay` component, styles, skip, and mounting

**Files:**
- Create: `client/src/components/CloseUpOverlay.tsx`
- Create: `client/src/styles/closeup.css`
- Modify: `client/src/main.tsx` (import `closeup.css` after `menu.css`)
- Modify: `client/src/App.tsx` (mount next to `CombatIntro`)

**Interfaces:**
- Consumes: `useCloseUpStore` (Task 3), `stageFor` (Task 4), `audioEngine.playUi` (Task 5 sounds), `prefersReducedMotion` (`client/src/ui/motion.ts`), `CLOSE_UP_CONFIG`.
- Produces: `<CloseUpOverlay />` (no props). It renders nothing when there's no current close-up.

- [ ] **Step 1: The component** — `client/src/components/CloseUpOverlay.tsx`:

```tsx
import { useEffect, useState, type CSSProperties } from 'react';
import { CLOSE_UP_CONFIG } from '@caverns/shared';
import { useCloseUpStore } from '../combat/closeUpStore.js';
import { stageFor, type StageActor } from '../combat/closeUpStage.js';
import { audioEngine } from '../audio/audioEngine.js';
import { prefersReducedMotion } from '../ui/motion.js';

function Figure({ a, i }: { a: StageActor; i: number }) {
  const [idx, setIdx] = useState(0);
  const src = a.art[Math.min(idx, a.art.length - 1)];
  return (
    <div className={`closeup-fig closeup-fig--${a.side}${a.isActor ? ' closeup-fig--actor' : ''}${a.downed ? ' closeup-fig--downed' : ''}`} style={{ '--i': i } as CSSProperties}>
      {src && <img src={src} alt="" draggable={false} onError={() => setIdx((n) => n + 1)} />}
    </div>
  );
}

export function CloseUpOverlay() {
  const current = useCloseUpStore((s) => s.current);
  const skip = useCloseUpStore((s) => s.skip);

  useEffect(() => {
    if (!current) return;
    const stage = stageFor(current);
    const t = window.setTimeout(() => audioEngine.playUi(stage.sound), current.closeUp.durationMs * CLOSE_UP_CONFIG.impactAt);
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); skip(); };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, { capture: true }); };
  }, [current, skip]);

  if (!current) return null;
  const stage = stageFor(current);
  const reduced = prefersReducedMotion();
  const style = { '--closeup-dur': `${current.closeUp.durationMs}ms`, '--closeup-band': stage.band } as CSSProperties;

  return (
    <div key={current.id} className={`closeup closeup--${stage.layout} closeup--${stage.tone}${reduced ? ' closeup--still' : ''}`}
      style={style} onPointerDown={(e) => { e.preventDefault(); skip(); }} role="presentation">
      <div className="closeup__dim" />
      <div className="closeup__band">
        <div className="closeup__side closeup__side--left">{stage.left.map((a, i) => <Figure key={a.id} a={a} i={i} />)}</div>
        <div className="closeup__side closeup__side--right">
          {stage.right.map((a, i) => <Figure key={a.id} a={a} i={i} />)}
          {stage.extra > 0 && <div className="closeup__extra">+{stage.extra}</div>}
        </div>
      </div>
      <div className="closeup__flash" />
      <div className="closeup__title">{stage.title}</div>
      {(stage.number || stage.subtitle) && (
        <div className={`closeup__number${stage.number?.kind === 'heal' ? ' closeup__number--heal' : ''}`}>
          {stage.number && <span>{stage.number.kind === 'heal' ? '+' : ''}{stage.number.value}</span>}
          {stage.subtitle && <span className="closeup__subtitle">{stage.subtitle}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Styles** — `client/src/styles/closeup.css`. The keyframes follow the approved mockup A; all timings are percentages of `--closeup-dur`.

```css
/* === Combat close-ups (Darkest Dungeon-style). Under the CRT overlay (998), above everything else. === */
.closeup { position: fixed; inset: 0; z-index: 950; overflow: hidden; cursor: pointer; font-family: inherit; }
.closeup * { animation-duration: var(--closeup-dur); animation-fill-mode: both; animation-timing-function: ease-out; }
.closeup__dim { position: absolute; inset: 0; background: #050302; animation-name: cu-dim; }
@keyframes cu-dim { 0% { opacity: 0 } 10%, 82% { opacity: .92 } 100% { opacity: 0 } }
.closeup__band { position: absolute; left: 0; right: 0; top: 14%; height: 68%; display: flex; justify-content: space-between; align-items: flex-end;
  padding: 0 6%; background: linear-gradient(90deg, #0d0806, var(--closeup-band) 50%, #0d0806);
  border-top: 2px solid color-mix(in srgb, var(--closeup-band) 60%, #fff 10%); border-bottom: 2px solid color-mix(in srgb, var(--closeup-band) 60%, #fff 10%);
  animation-name: cu-band; transform-origin: center; }
@keyframes cu-band { 0%, 4% { transform: scaleY(0) } 10%, 80% { transform: scaleY(1) } 90%, 100% { transform: scaleY(0) } }
.closeup--enemy .closeup__dim { background: #0a0000; }
.closeup__side { position: relative; display: flex; align-items: flex-end; gap: 2%; height: 100%; width: 46%; }
.closeup__side--right { justify-content: flex-end; }
.closeup-fig { height: 88%; display: flex; align-items: flex-end; }
.closeup-fig img { height: 100%; image-rendering: pixelated; filter: drop-shadow(0 0 10px rgba(0,0,0,.8)); }
.closeup-fig:not(.closeup-fig--actor) { height: 72%; opacity: .95; }
.closeup-fig--left { animation-name: cu-in-left; }
.closeup-fig--right { animation-name: cu-in-right; }
.closeup-fig--right img { transform: scaleX(-1); }
@keyframes cu-in-left { 0%, 10% { transform: translateX(-120%) } 25% { transform: translateX(0) scale(1.03) } 80%, 100% { transform: translateX(6%) scale(1.12) } }
@keyframes cu-in-right { 0%, 10% { transform: translateX(120%) } 25% { transform: translateX(0) } 80%, 100% { transform: translateX(-4%) scale(1.08) } }
.closeup-fig--actor.closeup-fig--left { animation-name: cu-lunge-left; }
@keyframes cu-lunge-left { 0%, 10% { transform: translateX(-120%) } 25% { transform: translateX(0) scale(1.03) } 33% { transform: translateX(14%) scale(1.08) } 80%, 100% { transform: translateX(16%) scale(1.12) } }
.closeup-fig--actor.closeup-fig--right { animation-name: cu-lunge-right; }
@keyframes cu-lunge-right { 0%, 10% { transform: translateX(120%) } 25% { transform: translateX(0) } 33% { transform: translateX(-14%) scale(1.06) } 80%, 100% { transform: translateX(-16%) scale(1.1) } }
.closeup-fig:not(.closeup-fig--actor) img { animation: cu-recoil var(--closeup-dur) both; }
@keyframes cu-recoil { 0%, 34% { transform: none; filter: none } 36% { transform: translateX(8%) rotate(6deg); filter: brightness(4) } 44%, 100% { transform: translateX(10%) rotate(7deg); filter: none } }
.closeup-fig--left:not(.closeup-fig--actor) img { animation-name: cu-recoil-left; }
@keyframes cu-recoil-left { 0%, 34% { transform: none; filter: none } 36% { transform: translateX(-8%) rotate(-6deg); filter: brightness(4) } 44%, 100% { transform: translateX(-10%) rotate(-7deg); filter: none } }
.closeup-fig--downed img { animation-name: cu-fall; }
@keyframes cu-fall { 0%, 34% { transform: none; filter: none } 36% { filter: brightness(4) } 60%, 100% { transform: translateY(12%) rotate(14deg); filter: grayscale(1) brightness(.6) } }
.closeup--allies .closeup-fig:not(.closeup-fig--actor) img, .closeup--solo .closeup-fig img { animation-name: none; }
.closeup--solo .closeup__side--left { width: 60%; justify-content: center; }
.closeup__extra { align-self: center; color: #f0c878; font-size: 1.4rem; text-shadow: 0 0 6px #000; }
.closeup__flash { position: absolute; inset: 0; background: #fff; pointer-events: none; animation-name: cu-flash; }
@keyframes cu-flash { 0%, 34% { opacity: 0 } 35% { opacity: .85 } 41%, 100% { opacity: 0 } }
.closeup__title { position: absolute; left: 0; right: 0; top: 4%; text-align: center; font-size: clamp(1.6rem, 3.2vw, 3rem); letter-spacing: .3em; color: #f0c878;
  text-shadow: 0 0 10px rgba(240,160,60,.6), 0 2px 0 #000; animation-name: cu-title; }
@keyframes cu-title { 0%, 12% { opacity: 0; transform: translateY(-12px) scale(1.4) } 20%, 82% { opacity: 1; transform: none } 92%, 100% { opacity: 0 } }
.closeup__number { position: absolute; right: 18%; top: 22%; display: flex; flex-direction: column; align-items: center; font-weight: bold; font-size: clamp(2rem, 4.5vw, 4rem);
  color: #ff5a3a; text-shadow: 0 0 6px #000, 0 0 2px #000; animation-name: cu-number; }
.closeup__number--heal { color: #6fe08a; right: auto; left: 32%; }
.closeup--enemy .closeup__number { right: auto; left: 22%; }
.closeup__subtitle { font-size: .3em; letter-spacing: .25em; color: #ffd98a; }
@keyframes cu-number { 0%, 35% { opacity: 0; transform: scale(2) } 40% { opacity: 1; transform: scale(1) } 80% { opacity: 1; transform: translateY(-14px) } 92%, 100% { opacity: 0 } }
.closeup { animation: cu-shake var(--closeup-dur) both; }
@keyframes cu-shake { 0%, 35% { transform: none } 36% { transform: translate(-6px, 3px) } 38% { transform: translate(5px, -2px) } 40% { transform: translate(-3px, 1px) } 42%, 100% { transform: none } }

/* Reduced motion: a still title card for the same duration */
.closeup--still, .closeup--still * { animation: none !important; }
.closeup--still .closeup__dim { opacity: .9; }
.closeup--still .closeup__band { transform: none; }
.closeup--still .closeup__flash { display: none; }
@media (prefers-reduced-motion: reduce) { .closeup, .closeup * { animation: none !important; } .closeup__flash { display: none; } }
```

- [ ] **Step 3: Mount and import.** In `client/src/main.tsx`, after the `menu.css` import, add `import './styles/closeup.css';`.

In `client/src/App.tsx`, add `import { CloseUpOverlay } from './components/CloseUpOverlay.js';`, and directly after `{arenaIntro && <CombatIntro enemyNames={arenaIntro.enemyNames} />}`, add:

```tsx
      <CloseUpOverlay />
```

- [ ] **Step 4: Typecheck and run the tests.**
Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"` → Expected: exit 0; all pass.

- [ ] **Step 5: The visual check with an ability cast in the sandbox** (Review Focus 2 and 3). Create `.sandbox/closeup-check.mjs`:

```js
// Cast the first available ability in the duel sandbox; capture the close-up and check the log line waits for impact.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const base = process.argv[2] ?? 'http://localhost:5175';
mkdirSync('.sandbox/closeups', { recursive: true });
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${base}/?sandbox=duel`);
await p.waitForFunction(() => window.__cavernsSandbox?.status === 'my_turn', null, { timeout: 60000 });
await p.waitForTimeout(3200); // let the ENCOUNTER intro clear
await p.locator('.arena-btn', { hasText: 'Abilities' }).click();
const abilities = p.locator('.ability-btn:not([disabled])');
if ((await abilities.count()) === 0) { console.log('no castable ability'); process.exit(1); }
const logBefore = await p.locator('.arena-combat-log').innerText().catch(() => '');
await abilities.first().click();
const needsTarget = await p.locator('.waiting-text', { hasText: /Click a/ }).count();
if (needsTarget) {
  const h = await p.evaluate(() => window.__cavernsSandbox);
  const mob = h.combat.participants.find((x) => x.type === 'mob');
  const pos = h.positions[mob.id];
  await p.locator(`.room-grid > .room-row:nth-child(${pos.y + 1}) > span:nth-child(${pos.x + 1})`).click();
}
await p.waitForSelector('.closeup', { timeout: 3000 });
const t0 = Date.now();
const samples = [];
for (const at of [150, 400, 900, 1400]) {
  await p.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  await p.screenshot({ path: `.sandbox/closeups/frame-${at}.png` });
  samples.push({ at, log: await p.locator('.arena-combat-log').innerText().catch(() => '') });
}
await p.waitForSelector('.closeup', { state: 'detached', timeout: 4000 });
await b.close();
const early = samples.find((s) => s.at === 400);
const late = samples.find((s) => s.at === 900);
const heldEarly = early.log === logBefore;
const releasedLate = late.log !== logBefore;
console.log(JSON.stringify({ heldEarly, releasedLate }));
console.log(heldEarly && releasedLate ? 'PASS' : 'FAIL');
process.exit(heldEarly && releasedLate ? 0 : 1);
```

Run: `cmd.exe /c "node .sandbox/closeup-check.mjs"`
Expected: PASS. The combat log is unchanged at 400ms (before impact at 700ms for a 2000ms ability) and changed by 900ms. View `.sandbox/closeups/frame-150.png`, `-400` and `-900` with the Read tool. The band should be open, the caster on the left with a stand-in portrait, the title at the top, and at 900ms the number.

If the duel player's ability requires adjacency and the target click is rejected, the check will time out waiting for `.closeup`. Record a ruling and use a self-target ability instead (the loop picks the first enabled one; filter with `hasText` on a `targetType: none` ability's name, looked up at runtime from `window.__cavernsSandbox`, never hard-coded).

Skip check (Review Focus 3): repeat the cast, press `Enter` 300ms into the close-up, and assert that `.closeup` is gone within 200ms and that no `.arena-btn-end` click was triggered (the turn is still the player's, or the server's next turn came from the pacing timer). Extend `closeup-check.mjs` with this as a second phase when the fight allows a second cast; otherwise check it manually and ledger it.

- [ ] **Step 6: Commit.**

```bash
git.exe add client/src/components/CloseUpOverlay.tsx client/src/styles/closeup.css client/src/main.tsx client/src/App.tsx
git.exe commit -m "Add Darkest Dungeon-style combat close-up overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Player art batch (PixelLab)

This is art production done by the agent with PixelLab MCP tools. It has a **user approval gate** (Step 4).

**Files:**
- Create: `client/public/closeups/classes/<classId>-attack.png`, `<classId>-hurt.png` for every class in `CLASS_DEFINITIONS` (8 today)
- Create: `client/public/closeups/abilities/<abilityId>.png` for every non-passive ability (8 today)
- Modify: `shared/src/data/classes.json` (add `"closeUp": { "art": "/closeups/abilities/<abilityId>.png" }` to each ability that got art, and optional class `"color"` values)
- Create: `art/closeups/chosen.json`; raw candidates go in `art/closeups/raw/` (untracked)

**Interfaces:**
- Produces files at the exact paths `artChainFor` looks up (Task 4).

- [ ] **Step 1: Check the budget.** Call `mcp__pixellab__get_balance`. Continue only if `generations_remaining >= 400`; otherwise record a ruling and stop at this step, since the feature works with stand-ins.

- [ ] **Step 2: Generate.** Generate one `mcp__pixellab__create_image_pro` per image, at `width: 160, height: 160`, with `style_image_url` = the class portrait's raw GitHub URL (`https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/portraits/<portrait>.png`, from `getClassPortrait`). Run at most 10 at a time; PixelLab caps concurrent jobs at 10.

Prompt template, built from **data** (a script iterates over `CLASS_DEFINITIONS`; don't hand-write per-ability prompts):
- **attack:** `full-body action pose, side view facing right: <class displayName> (<class description>) lunging into a strike, dynamic, strange post-collapse retro-future relic tech`
- **hurt:** `full-body pose, side view facing right: <class displayName> (<class description>) staggering back from a hit, bracing, strange post-collapse retro-future relic tech`
- **cast:** `full-body action pose, side view facing right: <class displayName> using "<ability name>" — <ability description>, dynamic, strange post-collapse retro-future relic tech`

- [ ] **Step 3: Pick candidates.** Download all 4 candidates per job into `art/closeups/raw/`. Build a 2× contact sheet per class, and pick the best by these criteria:
  - it reads at a glance as a pose;
  - it faces right;
  - it isn't cropped;
  - it matches the portrait's palette.

Write `art/closeups/chosen.json`. Build `art/closeups/_players.png`, a sheet of all 16 picks labelled.

- [ ] **Step 4: USER APPROVAL GATE.** Show `_players.png`, on the mockup page if it's running, otherwise via Read. Reroll only the IDs the user rejects. **Don't continue until the user approves.**

- [ ] **Step 5: Install and wire up.**
- Copy the picks to the exact paths above.
- Add `closeUp.art` to each ability in `classes.json` with a data-driven script. It iterates over the abilities and sets `"closeUp": { "art": "/closeups/abilities/<id>.png" }` only where that file exists; don't hand-edit named abilities.
- Optionally add a class `"color"` taken from each class's glyph palette.
- Run: `cmd.exe /c "npm run build --workspace=shared && npm run test --workspace=shared && cd client && npx vitest run"` → Expected: all pass (the data-integrity test validates the new fields).
- Re-run `.sandbox/closeup-check.mjs` and view the frames: the real pose art should replace the portrait.

- [ ] **Step 6: Commit.**

```bash
git.exe add client/public/closeups shared/src/data/classes.json
git.exe commit -m "Add player close-up pose art

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mob batches** (45 sprites; one biome per batch and commit, same gate) are **optional for this plan's "done"**. The spec lets them follow, and stand-ins cover them. The steps are the same: the prompt is built from the mob pool's `name` and `description` in `shared/src/data/mobPool.json`, facing **left**; the files go to `client/public/closeups/mobs/<id>.png`; and each biome's sheet is approved before install.

---

### Task 8: Verification

**Files:** none tracked.

- [ ] **Step 1: Full suite and types.**
Run: `cmd.exe /c "npm run build --workspace=shared && npm test && cd client && npx tsc --noEmit -p ."` → Expected: every workspace passes; `tsc` is clean.

- [ ] **Step 2: Simulations stay fast.** Run `cmd.exe /c "npm run sim --workspace=server -- --help"` to see its options, then one seeded run. Expected: it completes in under 10s, which shows `closeUpScale: 0` is in effect.

- [ ] **Step 3: Close-up capture.** `.sandbox/closeup-check.mjs` → PASS. Put the frames on the mockup page for the user.

- [ ] **Step 4: Regressions.**
- `.sandbox/arena-size.mjs` → at least `{28, 8}`;
- `.sandbox/move-closes.mjs` → PASS;
- `scripts/sandbox-drive.mjs duel --wait my-turn --end-turn 3` → exits 0 (turns still flow when nothing qualifies).

- [ ] **Step 5: Memory.** Record anything non-obvious (e.g. prompt tweaks that worked for poses) with `mcp__thinker__memory_store`.
