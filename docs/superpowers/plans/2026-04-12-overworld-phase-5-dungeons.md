# Overworld Phase 5 — Dungeon Portals & Party Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Stepping onto a portal tile with a party creates a dungeon `GameSession` instance, transfers the party's connections into it, runs the dungeon to completion, and returns surviving characters to the overworld at the portal tile. This phase also retires the dead legacy lobby-code flow, because its replacement (portal entry) is now live.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Depends on:** Phase 4 (`docs/superpowers/plans/2026-04-12-overworld-phase-4-movement.md`) — characters can walk to a portal tile under their own power. `WorldSession` owns positions, `overworld_pos` persistence works.

**Ships alone. Do not bundle with anything else.** This phase is where the previously-painful bugs (`stuck in_use`, stale `playerRoom`, orphaned `GameSession`) all try to come back. It gets its own PR, its own focused review, and its own explicit test list.

---

## Decisions locked in this phase

1. **Party formation model: portal muster.** Players who want to enter a dungeon walk onto a portal tile and press "Ready." Any world member standing on the same portal tile with Ready status is part of the muster. When any party member clicks "Enter Dungeon," the party is locked and the instance spawns. This avoids a separate party-management UI and reuses walking + clicking for grouping.
2. **Ready state is per-portal, not global.** Walking off a portal clears your Ready state. Only members currently on the same portal tile are part of that muster. No out-of-range party formation.
3. **Solo entry is allowed.** A party of one — Ready + Enter — spawns an instance just like a multi-person party.
4. **Non-party members can still see the portal and start their own muster on it.** Two parties muster-and-enter on the same portal → two independent `GameSession` instances. The portal is not a shared lock; it's just a tile.
5. **Characters in a dungeon remain "in the world" for bookkeeping.** `WorldSession` teardown must refuse while any origin `GameSession` is still alive. Members in a dungeon are removed from `members` but tracked in a new `outboundDungeons: Map<sessionId, DungeonHandle>` on the `WorldSession`.
6. **Connection state: `in_world` → `in_dungeon` → `in_world`.** The `currentView` state machine from Phase 2 finally exercises `in_dungeon`. Dungeon entry removes the connection from `worldConnections`; dungeon exit re-adds it.
7. **On dungeon end, characters return to the portal tile.** Victory, wipe, flee — all three outcomes return the party to the overworld at the portal tile. Characters persist whatever loot/XP they earned (existing snapshot machinery).
8. **Disconnect mid-dungeon: character stays in the dungeon.** Mirror existing behavior — the player's connection is dropped, but their `Player` state inside `GameSession` persists. If they reconnect while the dungeon is still alive, they rejoin via `reattachConnection` (existing code path). If the dungeon ends while they're disconnected, their character is snapshotted and released as today, and the next time they log in they enter the overworld at the portal tile.
9. **No party chat scoping this phase.** Dungeon chat is broadcast within the `GameSession` as today; world chat is broadcast within `WorldSession`. A party entering a dungeon simply stops seeing world chat until they return. No cross-scope messaging.
10. **Legacy lobby flow is retired in this phase.** `rooms`, `playerRoom`, `join_lobby`, `start_game`, the old `Lobby.tsx`, and the `in_lobby` view case all get deleted in one pass. The new entry point is the portal muster. This cleanup is its own task (Task 10) and happens only after portal entry is working end-to-end.
11. **Dungeon generation uses existing code as-is.** The handoff constructs a `GameSession` exactly as `start_game` did today, passing through the same dungeon generator. No generator changes in Phase 5.
12. **API key and difficulty: deferred.** The old `start_game` flow let the host paste an API key and pick difficulty. Phase 5 removes that path. Dungeons spawned from portals use the default procedural generator with hardcoded medium difficulty; API-key-driven generation is a Phase 5.5 concern if the user still wants it. Flag this loudly during Task 10.

---

## File structure

### New files

**Server:**
- `server/src/WorldSession.integration.test.ts` — end-to-end tests for enter → wipe → re-enter → disconnect mid-dungeon → reconnect. Uses the real `GameSession` plus stubbed sockets.

### Modified files

**Shared:**
- `shared/src/messages.ts` — add `portal_ready`, `portal_unready`, `portal_enter`, `portal_muster_update`, `dungeon_entered`, `dungeon_returned`; remove `join_lobby`, `start_game`, `set_difficulty`, `lobby_state`, `set_ready` (legacy lobby ready toggle — not the portal ready)

**Server:**
- `server/src/WorldSession.ts` — muster state per portal, `outboundDungeons` map, `enterDungeon` method that creates a `GameSession` and hands off connections, `returnFromDungeon` method called by the dungeon's `onGameOver` hook, updated teardown rule
- `server/src/WorldSession.test.ts` — add muster tests, enter/return tests
- `server/src/GameSession.ts` — add `originWorldId` and `originPortal` fields, passed in at construction; `endGame` calls `onGameOver` with enough context for the caller to route returning connections back to the origin WorldSession
- `server/src/index.ts` — new message handlers for `portal_ready` / `portal_unready` / `portal_enter`, `in_dungeon` bookkeeping in `worldConnections`, reconnect flow routes to dungeon first and overworld second, **delete** legacy lobby handlers in Task 10
- `server/src/Lobby.ts` — **delete** in Task 10
- `server/src/PlayerManager.ts` — no change expected

**Client:**
- `client/src/components/WorldMapView.tsx` — when standing on a portal, show a muster panel overlay (ready button, party list, enter button)
- `client/src/components/Lobby.tsx` — **delete** in Task 10
- `client/src/store/gameStore.ts` — track `currentPortalMuster: PortalMusterState | null`; handle new portal messages; `dungeon_entered` transitions to `in_dungeon`; `dungeon_returned` transitions back to `in_world`
- `client/src/hooks/useGameActions.ts` — `portalReady()`, `portalUnready()`, `portalEnter()` senders; **delete** legacy senders in Task 10
- `client/src/App.tsx` — `in_dungeon` case renders the existing game layout (unchanged); `in_lobby` case deleted in Task 10

### Files to actively delete (Task 10)

- `server/src/Lobby.ts`
- `server/src/Lobby.test.ts` if it exists
- `client/src/components/Lobby.tsx`
- All references to `rooms`, `playerRoom`, `getRoom`, `destroyRoom`, `roomBroadcast` in `server/src/index.ts`
- `join_lobby`, `start_game`, `set_difficulty`, `set_ready`, `lobby_state` message handlers
- `in_lobby` view case in `App.tsx` and the store

---

## Task list

### Task 1: `GameSession` origin context

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Constructor takes origin**

Extend the constructor args (after the existing ones) with:

```ts
origin?: {
  worldId: string;
  portalId: string;
  portalPos: { x: number; y: number };
}
```

Store as `private readonly origin?`. This is the breadcrumb the `WorldSession` uses to route returning connections.

- [ ] **Step 2: `endGame` path invokes `onGameOver` with origin**

Today `onGameOver` is a zero-arg callback. Change to pass the origin (or `undefined`):

```ts
private onGameOver?: (origin?: GameSessionOrigin) => void;
```

Every call to `this.onGameOver?.()` becomes `this.onGameOver?.(this.origin)`. If no origin (legacy path — won't exist after Task 10, but during the transitional period it might), the caller falls back to today's behavior.

- [ ] **Step 3: No other `GameSession` behavior changes**

Combat, movement, loot, wipe — all unchanged. Dungeon runs exactly as today. The only difference is it now knows where it came from.

### Task 2: `WorldSession` muster state

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Per-portal muster tracking**

```ts
private musters = new Map<string /* portalId */, Set<string /* connectionId */>>();
```

Helper:

```ts
private getPortalAt(pos: { x: number; y: number }): OverworldPortal | undefined {
  return this.map.portals.find(p => p.x === pos.x && p.y === pos.y);
}
```

- [ ] **Step 2: Ready / unready methods**

```ts
setReadyAtPortal(connectionId: string): 'ok' | 'not_on_portal' | 'not_member' {
  const member = this.members.get(connectionId);
  if (!member) return 'not_member';
  const portal = this.getPortalAt(member.pos);
  if (!portal) return 'not_on_portal';

  let muster = this.musters.get(portal.id);
  if (!muster) { muster = new Set(); this.musters.set(portal.id, muster); }
  muster.add(connectionId);
  this.broadcastMuster(portal.id);
  return 'ok';
}

setUnreadyAtPortal(connectionId: string): void {
  for (const [portalId, set] of this.musters) {
    if (set.delete(connectionId)) {
      if (set.size === 0) this.musters.delete(portalId);
      this.broadcastMuster(portalId);
    }
  }
}
```

- [ ] **Step 3: Auto-unready on walk-away**

In `tick()`, after advancing a member, check: if the member is in any muster set and their new position is not on the portal that muster belongs to, remove them from that muster and `broadcastMuster(portalId)`. This enforces decision 2 (ready state is per-portal).

- [ ] **Step 4: `broadcastMuster` payload**

```ts
private broadcastMuster(portalId: string): void {
  const set = this.musters.get(portalId) ?? new Set();
  const readyMembers: WorldMemberSummary[] = [];
  for (const connId of set) {
    const m = this.members.get(connId);
    if (m) readyMembers.push(toSummary(m));
  }
  this.broadcast({
    type: 'portal_muster_update',
    portalId,
    readyMembers,
  });
}
```

### Task 3: `WorldSession.enterDungeon`

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: `enterDungeon` method**

```ts
async enterDungeon(requesterConnectionId: string): Promise<'ok' | 'not_on_portal' | 'not_ready' | 'not_member'> {
  const member = this.members.get(requesterConnectionId);
  if (!member) return 'not_member';
  const portal = this.getPortalAt(member.pos);
  if (!portal) return 'not_on_portal';

  const muster = this.musters.get(portal.id);
  if (!muster || !muster.has(requesterConnectionId)) return 'not_ready';

  // Snapshot party member ids (copy — muster set is about to be cleared)
  const partyConnIds = [...muster];
  this.musters.delete(portal.id);
  this.broadcastMuster(portal.id); // tells remaining members the muster is gone

  // Build the dungeon
  const dungeon = generateProceduralDungeon(3);
  const broadcastToDungeon = this.makeDungeonBroadcast();
  const gameSession = new GameSession(
    broadcastToDungeon,
    this.sendTo,
    dungeon,
    (origin) => this.returnFromDungeon(gameSession.sessionId, origin),
    { worldId: this.worldId, portalId: portal.id, portalPos: { x: portal.x, y: portal.y } }
  );

  // Add players and transfer connections
  const partyMembers: WorldSessionMember[] = [];
  for (const connId of partyConnIds) {
    const m = this.members.get(connId);
    if (!m) continue;
    gameSession.addPlayer(connId, m.characterName, m.className);
    // TODO: hydrate character snapshot into the GameSession Player here
    // (existing character snapshot machinery — this is the "enter dungeon
    // with gear intact" path)
    partyMembers.push(m);
  }

  // Register the outbound dungeon BEFORE removing members so teardown check is safe
  this.outboundDungeons.set(gameSession.sessionId, {
    sessionId: gameSession.sessionId,
    portalId: portal.id,
    portalPos: { x: portal.x, y: portal.y },
    memberIds: new Set(partyConnIds),
    gameSession,
  });

  // Remove party members from WorldSession.members WITHOUT snapshotting position
  // (they're not leaving the world — their position should be fixed at the portal
  // when they return, not wherever they last stepped)
  for (const m of partyMembers) {
    this.members.delete(m.connectionId);
    // worldConnections update happens in the caller (index.ts) so the
    // connection-level registry stays consistent.
  }

  // Notify remaining world members that the party disappeared into the portal
  for (const m of partyMembers) {
    this.broadcast({ type: 'world_member_left', connectionId: m.connectionId, characterId: m.characterId });
  }

  // Send each party member the transition signal
  for (const connId of partyConnIds) {
    this.sendTo(connId, { type: 'dungeon_entered', dungeonSessionId: gameSession.sessionId });
  }

  // Kick off the dungeon
  gameSession.startGame();

  return 'ok';
}
```

Call sites for `worldConnections.delete(connId)` + `dungeonConnections.set(connId, sessionId)` live in `index.ts` at the handler level — `WorldSession` doesn't own that registry.

- [ ] **Step 2: `makeDungeonBroadcast` helper**

Returns a broadcast function that sends only to connections currently tracked in the `outboundDungeons` entry for the new session. The registration in Step 1 happens before any broadcasts, so this works as long as `startGame` is called after the `set`.

- [ ] **Step 3: Expose a way to look up outbound dungeons**

```ts
getOutboundDungeon(sessionId: string): DungeonHandle | undefined;
hasOutboundDungeon(sessionId: string): boolean;
```

Used by `index.ts` when a connection needs to be routed into an existing dungeon (reconnect path).

### Task 4: `WorldSession.returnFromDungeon`

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Handle the callback**

Triggered by `GameSession.onGameOver`. Responsibilities:

```ts
private async returnFromDungeon(sessionId: string, origin?: GameSessionOrigin): Promise<void> {
  const handle = this.outboundDungeons.get(sessionId);
  if (!handle) {
    console.warn('[WorldSession] returnFromDungeon: no handle for', sessionId);
    return;
  }
  this.outboundDungeons.delete(sessionId);

  const returnPos = handle.portalPos;

  for (const connId of handle.memberIds) {
    // Determine who's still connected and needs to be re-added
    // The GameSession has already snapshotted characters via its endGame
    // path. We need to re-fetch the latest row to hydrate position + gear.
    const ctx = connectionContextLookup(connId); // supplied by index.ts
    if (!ctx?.characterId) continue;

    const ch = await this.characterRepo.getById(ctx.characterId);
    if (!ch) continue;

    // Force position to the portal regardless of saved overworld_pos
    // (saved position might be stale)
    const member: WorldSessionMember = {
      connectionId: connId,
      accountId: ctx.accountId,
      characterId: ch.id,
      displayName: ctx.displayName,
      characterName: ch.name,
      className: ch.class,
      level: ch.level,
      pos: returnPos,
      path: [],
    };

    this.members.set(connId, member);
    this.sendTo(connId, { type: 'dungeon_returned', worldId: this.worldId });
    this.sendTo(connId, {
      type: 'world_state',
      worldId: this.worldId,
      worldName: this.worldName,
      map: this.map,
      members: this.getMembers(),
    });
    this.broadcast({ type: 'world_member_joined', member: toSummary(member) });
  }

  // Tick loop: if the WorldSession had torn down while the dungeon was
  // running, this handler would be a no-op because the WorldSession
  // wouldn't exist. That's why teardown refuses while outboundDungeons
  // is non-empty — Task 5.
}
```

The `connectionContextLookup` dependency is awkward — `WorldSession` doesn't own `connectionAccounts`. Two options:
- (a) Add a `(connId: string) => ConnectionContext | undefined` function to `WorldSessionDeps`.
- (b) Have `index.ts` handle the return by subscribing to a simpler callback and doing the work there.

**Pick (a).** It keeps the return-flow logic inside `WorldSession` where the lifecycle invariants live.

### Task 5: Teardown rule update

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Refuse teardown while outbound dungeons exist**

```ts
async removeConnection(connectionId: string): Promise<'destroyed' | 'still_active'> {
  // ... existing snapshot + removal
  if (this.members.size === 0 && this.outboundDungeons.size === 0) {
    await this.snapshot();
    this.stopTickLoop();
    return 'destroyed';
  }
  return 'still_active';
}
```

- [ ] **Step 2: Tick loop behavior when only dungeons remain**

If all members are in dungeons (members.size === 0 but outboundDungeons.size > 0), the tick loop has no work to do. Two options:
- (a) Stop the tick loop and restart it when a member returns
- (b) Let it run no-op 4 times per second

**Pick (a).** It keeps the idle-worlds-cost-nothing invariant. Add `startTickLoop()` to the `returnFromDungeon` path when the first member returns.

### Task 6: Shared message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add**

```ts
// Client → server
| { type: 'portal_ready' }
| { type: 'portal_unready' }
| { type: 'portal_enter' }

// Server → client
| { type: 'portal_muster_update'; portalId: string; readyMembers: WorldMemberSummary[] }
| { type: 'dungeon_entered'; dungeonSessionId: string }
| { type: 'dungeon_returned'; worldId: string }
```

- [ ] **Step 2: Mark for removal (do in Task 10)**

Comment-flag legacy messages for deletion: `join_lobby`, `start_game`, `set_difficulty`, `set_ready` (the lobby ready, not portal ready), `lobby_state`. Don't delete yet.

### Task 7: Server routing

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: `portal_ready` / `portal_unready` handlers**

```ts
case 'portal_ready': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const result = session.setReadyAtPortal(playerId);
  if (result !== 'ok') sendTo(playerId, { type: 'error', message: `Cannot ready: ${result}` });
  break;
}
case 'portal_unready': {
  const session = getWorldSession(playerId);
  if (!session) break;
  session.setUnreadyAtPortal(playerId);
  break;
}
```

- [ ] **Step 2: `portal_enter` handler**

```ts
case 'portal_enter': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const result = await session.enterDungeon(playerId);
  if (result !== 'ok') {
    sendTo(playerId, { type: 'error', message: `Cannot enter: ${result}` });
    break;
  }
  // The members who entered are no longer in the WorldSession.
  // Update worldConnections and dungeonConnections registries.
  // `enterDungeon` already emitted `dungeon_entered` per member.
  // Track them in a new Map:
  //   dungeonConnections: Map<connectionId, { worldId, dungeonSessionId }>
  break;
}
```

- [ ] **Step 3: Add `dungeonConnections` registry**

```ts
const dungeonConnections = new Map<string, { worldId: string; dungeonSessionId: string }>();
```

Alongside `worldConnections`. The `enterDungeon` handler needs to know which connections moved into a dungeon so the close/logout paths can route correctly.

Cleanest flow: `WorldSession.enterDungeon` returns the list of entered connection IDs; the `index.ts` handler moves them out of `worldConnections` and into `dungeonConnections`.

- [ ] **Step 4: Update `ws.on('close')`**

```ts
ws.on('close', async () => {
  clients.delete(playerId);

  const dungeonInfo = dungeonConnections.get(playerId);
  if (dungeonInfo) {
    // Disconnect from the GameSession, not from WorldSession.
    // Character stays inside the dungeon. Existing GameSession logic
    // handles disconnect — AFK, party-wipe detection, etc.
    dungeonConnections.delete(playerId);
    // Do NOT release in_use — the character is mid-run.
    return;
  }

  const worldSession = getWorldSession(playerId);
  if (worldSession) {
    const result = await worldSession.removeConnection(playerId);
    worldConnections.delete(playerId);
    if (result === 'destroyed') worldSessionManager.unregisterSession(worldSession.worldId);
  }

  // Release in_use (same as existing behavior)
  releaseCharacterLock(playerId);
});
```

The in-dungeon disconnect path preserves existing GameSession behavior. The in-world disconnect path goes through `WorldSession.removeConnection` as in Phase 2.

- [ ] **Step 5: Update `resume_session`**

Priority order when resuming:

1. If the account has a dungeon connection tied to it via `activeSessions`, reattach to that `GameSession` via `reattachConnection` — existing code. Connection is in `in_dungeon`.
2. Else if the account's characters belong to a world and a `WorldSession` exists for it, attach to that world — Phase 2 behavior.
3. Else land in character select — existing behavior.

This means a user who disconnected mid-dungeon and reconnects goes straight back into combat. A user who disconnected in the overworld returns to the overworld. Both must work.

### Task 8: `GameSession` construction via portal

**Files:**
- Modify: `server/src/WorldSession.ts` (the `enterDungeon` method)

- [ ] **Step 1: Match existing `start_game` dungeon construction**

Look at the current `start_game` handler in `index.ts` for the exact sequence used to build a `GameSession`. Replicate it inside `enterDungeon`:

- Construct dungeon via `generateProceduralDungeon(3)` (or today's default medium-difficulty call).
- `new GameSession(broadcast, sendTo, dungeon, onGameOver, origin)`.
- Call `gameSession.addPlayer(id, name, className)` for each party member.
- Call `gameSession.startGame()`.

- [ ] **Step 2: Character snapshot hydration**

The existing `start_game` path hydrates characters from their DB rows into `Player` state before `startGame` runs. Replicate that here — without it, characters enter dungeons without their gear. Read the existing code path carefully; this is the exact spot where a one-line oversight silently breaks the whole feature.

- [ ] **Step 3: API key path removed**

The existing `start_game` had an API-key-driven generator branch. Portal entry does not expose an API key input. Default to the procedural generator. The user was explicitly told this was deferred in Decision 12.

### Task 9: Client-side portal UX

**Files:**
- Modify: `client/src/components/WorldMapView.tsx`
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Store state**

```ts
currentPortalMuster: {
  portalId: string;
  readyMembers: WorldMemberSummary[];
} | null;
```

Handle `portal_muster_update`: set `currentPortalMuster` when the logged-in player is standing on that portal, else ignore. "Standing on" is derived from the local `worldMembers[self].pos` vs. the portal coordinates.

- [ ] **Step 2: Actions**

```ts
portalReady: () => send({ type: 'portal_ready' }),
portalUnready: () => send({ type: 'portal_unready' }),
portalEnter: () => send({ type: 'portal_enter' }),
```

- [ ] **Step 3: Muster panel overlay**

When `self.pos` equals a portal's coordinates:
- Render a floating panel over the map showing:
  - Portal label (e.g., "Dungeon Entrance")
  - Ready status for self (button: Ready / Unready)
  - Ready members list (name · Lv · class)
  - "Enter Dungeon" button — disabled unless self is ready
- The panel auto-closes when self walks off the portal.

No new screen — it's an overlay component rendered inside `WorldMapView`.

- [ ] **Step 4: Handle `dungeon_entered`**

Transitions `currentView` to `in_dungeon` via the state machine recompute. Store drops all overworld state *except* the bookkeeping that tells the client "we came from a world" (a new `originWorldId: string | null` field), so the eventual `dungeon_returned` can re-open the world view cleanly without starting from scratch.

- [ ] **Step 5: Handle `dungeon_returned`**

Transitions back to `in_world`. Re-request `world_state` from the server — or rely on the server's follow-up `world_state` send in `returnFromDungeon` (Task 4 Step 1 already sends one).

- [ ] **Step 6: Existing game layout unchanged**

`currentView === 'in_dungeon'` renders the existing `game-layout` JSX from `App.tsx` (the combat/exploration side-by-side). No changes to the in-dungeon rendering.

### Task 10: Retire legacy lobby flow

**Files:**
- Delete: `server/src/Lobby.ts`, `server/src/Lobby.test.ts`
- Delete: `client/src/components/Lobby.tsx`
- Modify: `server/src/index.ts` — remove `rooms`, `playerRoom`, `getRoom`, `destroyRoom`, `roomBroadcast`, `join_lobby`, `start_game`, `set_difficulty`, `set_ready` handlers
- Modify: `client/src/App.tsx` — remove `in_lobby` case, remove `<Lobby>` import
- Modify: `client/src/store/gameStore.ts` — remove `in_lobby` view, remove `roomCode`, `lobbyPlayers`, `lobbyDifficulty`, `isHost`, `lobby_state` handler
- Modify: `client/src/hooks/useGameActions.ts` — remove `joinLobby`, `startGame`, `setDifficulty`, `setReady`
- Modify: `shared/src/messages.ts` — remove flagged message types

- [ ] **Step 1: Gate this task on portal entry working**

Do NOT start Task 10 until the end-to-end smoke test in Task 11 passes without the legacy flow being involved. The legacy code is a known-good fallback during development. Once portal entry is functional, delete it in one commit.

- [ ] **Step 2: Delete in one pass**

After gating, do every deletion above in one change. Half-deletion leaves a minefield of type errors.

- [ ] **Step 3: Recompile everything**

`npm run build` across all workspaces. Fix any dangling imports. Search for `'join_lobby'` / `'start_game'` / `lobbyPlayers` / `Lobby` across the codebase to catch stragglers.

### Task 11: Integration tests

**Files:**
- Create: `server/src/WorldSession.integration.test.ts`

- [ ] **Step 1: Enter and victory**

Spin up a real `WorldSession` + real `GameSession`. Stub dungeon content to force a victory on turn 1 (or mock the dungeon generator to return a trivial one-room dungeon). Assertions:
- Before entry: `worldSession.members.has(connId)` is true
- After `enterDungeon`: `worldSession.members.has(connId)` is false, `outboundDungeons.size === 1`
- After victory callback: `outboundDungeons.size === 0`, `worldSession.members.has(connId)` is true, `member.pos` equals the portal tile
- `worldSession.removeConnection(connId)` after return returns `'destroyed'` when it's the last member

- [ ] **Step 2: Enter and wipe**

Same setup but force a wipe. Assertions:
- After wipe: same state as victory — returned to overworld at portal. The character's HP may be 0 / downed; that's a separate concern.

- [ ] **Step 3: Teardown refusal**

- Create world with two members A and B
- A enters dungeon
- B disconnects (removeConnection)
- Expected: `removeConnection` returns `'still_active'` (because `outboundDungeons.size === 1`); tick loop stops; WorldSession stays registered
- A's dungeon ends
- Expected: `returnFromDungeon` fires; A is re-added; tick loop restarts
- A then disconnects
- Expected: `removeConnection` returns `'destroyed'`; session cleaned up

- [ ] **Step 4: Disconnect mid-dungeon**

- A and B in world
- A and B enter dungeon
- A disconnects mid-run
- Expected: `dungeonConnections.delete(A)`, A's `Player` state persists inside the `GameSession`, `outboundDungeons` still tracks A's membership
- B continues playing solo
- B wins
- Expected: `returnFromDungeon` fires for B; A is absent from the world (they're logged out); A's character is snapshotted and `in_use` released via `endGame`
- A reconnects via `resume_session`
- Expected: A lands in `in_world` at the portal tile (not reattaching to a dead dungeon)

This is the most load-bearing test. If this passes, Phase 5 is genuinely done.

- [ ] **Step 5: Two parties on one portal**

- World with three members: A, B, C
- A and B muster on portal X, enter (party 1)
- C later walks onto portal X, readys, enters solo (party 2)
- Both instances exist simultaneously, `outboundDungeons.size === 2`
- Party 1 wins → A and B return
- Party 2 wins → C returns
- All three back in the world at portal X

### Task 12: Smoke test

- [ ] **Step 1: Solo portal run**

1. Enter world → walk onto portal → Ready → Enter → play through dungeon → win → return to overworld at portal.
2. Check character's loot survived the return.

- [ ] **Step 2: Party portal run**

1. Two tabs → both walk onto portal → both Ready → tab 1 Enter.
2. Both tabs transition to dungeon view, both complete the dungeon, both return.
3. Muster UX on tab 2 after tab 1 readies: shows tab 1 in the ready list.

- [ ] **Step 3: Walk-off auto-unready**

1. Ready on portal → walk one tile away → Ready status clears; muster panel disappears.

- [ ] **Step 4: Concurrent parties**

1. Three tabs → party A (tabs 1 + 2) enters portal → party B (tab 3) musters and enters the same portal solo.
2. Both instances run. Both return independently.

- [ ] **Step 5: Mid-dungeon disconnect**

1. Solo enter dungeon → hard-close tab → server logs should not tear down the WorldSession.
2. Reopen → resume session → expect to reattach to the dungeon (not the world).
3. Finish dungeon → return to overworld at portal.

---

## Known rough edges accepted in Phase 5

- **API key driven dungeon generation is gone.** Phase 5.5 if needed.
- **Difficulty selection is gone.** Portal entry hardcodes medium (or whatever today's default is). Add a difficulty dropdown to the muster panel in Phase 5.5.
- **No party invite / kick.** Muster is walk-in, walk-out.
- **No visible "dungeon active on this portal" indicator to bystanders.** Nice-to-have, deferred.
- **No reconnect UI polish.** When a mid-dungeon reconnect lands, the user jumps straight into combat with no "welcome back" beat. Acceptable for v1.
- **No world snapshot on portal entry.** Exiting members don't persist their overworld position (they're returning to the portal anyway). World-level flags don't change on entry — no snapshot needed.

---

## Open questions to resolve during implementation

1. **`sessionId` uniqueness for `GameSession`.** Does today's `GameSession` already have a `sessionId` field? If not, add one in Task 1 (uuid at construction). `WorldSession.outboundDungeons` keys on it.
2. **Connection context lookup.** Task 4 Step 1 punts on how `WorldSession` reaches `connectionAccounts`. Pick (a) — pass a lookup function into `WorldSessionDeps`. Don't let this turn into a cross-file reach.
3. **Character re-hydration on dungeon entry.** The existing `start_game` flow hydrates Player state from character rows. Replicating this inside `enterDungeon` is the single riskiest line of the entire feature — read the existing code and port it faithfully. If the hydration is currently a free function, reuse the function directly. If it's inlined in `start_game`, extract it to a helper *first*, then call the helper from both places. Do the extraction in a prep commit before Task 8.
4. **`in_use` lock timing.** The lock is set on `select_character` and released on `endGame` (old flow). In the new flow: lock is still acquired on `select_character`; it must *not* be released when transitioning from world to dungeon (character is still in use); it *must* be released when the character leaves the world entirely (logout, disconnect from world-only state, end of game after wipe with no return). Walk through every state transition and make sure the lock tracks. Write a dedicated test.

---

## Done when

- All tasks checked off.
- `npm run test -w server` passes, including `WorldSession.integration.test.ts`.
- `npm run build` in all workspaces is clean.
- Task 12 smoke test scenarios all pass end-to-end in the browser.
- Legacy lobby code is deleted. Grep for `join_lobby`, `startGame`, `lobbyPlayers`, `Lobby.tsx` returns no stale references.
- Zero reports of stuck-`in_use` across the five integration test scenarios.
- Two parties on the same portal run independently without interfering.
- Disconnect mid-dungeon → reconnect → land back in the dungeon (not the world).
- Disconnect mid-dungeon → dungeon ends while disconnected → reconnect → land in the world at the portal tile.
