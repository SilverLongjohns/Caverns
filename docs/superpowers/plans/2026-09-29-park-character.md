# Park Character Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player park a character mid-run (exploring only), play another character, and resume the parked one later from character select. Add an in-dungeon "Leave run" escape that costs a toll of 25 gold or one item.

**Architecture:**
- **Seats stay in the run.** A parked character keeps its seat inside `GameSession`, re-keyed to a placeholder ID (`parked:<characterId>`), so no dungeon traffic reaches the player's new connection.
- **Runs are found by character.** `ActiveSessionMap` becomes character → run, so one account can hold parked runs while playing elsewhere.
- **Resume reuses reconnect.** Resume and reconnect share one server helper (`attachToRun`) built on `GameSession.reattachConnection`.
- **Leaving is per member.** Leaving a run removes one seat and returns that member to the world through a new `WorldSession.returnMemberFromDungeon`.

**Tech Stack:** TypeScript, Node `ws` server, Vitest, React + Zustand client, Playwright sandbox scripts (`.sandbox/`, git-ignored).

**Spec:** `docs/superpowers/specs/2026-09-29-park-character-design.md`

## Global Constraints

- **No git commands.** `CLAUDE.md` says the user manages git themselves. Leave every change uncommitted; there are no commit steps.
- **Node runs on Windows.** Run tooling as `cmd.exe /c "cd <workspace> && npx vitest run <file>"` and `cmd.exe /c "cd <workspace> && npx tsc --noEmit -p ."`.
- **The toll comes from config.** It is `LOOT_CONFIG.leaveRunTollGold` (25); never write a `25` literal in code.
- **Parking and leaving happen only while exploring.** Refuse when the seat is `in_combat`, `downed`, or has a loot roll pending. The server enforces this; client button state is a convenience only.
- **Placeholder seat IDs** are `parked:<characterId>` (parked) and `dropped:<characterId>` (logged out while unable to park).
- **Mobs ignore away seats.** An away seat is parked, or disconnected while not `in_combat`.
- **Client UI** uses the existing relic components (`RelicButton`, `MenuConsole`, `ScreenTransition`) and CRT styling. Keep scanlines and flicker; fix readability through colour.
- **Keep the existing tests passing:** `server/src/GameSession.reattach.test.ts` and the `ArenaCombatManager` re-key test.

## Review Focus

1. **Two tabs, one account.** Tab 1 parks A; tab 2 resumes A; then tab 1 tries to resume A. The second attempt must get "Character already in use" and must not steal the seat. Covered in Task 4 (`resumeParked` returns false once the seat is no longer parked) and Task 7 (the flow).
2. **A mob fight in a parked seat's room.** Detection must not open a fight against only away seats, and a fight started by a present player must not add the away seat. Covered in Task 3.
3. **Leaving an item from a partly empty pouch.** Only the chosen slot becomes `null`; the other slots keep their positions. Covered in Task 5.
4. **The party finishes the run while a member is parked.** The finalize path releases every seat, parked included, and `activeSessions` forgets the character. Covered in Task 5 (`finalizeGracefulEnd` iterates all players, including placeholder IDs).
5. **Reconnecting after a server restart.** No runs exist, so no "In run" cards appear and in_use flags are cleared. Covered in Task 7 (`clearInUseForAccount` with an empty keep list).

## File Map

| File | Change |
|---|---|
| `shared/src/data/lootConfig.json`, `shared/src/data/configTypes.ts` | `leaveRunTollGold` |
| `shared/src/types.ts` | `Player.away?: boolean` |
| `shared/src/messages.ts` | `park_run`, `leave_run` (+ `LeaveRunToll`), `run_parked`, `party_member_left`, `seat_rekeyed`, `CharacterSummary.parkedRun` |
| `server/src/ActiveSessionMap.ts` (+test) | per-character map |
| `server/src/LootManager.ts` (+test) | `hasPendingFor`, `replacePlayerId` |
| `server/src/PlayerManager.ts` | `removePlayer` |
| `server/src/GameSession.ts` (+ `GameSession.park.test.ts`) | presence, away rules, `rekeySeat`, park/resume/leave/release |
| `server/src/WorldSession.ts` (+test) | `updateOutboundConnection`, `returnMemberFromDungeon` |
| `server/src/CharacterRepository.ts` (+test) | `clearInUseForAccount(accountId, keepIds)` |
| `server/src/index.ts` | `attachToRun`, `park_run`, `leave_run`, `select_character` resume, `resume_session`, `logout`, `parkedRun` in the character list |
| `client/src/store/gameStore.ts` (+ `gameStore.parkRun.test.ts`) | `run_parked`, `party_member_left`, `seat_rekeyed` |
| `client/src/hooks/useGameActions.ts` | `parkRun`, `leaveRun` |
| `client/src/components/RunControls.tsx`, `LeaveRunModal.tsx` (new) | Park / Leave run UI |
| `client/src/components/ActionBar.tsx`, `CharacterSlotCard.tsx`, `PartyPanel.tsx`, `App.tsx`, `styles/index.css` | wiring and styling |
| `CLAUDE.md` | document the feature |

---

### Task 1: Shared protocol and config

**Files:**
- Modify: `shared/src/data/lootConfig.json`, `shared/src/data/configTypes.ts`, `shared/src/types.ts`, `shared/src/messages.ts`
- Test: `shared/src/parkRun.test.ts` (new)

**Interfaces:**
- Produces:
  - `LOOT_CONFIG.leaveRunTollGold: number`;
  - `Player.away?: boolean`;
  - `LeaveRunToll`;
  - the message interfaces `ParkRunMessage`, `LeaveRunMessage`, `RunParkedMessage`, `PartyMemberLeftMessage`, `SeatRekeyedMessage`;
  - `CharacterSummary.parkedRun?: { roomName: string } | null`.

- [ ] **Step 1: Write the failing test** — `shared/src/parkRun.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LOOT_CONFIG } from './index.js';
import type { ClientMessage, ServerMessage, CharacterSummary, Player } from './index.js';

describe('park run protocol', () => {
  it('prices the leave-run toll from config', () => {
    expect(LOOT_CONFIG.leaveRunTollGold).toBe(25);
  });

  it('types the new messages', () => {
    const out: ClientMessage[] = [
      { type: 'park_run' },
      { type: 'leave_run', toll: { kind: 'gold' } },
      { type: 'leave_run', toll: { kind: 'item', source: 'consumables', index: 2 } },
      { type: 'leave_run', toll: { kind: 'free' } },
    ];
    const inc: ServerMessage[] = [
      { type: 'run_parked' },
      { type: 'party_member_left', playerId: 'p1' },
      { type: 'seat_rekeyed', oldId: 'p1', newId: 'parked:c1' },
    ];
    const summary: Pick<CharacterSummary, 'parkedRun'> = { parkedRun: { roomName: 'Torchlit Passage' } };
    const away: Pick<Player, 'away'> = { away: true };
    expect(out).toHaveLength(4);
    expect(inc).toHaveLength(3);
    expect(summary.parkedRun?.roomName).toBe('Torchlit Passage');
    expect(away.away).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  Run: `cmd.exe /c "cd shared && npx vitest run src/parkRun.test.ts"`
  Expected: FAIL (`leaveRunTollGold` is undefined), and `tsc` would reject the literals.

- [ ] **Step 3: Implement.**
  - **`lootConfig.json`:** add `"leaveRunTollGold": 25,` after `"timeoutMs": 15000,`.
  - **`configTypes.ts`:** add `leaveRunTollGold: number;` to `LootConfig`.
  - **`types.ts`:** in `export interface Player`, after `status: PlayerStatus;`, add:

```ts
  /** Parked, or disconnected outside a fight: mobs ignore the seat and the party sees it as away. */
  away?: boolean;
```

  - **`messages.ts`:** add next to `LeaveWorldMessage`:

```ts
export interface ParkRunMessage {
  type: 'park_run';
}

export type LeaveRunToll =
  | { kind: 'gold' }
  | { kind: 'item'; source: 'inventory' | 'consumables'; index: number }
  | { kind: 'free' };

export interface LeaveRunMessage {
  type: 'leave_run';
  toll: LeaveRunToll;
}
```

  Add `| ParkRunMessage` and `| LeaveRunMessage` to `ClientMessage`. Add the server messages near `GameStartMessage`:

```ts
/** Your seat was parked; the client leaves the dungeon view for character select. */
export interface RunParkedMessage {
  type: 'run_parked';
}

/** A party member left the run for good (escape); drop their seat. */
export interface PartyMemberLeftMessage {
  type: 'party_member_left';
  playerId: string;
}

/** A seat changed id (park, resume, reconnect); rename it in client state. */
export interface SeatRekeyedMessage {
  type: 'seat_rekeyed';
  oldId: string;
  newId: string;
}
```

  Add all three to the `ServerMessage` union. In `CharacterSummary`, add:

```ts
  /** Set when this character is parked in a dungeon run it can resume. */
  parkedRun?: { roomName: string } | null;
```

- [ ] **Step 4: Run the test and typecheck.**
  Run: `cmd.exe /c "cd shared && npx vitest run src/parkRun.test.ts && npx tsc --noEmit -p . && npm run build"`
  Expected: PASS, no type errors. The build refreshes `shared/dist` for the server and client.

---

### Task 2: Per-character `ActiveSessionMap`

**Files:**
- Modify: `server/src/ActiveSessionMap.ts`, `server/src/ActiveSessionMap.test.ts`, `server/src/GameSession.ts` (lines around 323, 1324, 1336, 1356), `server/src/index.ts` (`resume_session` around 382, `logout` around 426)

**Interfaces:**
- Produces:
  - `attach(characterId, accountId, sessionId)`;
  - `detachCharacter(characterId)`;
  - `detachSession(sessionId)`;
  - `getByCharacter(characterId): string | undefined`;
  - `listForAccount(accountId): CharacterRun[]`;
  - `clear()`.
- `CharacterRun = { characterId: string; sessionId: string }`.

- [ ] **Step 1: Replace the test file** `server/src/ActiveSessionMap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ActiveSessionMap } from './ActiveSessionMap.js';

describe('ActiveSessionMap (per character)', () => {
  it('tracks two characters of one account in two runs', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    expect(m.getByCharacter('char-A')).toBe('sess-1');
    expect(m.getByCharacter('char-B')).toBe('sess-2');
    expect(m.listForAccount('acc-1')).toEqual([
      { characterId: 'char-A', sessionId: 'sess-1' },
      { characterId: 'char-B', sessionId: 'sess-2' },
    ]);
    expect(m.listForAccount('acc-2')).toEqual([]);
  });

  it('detachCharacter removes only that character', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    m.detachCharacter('char-A');
    expect(m.getByCharacter('char-A')).toBeUndefined();
    expect(m.getByCharacter('char-B')).toBe('sess-2');
  });

  it('detachSession removes every character in that run', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-C', 'acc-2', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    m.detachSession('sess-1');
    expect(m.listForAccount('acc-2')).toEqual([]);
    expect(m.listForAccount('acc-1')).toEqual([{ characterId: 'char-B', sessionId: 'sess-2' }]);
  });

  it('clear empties everything', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.clear();
    expect(m.getByCharacter('char-A')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  Run: `cmd.exe /c "cd server && npx vitest run src/ActiveSessionMap.test.ts"`
  Expected: FAIL (`getByCharacter is not a function`).

- [ ] **Step 3: Replace** `server/src/ActiveSessionMap.ts`:

```ts
export interface CharacterRun {
  characterId: string;
  sessionId: string;
}

/**
 * Which dungeon run each character is seated in. Keyed by character, not account,
 * so one account can have a character parked in a run while playing another.
 */
export class ActiveSessionMap {
  private byCharacter = new Map<string, { accountId: string; sessionId: string }>();

  attach(characterId: string, accountId: string, sessionId: string): void {
    this.byCharacter.set(characterId, { accountId, sessionId });
  }

  detachCharacter(characterId: string): void {
    this.byCharacter.delete(characterId);
  }

  detachSession(sessionId: string): void {
    for (const [characterId, run] of this.byCharacter) {
      if (run.sessionId === sessionId) this.byCharacter.delete(characterId);
    }
  }

  getByCharacter(characterId: string): string | undefined {
    return this.byCharacter.get(characterId)?.sessionId;
  }

  listForAccount(accountId: string): CharacterRun[] {
    const out: CharacterRun[] = [];
    for (const [characterId, run] of this.byCharacter) {
      if (run.accountId === accountId) out.push({ characterId, sessionId: run.sessionId });
    }
    return out;
  }

  clear(): void {
    this.byCharacter.clear();
  }
}
```

- [ ] **Step 4: Update the callers** (behaviour-preserving; Task 7 rewrites these flows).
  - **`GameSession.ts` `hydratePlayerFromCharacter`:** `this.activeSessions?.attach(characterId, accountId, this.sessionId);`
  - **`GameSession.ts` `finalizeGracefulEnd`, `finalizeWipe`, `cleanup`:** replace each `if (ctx?.accountId) this.activeSessions?.detach(ctx.accountId);` with `if (ctx?.characterId) this.activeSessions?.detachCharacter(ctx.characterId);`
  - **`index.ts` `resume_session`:** replace `const existingSessionId = activeSessions.get(info.accountId);` with:

```ts
        const existingSessionId = activeSessions.listForAccount(info.accountId)[0]?.sessionId;
```

  - **`index.ts` `logout`:** replace `activeSessions.detach(ctx.accountId);` with:

```ts
          for (const run of activeSessions.listForAccount(ctx.accountId)) activeSessions.detachCharacter(run.characterId);
```

- [ ] **Step 5: Run the tests and typecheck.**
  Run: `cmd.exe /c "cd server && npx vitest run src/ActiveSessionMap.test.ts src/GameSession.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS, no type errors.

---

### Task 3: Seat presence, away rules, `rekeySeat`

**Files:**
- Modify: `server/src/LootManager.ts`, `server/src/GameSession.ts`
- Test: `server/src/LootManager.test.ts` (append), `server/src/GameSession.park.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 (`Player.away`, `seat_rekeyed`).
- Produces:
  - `LootManager.hasPendingFor(playerId): boolean`;
  - `LootManager.replacePlayerId(oldId, newId): void`;
  - on `GameSession`: `markDisconnected(id)`, `markConnected(id)`, `isDisconnected(id): boolean`, `isAway(id): boolean`;
  - `private rekeySeat(oldId, newId): Player | undefined`, which also broadcasts `seat_rekeyed`;
  - `reattachConnection(old, new)`, same signature, now built on `rekeySeat`.

- [ ] **Step 1: Write the failing LootManager tests** (append to `server/src/LootManager.test.ts`):

```ts
describe('LootManager seat helpers', () => {
  it('reports who a pending round waits on and follows a re-keyed seat', () => {
    const awarded: [string, string][] = [];
    const lm = new LootManager((item, winner) => awarded.push([item.id, winner]));
    const item = { id: 'i1', name: 'Rock', slot: 'weapon', rarity: 'common', stats: {} } as any;
    lm.startLootRound('r1', [item], ['p1', 'p2']);
    expect(lm.hasPendingFor('p1')).toBe(true);
    expect(lm.hasPendingFor('p3')).toBe(false);
    lm.submitChoice('p1', 'i1', 'need');
    lm.replacePlayerId('p1', 'p1b');
    expect(lm.hasPendingFor('p1')).toBe(false);
    expect(lm.hasPendingFor('p1b')).toBe(true);
    lm.submitChoice('p2', 'i1', 'pass'); // completes the round: p1b's earlier 'need' still counts
    expect(awarded).toEqual([['i1', 'p1b']]);
  });
});
```

(If `LootManager.test.ts` doesn't import `describe`/`it`/`expect`/`LootManager` already, it does; keep the existing imports.)

- [ ] **Step 2: Write the failing GameSession away tests** — `server/src/GameSession.park.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameSession } from './GameSession.js';

export function createParkSession(players: string[] = ['p1', 'p2']) {
  const messages: { playerId: string; msg: any }[] = [];
  const session = new GameSession(
    (msg: any) => messages.push({ playerId: '__broadcast__', msg }),
    (playerId: string, msg: any) => messages.push({ playerId, msg }),
  );
  for (const id of players) session.addPlayer(id, id === 'p1' ? 'Alice' : 'Bob');
  session.startGame();
  for (const id of players) session.attachCharacterContext(id, { accountId: `acc-${id}`, characterId: `char-${id}` });
  messages.length = 0;
  return { session, s: session as any, messages };
}

describe('GameSession away seats', () => {
  it('a disconnected seat outside a fight is away and hidden from mob AI', () => {
    const { session, s, messages } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    session.markDisconnected('p1');
    expect(session.isAway('p1')).toBe(true);
    expect(s.playerManager.getPlayer('p1').away).toBe(true);
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('p1') ?? false).toBe(false);
    expect(messages.some((m) => m.msg.type === 'player_update' && m.msg.player.id === 'p1' && m.msg.player.away)).toBe(true);
    session.markConnected('p1');
    expect(session.isAway('p1')).toBe(false);
    expect(s.playerManager.getPlayer('p1').away).toBeUndefined();
  });

  it('a disconnected seat inside a fight is not away (AFK rules apply instead)', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    session.markDisconnected('p1');
    expect(session.isDisconnected('p1')).toBe(true);
    expect(session.isAway('p1')).toBe(false);
  });

  it('mob detection does not open a fight when only away seats are present', () => {
    const { session, s } = createParkSession(['p1']);
    const roomId = session.getPlayerRoom('p1')!;
    s.rooms.get(roomId).encounter = { mobId: s.content.mobs[0].id, skullRating: 1 };
    session.markDisconnected('p1');
    s.handleMobDetection(roomId, 'any');
    expect(s.combats.has(roomId)).toBe(false);
  });

  it('a fight started by a present player leaves the away seat out', () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    session.markDisconnected('p2');
    const mob = { instanceId: 'm1', templateId: s.content.mobs[0].id, name: 'Rat', maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0 };
    session.startArenaCombat(roomId, [mob]);
    const ids = s.combats.get(roomId).getState().participants.map((p: any) => p.id);
    expect(ids).toContain('p1');
    expect(ids).not.toContain('p2');
    expect(s.playerManager.getPlayer('p2').status).not.toBe('in_combat');
  });

  it('rekeySeat moves the seat and tells everyone', () => {
    const { session, s, messages } = createParkSession();
    s.rekeySeat('p1', 'x1');
    expect(session.getPlayerRoom('x1')).toBeDefined();
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.getCharacterIdFor('x1')).toBe('char-p1');
    expect(messages.some((m) => m.msg.type === 'seat_rekeyed' && m.msg.oldId === 'p1' && m.msg.newId === 'x1')).toBe(true);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail.**
  Run: `cmd.exe /c "cd server && npx vitest run src/LootManager.test.ts src/GameSession.park.test.ts"`
  Expected: FAIL (`hasPendingFor` / `isAway` / `rekeySeat` not functions).

- [ ] **Step 4: Implement LootManager** — add inside the class:

```ts
  /** True while a need/greed round is waiting on this player. */
  hasPendingFor(playerId: string): boolean {
    return !!this.pendingRound?.playerIds.includes(playerId);
  }

  /** Reconnect/park: the seat keeps its place (and any choice made) in a pending round. */
  replacePlayerId(oldId: string, newId: string): void {
    const round = this.pendingRound;
    if (!round) return;
    round.playerIds = round.playerIds.map((id) => (id === oldId ? newId : id));
    for (const itemChoices of round.choices.values()) {
      const choice = itemChoices.get(oldId);
      if (choice !== undefined) {
        itemChoices.delete(oldId);
        itemChoices.set(newId, choice);
      }
    }
  }
```

- [ ] **Step 5: Implement GameSession presence.**
  - **Module-level helpers**, above `export class GameSession`:

```ts
type SeatPresence = 'disconnected' | 'parked';

function moveKey<V>(m: Map<string, V>, from: string, to: string): void {
  if (!m.has(from)) return;
  m.set(to, m.get(from)!);
  m.delete(from);
}
```

  - **Presence map:** replace the `disconnectedConnections` field (and its comment) with:

```ts
  // Seats that are not connected: dropped sockets, or players who parked the character.
  private presence = new Map<string, SeatPresence>();
```

  - **Presence methods:** replace `markDisconnected` / `markConnected` with:

```ts
  markDisconnected(connectionId: string): void {
    this.presence.set(connectionId, 'disconnected');
    this.applyAway(connectionId);
  }

  markConnected(connectionId: string): void {
    this.presence.delete(connectionId);
    this.applyAway(connectionId);
  }

  isDisconnected(connectionId: string): boolean {
    return this.presence.get(connectionId) === 'disconnected';
  }

  /** Parked, or dropped outside a fight: mobs ignore the seat and new fights/loot rolls leave it out. */
  isAway(connectionId: string): boolean {
    const p = this.presence.get(connectionId);
    if (p === 'parked') return true;
    if (p !== 'disconnected') return false;
    return this.playerManager.getPlayer(connectionId)?.status !== 'in_combat';
  }

  /** Sync the away flag, mob-AI visibility and party view with presence. */
  private applyAway(connectionId: string): void {
    const player = this.playerManager.getPlayer(connectionId);
    if (!player) return;
    const away = this.isAway(connectionId);
    if (!!player.away === away) return;
    if (away) {
      player.away = true;
      this.mobAIManager.removePlayer(player.roomId, connectionId);
    } else {
      delete player.away;
      const pos = this.playerGridPositions.get(connectionId);
      if (pos) this.mobAIManager.addPlayer(player.roomId, connectionId, pos);
    }
    this.broadcast({ type: 'player_update', player });
  }
```

  - **AFK check** in `broadcastTurnPrompt`: replace both `this.disconnectedConnections.has(turnId)` with `this.isDisconnected(turnId)`.
  - **`clearRoom`:** inside the `for` loop, after `this.playerManager.setStatus(p.id, 'exploring');`, add `this.applyAway(p.id);` so a seat that dropped mid-fight becomes away once the fight ends.
  - **`handleMobDetection`:** after `if (!room?.encounter) return;`, add:

```ts
    // Away seats can't be detected: no fight opens unless someone present is in the room.
    if (!this.playerManager.getPlayersInRoom(roomId).some((p) => !this.isAway(p.id))) return;
```

  - **`startCombat`:** change the first player line to:

```ts
    const playersInRoom = this.playerManager.getPlayersInRoom(roomId).filter((p) => !this.isAway(p.id));
    if (playersInRoom.length === 0) return;
```

  - **`runLootFlow`:** add `.filter((p) => !this.isAway(p.id))` to the `getPlayersInRoom(roomId)` chain that builds `playerIds`, before `.map`.

- [ ] **Step 6: Extract `rekeySeat`** and rebuild `reattachConnection` on it. Replace the whole current `reattachConnection` method with:

```ts
  /**
   * Move a seat to a new id (reconnect, park, resume). Every id-keyed map follows,
   * including the running fight; clients rename it via seat_rekeyed. Mob-AI tracking
   * is dropped here and re-added by the caller once it is safe to run detection.
   */
  private rekeySeat(oldId: string, newId: string): Player | undefined {
    const player = this.playerManager.getPlayer(oldId);
    if (!player) return undefined;
    this.playerManager.replacePlayerId(oldId, newId);
    moveKey(this.connectionContexts, oldId, newId);
    moveKey(this.playerGridPositions, oldId, newId);
    moveKey(this.playerNames, oldId, newId);
    moveKey(this.playerClasses, oldId, newId);
    moveKey(this.presence, oldId, newId);
    moveKey(this.goldWriteTimers, oldId, newId);
    moveKey(this.lastGridMove, oldId, newId);
    const idx = this.playerIds.indexOf(oldId);
    if (idx >= 0) this.playerIds[idx] = newId;
    for (const [roomId, solver] of this.activePuzzleSolver) {
      if (solver === oldId) this.activePuzzleSolver.set(roomId, newId);
    }
    this.lootManager.replacePlayerId(oldId, newId);
    const grid = this.roomGrids.get(player.roomId);
    const entity = grid?.getEntity(oldId);
    if (grid && entity) {
      grid.removeEntity(oldId);
      grid.addEntity({ ...entity, id: newId });
    }
    this.mobAIManager.removePlayer(player.roomId, oldId);
    this.combats.get(player.roomId)?.replaceParticipantId(oldId, newId);
    this.broadcast({ type: 'seat_rekeyed', oldId, newId });
    return player;
  }

  reattachConnection(oldConnectionId: string, newConnectionId: string): boolean {
    const player = this.rekeySeat(oldConnectionId, newConnectionId);
    if (!player) return false;
    // Cancel any AFK timer — the player is back.
    for (const combat of this.combats.values()) combat.cancelAfkTimer();
    this.presence.delete(newConnectionId);
    // The client only enters the dungeon view on game_start, so resend a full snapshot.
    this.sendTo(newConnectionId, this.buildResumeSnapshot(newConnectionId, player.roomId));
    const combat = this.combats.get(player.roomId);
    if (combat) {
      this.sendTo(newConnectionId, {
        type: 'arena_combat_start',
        tileGrid: combat.getGrid(),
        positions: combat.getAllPositions(),
        combat: combat.getCombatState(),
      } as any);
      // Their turn may have been waiting on them (the AFK skip was cancelled above): prompt them again.
      const state = combat.getState();
      if (state.currentTurnId === newConnectionId) {
        this.sendTo(newConnectionId, { type: 'combat_turn', currentTurnId: newConnectionId, roundNumber: state.roundNumber });
        const turnState = combat.getTurnState(newConnectionId);
        if (turnState) {
          this.sendTo(newConnectionId, {
            type: 'arena_positions_update',
            positions: combat.getAllPositions(),
            movementRemaining: turnState.movementRemaining,
            moverId: newConnectionId,
          } as any);
        }
      }
    }
    // Last: addPlayer runs detection, which may open a fight the client must see after game_start.
    const wasAway = !!player.away;
    delete player.away;
    const gridPos = this.playerGridPositions.get(newConnectionId);
    if (gridPos) this.mobAIManager.addPlayer(player.roomId, newConnectionId, gridPos);
    if (wasAway) this.broadcast({ type: 'player_update', player });
    return true;
  }
```

  In `server/src/GameSession.reattach.test.ts`, the fake combat object already has `replaceParticipantId` and `getState`. Leave that test unchanged.

- [ ] **Step 7: Run the tests and typecheck.**
  Run: `cmd.exe /c "cd server && npx vitest run src/LootManager.test.ts src/GameSession.park.test.ts src/GameSession.reattach.test.ts src/GameSession.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS. If the encounter shape in the detection test doesn't match `Room['encounter']`, read `shared/src/types.ts` for the real field names and adjust the test object only.

---

### Task 4: Park and resume in `GameSession`

**Files:**
- Modify: `server/src/GameSession.ts`
- Test: `server/src/GameSession.park.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 (`rekeySeat`, `presence`, `reattachConnection`, `LootManager.hasPendingFor`).
- Produces:
  - `stepAwayBlocker(id): string | null`;
  - `park(id): { ok: true; characterId: string; seatId: string } | { ok: false; reason: string }`;
  - `releaseConnection(id): string | undefined`, used at logout when parking is refused; returns the `dropped:` seat ID;
  - `findSeatByCharacter(characterId): string | undefined`;
  - `isParked(characterId): boolean`;
  - `getParkedRoomName(characterId): string | null`;
  - `resumeParked(characterId, newConnectionId): boolean`.

- [ ] **Step 1: Write the failing tests** (append to `GameSession.park.test.ts`):

```ts
describe('GameSession park / resume', () => {
  it('refuses to park in a fight, while downed, or with a loot roll pending', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    expect(session.park('p1')).toEqual({ ok: false, reason: "You can't do that during a fight." });
    s.playerManager.setStatus('p1', 'downed');
    expect(session.park('p1')).toEqual({ ok: false, reason: "You can't do that while downed." });
    s.playerManager.setStatus('p1', 'exploring');
    s.lootManager.startLootRound('r', [{ id: 'i1', name: 'Rock' }], ['p1', 'p2']);
    expect(session.park('p1')).toEqual({ ok: false, reason: 'Finish the loot roll first.' });
  });

  it('parks the seat under a placeholder id, away from mobs', () => {
    const { session, s, messages } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    const res = session.park('p1');
    expect(res).toEqual({ ok: true, characterId: 'char-p1', seatId: 'parked:char-p1' });
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.isParked('char-p1')).toBe(true);
    expect(session.findSeatByCharacter('char-p1')).toBe('parked:char-p1');
    expect(session.getParkedRoomName('char-p1')).toBe(s.rooms.get(roomId).name);
    expect(session.isAway('parked:char-p1')).toBe(true);
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('parked:char-p1') ?? false).toBe(false);
    expect(messages.some((m) => m.msg.type === 'text_log' && /steps back into the shadows/.test(m.msg.message))).toBe(true);
  });

  it('resumes a parked seat onto a new connection with a dungeon snapshot', () => {
    const { session, messages } = createParkSession();
    session.park('p1');
    messages.length = 0;
    expect(session.resumeParked('char-p1', 'p1c')).toBe(true);
    expect(session.isParked('char-p1')).toBe(false);
    expect(session.findSeatByCharacter('char-p1')).toBe('p1c');
    expect(session.isAway('p1c')).toBe(false);
    expect(messages.some((m) => m.playerId === 'p1c' && m.msg.type === 'game_start' && m.msg.playerId === 'p1c')).toBe(true);
    // A second resume (e.g. another tab) finds nothing parked.
    expect(session.resumeParked('char-p1', 'p1d')).toBe(false);
  });

  it('releaseConnection keeps a fighting seat in the run as dropped', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    expect(session.releaseConnection('p1')).toBe('dropped:char-p1');
    expect(session.isDisconnected('dropped:char-p1')).toBe(true);
    expect(session.findSeatByCharacter('char-p1')).toBe('dropped:char-p1');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `cmd.exe /c "cd server && npx vitest run src/GameSession.park.test.ts"`
  Expected: FAIL (`park` is not a function).

- [ ] **Step 3: Implement.** Add after `getCharacterIdFor`:

```ts
  findSeatByCharacter(characterId: string): string | undefined {
    for (const [seat, ctx] of this.connectionContexts) {
      if (ctx.characterId === characterId) return seat;
    }
    return undefined;
  }

  /** Why this seat can't park or leave right now, or null if it can. Exploring only. */
  stepAwayBlocker(connectionId: string): string | null {
    const player = this.playerManager.getPlayer(connectionId);
    if (!player) return 'You are not in this run.';
    if (player.status === 'in_combat') return "You can't do that during a fight.";
    if (player.status === 'downed') return "You can't do that while downed.";
    if (this.lootManager.hasPendingFor(connectionId)) return 'Finish the loot roll first.';
    return null;
  }

  /**
   * Park the seat: it stays in the run, re-keyed to a placeholder so nothing the run
   * sends reaches the player's connection (which goes back to character select).
   */
  park(connectionId: string): { ok: true; characterId: string; seatId: string } | { ok: false; reason: string } {
    const blocker = this.stepAwayBlocker(connectionId);
    if (blocker) return { ok: false, reason: blocker };
    const characterId = this.connectionContexts.get(connectionId)?.characterId;
    if (!characterId) return { ok: false, reason: 'This seat has no character.' };
    const seatId = `parked:${characterId}`;
    const player = this.rekeySeat(connectionId, seatId)!;
    this.presence.set(seatId, 'parked');
    player.away = true;
    this.broadcast({ type: 'text_log', message: `${player.name} steps back into the shadows.`, logType: 'system' });
    this.broadcast({ type: 'player_update', player });
    return { ok: true, characterId, seatId };
  }

  /** Logout when parking is refused (mid-fight): keep the seat as dropped, off this connection. */
  releaseConnection(connectionId: string): string | undefined {
    const characterId = this.connectionContexts.get(connectionId)?.characterId;
    if (!characterId) return undefined;
    const seatId = `dropped:${characterId}`;
    if (!this.rekeySeat(connectionId, seatId)) return undefined;
    this.markDisconnected(seatId);
    return seatId;
  }

  isParked(characterId: string): boolean {
    return this.presence.get(`parked:${characterId}`) === 'parked';
  }

  getParkedRoomName(characterId: string): string | null {
    if (!this.isParked(characterId)) return null;
    const player = this.playerManager.getPlayer(`parked:${characterId}`);
    return player ? this.rooms.get(player.roomId)?.name ?? null : null;
  }

  resumeParked(characterId: string, newConnectionId: string): boolean {
    if (!this.isParked(characterId)) return false;
    return this.reattachConnection(`parked:${characterId}`, newConnectionId);
  }
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `cmd.exe /c "cd server && npx vitest run src/GameSession.park.test.ts src/GameSession.reattach.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS.

---

### Task 5: Leave run with toll

**Files:**
- Modify: `server/src/PlayerManager.ts`, `server/src/GameSession.ts`
- Test: `server/src/GameSession.park.test.ts` (append)

**Interfaces:**
- Consumes:
  - Task 1: `LeaveRunToll`, `LOOT_CONFIG.leaveRunTollGold`, `party_member_left`;
  - Task 4: `stepAwayBlocker`.
- Produces:
  - `PlayerManager.removePlayer(id)`;
  - `GameSession.leaveRun(id, toll): Promise<{ ok: true; characterId: string; remainingSeats: number } | { ok: false; reason: string }>`.

- [ ] **Step 1: Write the failing tests** (append to `GameSession.park.test.ts`):

```ts
describe('GameSession leaveRun', () => {
  const potion = (n: number) => ({ id: 'potion', name: `Potion ${n}`, slot: 'consumable', rarity: 'common', stats: {} }) as any;

  it('pays 25 gold and removes the seat', async () => {
    const { session, s, messages } = createParkSession();
    s.playerManager.getPlayer('p1').gold = 30;
    const res = await session.leaveRun('p1', { kind: 'gold' });
    expect(res).toEqual({ ok: true, characterId: 'char-p1', remainingSeats: 1 });
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.findSeatByCharacter('char-p1')).toBeUndefined();
    expect(messages.some((m) => m.msg.type === 'party_member_left' && m.msg.playerId === 'p1')).toBe(true);
  });

  it('refuses gold it cannot pay', async () => {
    const { session, s } = createParkSession();
    s.playerManager.getPlayer('p1').gold = 24;
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: false, reason: 'You need 25 gold.' });
  });

  it('takes only the chosen pouch slot', async () => {
    const { session, s } = createParkSession();
    const p = s.playerManager.getPlayer('p1');
    p.consumables = [potion(0), null, potion(2), null, null, null];
    let snap: any;
    s.snapshotPlayer = async (id: string) => { snap = JSON.parse(JSON.stringify(s.playerManager.getPlayer(id))); };
    await session.leaveRun('p1', { kind: 'item', source: 'consumables', index: 2 });
    expect(snap.consumables.map((c: any) => c?.name ?? null)).toEqual(['Potion 0', null, null, null, null, null]);
  });

  it('rejects an empty or out-of-range slot', async () => {
    const { session } = createParkSession();
    expect(await session.leaveRun('p1', { kind: 'item', source: 'inventory', index: 99 }))
      .toEqual({ ok: false, reason: 'There is no item in that slot.' });
  });

  it('allows free only when nothing is payable', async () => {
    const { session, s } = createParkSession();
    const p = s.playerManager.getPlayer('p1');
    p.gold = 0; p.inventory = p.inventory.map(() => null); p.consumables = [potion(0), null, null, null, null, null];
    expect(await session.leaveRun('p1', { kind: 'free' })).toEqual({ ok: false, reason: 'You can still pay the toll.' });
    p.consumables = p.consumables.map(() => null);
    expect((await session.leaveRun('p1', { kind: 'free' })).ok).toBe(true);
  });

  it('is refused in a fight and reports zero seats left for a solo run', async () => {
    const { session, s } = createParkSession(['p1']);
    s.playerManager.getPlayer('p1').gold = 100;
    s.playerManager.setStatus('p1', 'in_combat');
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: false, reason: "You can't do that during a fight." });
    s.playerManager.setStatus('p1', 'exploring');
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: true, characterId: 'char-p1', remainingSeats: 0 });
  });

  it('a parked survivor keeps the run alive when the present party is downed', () => {
    const { session, s } = createParkSession();
    session.park('p2');
    s.playerManager.setStatus('p1', 'downed');
    expect(s.playerManager.allPlayersDowned()).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `cmd.exe /c "cd server && npx vitest run src/GameSession.park.test.ts"`
  Expected: FAIL (`leaveRun` is not a function).

- [ ] **Step 3: Implement.**
  - **`PlayerManager`:** add after `replacePlayerId`:

```ts
  removePlayer(id: string): void {
    this.players.delete(id);
  }
```

  - **`GameSession` imports:** add `type LeaveRunToll,` to the `@caverns/shared` import list. Confirm that `LOOT_CONFIG` is already imported (it is).
  - **`GameSession` methods:** add after `resumeParked`:

```ts
  /** Escape the run while exploring, paying the toll. The caller returns the player to the world. */
  async leaveRun(
    connectionId: string,
    toll: LeaveRunToll,
  ): Promise<{ ok: true; characterId: string; remainingSeats: number } | { ok: false; reason: string }> {
    const blocker = this.stepAwayBlocker(connectionId);
    if (blocker) return { ok: false, reason: blocker };
    const player = this.playerManager.getPlayer(connectionId)!;
    const characterId = this.connectionContexts.get(connectionId)?.characterId;
    if (!characterId) return { ok: false, reason: 'This seat has no character.' };
    const tollGold = LOOT_CONFIG.leaveRunTollGold;
    const canPayGold = player.gold >= tollGold;
    const hasItem = player.inventory.some(Boolean) || player.consumables.some(Boolean);
    let paid: string;
    switch (toll.kind) {
      case 'gold':
        if (!canPayGold) return { ok: false, reason: `You need ${tollGold} gold.` };
        this.playerManager.addGold(connectionId, -tollGold);
        paid = `${tollGold} gold`;
        break;
      case 'item': {
        const slots = toll.source === 'inventory' ? player.inventory : player.consumables;
        const item = Number.isInteger(toll.index) ? slots[toll.index] : undefined;
        if (!item) return { ok: false, reason: 'There is no item in that slot.' };
        slots[toll.index] = null;
        paid = item.name;
        break;
      }
      case 'free':
        if (canPayGold || hasItem) return { ok: false, reason: 'You can still pay the toll.' };
        paid = 'nothing';
        break;
      default:
        return { ok: false, reason: 'Unknown toll.' };
    }
    await this.snapshotPlayer(connectionId);
    this.broadcast({ type: 'text_log', message: `${player.name} slips away through the portal, leaving ${paid} behind.`, logType: 'system' });
    this.broadcast({ type: 'party_member_left', playerId: connectionId });
    this.removeSeat(connectionId);
    return { ok: true, characterId, remainingSeats: this.playerIds.length };
  }

  /** Drop a seat from the run entirely (escape). Its character is already saved. */
  private removeSeat(connectionId: string): void {
    const player = this.playerManager.getPlayer(connectionId);
    if (!player) return;
    this.roomGrids.get(player.roomId)?.removeEntity(connectionId);
    this.mobAIManager.removePlayer(player.roomId, connectionId);
    const goldTimer = this.goldWriteTimers.get(connectionId);
    if (goldTimer) clearTimeout(goldTimer);
    const characterId = this.connectionContexts.get(connectionId)?.characterId;
    if (characterId) this.activeSessions?.detachCharacter(characterId);
    for (const m of [this.connectionContexts, this.playerGridPositions, this.playerNames, this.playerClasses,
      this.presence, this.goldWriteTimers, this.lastGridMove, this.hydratedPlayers] as Map<string, unknown>[]) {
      m.delete(connectionId);
    }
    this.playerIds = this.playerIds.filter((id) => id !== connectionId);
    this.playerManager.removePlayer(connectionId);
  }
```

  - **Check the snapshot fields.** Confirm that `characterSnapshotFromPlayer` (in `server/src/characterAdapter.ts`) includes `gold`, `inventory` and `consumables`; it does at lines 53–55. The snapshot therefore records the toll.

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `cmd.exe /c "cd server && npx vitest run src/GameSession.park.test.ts src/PlayerManager.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS.

---

### Task 6: `WorldSession` per-member return and handle sync

**Files:**
- Modify: `server/src/WorldSession.ts`
- Test: `server/src/WorldSession.test.ts` (append inside the top-level `describe('WorldSession', …)`)

**Interfaces:**
- Produces:
  - `updateOutboundConnection(sessionId, characterId, connectionId): void`;
  - `returnMemberFromDungeon(sessionId, characterId, connectionId): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (append before the final `});` of the top-level describe):

```ts
  describe('per-member dungeon return', () => {
    const member = (c: string) => ({
      connectionId: c, accountId: `acc_${c}`, characterId: `char_${c}`, displayName: c,
      characterName: `Char${c}`, className: 'vanguard', level: 1,
    });

    it('returns only the leaving member and keeps the handle for the rest', async () => {
      session.registerOutboundDungeon({ sessionId: 'd1', portalId: 'p', portalPos: { x: 3, y: 4 }, party: [member('c1'), member('c2')] });
      await session.returnMemberFromDungeon('d1', 'char_c1', 'c1');
      expect(session.getMembers().map((m) => m.connectionId)).toEqual(['c1']);
      expect(session.getMembers()[0].pos).toEqual({ x: 3, y: 4 });
      expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c1', { x: 3, y: 4 });
      expect(session.outboundDungeonCount()).toBe(1);
      await session.returnMemberFromDungeon('d1', 'char_c2', 'c2');
      expect(session.outboundDungeonCount()).toBe(0);
    });

    it('updateOutboundConnection makes a reconnected member return on run end', async () => {
      session.registerOutboundDungeon({ sessionId: 'd1', portalId: 'p', portalPos: { x: 3, y: 4 }, party: [member('c1')] });
      session.updateOutboundConnection('d1', 'char_c1', 'c9');
      await session.returnFromDungeon('d1', new Set(['c9']));
      expect(session.getMembers().map((m) => m.connectionId)).toEqual(['c9']);
      expect(sendTo).toHaveBeenCalledWith('c9', { type: 'dungeon_returned' });
    });
  });
```

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `cmd.exe /c "cd server && npx vitest run src/WorldSession.test.ts"`
  Expected: FAIL (`returnMemberFromDungeon` is not a function).

- [ ] **Step 3: Implement.** In `returnFromDungeon`, replace the second `for (const p of handle.party)` loop body with a call to a new private helper, and add the two public methods:

```ts
    for (const p of handle.party) {
      if (!activeConnIds.has(p.connectionId)) continue;
      this.admitFromDungeon(p, pos);
    }
    if (this.members.size > 0 && this.tickHandle === undefined) this.startTickLoop();
  }

  /** A member's seat moved to a new connection (reconnect, park, resume); return that one at run end. */
  updateOutboundConnection(sessionId: string, characterId: string, connectionId: string): void {
    const member = this.outboundDungeons.get(sessionId)?.party.find((p) => p.characterId === characterId);
    if (member) member.connectionId = connectionId;
  }

  /** One member leaves the run early (escape); the rest stay out until the run ends. */
  async returnMemberFromDungeon(sessionId: string, characterId: string, connectionId: string): Promise<void> {
    const handle = this.outboundDungeons.get(sessionId);
    if (!handle) return;
    const idx = handle.party.findIndex((p) => p.characterId === characterId);
    if (idx < 0) return;
    const [p] = handle.party.splice(idx, 1);
    if (handle.party.length === 0) this.outboundDungeons.delete(sessionId);
    try {
      await this.characterRepo.snapshotOverworldPos(characterId, handle.portalPos);
    } catch (e) {
      console.error('[WorldSession] snapshot on member return failed', e);
    }
    this.admitFromDungeon({ ...p, connectionId }, handle.portalPos);
    if (this.members.size > 0 && this.tickHandle === undefined) this.startTickLoop();
  }

  private admitFromDungeon(p: DungeonPartyMember, pos: { x: number; y: number }): void {
    const member: WorldSessionMember = {
      connectionId: p.connectionId,
      accountId: p.accountId,
      characterId: p.characterId,
      displayName: p.displayName,
      characterName: p.characterName,
      className: p.className,
      level: p.level,
      pos: { ...pos },
      path: [],
    };
    this.members.set(p.connectionId, member);
    this.sendTo(p.connectionId, { type: 'dungeon_returned' });
    this.sendTo(p.connectionId, {
      type: 'world_state',
      worldId: this.worldId,
      worldName: this.worldName,
      map: this.map,
      members: this.getMembers(),
    });
    this.broadcast(
      { type: 'world_member_joined', member: this.toSummary(member) },
      p.connectionId,
    );
  }
```

  (Remove the old inline member-building code that `admitFromDungeon` now contains. `returnFromDungeon` keeps its snapshot loop and its `outboundDungeons.delete`.)

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `cmd.exe /c "cd server && npx vitest run src/WorldSession.test.ts src/WorldSession.integration.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS.

---

### Task 7: Server wiring in `index.ts`

**Files:**
- Modify: `server/src/CharacterRepository.ts`, `server/src/CharacterRepository.test.ts`, `server/src/index.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4–6.
- Produces:
  - the client messages `park_run` and `leave_run`, handled on the server;
  - `select_character` resumes parked characters;
  - `character_list` carries `parkedRun`.

- [ ] **Step 1: Write the failing repository test** (append inside the `describe.skipIf(...)('CharacterRepository', …)` block, using the file's existing helpers for creating an account and characters; read the top of the file for their names):

```ts
  it('clearInUseForAccount keeps the listed characters locked', async () => {
    const a = await makeCharacter('A');   // use the file's existing character factory
    const b = await makeCharacter('B');
    await repo.markInUse(a.id, true);
    await repo.markInUse(b.id, true);
    await repo.clearInUseForAccount(a.account_id, [a.id]);
    expect((await repo.getById(a.id))!.in_use).toBe(true);
    expect((await repo.getById(b.id))!.in_use).toBe(false);
  });
```

  This suite is skipped without `DATABASE_URL`. If no database is available, confirm it compiles with `tsc` and record "skipped: no DATABASE_URL" in the report.

- [ ] **Step 2: Implement the repository change.** In `CharacterRepository.ts`:

```ts
  /** Release stranded in_use locks for an account, except characters still seated in a run. */
  async clearInUseForAccount(accountId: string, keepIds: string[] = []): Promise<number> {
    let q = this.db.updateTable('characters')
      .set({ in_use: false })
      .where('account_id', '=', accountId)
      .where('in_use', '=', true);
    if (keepIds.length > 0) q = q.where('id', 'not in', keepIds);
    const result = await q.executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
```

- [ ] **Step 3: Add the helpers to `index.ts`,** after `getGameSession`:

```ts
/** Move a run seat onto this connection: reconnect after a drop, or resume a parked character. */
function attachToRun(inst: DungeonInstance, seatId: string, connId: string, characterId: string): boolean {
  if (!inst.gameSession.reattachConnection(seatId, connId)) return false;
  inst.connections.delete(seatId);
  inst.connections.add(connId);
  dungeonConnections.delete(seatId);
  dungeonConnections.set(connId, inst.sessionId);
  if (!seatId.includes(':')) clients.delete(seatId); // a dropped socket; placeholders were never clients
  const ctx = connectionAccounts.get(connId);
  if (ctx) ctx.characterId = characterId;
  worldSessionManager.getSession(inst.worldId)?.updateOutboundConnection(inst.sessionId, characterId, connId);
  sendTo(connId, { type: 'dungeon_entered', dungeonSessionId: inst.sessionId });
  return true;
}

/** Take this connection out of its run's routing (park / logout); the seat itself stays in the run. */
function detachConnectionFromRun(inst: DungeonInstance, connId: string, characterId: string, seatId: string): void {
  inst.connections.delete(connId);
  dungeonConnections.delete(connId);
  worldSessionManager.getSession(inst.worldId)?.updateOutboundConnection(inst.sessionId, characterId, seatId);
}

function parkedRunFor(characterId: string): { roomName: string } | null {
  const sessionId = activeSessions.getByCharacter(characterId);
  const roomName = sessionId ? dungeonInstances.get(sessionId)?.gameSession.getParkedRoomName(characterId) : null;
  return roomName ? { roomName } : null;
}
```

  Check: `worldSessionManager`, `clients` and `activeSessions` are declared above this point. If any is declared later, move these helpers below that declaration (function declarations are hoisted; only the `const`s must be initialised before a call).

- [ ] **Step 4: `sendCharacterListForWorld`:** change the `sendToWs` line to:

```ts
  sendToWs(ws, { type: 'character_list', characters: list.map((row) => ({ ...toSummary(row), parkedRun: parkedRunFor(row.id) })) });
```

- [ ] **Step 5: `resume_session`.**
  - Replace the `existingSessionId` block (from the comment `// If there's no active game session…` through the `clearInUseForAccount` call) with:

```ts
        // Release stranded in_use locks, except characters still seated in a run.
        const runs = activeSessions.listForAccount(info.accountId);
        try { await characterRepo.clearInUseForAccount(info.accountId, runs.map((r) => r.characterId)); } catch (e) { console.error(e); }
```

  - Replace the whole `// Reconnection reattach to an active run.` block with:

```ts
        // Reconnection: go back into a run whose seat dropped. Parked seats wait for character select.
        for (const run of runs) {
          const inst = dungeonInstances.get(run.sessionId);
          const seat = inst?.gameSession.findSeatByCharacter(run.characterId);
          if (!inst || !seat || !inst.gameSession.isDisconnected(seat)) continue;
          if (attachToRun(inst, seat, playerId, run.characterId)) break;
        }
```

- [ ] **Step 6: `select_character`.** After the world check (`if (!ctx.selectedWorldId || ch.world_id !== …) { … break; }`) and before `if (ch.in_use)`, add:

```ts
        // Resume a parked character straight into its run.
        const runInst = dungeonInstances.get(activeSessions.getByCharacter(ch.id) ?? '');
        if (runInst?.gameSession.isParked(ch.id)) {
          if (ctx.characterId) {
            sendTo(playerId, { type: 'error', message: 'Leave the world before resuming another character.' });
            break;
          }
          attachToRun(runInst, `parked:${ch.id}`, playerId, ch.id);
          break;
        }
```

- [ ] **Step 7: The new cases.** Add next to `leave_world`:

```ts
      case 'park_run': {
        const ctx = connectionAccounts.get(playerId);
        const inst = getDungeonInstance(playerId);
        if (!ctx || !inst) break;
        const res = inst.gameSession.park(playerId);
        if (!res.ok) {
          sendTo(playerId, { type: 'error', message: res.reason });
          break;
        }
        detachConnectionFromRun(inst, playerId, res.characterId, res.seatId);
        ctx.characterId = undefined; // the run keeps the character's in_use lock
        sendTo(playerId, { type: 'run_parked' });
        await sendCharacterListForWorld(ws, ctx.accountId, ctx.selectedWorldId);
        break;
      }

      case 'leave_run': {
        const inst = getDungeonInstance(playerId);
        if (!inst) break;
        const res = await inst.gameSession.leaveRun(playerId, msg.toll);
        if (!res.ok) {
          sendTo(playerId, { type: 'error', message: res.reason });
          break;
        }
        inst.connections.delete(playerId);
        dungeonConnections.delete(playerId);
        const worldSession = worldSessionManager.getSession(inst.worldId);
        if (worldSession) {
          await worldSession.returnMemberFromDungeon(inst.sessionId, res.characterId, playerId);
          worldConnections.set(playerId, inst.worldId);
        }
        if (res.remainingSeats === 0) {
          inst.gameSession.dispose();
          activeSessions.detachSession(inst.sessionId);
          dungeonInstances.delete(inst.sessionId);
        }
        break;
      }
```

- [ ] **Step 8: `logout`.** Replace the case body with:

```ts
      case 'logout': {
        const ctx = connectionAccounts.get(playerId);
        const inst = getDungeonInstance(playerId);
        if (ctx?.characterId && inst) {
          // The run keeps the seat: parked if possible, otherwise dropped (mid-fight) until reconnect.
          const parked = inst.gameSession.park(playerId);
          const seatId = parked.ok ? parked.seatId : inst.gameSession.releaseConnection(playerId);
          if (seatId) detachConnectionFromRun(inst, playerId, ctx.characterId, seatId);
          ctx.characterId = undefined; // the run keeps the character's in_use lock
        }
        await detachFromWorldSession(playerId);
        if (ctx) {
          if (ctx.characterId && characterRepo) {
            try { await characterRepo.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
          }
          if (sessionStore) {
            try { await sessionStore.delete(ctx.sessionToken); } catch (e) { console.error(e); }
          }
        }
        connectionAccounts.delete(playerId);
        break;
      }
```

- [ ] **Step 9: Typecheck and run the full server suite.**
  Run: `cmd.exe /c "cd server && npx tsc --noEmit -p . && npx vitest run"`
  Expected: all pass; `CharacterRepository` is skipped without a database.

---

### Task 8: Client store and actions

**Files:**
- Modify: `client/src/store/gameStore.ts`, `client/src/hooks/useGameActions.ts`
- Test: `client/src/store/gameStore.parkRun.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's messages.
- Produces:
  - the store handles `run_parked`, `party_member_left` and `seat_rekeyed`;
  - `actions.parkRun(): void`;
  - `actions.leaveRun(toll: LeaveRunToll): void`.

- [ ] **Step 1: Write the failing test** — `client/src/store/gameStore.parkRun.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, selectCurrentView } from './gameStore.js';

const player = (id: string, name: string) => ({ id, name, roomId: 'r1', hp: 10, maxHp: 10, status: 'exploring' }) as any;

describe('gameStore park-run messages', () => {
  beforeEach(() => {
    useGameStore.setState({
      authStatus: 'authenticated', connectionStatus: 'in_game', playerId: 'p1',
      players: { p1: player('p1', 'Alice'), p2: player('p2', 'Bob') },
      playerPositions: { p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } },
      rooms: { r1: { id: 'r1' } as any }, currentRoomId: 'r1', currentWorld: null,
    } as any);
  });

  it('run_parked leaves the dungeon for character select', () => {
    useGameStore.getState().handleServerMessage({ type: 'run_parked' });
    const s = useGameStore.getState();
    expect(s.connectionStatus).toBe('connected');
    expect(s.players).toEqual({});
    expect(s.exploredTiles.size).toBe(0);
    expect(selectCurrentView(s)).toBe('character_select');
  });

  it('party_member_left drops the seat', () => {
    useGameStore.getState().handleServerMessage({ type: 'party_member_left', playerId: 'p2' });
    const s = useGameStore.getState();
    expect(s.players.p2).toBeUndefined();
    expect(s.playerPositions.p2).toBeUndefined();
  });

  it('seat_rekeyed renames the seat', () => {
    useGameStore.getState().handleServerMessage({ type: 'seat_rekeyed', oldId: 'p2', newId: 'parked:c2' });
    const s = useGameStore.getState();
    expect(s.players['parked:c2']?.name).toBe('Bob');
    expect(s.players['parked:c2']?.id).toBe('parked:c2');
    expect(s.playerPositions['parked:c2']).toEqual({ x: 2, y: 2 });
    expect(s.players.p2).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  Run: `cmd.exe /c "cd client && npx vitest run src/store/gameStore.parkRun.test.ts"`
  Expected: FAIL (the state is unchanged).

- [ ] **Step 3: Implement the store cases,** next to `case 'dungeon_returned':`:

```ts
      case 'run_parked':
        // Seat parked in the run; the character list that follows shows character select.
        set({
          currentDungeonSessionId: null,
          connectionStatus: 'connected',
          currentWorld: null,
          worldMap: null,
          players: {},
          rooms: {},
          currentRoomId: '',
          playerPositions: {},
          mobPositions: {},
          exploredTiles: new Set<string>(),
          activeCombat: null,
          pendingLoot: null,
          gameOver: null,
          textLog: [],
        });
        break;

      case 'party_member_left':
        set((state) => {
          const players = { ...state.players };
          const playerPositions = { ...state.playerPositions };
          delete players[msg.playerId];
          delete playerPositions[msg.playerId];
          return { players, playerPositions };
        });
        break;

      case 'seat_rekeyed':
        set((state) => {
          const players = { ...state.players };
          const playerPositions = { ...state.playerPositions };
          const seat = players[msg.oldId];
          if (seat) { delete players[msg.oldId]; players[msg.newId] = { ...seat, id: msg.newId }; }
          const pos = playerPositions[msg.oldId];
          if (pos) { delete playerPositions[msg.oldId]; playerPositions[msg.newId] = pos; }
          return { players, playerPositions };
        });
        break;
```

  If `tsc` reports that a field in the `run_parked` reset (e.g. `mobPositions`) has a different name in `GameStore`, use the store's actual field name; the `game_start` case shows the dungeon fields.

- [ ] **Step 4: Add the actions** in `useGameActions.ts` next to `leaveWorld`:

```ts
    parkRun: () => send({ type: 'park_run' }),
    leaveRun: (toll: LeaveRunToll) => send({ type: 'leave_run', toll }),
```

  Import `type LeaveRunToll` from `@caverns/shared`, alongside the file's existing shared imports.

- [ ] **Step 5: Run the test and typecheck.**
  Run: `cmd.exe /c "cd client && npx vitest run src/store/gameStore.parkRun.test.ts && npx tsc --noEmit -p ."`
  Expected: PASS.

---

### Task 9: Client UI

**Files:**
- Create: `client/src/components/RunControls.tsx`, `client/src/components/LeaveRunModal.tsx`
- Modify: `client/src/components/ActionBar.tsx`, `client/src/App.tsx`, `client/src/components/CharacterSlotCard.tsx`, `client/src/components/PartyPanel.tsx`, `client/src/styles/index.css`

**Interfaces:**
- Consumes: Task 8 (`actions.parkRun`, `actions.leaveRun`); Task 1 (`CharacterSummary.parkedRun`, `Player.away`, `LOOT_CONFIG.leaveRunTollGold`).

- [ ] **Step 1: `LeaveRunModal.tsx`:**

```tsx
import { LOOT_CONFIG, type Item, type LeaveRunToll, type Player } from '@caverns/shared';
import { MenuConsole, RelicButton, ItemIcon } from './relic/index.js';
import { ScreenTransition } from './ScreenTransition.js';

interface Props {
  player: Player;
  open: boolean;
  onPay: (toll: LeaveRunToll) => void;
  onClose: () => void;
}

/** The toll for escaping a run: gold, one carried item, or free when neither is possible. */
export function LeaveRunModal({ player, open, onPay, onClose }: Props) {
  const tollGold = LOOT_CONFIG.leaveRunTollGold;
  const canPayGold = player.gold >= tollGold;
  const carried: { source: 'inventory' | 'consumables'; index: number; item: Item }[] = [
    ...player.inventory.flatMap((item, index) => (item ? [{ source: 'inventory' as const, index, item }] : [])),
    ...player.consumables.flatMap((item, index) => (item ? [{ source: 'consumables' as const, index, item }] : [])),
  ];
  const free = !canPayGold && carried.length === 0;
  return (
    <ScreenTransition screenKey={open ? 'leave-run' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {open && (
        <MenuConsole title="Leave run" width="520px" className="leave-run-modal" footer={<RelicButton onClick={onClose}>Stay</RelicButton>}>
          <p className="leave-run-copy">The portal takes a toll. You keep everything else you found.</p>
          {free ? (
            <RelicButton hot onClick={() => onPay({ kind: 'free' })}>Leave (you have nothing to pay)</RelicButton>
          ) : (
            <>
              <RelicButton hot disabled={!canPayGold} onClick={() => onPay({ kind: 'gold' })}
                title={canPayGold ? undefined : `You need ${tollGold} gold.`}>
                Pay {tollGold} gold
              </RelicButton>
              {carried.length > 0 && <div className="leave-run-label">…or leave an item:</div>}
              <div className="leave-run-items">
                {carried.map(({ source, index, item }) => (
                  <RelicButton key={`${source}-${index}`} size="sm" onClick={() => onPay({ kind: 'item', source, index })}>
                    <ItemIcon item={item} size={20} /> {item.name}
                  </RelicButton>
                ))}
              </div>
            </>
          )}
        </MenuConsole>
      )}
    </ScreenTransition>
  );
}
```

  Match the import paths to the ones used by `CharacterModal.tsx`. Its `ScreenTransition` / `MenuConsole` imports are authoritative: if they come from different modules than written above, use theirs. Likewise check `ItemIcon`'s props against its use in `ActionBar.tsx`.

- [ ] **Step 2: `RunControls.tsx`:**

```tsx
import { useState } from 'react';
import type { LeaveRunToll, Player } from '@caverns/shared';
import { RelicButton } from './relic/index.js';
import { LeaveRunModal } from './LeaveRunModal.js';

interface Props {
  player: Player;
  lootPending: boolean;
  onPark: () => void;
  onLeave: (toll: LeaveRunToll) => void;
}

/** Park the character or escape the run. Exploring only; the server re-checks every rule. */
export function RunControls({ player, lootPending, onPark, onLeave }: Props) {
  const [leaving, setLeaving] = useState(false);
  const blocked = player.status === 'downed' ? "You can't do that while downed."
    : lootPending ? 'Finish the loot roll first.' : undefined;
  return (
    <div className="run-controls">
      <RelicButton size="sm" disabled={!!blocked} title={blocked}
        onClick={() => { if (confirm(`Park ${player.name} here? You can resume from character select.`)) onPark(); }}>
        Park
      </RelicButton>
      <RelicButton size="sm" tone="danger" disabled={!!blocked} title={blocked} onClick={() => setLeaving(true)}>
        Leave run
      </RelicButton>
      <LeaveRunModal player={player} open={leaving} onClose={() => setLeaving(false)}
        onPay={(toll) => { setLeaving(false); onLeave(toll); }} />
    </div>
  );
}
```

- [ ] **Step 3: `ActionBar.tsx`.**
  - Add `onParkRun: () => void;` and `onLeaveRun: (toll: LeaveRunToll) => void;` to `ActionBarProps`, and destructure them.
  - Import `RunControls` and `type LeaveRunToll`.
  - Replace the tail from `if (downedInRoom.length === 0) return null;` to the end of the component with:

```tsx
  return (
    <div className="action-bar explore-bar">
      {downedInRoom.length > 0 && (
        <div className="revive-actions">
          {downedInRoom.map((ally) => (
            <RelicButton key={ally.id} onClick={() => onRevive(ally.id)}>
              Revive {ally.name}
            </RelicButton>
          ))}
        </div>
      )}
      <RunControls player={player} lootPending={!!pendingLoot} onPark={onParkRun} onLeave={onLeaveRun} />
    </div>
  );
```

  `ActionBar` renders only outside combat: `App.tsx` shows the arena bar during a fight. So the buttons are hidden in combat without extra checks.

- [ ] **Step 4: `App.tsx`:** pass `onParkRun={actions.parkRun}` and `onLeaveRun={actions.leaveRun}` to `<ActionBar>`.

- [ ] **Step 5: `CharacterSlotCard.tsx`.** Replace the Resume button and the preceding meta line with:

```tsx
      {character.parkedRun && <div className="char-slot-meta char-slot-parked">Parked in {character.parkedRun.roomName}</div>}
      <div className="char-slot-actions">
        {character.parkedRun ? (
          <RelicButton hot onClick={() => onResume(character.id)}>In run: Resume</RelicButton>
        ) : (
          <RelicButton hot={!character.inUse} onClick={() => onResume(character.id)} disabled={character.inUse}>
            {character.inUse ? 'In use' : 'Resume'}
          </RelicButton>
        )}
```

  Keep the existing Delete button after it, inside the same `char-slot-actions` div. Keep the `{character.gold}g · last …` meta line above the new `parkedRun` line.

- [ ] **Step 6: `PartyPanel.tsx`.**
  - Give the member row `className={`party-member${player.away ? ' party-member--away' : ''}`}`.
  - After the name span inside `party-member-header`, add `{player.away && <span className="party-away">away</span>}`.

- [ ] **Step 7: CSS** (append to `client/src/styles/index.css`; keep the existing effects, colour only):

```css
/* Park / leave run */
.explore-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.run-controls { display: flex; gap: 8px; margin-left: auto; }
.leave-run-copy { color: var(--text-dim, #9fb8a0); margin: 0 0 12px; }
.leave-run-label { color: var(--text-dim, #9fb8a0); margin: 12px 0 6px; }
.leave-run-items { display: flex; flex-wrap: wrap; gap: 6px; }
.char-slot-parked { color: #d8b25a; }
.party-member--away { opacity: 0.55; }
.party-away { color: #d8b25a; font-size: 0.8em; margin-left: 6px; text-transform: uppercase; letter-spacing: 0.08em; }
```

  Replace `var(--text-dim, …)` with the stylesheet's existing dim-text variable if it uses a different name. Search for `--text` in `index.css`.

- [ ] **Step 8: Typecheck and run the client tests.**
  Run: `cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"`
  Expected: PASS.

---

### Task 10: End-to-end verification and docs

**Files:**
- Create: `.sandbox/charbug/park.mjs` (git-ignored)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Restart the dev game server** with the new code:
  - kill the PID listening on 3001: `cmd.exe /c "netstat -ano"` | grep `:3001` … `taskkill /F /T /PID <pid>`;
  - start `cmd.exe /c "cd server && npx tsx --env-file=../.env src/index.ts --sandbox"` in the background, **without watch** (`tsx watch` hangs on this machine);
  - Vite should already be serving on :5173.

- [ ] **Step 2: Write `.sandbox/charbug/park.mjs`.** Copy the login/create/enter-dungeon preamble and the WS capture from `.sandbox/charbug/repro.mjs` (lines 1–27). Then script these checks, logging PASS/FAIL for each and saving a screenshot per step to `.sandbox/charbug/park-<n>.png`:
  1. **Park.** In the dungeon, click `.run-controls` "Park", accept the confirm (`page.on('dialog', d => d.accept())`). Expect `run_parked` received and `.char-slot` visible. The first card reads "In run: Resume" and has the `Parked in` line.
  2. **Switch character.** Create character B and resume it. Expect `.town-services`, then open the character panel (the town character button). Expect `character_panel_opened` and no `character_panel_error`.
  3. **Resume the parked character.** Leave the world (the town's leave button), then click A's "In run: Resume". Expect `game_start` and `.main-screen .room-area`, and the same `currentRoomId` as before parking.
  4. **Leave run with the gold toll.** Give A gold first via `debug_give_item` if needed, or read gold from the latest `player_update`. Click "Leave run", then "Pay 25 gold". Expect `dungeon_returned` then `world_state`, and gold 25 lower in the next character list or panel.
  5. **Parking refused in a fight.** Re-enter a run, `debug_reveal_all`, then `debug_teleport` into encounter rooms until `.arena-view` appears (as in `combat-resume.mjs`). Send `{type:'park_run'}` over `window.__lastWS`. Expect `error` "You can't do that during a fight."
  6. **Reload outside a fight still auto-resumes.** Leave the fight (or use a new run), reload, and expect `.main-screen .room-area` with no character select in between.

- [ ] **Step 3: Run it.**
  Run: `cmd.exe /c "node .sandbox/charbug/park.mjs"`
  Expected: 6 PASS lines, and no page errors other than the known AudioContext / WS-close warnings. View the screenshots to confirm the card, buttons and modal render in CRT style.

- [ ] **Step 4: Update `CLAUDE.md`.**
  - **What's Working:** add a bullet: "Park character: Park (exploring only) seats the character as `parked:<characterId>` in its run, and character select shows 'In run: Resume'. Leave run escapes for a toll of `LOOT_CONFIG.leaveRunTollGold` gold or one item. Mobs ignore away seats. Runs are tracked per character (`ActiveSessionMap`)."
  - **What's Not Built Yet:** replace "No reconnection handling" with "Reconnect/resume is in-memory only (a server restart ends runs)".
  - **Message Protocol:** add `park_run` and `leave_run` to Client → Server, and `run_parked`, `party_member_left` and `seat_rekeyed` to Server → Client.

- [ ] **Step 5: Run the full suites.**
  Run: `cmd.exe /c "cd shared && npx vitest run" && cmd.exe /c "cd server && npx tsc --noEmit -p . && npx vitest run" && cmd.exe /c "cd client && npx tsc --noEmit -p . && npx vitest run"`
  Expected: all green.
