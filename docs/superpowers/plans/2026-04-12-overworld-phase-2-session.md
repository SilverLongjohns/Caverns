# Overworld Phase 2 — WorldSession Lifecycle & State Machine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Introduce an empty-but-lifecycle-correct `WorldSession` server class, route world members into it after character select, and replace the implicit client state machine in `App.tsx` with an explicit `currentView` that can represent `in_world` as a distinct state. No map, no movement, no interactions — just "you and your party are in world X together" with a stub view showing the member list.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Depends on:** Phase 1 (`docs/superpowers/plans/2026-04-12-overworld-phase-1-schema.md`) — worlds table, `WorldRepository`, world-select UI, `ctx.selectedWorldId` on the connection context, `characters.world_id` binding.

**Ships with Phase 1 in one PR.** Do not cut a release between them.

---

## Decisions locked in this phase

1. **`WorldSession` is a new class, not a subclass of `GameSession` or `Lobby`.** Parallel, not hierarchical.
2. **World sessions are lazy.** Spin up on first member join, tear down on last leaver. First-join hydration reads from DB; last-leave snapshot writes to DB even though Phase 2 has no dynamic state to persist yet (plumbing for Phase 3+).
3. **Explicit client state machine.** Replace today's branching on `authStatus` + `connectionStatus` + `gameOver` + `generationStatus` with an explicit `currentView` enum in the store. Rendering in `App.tsx` becomes a single switch on `currentView`.
4. **Old lobby flow is NOT retired this phase.** It continues to work exactly as today so existing gameplay isn't broken. Phase 5 retires it once dungeon entry moves onto portal tiles. In Phase 2, a character who has selected a world routes into `WorldSession`; there is no path from `WorldSession` to the old lobby (that's a Phase 5 concern).
5. **Stub WorldView.** Phase 2's `WorldView` component renders: world name, member list (online + total), a "Leave World" button that returns to world select, and nothing else. No map, no sprites, no tiles. Phase 3 replaces the body.
6. **`in_dungeon` exists in the state machine but is unused in Phase 2.** Define the state so Phase 5's handoff doesn't have to reshape the enum; leave all transitions into/out of it as TODO comments.
7. **No connection transfer between sessions in Phase 2.** A connection is attached to either a `WorldSession` OR the legacy lobby room, chosen at `select_character` time based on whether the character's `world_id` matches the connection's `selectedWorldId`. Since Phase 1 enforces that they always match, in practice every character-select goes into a `WorldSession`. The legacy lobby path is dead-but-present code.
8. **Teardown rule for Phase 2:** `members.size === 0`. The Phase 5 invariant (`&& outboundDungeons.size === 0`) is added when Phase 5 lands. Leave a comment pointing at it.

---

## File structure

### New files

**Server:**
- `server/src/WorldSession.ts` — the session class
- `server/src/WorldSession.test.ts` — lifecycle tests
- `server/src/worldSessionManager.ts` — module-level `Map<worldId, WorldSession>` + `getOrCreate` / `destroy` helpers (mirrors the `rooms` map pattern from `index.ts`, but hoisted out of `index.ts` to keep that file from growing further)

**Client:**
- `client/src/components/WorldView.tsx` — stub view: world name, member list, leave button

### Modified files

**Shared:**
- `shared/src/messages.ts` — new messages: `enter_world`, `leave_world`, `world_state`, `world_member_joined`, `world_member_left`. Define `WorldMemberSummary` type.

**Server:**
- `server/src/index.ts` — on `select_character`, after existing validation, route the connection into a `WorldSession` via `worldSessionManager.getOrCreate(worldId)`. On `ws.on('close')` and `logout`, detach from the WorldSession. Handle new `leave_world` message.
- `server/src/CharacterRepository.ts` — no change expected; `getById` + `snapshot` are already in place from earlier work.

**Client:**
- `client/src/App.tsx` — replace the cascading `else if` with a single switch on `currentView`. Add a `WorldView` branch.
- `client/src/store/gameStore.ts` — add `currentView: ClientView` state, compute it from existing auth/world/character/lobby state during message handling, add handlers for new world messages.
- `client/src/hooks/useGameActions.ts` — add `leaveWorld()` sender. `enter_world` is sent automatically on successful `select_character` server-side; the client does not call it directly.

### Files NOT touched in Phase 2

- `server/src/GameSession.ts` — not world-aware yet
- `server/src/Lobby.ts` — the old lobby keeps working unchanged
- Any tile rendering, movement, or overworld map code

---

## Task list

### Task 1: `worldSessionManager`

**Files:**
- Create: `server/src/worldSessionManager.ts`

- [ ] **Step 1: Module-level registry**

```ts
import type { WorldSession } from './WorldSession.js';

const sessions = new Map<string, WorldSession>();

export function getSession(worldId: string): WorldSession | undefined {
  return sessions.get(worldId);
}

export function registerSession(session: WorldSession): void {
  sessions.set(session.worldId, session);
}

export function unregisterSession(worldId: string): void {
  sessions.delete(worldId);
}

export function allSessions(): IterableIterator<WorldSession> {
  return sessions.values();
}
```

Kept as separate functions (not a class) so Phase 5 can easily add a `findByOriginPortal` helper without a refactor.

### Task 2: `WorldSession` skeleton

**Files:**
- Create: `server/src/WorldSession.ts`

- [ ] **Step 1: Define the class**

```ts
import type { ServerMessage, WorldMemberSummary } from '@caverns/shared';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

export interface WorldSessionMember {
  connectionId: string;
  accountId: string;
  characterId: string;
  displayName: string;
  characterName: string;
  className: string;
  level: number;
}

export interface WorldSessionDeps {
  worldId: string;
  worldName: string;
  worldRepo: WorldRepository;
  characterRepo: CharacterRepository;
  broadcast: (msg: ServerMessage) => void;
  sendTo: (connectionId: string, msg: ServerMessage) => void;
}

export class WorldSession {
  readonly worldId: string;
  readonly worldName: string;
  private members = new Map<string, WorldSessionMember>();
  private worldRepo: WorldRepository;
  private characterRepo: CharacterRepository;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (connectionId: string, msg: ServerMessage) => void;

  constructor(deps: WorldSessionDeps) { /* assign */ }

  async addConnection(member: WorldSessionMember): Promise<void>;
  async removeConnection(connectionId: string): Promise<'destroyed' | 'still_active'>;
  hasMember(connectionId: string): boolean;
  memberCount(): number;
  getMembers(): WorldMemberSummary[];

  private async snapshot(): Promise<void>;
  private async hydrate(): Promise<void>;
}
```

- [ ] **Step 2: `addConnection` implementation**

1. If `members.size === 0`, call `await this.hydrate()` first (loads world row, member character positions, etc. — no-op for Phase 2 but the call must be in place).
2. Insert the member into `this.members`.
3. `this.sendTo(connectionId, { type: 'world_state', ... })` — send the joining client the full world state snapshot (world name, member summary list).
4. `this.broadcast({ type: 'world_member_joined', member: summary })` — tell everyone else. Note: broadcast here must skip the joining client so they don't double-receive; if the existing `broadcast` helper doesn't support exclusion, add a second arg or use `sendTo` loops.

- [ ] **Step 3: `removeConnection` implementation**

1. If not a member, return `'still_active'`.
2. Delete from `this.members`.
3. Broadcast `world_member_left { connectionId, characterId }`.
4. If `this.members.size === 0`: `await this.snapshot()`, return `'destroyed'`. Caller is responsible for `unregisterSession(this.worldId)`.
5. Otherwise return `'still_active'`.

- [ ] **Step 4: `hydrate` + `snapshot` stubs**

```ts
private async hydrate(): Promise<void> {
  // Phase 2: nothing to load. Phase 3 reads the authored map;
  // Phase 4+ loads per-character positions and world state.
  // Phase 5 invariant: check for abandoned dungeon instances
  // belonging to this world and refuse teardown if present.
}

private async snapshot(): Promise<void> {
  // Phase 2: nothing to persist. Phase 4+ writes positions;
  // Phase 5+ writes world.state jsonb.
}
```

Leave detailed Phase 3/4/5 TODO comments inside each method pointing at the future work.

### Task 3: `WorldSession` tests

**Files:**
- Create: `server/src/WorldSession.test.ts`

- [ ] **Step 1: Lifecycle tests**

With stubbed `worldRepo`, `characterRepo`, `broadcast`, `sendTo`:

- Creating a session and calling `addConnection` sends `world_state` to the joiner.
- Adding a second connection broadcasts `world_member_joined` to the first (verify exclusion works).
- `removeConnection` on the last member returns `'destroyed'` and broadcasts `world_member_left`.
- `removeConnection` on a non-last member returns `'still_active'`.
- `removeConnection` on a non-member is a no-op that returns `'still_active'`.
- `memberCount` and `getMembers` return correct shapes.

No DB involvement required — pure unit tests with mocked deps. (Do not use the real `testDb` here; this is a fast pure test.)

### Task 4: Shared message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add `WorldMemberSummary` type**

```ts
export interface WorldMemberSummary {
  connectionId: string;
  characterId: string;
  characterName: string;
  displayName: string;
  className: string;
  level: number;
}
```

- [ ] **Step 2: Add server messages**

```ts
| { type: 'world_state'; worldId: string; worldName: string; members: WorldMemberSummary[] }
| { type: 'world_member_joined'; member: WorldMemberSummary }
| { type: 'world_member_left'; connectionId: string; characterId: string }
```

- [ ] **Step 3: Add client messages**

```ts
| { type: 'leave_world' }
```

No `enter_world` client message — server routes automatically on `select_character`.

### Task 5: Server routing

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Import manager and class**

```ts
import { WorldSession } from './WorldSession.js';
import * as worldSessionManager from './worldSessionManager.js';
```

- [ ] **Step 2: Update `select_character`**

After the existing validation (character exists, belongs to account, matches selected world, not `in_use`), and after `markInUse(true)`:

```ts
const world = await worldRepo.getById(ctx.selectedWorldId);
if (!world) { sendTo(playerId, { type: 'world_error', reason: 'World not found' }); break; }

let session = worldSessionManager.getSession(world.id);
if (!session) {
  session = new WorldSession({
    worldId: world.id,
    worldName: world.name,
    worldRepo,
    characterRepo,
    broadcast: roomBroadcastByWorld(world.id), // new helper — broadcasts to all connections in this session
    sendTo,
  });
  worldSessionManager.registerSession(session);
}

await session.addConnection({
  connectionId: playerId,
  accountId: ctx.accountId,
  characterId: ch.id,
  displayName: ctx.displayName,
  characterName: ch.name,
  className: ch.class,
  level: ch.level,
});
```

Note: `select_character` currently *also* may attach the character to a legacy lobby entry. In Phase 2, remove the legacy attach call — any connection that reaches `select_character` goes into a `WorldSession` instead. The old lobby flow is reached through a different path (`join_lobby`) which Phase 2 does not touch; that path is reachable via the deprecated code but no UI will navigate to it.

- [ ] **Step 3: Add `worldConnections: Map<connectionId, worldId>` registry**

Mirror `playerRoom` for WorldSessions — a reverse lookup so `ws.on('close')` and `logout` can find which WorldSession a connection belongs to. Add helper:

```ts
function getWorldSession(connectionId: string): WorldSession | undefined {
  const worldId = worldConnections.get(connectionId);
  return worldId ? worldSessionManager.getSession(worldId) : undefined;
}
```

On `addConnection` success in Step 2, `worldConnections.set(playerId, world.id)`. On removal, delete.

- [ ] **Step 4: `leave_world` handler**

```ts
case 'leave_world': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const result = await session.removeConnection(playerId);
  worldConnections.delete(playerId);
  if (result === 'destroyed') worldSessionManager.unregisterSession(session.worldId);

  // Release the character's in_use lock (mirrors logout path)
  const ctx = connectionAccounts.get(playerId);
  if (ctx?.characterId && characterRepo) {
    try { await characterRepo.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
    ctx.characterId = undefined;
  }

  // Send the client back to character select
  if (ctx?.selectedWorldId) {
    const chars = await characterRepo.listForWorld(ctx.accountId, ctx.selectedWorldId);
    sendTo(playerId, { type: 'character_list', characters: chars.map(toSummary) });
  }
  break;
}
```

- [ ] **Step 5: Update `ws.on('close')`**

Before the existing legacy-lobby cleanup, add:

```ts
const worldSession = getWorldSession(playerId);
if (worldSession) {
  const result = await worldSession.removeConnection(playerId);
  worldConnections.delete(playerId);
  if (result === 'destroyed') worldSessionManager.unregisterSession(worldSession.worldId);
}
```

Release the character's `in_use` lock via the same path as today's close handler — WorldSession membership alone should not keep the character locked after disconnect.

- [ ] **Step 6: Update `logout`**

Same pattern as `leave_world` — detach from WorldSession first, then run the existing logout cleanup (session delete, in_use release, `connectionAccounts.delete`). The existing logout cleanup stays intact.

- [ ] **Step 7: `roomBroadcastByWorld` helper**

```ts
function roomBroadcastByWorld(worldId: string) {
  return (msg: ServerMessage) => {
    for (const [connId, wsId] of worldConnections) {
      if (wsId === worldId) sendTo(connId, msg);
    }
  };
}
```

Naming note: despite the name, this does not touch the legacy `rooms` map. Consider renaming to `worldBroadcast` for clarity.

### Task 6: Client state machine

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Define `ClientView`**

```ts
export type ClientView =
  | 'connecting'
  | 'login'
  | 'world_select'
  | 'character_select'
  | 'in_world'
  | 'in_lobby'    // legacy — kept until Phase 5 retires the old lobby flow
  | 'in_dungeon'  // placeholder for Phase 5 — unused in Phase 2
  | 'game_over'
  | 'generating';
```

- [ ] **Step 2: Add store state**

```ts
currentView: ClientView;
currentWorld: { id: string; name: string } | null;
worldMembers: WorldMemberSummary[];
```

Initialize `currentView` to `'connecting'`, the others to `null` / `[]`.

- [ ] **Step 3: Derive `currentView` on every store change**

Add a private `recomputeView()` action called from any reducer that mutates relevant state. Priority order (first match wins):

1. `connectionStatus === 'disconnected'` → `'connecting'`
2. `generationStatus === 'generating' || 'failed'` → `'generating'`
3. `gameOver` → `'game_over'`
4. `activeGameSession` → `'in_dungeon'` (Phase 5 wires this)
5. `currentWorld && worldMembers.length > 0` → `'in_world'`
6. legacy lobby condition (roomCode set, no world) → `'in_lobby'`
7. `authStatus === 'authenticated' && selectedWorldId && !selectedCharacterId` → `'character_select'`
8. `authStatus === 'authenticated' && !selectedWorldId` → `'world_select'`
9. `authStatus === 'unauthenticated'` → `'login'`
10. Default → `'connecting'`

Expose `currentView` as a selector; `App.tsx` reads it.

- [ ] **Step 4: Handle new messages**

- `world_state`: set `currentWorld = { id, name }`, `worldMembers = members`. Triggers view recomputation → `'in_world'`.
- `world_member_joined`: append to `worldMembers`.
- `world_member_left`: remove from `worldMembers`.

- [ ] **Step 5: Clear world state on leave/logout**

`leave_world` client action (Task 7) and logout both clear `currentWorld` and `worldMembers`.

### Task 7: Client action

**Files:**
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Add `leaveWorld` sender**

```ts
leaveWorld: () => {
  send({ type: 'leave_world' });
  useGameStore.setState({
    currentWorld: null,
    worldMembers: [],
    selectedCharacterId: null,
  });
},
```

Optimistic clear mirrors the existing `selectCharacter` pattern.

### Task 8: `WorldView` component

**Files:**
- Create: `client/src/components/WorldView.tsx`

- [ ] **Step 1: Stub layout**

Use the `.lobby` shell + `CaveBackground` + logo pattern. Body:

- Subtitle: `"Welcome to {currentWorld.name}"`
- "Members online" list: each `worldMembers[]` row shows `characterName · Lv level className` — same formatting as the existing lobby player row.
- Single button: `Leave World` → `actions.leaveWorld()`.
- Optional: small note "Phase 2 — map and movement coming soon" so it's obvious this is a stub if someone opens it.

Props: `onLeaveWorld: () => void`.

### Task 9: `App.tsx` refactor

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace `else if` chain with a `switch`**

```tsx
const currentView = useGameStore((s) => s.currentView);

let content: React.ReactNode;
switch (currentView) {
  case 'connecting': content = <ConnectingScreen />; break;
  case 'login': content = <LoginScreen onLogin={actions.login} />; break;
  case 'world_select': content = <WorldSelect ... />; break;
  case 'character_select': content = <CharacterSelect ... />; break;
  case 'in_world': content = <WorldView onLeaveWorld={actions.leaveWorld} />; break;
  case 'in_lobby': content = <Lobby ... />; break;
  case 'in_dungeon':   // fall through to game-layout (Phase 5 will distinguish)
  case 'generating': content = <GenerationScreen />; break;
  case 'game_over': content = <GameOverScreen />; break;
  default: content = <div className="game-layout">...</div>; break;
}
```

Extract the tiny inline "connecting" and "generating" blocks into their own mini components only if it improves readability; otherwise keep them inline.

- [ ] **Step 2: Remove duplicate state checks**

Gone from `App.tsx`:
- `authStatus === 'unauthenticated'` branch
- `authStatus === 'authenticated' && !selectedCharacterId` branch
- `connectionStatus === 'connected' || 'in_lobby'` branch
- The `gameOver` branch
- The `generationStatus` branches

All replaced by the store-derived `currentView`.

- [ ] **Step 3: Preserve game-layout rendering**

The `in_dungeon` / default case still renders the full game layout (`main-column` + `side-column`) exactly as today. Do not refactor the game layout itself in Phase 2.

### Task 10: Smoke test

- [ ] **Step 1: Manual walkthrough**

1. Launch fresh. Log in → world select → create world → character select → create character → select character.
2. Expect: `WorldView` renders showing your character in the member list.
3. Open a second browser tab. Log in as a second account → join world (invite code) → select world → create character → select character.
4. Expect: both tabs show both members in `WorldView`, live-updating.
5. Click "Leave World" in tab 1.
6. Expect: tab 1 returns to character select. Tab 2 sees the member disappear.
7. Close tab 2 entirely (not logout — hard close).
8. Expect: server logs show WorldSession teardown. Character's `in_use` lock is released.
9. Reopen tab 2 → resume → select character → land back in WorldView.

- [ ] **Step 2: Regression check**

Confirm the legacy `join_lobby` → `start_game` → in-game flow still works *if* reached. Phase 2 doesn't wire any UI to it (WorldView is the only path out of character-select), but the code path must not have been broken. If exercising this requires temporarily wiring a button, skip — we'll properly verify in Phase 5 when the handoff becomes real.

---

## Known dead code after Phase 2

These are flagged here so they're easy to find in Phase 5:

- The legacy `rooms` map in `index.ts` — still referenced, but no character-select path leads into it.
- `playerRoom` reverse lookup — same.
- `join_lobby` / `start_game` message handlers — still work, nothing calls them.
- `Lobby.tsx` — the component isn't rendered; `in_lobby` view is unreachable from the new flow.
- `in_lobby` case in the state machine switch.

Do not delete any of this. Phase 5 ports the dungeon-entry flow onto `WorldSession` + portal tiles and THEN retires the legacy code in one pass.

---

## Open questions to resolve during implementation

1. **`recomputeView()` or selector?** The plan above derives `currentView` by calling `recomputeView()` from each reducer. An alternative is a pure computed selector called from `App.tsx`. Both work. Pick one by looking at the existing Zustand patterns in `gameStore.ts` and stay consistent.
2. **Broadcast exclusion.** Does the existing `broadcast` helper support "send to all except X"? If not, accept that `world_state` + `world_member_joined` will briefly double-receive on the joiner side and just ignore the duplicate in the client. Or add an `exceptConnectionId` parameter. Pick in Task 2 Step 2.
3. **Character in_use release timing on disconnect.** Phase 1 of this feature's ancestor plan had a "stuck in use" bug. In Phase 2, disconnect from WorldSession releases `in_use` on close. Make sure this doesn't double-release or race with the logout handler. Add a unit test if a clean assertion can be written.

---

## Done when

- All tasks checked off.
- `npm run test -w server` passes, including new `WorldSession` tests.
- `npm run build` in client and server is clean.
- Manual smoke test (Task 10) passes two-tab end-to-end.
- `App.tsx` no longer contains any `else if` chains for view routing — only a `switch (currentView)`.
- Closing a browser tab while in a WorldSession tears it down cleanly and releases the character lock.
- Server logs show WorldSession create/destroy lifecycle messages matching member join/leave events.
