# Attack Juice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every ordinary arena hit a see-through 0.9s "strike" close-up plus on-board juice (lunge, RGB tear, slam-in number), and give every mob close-up art.

**Architecture:**
- **Rule:** a new `strike` kind in the shared close-up rule. The existing server pacing and the client gate pick it up with no new server code.
- **Overlay:** the strike reuses `CloseUpOverlay` as a translucent, title-less variant.
- **Board juice:** a pure `boardFx` reducer, fed by every message the close-up gate delivers. It is rendered inside the arena grid's world layer: classes on unit spans, plus absolutely positioned number spans.
- **Mob art:** follows the player-art pipeline. A manifest gates it, so there are no 404s.

**Tech Stack:** TypeScript, React 18 + Zustand, Vite, Vitest, Playwright (sandbox scripts), PixelLab MCP (art).

**Spec:** `docs/superpowers/specs/2026-09-27-attack-juice-design.md`

## Global Constraints

- **Branch:** `feature/attack-juice`, stacked on `feature/combat-closeups`. Commit locally with `git.exe` and explicit paths. Never push.
- **Environment:** Node runs on Windows. Run npm/npx/node as `cmd.exe /c "..."` from the repo root. After any change under `shared/src`, run `cmd.exe /c "npm run build --workspace=shared"` before client or server tests: they import `@caverns/shared` from `shared/dist`.
- **Data-driven:** no code, CSS or test may name a specific ability or mob. Iterate over `CLASS_DEFINITIONS` / `mobPool.json`, or use made-up ids.
- **Staging:** players are always on the left and mobs always on the right in every close-up. The attacker lunges toward the other side.
- **Strike timing:** `"strikeMs": 900`. Impact stays at `impactAt` (0.35).
- **Board juice numbers:**
  - red `#ff5a3c` for damage to a mob;
  - amber `#ffb000` for damage to a player;
  - dim grey `#8c7f6c` when the damage is 1.
- **Board juice timings:**
  - lunge 300ms, `cubic-bezier(.2,.8,.3,1)`, about 11px;
  - tear 360ms, `steps(6)`, starting 100ms after the lunge;
  - number 950ms, starting 100ms after the lunge.
- **Strike close-up look:**
  - band about 45% of the screen height, translucent (about 40%);
  - dim about 20%;
  - no title, no subtitle, no flash;
  - **silent**.
- **Reduced motion:** no lunge, tear or movement. Numbers fade in place, and strikes show only the number.
- **Art:** PixelLab `create_image_pro` at 160×160.
  - `reference_images` uses the mob's own board sprite (raw GitHub URL on `main`) with `usage: "character identity: this exact creature, same shape and colours"`, and the same URL as `style_image_url`.
  - Prompts come from the data, include "no text, no letters, no symbols written", and never contain mechanics text.
  - Each biome batch needs the user's approval before install.
- **Commit trailer:**
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

1. **A mob walks, then attacks, in the same turn:**
   - The lunge must start from the mob's final tile, after its walk animation, never mid-walk or from the old tile.
   - Test: Task 4, "a mover's effects wait behind its active walk".
2. **A board number when the target was just killed or removed:**
   - The number shows at the last known tile, or nothing; there is no crash and no number at (0,0).
   - Test: Task 4, "missing target position falls back to the last known tile, else no number".
3. **Several hits in quick succession (area abilities, back-to-back strikes):**
   - Numbers on the same tile don't overlap, and effects expire so the store doesn't grow.
   - Test: Task 4, "numbers on the same tile are offset" and "fxExpire drops finished effects".
4. **A mob attack on a player during a strike:**
   - The player is on the left in the hurt pose, the mob is on the right, and the number is next to the player.
   - Tests: Task 3, "mob strike on a player: player left, mob right"; Task 5, sandbox script mob-attack check.
5. **Existing server tests that step fake timers through ordinary attacks:**
   - Every ordinary attack now adds 900ms, so tests that assumed instant turns must not break silently or be "fixed" by deleting assertions.
   - Test: Task 2, full server suite run. Non-pacing tests get `closeUpScale: 0`, each with a ledgered ruling.

---

### Task 1: Shared `strike` kind and config

**Files:**
- Modify: `shared/src/data/closeUpConfig.json`
- Modify: `shared/src/combat/closeUp.ts`
- Test: `shared/src/combat/closeUp.test.ts`

**Interfaces:**
- Produces:
  - `type CloseUpKind = 'ability' | 'crit' | 'kill' | 'strike'`;
  - `CLOSE_UP_CONFIG.strikeMs: number` (900);
  - `closeUpFor(...)` returns `{ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs }` for ordinary attacks. Its signature is unchanged.

- [ ] **Step 1: Update the two tests that expect `null` for an ordinary hit, and add the new cases.** In `shared/src/combat/closeUp.test.ts`, replace the test `'player basic attacks: kill beats crit, plain hits get nothing'` with:

```ts
  it('player basic attacks: kill beats crit beats strike', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true, critMultiplier: 2 }, player))
      .toEqual({ kind: 'kill', durationMs: CLOSE_UP_CONFIG.killMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1.5 }, player))
      .toEqual({ kind: 'crit', durationMs: CLOSE_UP_CONFIG.critMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1 }, player))
      .toEqual({ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs });
    expect(closeUpFor({ action: 'attack' }, player)?.kind).toBe('strike');
  });
```

Replace `'mob hits on players: kill or crit only, including hits landed through the defend QTE'` with:

```ts
  it('mob hits on players: kill, crit or strike, including hits landed through the defend prompt', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true }, mobHit)?.kind).toBe('kill');
    expect(closeUpFor({ action: 'attack', critMultiplier: 2 }, mobHit)?.kind).toBe('crit');
    expect(closeUpFor({ action: 'attack' }, mobHit)).toEqual({ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs });
    expect(closeUpFor({ action: 'defend', targetDowned: true }, mobHit)?.kind).toBe('kill');
    expect(closeUpFor({ action: 'defend' }, mobHit)?.kind).toBe('strike');
  });
```

Leave `'never fires for defend, items, flee, the defend-QTE preview, or mob-on-mob'` as it is; it must still pass. Add to the `data integrity` describe block:

```ts
  it('strikes are shorter than every other close-up', () => {
    expect(CLOSE_UP_CONFIG.strikeMs).toBeGreaterThan(0);
    expect(CLOSE_UP_CONFIG.strikeMs).toBeLessThan(Math.min(CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.abilityMs));
  });
```

- [ ] **Step 2: Run the tests; they must fail.**
Run: `cmd.exe /c "cd shared && npx vitest run src/combat/closeUp.test.ts"`
Expected: FAIL. The strike expectations get `null`, and `strikeMs` is `undefined` (the comparison fails).

- [ ] **Step 3: Implement.** Set `shared/src/data/closeUpConfig.json` to:

```json
{ "abilityMs": 2000, "critMs": 1600, "killMs": 1800, "strikeMs": 900, "impactAt": 0.35, "maxQueued": 3 }
```

In `shared/src/combat/closeUp.ts`, make these changes.

Replace the config type and the kind:

```ts
export const CLOSE_UP_CONFIG: { abilityMs: number; critMs: number; killMs: number; strikeMs: number; impactAt: number; maxQueued: number } = closeUpConfig;

export type CloseUpKind = 'ability' | 'crit' | 'kill' | 'strike';
```

Replace `make`:

```ts
const DURATION_KEY: Record<CloseUpKind, 'abilityMs' | 'critMs' | 'killMs' | 'strikeMs'> = {
  ability: 'abilityMs', crit: 'critMs', kill: 'killMs', strike: 'strikeMs',
};
const make = (kind: CloseUpKind): CloseUp => ({ kind, durationMs: CLOSE_UP_CONFIG[DURATION_KEY[kind]] });
```

In `closeUpFor`, the player branch becomes:

```ts
    if (r.action === 'attack') {
      if (r.targetDowned) return make('kill');
      if ((r.critMultiplier ?? 1) > 1) return make('crit');
      return make('strike');
    }
    return null;
```

The mob branch's last line `return null;` becomes `return make('strike');`. Update the doc comment above `closeUpFor` to:

```ts
/** Whether a combat result earns a close-up, and which kind. Data-driven: never names an ability. Ordinary hits are strikes. */
```

- [ ] **Step 4: Run the tests; they must pass, then rebuild shared.**
Run: `cmd.exe /c "cd shared && npx vitest run && cd .. && npm run build --workspace=shared"`
Expected: all shared tests pass, and the build exits 0.

- [ ] **Step 5: Commit.**

```bash
git.exe add shared/src/data/closeUpConfig.json shared/src/combat/closeUp.ts shared/src/combat/closeUp.test.ts
git.exe commit -m "Add strike close-ups for ordinary attacks to the shared rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server pacing covers strikes

The pacing code doesn't change: `GameSession.closeUpDelay` already reads the shared rule. This task proves it with a test and repairs tests that assumed ordinary attacks add no delay.

**Files:**
- Test: `server/src/GameSession.closeUp.test.ts`
- Possibly modify: other `server/src/*.test.ts` files that break (see Step 4)

**Interfaces:**
- Consumes: `CLOSE_UP_CONFIG.strikeMs` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the test.** In `server/src/GameSession.closeUp.test.ts`, add this helper below `msUntilNextAction`:

```ts
/** End p1's turns until a mob stands next to p1 (the duel mob walks in), then stop on p1's turn. */
function closeIn(session: GameSession) {
  const near = () => {
    const s = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
    const m = s.participants.find((p) => p.type === 'mob')!;
    const a = s.positions.p1, b = s.positions[m.id];
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
  };
  for (let i = 0; i < 20 && !near(); i++) { toPlayerTurn(session); session.handleArenaEndTurn('p1'); }
  toPlayerTurn(session);
}
```

Replace the inline `near`/loop in the existing `'area ability results list every target hit'` test with `closeIn(session);`, deleting its now-duplicated `toPlayerTurn(session)` line after the loop. Then add:

```ts
  it('an ordinary attack delays the next turn by the strike close-up', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      const mobId = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!.id;
      // test-only: the attack must not kill (a kill would be a longer kill close-up)
      (session as unknown as { combats: Map<string, { getParticipant(id: string): { hp: number } }> })
        .combats.get(SANDBOX_ROOM_ID)!.getParticipant(mobId).hp = 9999;
      closeIn(session);
      const before = sent.length;
      session.handleCombatAction('p1', 'attack', mobId);
      expect(sent.slice(before).some((m) => m.type === 'combat_action_result')).toBe(true);
      const ms = msUntilNextAction(sent, before);
      expect(ms).toBeGreaterThanOrEqual(CLOSE_UP_CONFIG.strikeMs + MOB_DELAY);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
```

- [ ] **Step 2: Run it and prove it guards the rule.** The pacing code already exists, so this test should pass straight away. Prove that it can fail: temporarily change the mob branch's `return make('strike');` in `shared/src/combat/closeUp.ts` back to `return null;` and the player branch's `return make('strike');` to `return null;`, then rebuild shared and run:
`cmd.exe /c "npm run build --workspace=shared && cd server && npx vitest run src/GameSession.closeUp.test.ts"`
Expected: `an ordinary attack delays the next turn by the strike close-up` FAILS (`ms` is about 100 and less than 1000).
Restore both lines, rebuild shared, and re-run.
Expected: all tests in the file pass.

- [ ] **Step 3: Run the full server suite.**
Run: `cmd.exe /c "cd server && npx vitest run" > .sandbox/server-t2.log 2>&1`, then read the tail and every `×` line.
Expected: some tests that drive ordinary attacks with fake timers may now fail, because every ordinary attack adds 900ms.

- [ ] **Step 4: Repair each failure by what the test is about.**
  - If a failing test is **not about pacing** (for example, loot, dispose or victory flow), add `session.setTiming({ closeUpScale: 0 })` (or pass `closeUpScale: 0` wherever that test already sets timing) right after the session is created. Record in the ledger: `Task 2: Ruling: <test name> sets closeUpScale:0 — it is about <X>, not pacing; strikes now add 900ms per attack — cost if wrong: none`.
  - If a failing test **is about pacing**, update its expected delay to include `CLOSE_UP_CONFIG.strikeMs` and record a ruling.
  - Never delete an assertion.

  Re-run the full suite.
  Expected: every test passes, with the same skipped count as before.

- [ ] **Step 5: Commit.**

```bash
git.exe add server/src
git.exe commit -m "Test that ordinary attacks are paced by the strike close-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Strike close-up staging and overlay variant

**Files:**
- Modify: `client/src/combat/closeUpStage.ts`
- Modify: `client/src/components/CloseUpOverlay.tsx`
- Modify: `client/src/styles/closeup.css`
- Test: `client/src/combat/closeUpStage.test.ts`

**Interfaces:**
- Consumes: `CloseUpKind` including `'strike'` (Task 1).
- Produces:
  - `Stage.variant: 'full' | 'strike'`;
  - `Stage.sound: 'crack' | 'boom' | 'shimmer' | null` (`null` for strikes);
  - for strikes, `Stage.title === ''` and `Stage.subtitle === ''`;
  - CSS class `closeup--strike` on the overlay root.

- [ ] **Step 1: Write the failing tests.** In `client/src/combat/closeUpStage.test.ts`:
  - widen the `active` helper's `kind` parameter type to `'ability' | 'crit' | 'kill' | 'strike'`;
  - set `durationMs` to `CLOSE_UP_CONFIG.strikeMs` when `kind === 'strike'`, else `CLOSE_UP_CONFIG.abilityMs`.

Then add:

```ts
describe('strikes', () => {
  it('a player strike: strike variant, no title or subtitle, silent, damage number, player left', () => {
    const s = stageFor(active({ actorId: 'p1', action: 'attack', targetId: 'm1', damage: 4 }, 'strike'));
    expect(s.variant).toBe('strike');
    expect(s.title).toBe('');
    expect(s.subtitle).toBe('');
    expect(s.sound).toBeNull();
    expect(s.number).toEqual({ value: 4, kind: 'damage' });
    expect(s.left.map((a) => a.id)).toEqual(['p1']);
    expect(s.right.map((a) => a.id)).toEqual(['m1']);
  });
  it('mob strike on a player: player left (hurt), mob right (actor), enemy tone', () => {
    const s = stageFor(active({ actorId: 'm1', action: 'attack', targetId: 'p1', damage: 3 }, 'strike'));
    expect(s.variant).toBe('strike');
    expect(s.left.map((a) => [a.id, a.isActor])).toEqual([['p1', false]]);
    expect(s.right.map((a) => [a.id, a.isActor])).toEqual([['m1', true]]);
    expect(s.tone).toBe('enemy');
  });
  it('non-strike close-ups keep the full variant and a sound', () => {
    const s = stageFor(active({ actorId: 'p1', action: 'attack', targetId: 'm1', damage: 9, critMultiplier: 2 }, 'crit'));
    expect(s.variant).toBe('full');
    expect(s.sound).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them; they must fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat/closeUpStage.test.ts"`
Expected: FAIL. `variant` is `undefined`, the strike title is `'CRITICAL STRIKE'`, and the sound is `'crack'`.

- [ ] **Step 3: Implement staging.** In `client/src/combat/closeUpStage.ts`, change the `Stage` interface's last line to:

```ts
  band: string; tone: 'player' | 'enemy'; sound: 'crack' | 'boom' | 'shimmer' | null; variant: 'full' | 'strike';
```

In `stageFor`, right after `const { result: r, participants, closeUp } = active;` add:

```ts
  const strike = closeUp.kind === 'strike';
```

Replace the `subtitle`, `sound` and `title` lines with:

```ts
  const subtitle = strike ? '' : anyDowned ? 'KILLED' : closeUp.kind === 'crit' ? 'CRITICAL' : (r.buffsApplied ?? []).map((b) => b.replace(/_/g, ' ')).join(' · ').toUpperCase();
  const derivedSound: 'crack' | 'boom' | 'shimmer' = anyDowned ? 'boom' : (!damage && (r.healing || (r.buffsApplied ?? []).length)) ? 'shimmer' : 'crack';
  const sound = strike ? null : ability?.closeUp?.sound ?? derivedSound;
  const title = strike ? '' : (r.abilityName ?? ability?.name ?? (closeUp.kind === 'kill' ? 'Killing Blow' : 'Critical Strike')).toUpperCase();
```

Change the `return` to:

```ts
  return { layout, left, right, extra, title, subtitle, number, band, tone: actorIsMob ? 'enemy' : 'player', sound, variant: strike ? 'strike' : 'full' };
```

- [ ] **Step 4: Implement the overlay.** In `client/src/components/CloseUpOverlay.tsx`:

Replace the sound timer line inside the effect with:

```ts
    const t = stage.sound ? window.setTimeout(() => audioEngine.playUi(stage.sound!), current.closeUp.durationMs * CLOSE_UP_CONFIG.impactAt) : 0;
```

Leave the cleanup's `window.clearTimeout(t)` as it is (clearing 0 is a no-op). Change the root `className` to include the variant:

```tsx
    <div key={current.id} className={`closeup closeup--${stage.layout} closeup--${stage.tone} closeup--${stage.variant}${reduced ? ' closeup--still' : ''}`}
```

Render the title only when present:

```tsx
      {stage.title && <div className="closeup__title">{stage.title}</div>}
```

- [ ] **Step 5: Add the strike CSS.** Append to `client/src/styles/closeup.css`, before the `/* Reduced motion` comment:

```css
/* === Strike: the quick, see-through close-up for ordinary attacks === */
.closeup--strike .closeup__dim { animation-name: cu-dim-strike; }
@keyframes cu-dim-strike { 0% { opacity: 0 } 10%, 82% { opacity: .2 } 100% { opacity: 0 } }
.closeup--strike .closeup__band { top: 27.5%; height: 45%;
  background: linear-gradient(90deg, rgba(13,8,6,.3), color-mix(in srgb, var(--closeup-band) 42%, transparent) 50%, rgba(13,8,6,.3));
  border-color: color-mix(in srgb, var(--closeup-band) 50%, transparent); }
.closeup--strike .closeup__flash { display: none; }
.closeup--strike .closeup-fig:not(.closeup-fig--actor) img,
.closeup--strike .closeup-fig--left:not(.closeup-fig--actor) img { animation-name: cu-tear; }
@keyframes cu-tear {
  0%, 34% { transform: none; filter: none }
  35% { transform: translateX(3%); filter: drop-shadow(6px 0 0 #f00) drop-shadow(-6px 0 0 #0ff) brightness(2) }
  40% { transform: translateX(-3%) skewX(8deg); filter: drop-shadow(-4px 0 0 #f00) drop-shadow(4px 0 0 #0ff) }
  45% { transform: skewX(-4deg); filter: drop-shadow(2px 0 0 #f00) }
  50%, 100% { transform: none; filter: none }
}
.closeup--strike .closeup__number { top: 30%; }
.closeup--still.closeup--strike .closeup__band, .closeup--still.closeup--strike .closeup-fig { visibility: hidden; }
```

The last rule makes a reduced-motion strike show only the number, as the spec requires.

- [ ] **Step 6: Run the tests and the type-check; they must pass.**
Run: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
Expected: all client tests pass, and `tsc` is clean.

- [ ] **Step 7: Commit.**

```bash
git.exe add client/src/combat/closeUpStage.ts client/src/combat/closeUpStage.test.ts client/src/components/CloseUpOverlay.tsx client/src/styles/closeup.css
git.exe commit -m "Add the see-through strike close-up variant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `boardFx` reducer (pure)

**Files:**
- Create: `client/src/combat/boardFx.ts`
- Test: `client/src/combat/boardFx.test.ts`

**Interfaces:**
- Consumes: `ServerMessage`, the `combat_action_result` fields `actorId`, `targetId`, `targetIds`, `damage`, `defendQte`, and the `arena_positions_update` fields `moverId`, `path`.
- Produces (exported):
  - `FX_TIMING`, `type FxDir`, `type FxTone`, `type BoardFx`, `type BoardFxState`, `type FxCtx`;
  - `initialBoardFx()`;
  - `lungeDir(from, to): FxDir | null`;
  - `fxReceive(state, msg, ctx): BoardFxState`;
  - `fxExpire(state, now): BoardFxState`.

  `fxReceive` returns the **same `fx` array reference** when it adds no effects. The store relies on this to skip re-renders.

- [ ] **Step 1: Write the failing tests.** Create `client/src/combat/boardFx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { FX_TIMING, fxExpire, fxReceive, initialBoardFx, lungeDir, type BoardFx, type FxCtx } from './boardFx.js';

const hit = (o: object) => ({ type: 'combat_action_result', actorName: 'x', action: 'attack', ...o }) as unknown as ServerMessage;
const walk = (moverId: string, steps: number) =>
  ({ type: 'arena_positions_update', positions: {}, moverId, path: Array.from({ length: steps }, (_, i) => ({ x: i, y: 0 })) }) as unknown as ServerMessage;
const ctx = (over: Partial<FxCtx> = {}): FxCtx => ({
  now: 1000,
  positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 }, m2: { x: 3, y: 3 } },
  participants: [{ id: 'p1', type: 'player' }, { id: 'm1', type: 'mob' }, { id: 'm2', type: 'mob' }],
  ...over,
});
const kinds = (fx: BoardFx[]) => fx.map((f) => f.kind);

describe('lungeDir', () => {
  it('points along the dominant axis toward the target', () => {
    expect(lungeDir({ x: 2, y: 2 }, { x: 3, y: 2 })).toBe('right');
    expect(lungeDir({ x: 2, y: 2 }, { x: 1, y: 2 })).toBe('left');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 5 })).toBe('down');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 0 })).toBe('up');
    expect(lungeDir({ x: 2, y: 2 }, { x: 4, y: 3 })).toBe('right');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('fxReceive', () => {
  it('a damaging hit gives a lunge, a tear and a number', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 5 }), ctx());
    expect(kinds(s.fx)).toEqual(['lunge', 'tear', 'number']);
    const [lunge, tear, num] = s.fx as [Extract<BoardFx, { kind: 'lunge' }>, Extract<BoardFx, { kind: 'tear' }>, Extract<BoardFx, { kind: 'number' }>];
    expect(lunge).toMatchObject({ unitId: 'p1', dir: 'right', delayMs: 0, until: 1000 + FX_TIMING.lungeMs });
    expect(tear).toMatchObject({ unitId: 'm1', delayMs: FX_TIMING.hitDelayMs });
    expect(num).toMatchObject({ tile: { x: 3, y: 2 }, value: 5, tone: 'mob', offset: 0, delayMs: FX_TIMING.hitDelayMs });
  });
  it('number tone: player target amber, 1 damage grey', () => {
    const onPlayer = fxReceive(initialBoardFx(), hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx());
    expect(onPlayer.fx.find((f) => f.kind === 'number')).toMatchObject({ tone: 'player' });
    const chip = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 1 }), ctx());
    expect(chip.fx.find((f) => f.kind === 'number')).toMatchObject({ tone: 'chip' });
  });
  it('area results tear every target and show the total once, above the first target', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', action: 'use_ability', targetIds: ['m1', 'm2'], damage: 8 }), ctx());
    expect(s.fx.filter((f) => f.kind === 'tear').map((f) => (f as { unitId: string }).unitId)).toEqual(['m1', 'm2']);
    expect(s.fx.filter((f) => f.kind === 'number')).toEqual([expect.objectContaining({ value: 8, tile: { x: 3, y: 2 } })]);
  });
  it('no effects for non-damaging results, defend previews, or results with no target', () => {
    const base = initialBoardFx();
    for (const m of [
      hit({ actorId: 'p1', targetId: 'm1' }),
      hit({ actorId: 'm1', targetId: 'p1', pendingDamage: 4, defendQte: true }),
      hit({ actorId: 'p1', damage: 3 }),
      { type: 'combat_turn', currentTurnId: 'p1' } as unknown as ServerMessage,
    ]) expect(fxReceive(base, m, ctx()).fx).toBe(base.fx);
  });
  it('missing attacker position: no lunge; missing target position falls back to the last known tile, else no number', () => {
    const seen = fxReceive(initialBoardFx(), walk('zz', 0), ctx()); // records last known tiles
    const gone = ctx({ positions: { m1: { x: 3, y: 2 } } });
    const s1 = fxReceive(seen, hit({ actorId: 'p1', targetId: 'm1', damage: 2 }), ctx({ positions: { m1: { x: 3, y: 2 } } }));
    expect(kinds(s1.fx)).toEqual(['tear', 'number']);
    const s2 = fxReceive(seen, hit({ actorId: 'm1', targetId: 'p1', damage: 2 }), gone);
    expect(s2.fx.find((f) => f.kind === 'number')).toMatchObject({ tile: { x: 2, y: 2 } });
    const s3 = fxReceive(initialBoardFx(), hit({ actorId: 'm1', targetId: 'ghost', damage: 2 }), ctx());
    expect(s3.fx.find((f) => f.kind === 'number')).toBeUndefined();
  });
  it("a mover's effects wait behind its active walk", () => {
    const walking = fxReceive(initialBoardFx(), walk('m1', 3), ctx());
    const wait = 3 * FX_TIMING.walkStepMs + FX_TIMING.walkTailMs;
    const s = fxReceive(walking, hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx({ now: 1100 }));
    expect(s.fx.find((f) => f.kind === 'lunge')).toMatchObject({ delayMs: wait - 100 });
    expect(s.fx.find((f) => f.kind === 'number')).toMatchObject({ delayMs: wait - 100 + FX_TIMING.hitDelayMs });
    const later = fxReceive(walking, hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx({ now: 1000 + wait + 50 }));
    expect(later.fx.find((f) => f.kind === 'lunge')).toMatchObject({ delayMs: 0 });
  });
  it('numbers on the same tile are offset', () => {
    const a = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 2 }), ctx());
    const b = fxReceive(a, hit({ actorId: 'p1', targetId: 'm1', damage: 3 }), ctx({ now: 1050 }));
    expect(b.fx.filter((f) => f.kind === 'number').map((f) => (f as { offset: number }).offset)).toEqual([0, 1]);
  });
});

describe('fxExpire', () => {
  it('drops finished effects and keeps the array when nothing expired', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 5 }), ctx());
    expect(fxExpire(s, 1000)).toBe(s);
    expect(kinds(fxExpire(s, 1000 + FX_TIMING.lungeMs + 1).fx)).toEqual(['tear', 'number']);
    expect(fxExpire(s, 1000 + 10_000).fx).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them; they must fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat/boardFx.test.ts"`
Expected: FAIL with `Cannot find module './boardFx.js'`.

- [ ] **Step 3: Implement.** Create `client/src/combat/boardFx.ts`:

```ts
import type { ServerMessage } from '@caverns/shared';

/** On-board juice for damaging hits: attacker lunge, target RGB tear, slam-in number. Pure; see boardFxStore. */
export const FX_TIMING = { lungeMs: 300, hitDelayMs: 100, tearMs: 360, numberMs: 950, walkStepMs: 100, walkTailMs: 50 } as const;

export type FxDir = 'up' | 'down' | 'left' | 'right';
export type FxTone = 'mob' | 'player' | 'chip';
type Tile = { x: number; y: number };
export type BoardFx =
  | { id: number; kind: 'lunge'; unitId: string; dir: FxDir; delayMs: number; until: number }
  | { id: number; kind: 'tear'; unitId: string; delayMs: number; until: number }
  | { id: number; kind: 'number'; tile: Tile; value: number; tone: FxTone; offset: number; delayMs: number; until: number };
export interface BoardFxState { fx: BoardFx[]; walkUntil: Record<string, number>; lastTile: Record<string, Tile>; nextId: number }
export interface FxCtx { now: number; positions: Record<string, Tile>; participants: { id: string; type: 'player' | 'mob' }[] }

export const initialBoardFx = (): BoardFxState => ({ fx: [], walkUntil: {}, lastTile: {}, nextId: 1 });

export function lungeDir(from: Tile, to: Tile): FxDir | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function fxReceive(s: BoardFxState, msg: ServerMessage, ctx: FxCtx): BoardFxState {
  const lastTile = { ...s.lastTile, ...ctx.positions };
  if (msg.type === 'arena_positions_update') {
    const m = msg as { moverId?: string; path?: Tile[] };
    if (!m.moverId || !m.path?.length) return { ...s, lastTile };
    const until = ctx.now + m.path.length * FX_TIMING.walkStepMs + FX_TIMING.walkTailMs;
    return { ...s, lastTile, walkUntil: { ...s.walkUntil, [m.moverId]: until } };
  }
  if (msg.type !== 'combat_action_result') return { ...s, lastTile };
  const r = msg as { actorId: string; targetId?: string; targetIds?: string[]; damage?: number; defendQte?: boolean };
  const targets = r.targetIds ?? (r.targetId ? [r.targetId] : []);
  if (r.defendQte || !r.damage || r.damage <= 0 || targets.length === 0) return { ...s, lastTile };

  const wait = Math.max(0, (s.walkUntil[r.actorId] ?? 0) - ctx.now);
  const hitAt = wait + FX_TIMING.hitDelayMs;
  const fx = [...s.fx];
  let id = s.nextId;

  const from = ctx.positions[r.actorId];
  const firstTile = ctx.positions[targets[0]] ?? s.lastTile[targets[0]];
  const dir = from && firstTile ? lungeDir(from, firstTile) : null;
  if (dir) fx.push({ id: id++, kind: 'lunge', unitId: r.actorId, dir, delayMs: wait, until: ctx.now + wait + FX_TIMING.lungeMs });
  for (const t of targets) {
    if (ctx.positions[t]) fx.push({ id: id++, kind: 'tear', unitId: t, delayMs: hitAt, until: ctx.now + hitAt + FX_TIMING.tearMs });
  }
  if (firstTile) {
    const actorType = ctx.participants.find((p) => p.id === r.actorId)?.type;
    const targetType = ctx.participants.find((p) => p.id === targets[0])?.type ?? (actorType === 'player' ? 'mob' : 'player');
    const tone: FxTone = r.damage === 1 ? 'chip' : targetType === 'player' ? 'player' : 'mob';
    const offset = s.fx.filter((f) => f.kind === 'number' && f.until > ctx.now && f.tile.x === firstTile.x && f.tile.y === firstTile.y).length;
    fx.push({ id: id++, kind: 'number', tile: firstTile, value: r.damage, tone, offset, delayMs: hitAt, until: ctx.now + hitAt + FX_TIMING.numberMs });
  }
  return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
}

export function fxExpire(s: BoardFxState, now: number): BoardFxState {
  const fx = s.fx.filter((f) => f.until > now);
  return fx.length === s.fx.length ? s : { ...s, fx };
}
```

- [ ] **Step 4: Run the tests; they must pass.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat/boardFx.test.ts && npx tsc --noEmit -p ."`
Expected: all pass, and `tsc` is clean.

- [ ] **Step 5: Commit.**

```bash
git.exe add client/src/combat/boardFx.ts client/src/combat/boardFx.test.ts
git.exe commit -m "Add the board juice reducer: lunge, tear and damage numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire board juice into the arena

**Files:**
- Create: `client/src/combat/boardFxStore.ts`
- Modify: `client/src/combat/closeUpStore.ts` (the `deliver` function)
- Modify: `client/src/components/ArenaGrid.tsx`
- Create: `client/src/styles/boardfx.css`
- Modify: `client/src/main.tsx` (import the CSS after `closeup.css`)
- Create: `.sandbox/strike-check.mjs` (git-ignored)

**Interfaces:**
- Consumes: `fxReceive`, `fxExpire`, `initialBoardFx`, `BoardFx` (Task 4); `useGameStore` fields `arenaPositions` and `activeCombat.participants`.
- Produces:
  - `useBoardFxStore` (Zustand, `{ fx: BoardFx[] }`);
  - `boardFxReceive(msg: ServerMessage): void`;
  - CSS classes:
    - `fx-lunge fx-lunge-<dir>` and `fx-tear` on entity spans (the delay comes from the custom properties `--fx-lunge-delay` / `--fx-tear-delay`);
    - `fx-number fx-number--<tone>` on number spans.

- [ ] **Step 1: The store.** Create `client/src/combat/boardFxStore.ts`:

```ts
import { create } from 'zustand';
import type { ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { fxExpire, fxReceive, initialBoardFx, type BoardFx, type BoardFxState } from './boardFx.js';

export const useBoardFxStore = create<{ fx: BoardFx[] }>(() => ({ fx: [] }));

let state: BoardFxState = initialBoardFx();
let timer = 0;

function publish(prev: BoardFx[]): void {
  if (state.fx === prev) return;
  useBoardFxStore.setState({ fx: state.fx });
  window.clearTimeout(timer);
  if (!state.fx.length) return;
  const next = Math.min(...state.fx.map((f) => f.until));
  timer = window.setTimeout(() => { const p = state.fx; state = fxExpire(state, performance.now()); publish(p); }, Math.max(0, next - performance.now()) + 16);
}

/** Called for every message the close-up gate delivers, after the game store has applied it. Decoration only: never throws. */
export function boardFxReceive(msg: ServerMessage): void {
  try {
    const prev = state.fx;
    if (msg.type === 'combat_end' || msg.type === 'combat_start') state = initialBoardFx();
    const g = useGameStore.getState();
    state = fxReceive(state, msg, { now: performance.now(), positions: g.arenaPositions, participants: g.activeCombat?.participants ?? [] });
    publish(prev);
  } catch { /* juice must never break message delivery */ }
}
```

- [ ] **Step 2: Feed it from the gate.** In `client/src/combat/closeUpStore.ts`, add `import { boardFxReceive } from './boardFxStore.js';` and change `deliver` to:

```ts
const deliver = (msgs: ServerMessage[]) => {
  for (const m of msgs) { useGameStore.getState().handleServerMessage(m); boardFxReceive(m); }
};
```

- [ ] **Step 3: Render in `ArenaGrid`.** In `client/src/components/ArenaGrid.tsx`:

Add these imports:

```ts
import type { CSSProperties, RefObject } from 'react';
import { useBoardFxStore } from '../combat/boardFxStore.js';
import type { BoardFx } from '../combat/boardFx.js';
```

Inside the component, before the `entities` memo, add:

```ts
  const fx = useBoardFxStore((s) => s.fx);
  const unitFx = useMemo(() => {
    const m = new Map<string, { cls: string; style: Record<string, string> }>();
    for (const f of fx) {
      if (f.kind === 'number') continue;
      const cur = m.get(f.unitId) ?? { cls: '', style: {} };
      if (f.kind === 'lunge') { cur.cls += ` fx-lunge fx-lunge-${f.dir}`; cur.style['--fx-lunge-delay'] = `${f.delayMs}ms`; }
      else { cur.cls += ' fx-tear'; cur.style['--fx-tear-delay'] = `${f.delayMs}ms`; }
      m.set(f.unitId, cur);
    }
    return m;
  }, [fx]);
  const numbers = useMemo(() => fx.filter((f): f is Extract<BoardFx, { kind: 'number' }> => f.kind === 'number'), [fx]);
```

In the `entities` memo's `result.push({...})` for participants, apply the effects:

```ts
      const uf = unitFx.get(p.id);
      result.push({
        x: pos.x,
        y: pos.y,
        char: getEntityChar(p),
        className: getEntityClass(p, p.id === currentTurnId) + (uf?.cls ?? ''),
        sprite: getParticipantGlyph(p),
        style: uf ? (uf.style as CSSProperties) : undefined,
      });
```

Add `unitFx` to that memo's dependency list.

Add this component at the bottom of the file:

```tsx
function FxNumbers({ numbers, worldRef }: { numbers: Extract<BoardFx, { kind: 'number' }>[]; worldRef: RefObject<HTMLDivElement> }) {
  const [pos, setPos] = useState<Record<number, { left: number; top: number; width: number }>>({});
  useLayoutEffect(() => {
    const world = worldRef.current;
    const gridEl = world?.querySelector('.room-grid') as HTMLElement | null;
    if (!world || !gridEl) return;
    const pr = world.getBoundingClientRect();
    const next: Record<number, { left: number; top: number; width: number }> = {};
    for (const n of numbers) {
      const r = getCellRect(gridEl, n.tile.x, n.tile.y);
      if (r) next[n.id] = { left: r.left - pr.left, top: r.top - pr.top, width: r.width };
    }
    setPos(next);
  }, [numbers, worldRef]);
  return (
    <>
      {numbers.map((n) => pos[n.id] && (
        <span key={n.id} className={`fx-number fx-number--${n.tone}`}
          style={{ left: pos[n.id].left, top: pos[n.id].top - 8 - n.offset * 14, width: pos[n.id].width, animationDelay: `${n.delayMs}ms` }}>
          {n.value}
        </span>
      ))}
    </>
  );
}
```

Render it inside `.arena-world`, right after the `arena-anim-entity` span:

```tsx
          <FxNumbers numbers={numbers} worldRef={worldRef} />
```

`worldRef` is `useRef<HTMLDivElement>(null)` (`ArenaGrid.tsx:68`), so it matches `RefObject<HTMLDivElement>` as is.

- [ ] **Step 4: The CSS.** Create `client/src/styles/boardfx.css`:

```css
/* === Board juice for damaging hits (see combat/boardFx.ts). Inside .arena-world, under the CRT overlay. === */
.glyph-grid .fx-lunge .entity-glyph { animation: fx-lunge-right 300ms cubic-bezier(.2,.8,.3,1) var(--fx-lunge-delay, 0ms) both; }
.glyph-grid .fx-lunge-left .entity-glyph { animation-name: fx-lunge-left; }
.glyph-grid .fx-lunge-up .entity-glyph { animation-name: fx-lunge-up; }
.glyph-grid .fx-lunge-down .entity-glyph { animation-name: fx-lunge-down; }
@keyframes fx-lunge-right { 35% { transform: translateX(11px) scale(1.08) } 100% { transform: none } }
@keyframes fx-lunge-left { 35% { transform: translateX(-11px) scale(1.08) } 100% { transform: none } }
@keyframes fx-lunge-up { 35% { transform: translateY(-11px) scale(1.08) } 100% { transform: none } }
@keyframes fx-lunge-down { 35% { transform: translateY(11px) scale(1.08) } 100% { transform: none } }
.glyph-grid .fx-tear .entity-glyph { animation: fx-tear 360ms steps(6) var(--fx-tear-delay, 0ms) both; }
@keyframes fx-tear {
  0% { filter: drop-shadow(3px 0 0 #f00) drop-shadow(-3px 0 0 #0ff) brightness(2); transform: translateX(2px) }
  33% { filter: drop-shadow(-2px 0 0 #f00) drop-shadow(2px 0 0 #0ff); transform: translateX(-2px) skewX(8deg) }
  66% { filter: drop-shadow(1px 0 0 #f00); transform: skewX(-4deg) }
  100% { filter: none; transform: none }
}
.fx-number { position: absolute; z-index: 12; pointer-events: none; text-align: center; font: 700 16px 'Courier New', monospace;
  -webkit-text-stroke: .6px #000; opacity: 0; animation: fx-number 950ms ease-out both; }
.fx-number--mob { color: #ff5a3c; text-shadow: 0 0 4px #ff3a1c; }
.fx-number--player { color: #ffb000; text-shadow: 0 0 4px #ff8a00; }
.fx-number--chip { color: #8c7f6c; text-shadow: none; }
@keyframes fx-number { 0% { opacity: 1; transform: translateY(0) scale(1.8) } 15% { transform: translateY(-6px) scale(1) } 75% { opacity: 1 } 100% { opacity: 0; transform: translateY(-20px) } }
@keyframes fx-number-still { 0%, 75% { opacity: 1 } 100% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  .glyph-grid .fx-lunge .entity-glyph, .glyph-grid .fx-tear .entity-glyph { animation: none; }
  .fx-number { animation-name: fx-number-still; }
}
```

In `client/src/main.tsx`, add `import './styles/boardfx.css';` after `import './styles/closeup.css';`.

- [ ] **Step 5: Run the tests and the type-check.**
Run: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
Expected: all client tests pass, and `tsc` is clean.

- [ ] **Step 6: The visual check (Review Focus 1, 2 and 4).** Create `.sandbox/strike-check.mjs`:

```js
// Duel: walk into range, basic-attack the mob, check the strike close-up and board number; then check a mob strike stages the player left.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5175';
mkdirSync('.sandbox/strikes', { recursive: true });
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${base}/?sandbox=duel`);
const myTurn = () => p.waitForFunction(() => window.__cavernsSandbox?.status === 'my_turn', null, { timeout: 60000 });
await myTurn();
await p.waitForTimeout(3200);
const adjacent = () => p.evaluate(() => {
  const h = window.__cavernsSandbox; const me = h.positions[h.playerId ?? 'p1'] ?? Object.values(h.positions)[0];
  const mob = h.combat.participants.find((x) => x.type === 'mob'); const m = h.positions[mob.id];
  return Math.abs(me.x - m.x) + Math.abs(me.y - m.y) <= 1;
});
let mobStrikeLeft = null;
for (let i = 0; i < 12 && !(await adjacent()); i++) {
  await p.locator('.arena-btn', { hasText: 'End Turn' }).click();
  // While the mob acts, catch a mob strike close-up if one plays
  const seen = await p.waitForSelector('.closeup--strike.closeup--enemy', { timeout: 4000 }).then(() => true, () => false);
  if (seen && mobStrikeLeft === null) {
    await p.screenshot({ path: '.sandbox/strikes/mob-strike.png' });
    mobStrikeLeft = await p.locator('.closeup__side--left .closeup-fig img').first().getAttribute('src');
  }
  await myTurn();
}
const logBefore = await p.locator('.arena-combat-log').innerText().catch(() => '');
await p.locator('.arena-btn', { hasText: 'Attack' }).click();
const h = await p.evaluate(() => window.__cavernsSandbox);
const mob = h.combat.participants.find((x) => x.type === 'mob');
const pos = h.positions[mob.id];
await p.locator(`.room-grid > .room-row:nth-child(${pos.y + 1}) > span:nth-child(${pos.x + 1})`).click();
await p.waitForSelector('.closeup.closeup--strike', { timeout: 3000 });
await p.waitForTimeout(150);
const early = await p.locator('.arena-combat-log').innerText().catch(() => '');
await p.screenshot({ path: '.sandbox/strikes/strike-150.png' });
await p.waitForTimeout(250);
await p.screenshot({ path: '.sandbox/strikes/strike-400.png' });
const numberShown = await p.locator('.fx-number').count();
const late = await p.locator('.arena-combat-log').innerText().catch(() => '');
await b.close();
const out = {
  heldEarly: early === logBefore, releasedLate: late !== logBefore, numberShown: numberShown > 0,
  mobStrikeLeft, playerLeftOnMobStrike: mobStrikeLeft === null ? 'not observed' : !/\/mobs\//.test(mobStrikeLeft),
};
console.log(JSON.stringify(out));
const ok = out.heldEarly && out.releasedLate && out.numberShown && out.playerLeftOnMobStrike !== false;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
```

Run: `cmd.exe /c "node .sandbox/strike-check.mjs"`, with the dev server on port 5175 (start `npm run dev:sandbox` if it isn't running).
Expected: `PASS`, with `playerLeftOnMobStrike: true` (or `"not observed"` if the mob never reached the player before you did; if so, rerun until it's observed at least once). Look at `.sandbox/strikes/*.png`: the band is translucent and the board is visible behind it.

The sandbox handle exposes `playerId` (`client/src/sandbox/sandboxHook.ts:12`). If the Attack flow needs a different selector, fix the script (it's git-ignored) and record a ruling.

- [ ] **Step 7: Re-run the earlier regression scripts.**
Run each of these:
- `cmd.exe /c "node .sandbox/closeup-check.mjs"` → expect `PASS`;
- `cmd.exe /c "node .sandbox/closeup-check.mjs --skip"` → expect `PASS`;
- `cmd.exe /c "node .sandbox/move-closes.mjs"` → expect `PASS`;
- `cmd.exe /c "node .sandbox/arena-size.mjs http://localhost:5175"` → expect `{"cols":28,"rows":8}`.

- [ ] **Step 8: Commit.**

```bash
git.exe add client/src/combat/boardFxStore.ts client/src/combat/closeUpStore.ts client/src/components/ArenaGrid.tsx client/src/styles/boardfx.css client/src/main.tsx
git.exe commit -m "Play board juice for every delivered hit in the arena

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mob art manifest and pipeline scripts

**Files:**
- Create: `client/src/combat/mobCloseUpManifest.ts`. The spec names `mobCloseUpArt.json`; a TS module matches the existing `glyphManifest.ts` pattern and needs no JSON-module config. Record this as a ruling.
- Modify: `client/src/combat/closeUpStage.ts` (`artChainFor`)
- Test: `client/src/combat/closeUpStage.test.ts`
- Create: `client/src/combat/mobCloseUpManifest.test.ts`
- Create: `scripts/closeups/mob-prompts.mjs`
- Create: `scripts/closeups/install-mobs.mjs`

**Interfaces:**
- Produces:
  - `MOB_CLOSE_UPS: readonly string[]` (template ids with a PNG in `client/public/closeups/mobs/`), written by `install-mobs.mjs`;
  - `artChainFor` includes `/closeups/mobs/<id>.png` only for ids in the manifest;
  - `art/closeups/mob-prompts.json`: `[{ id, biome, ref, prompt }]`.

- [ ] **Step 1: Write the failing tests.** In `client/src/combat/closeUpStage.test.ts`, add `import { MOB_CLOSE_UPS } from './mobCloseUpManifest.js';` and replace the mob line in `'every class, role and mob resolves...'` with:

```ts
    const withArt = new Set(MOB_CLOSE_UPS);
    for (const id of ['__no_art_mob__', ...MOB_CLOSE_UPS]) {
      const chain = artChainFor({ type: 'mob', templateId: id }, 'attack');
      if (withArt.has(id)) expect(chain[0]).toBe(`/closeups/mobs/${id}.png`);
      else expect(chain.some((c) => c.startsWith('/closeups/mobs/'))).toBe(false);
    }
```

Create `client/src/combat/mobCloseUpManifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { MOB_CLOSE_UPS } from './mobCloseUpManifest.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pool = JSON.parse(readFileSync(`${root}shared/src/data/mobPool.json`, 'utf8')) as { id: string }[];

describe('mob close-up manifest', () => {
  it('every entry is a real mob with a PNG on disk, and there are no duplicates', () => {
    const ids = new Set(pool.map((m) => m.id));
    expect(new Set(MOB_CLOSE_UPS).size).toBe(MOB_CLOSE_UPS.length);
    for (const id of MOB_CLOSE_UPS) {
      expect(ids.has(id), id).toBe(true);
      expect(existsSync(`${root}client/public/closeups/mobs/${id}.png`), id).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run them; they must fail.**
Run: `cmd.exe /c "cd client && npx vitest run src/combat"`
Expected: FAIL with `Cannot find module './mobCloseUpManifest.js'`.

- [ ] **Step 3: Implement.** Create `client/src/combat/mobCloseUpManifest.ts`:

```ts
// Mob template ids with a close-up PNG in client/public/closeups/mobs/. Written by scripts/closeups/install-mobs.mjs.
export const MOB_CLOSE_UPS: readonly string[] = [];
```

In `client/src/combat/closeUpStage.ts`, add `import { MOB_CLOSE_UPS } from './mobCloseUpManifest.js';` and `const mobCloseUps = new Set<string>(MOB_CLOSE_UPS);` below the imports. Change the mob branch of `artChainFor` to:

```ts
  if (p.type === 'mob') {
    if (p.templateId && mobCloseUps.has(p.templateId)) chain.push(`/closeups/mobs/${p.templateId}.png`);
  } else {
```

- [ ] **Step 4: Run the tests; they must pass.**
Run: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
Expected: all pass (the empty manifest trivially satisfies the data test), and `tsc` is clean.

- [ ] **Step 5: The pipeline scripts.** Create `scripts/closeups/mob-prompts.mjs`:

```js
// Build PixelLab prompts for mob close-up sprites from the data: node scripts/closeups/mob-prompts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const pool = JSON.parse(readFileSync('shared/src/data/mobPool.json', 'utf8'));
const RAW = 'https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/sprites/glyphs/mobs/';
const out = pool.map((m) => ({
  id: m.id,
  biome: m.biomes[0],
  ref: `${RAW}${m.id}.png`,
  prompt: `the SAME creature as the reference image — identical shape and colours — ${m.name}, ${m.description} — full-body, head to feet, small in frame, side view facing left, menacing ready stance, no text, no letters, no symbols written`,
}));
mkdirSync('art/closeups', { recursive: true });
writeFileSync('art/closeups/mob-prompts.json', JSON.stringify(out, null, 1));
console.log(`${out.length} prompts`, Object.entries(out.reduce((a, m) => ({ ...a, [m.biome]: (a[m.biome] ?? 0) + 1 }), {})));
```

Create `scripts/closeups/install-mobs.mjs`:

```js
// Copy approved mob picks (art/closeups/chosen.json keys "mob-<id>" with a "file" under art/closeups/) into
// client/public/closeups/mobs/ and rewrite the client manifest: node scripts/closeups/install-mobs.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
const chosen = JSON.parse(readFileSync('art/closeups/chosen.json', 'utf8'));
const dir = 'client/public/closeups/mobs';
mkdirSync(dir, { recursive: true });
let n = 0;
for (const [key, e] of Object.entries(chosen)) {
  if (!key.startsWith('mob-') || !e.file) continue;
  copyFileSync(`art/closeups/${e.file}`, `${dir}/${key.slice(4)}.png`);
  n++;
}
const ids = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
writeFileSync('client/src/combat/mobCloseUpManifest.ts',
  `// Mob template ids with a close-up PNG in client/public/closeups/mobs/. Written by scripts/closeups/install-mobs.mjs.\nexport const MOB_CLOSE_UPS: readonly string[] = [\n${ids.map((i) => `  '${i}',`).join('\n')}\n];\n`);
console.log(`copied ${n}, manifest has ${ids.length}`);
```

Run: `cmd.exe /c "node scripts/closeups/mob-prompts.mjs"`
Expected: `45 prompts { starter: 10, fungal: 7, crystal: 7, flooded: 7, bone: 7, volcanic: 7 }`. Read five random prompts: none should contain numbers or stat words. If a description contains mechanics text, strip it in the script (a data-driven regex, not per mob) and record a ruling.

- [ ] **Step 6: Commit.**

```bash
git.exe add client/src/combat/mobCloseUpManifest.ts client/src/combat/mobCloseUpManifest.test.ts client/src/combat/closeUpStage.ts client/src/combat/closeUpStage.test.ts scripts/closeups
git.exe commit -m "Gate mob close-up art on a manifest; add mob art pipeline scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mob art batches (PixelLab), one biome at a time

This is art production with a **user approval gate per biome**. The feature is complete without it (glyph fallback); the plan's "done" needs the **starter** batch.

**Files:**
- Create: `client/public/closeups/mobs/<id>.png` per approved mob
- Modify: `client/src/combat/mobCloseUpManifest.ts` (via `install-mobs.mjs`)
- Modify: `art/closeups/chosen.json` (add `"mob-<id>"` entries: `{ job_id, index, ref, prompt, file }`)
- Raw candidates: `art/closeups/raw/mob-<id>_<n>.png` (untracked)

**Interfaces:**
- Consumes: `art/closeups/mob-prompts.json` and `install-mobs.mjs` (Task 6).

For each biome, in order `starter`, `fungal`, `crystal`, `flooded`, `bone`, `volcanic`:

- [ ] **Step 1: Check the budget.** Call `mcp__pixellab__get_balance`. Continue only if the remaining generations are at least `25 × (mobs in this biome) + 100`. Otherwise record a ruling and stop the art work (the feature works with fallbacks).

- [ ] **Step 2: Generate.** For each mob in the biome, from `mob-prompts.json`, call `mcp__pixellab__create_image_pro`:

```json
{ "description": "<prompt>", "width": 160, "height": 160,
  "reference_images": [{ "url": "<ref>", "usage": "character identity: this exact creature, same shape and colours" }],
  "style_image_url": "<ref>" }
```

Run at most 10 jobs at a time. Wait with `mcp__pixellab__wait_for_jobs`.

- [ ] **Step 3: Download and build a contact sheet.** For each job, download the 4 candidates from `https://api.pixellab.ai/mcp/images/<job_id>/download?index=<n>` into `art/closeups/raw/mob-<id>_<n>.png`. Build `art/closeups/_mobs-<biome>.png`: one row per mob, 4 candidates at 2× nearest-neighbour, labelled with the mob id and the index. Pick the best per mob using these criteria:
  - it reads as the same creature as the board sprite;
  - it faces left;
  - it isn't cropped;
  - there's no text.

- [ ] **Step 4: USER APPROVAL GATE.** Show the sheet (copy it into the mockup server's content directory as `closeup_mobs_<biome>.png` with a small HTML page if the server is running; otherwise use Read), with your picks. Reroll only the mobs the user rejects, with a reworded prompt that keeps the identity lock. **Don't install until the user approves.**

- [ ] **Step 5: Install.** Add `"mob-<id>": { "job_id", "index", "ref", "prompt", "file": "raw/mob-<id>_<n>.png" }` entries to `art/closeups/chosen.json` for the approved picks, then run:
`cmd.exe /c "node scripts/closeups/install-mobs.mjs && cd client && npx vitest run src/combat"`
Expected: `copied <n>, manifest has <total>`, and the client combat tests pass (the manifest data test now checks real files).

- [ ] **Step 6: Commit.**

```bash
git.exe add client/public/closeups/mobs client/src/combat/mobCloseUpManifest.ts art/closeups/chosen.json art/closeups/mob-prompts.json
git.exe commit -m "Add <biome> mob close-up art

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After the starter batch, re-run `.sandbox/strike-check.mjs` and look at a strike frame: the mob figure should be the new sprite, not the upscaled glyph.

---

### Task 8: Verification

**Files:** none tracked.

- [ ] **Step 1: Full suite and types.**
Run: `cmd.exe /c "npm run build --workspace=shared && npm test && cd client && npx tsc --noEmit -p ."`
Expected: every workspace passes, and `tsc` is clean.

- [ ] **Step 2: Simulations stay fast.**
Run: `cmd.exe /c "npm run sim --workspace=server -- showcase --seeds 5 --seed 42"`
Expected: it completes in under 10s (strikes are scaled to 0 in simulations).

- [ ] **Step 3: Captures for the user.** Run `.sandbox/strike-check.mjs` and `.sandbox/closeup-check.mjs` → both `PASS`. Put `.sandbox/strikes/*.png` on the mockup page for the user to review.

- [ ] **Step 4: Memory.** Record anything non-obvious with `mcp__thinker__memory_store`, for example mob-prompt tweaks that worked, or any test that needed `closeUpScale: 0` and why.
