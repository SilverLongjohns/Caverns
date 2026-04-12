# Overworld Phase 4 — Click-to-Travel Movement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Make characters move. A player clicks a destination tile on the overworld map; the server pathfinds from the character's current position; the character auto-advances one tile per server tick, broadcast to all members of the world. Movement is entirely server-authoritative. Positions persist to the DB so rejoining lands the character where they stopped.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Depends on:** Phase 3 (`docs/superpowers/plans/2026-04-12-overworld-phase-3-map.md`) — rendered map, member positions, `TileKind`, `isWalkable`.

**Ships alone.** This is the focused-review phase. Do not bundle with anything else — the tick loop and pathfinding are the parts of this feature most likely to grow subtle bugs, and they deserve their own PR.

---

## Decisions locked in this phase

1. **Server-authoritative. No client prediction.** Every tile a character occupies is decided by the server. The client renders what the server says and nothing else. If the click-to-first-step lag feels bad, we fix it via faster ticks or client-side path preview — never via speculative client movement.
2. **Tick rate: 4/sec (250ms).** Starting value. Tunable via a constant at the top of `WorldSession.ts`. Change it in code, not in config.
3. **Per-world tick loops.** Each `WorldSession` owns its own `setInterval`, started on first join and cleared on teardown. There is no global tick. Idle worlds consume zero CPU.
4. **Pathfinding: BFS on walkable tiles.** Simplest correct algorithm. 40×40 map, up to ~1600 nodes — BFS is trivially fast. No A*, no heuristics, no diagonal movement. Four-neighbor (N/E/S/W) only.
5. **Click a new destination = recompute from current tile.** The server never cancels a half-step. Characters are always at rest on a tile between ticks; new paths start from that tile.
6. **Unreachable target = reject with a friendly error.** Server sends a `world_move_rejected` message; client can optionally flash a message, but the character stays put.
7. **Collision: none in v1.** Multiple characters can occupy the same tile. Stacking rendering is a known rough edge carried from Phase 3.
8. **Path preview on the client.** When a click is sent, the client optimistically renders the clicked path as a dim trail until the server's first `overworld_tick` arrives. This hides the click-to-first-step latency without introducing client prediction of the character's actual position. If the server rejects the path, the trail clears.
9. **One-tick-per-step broadcasts, batched.** Each tick, the server emits a single `overworld_tick` message to all members containing every character's new position for that tick. Not one message per character per tick.
10. **Snapshot on meaningful events.** `overworld_pos` is written to the DB when a character (a) finishes a path (reaches destination), (b) gets removed from the session (disconnect/leave/dungeon entry), or (c) is snapshotted as part of WorldSession teardown. Not every tick — that would thrash the DB.
11. **Two-tick-rate consideration: deferred.** No separate "idle" vs. "moving" tick rate. The interval runs at 4 Hz whenever any member is in the session. If nobody is moving, the tick loop does a no-op; the overhead is negligible.

---

## File structure

### New files

**Server:**
- `server/src/overworldPath.ts` — pure BFS pathfinder, takes a map + start + end, returns `{x, y}[]` or `null`
- `server/src/overworldPath.test.ts` — unit tests for the pathfinder

### Modified files

**Shared:**
- `shared/src/messages.ts` — new client message `overworld_move`, new server messages `overworld_tick` and `world_move_rejected`

**Server:**
- `server/src/WorldSession.ts` — tick loop, per-member path state, `requestMove`, `tick` handler, snapshot-on-path-complete
- `server/src/WorldSession.test.ts` — tick loop tests, movement tests, path-replacement tests
- `server/src/index.ts` — route `overworld_move` into `WorldSession.requestMove`

**Client:**
- `client/src/components/WorldMapView.tsx` — click handler on tiles, path preview trail overlay
- `client/src/store/gameStore.ts` — `overworld_tick` handler updates member positions, `world_move_rejected` clears preview
- `client/src/hooks/useGameActions.ts` — `overworldMove(x, y)` sender

### Files NOT touched in Phase 4

- `shared/src/overworld.ts` — types already in place
- `server/src/CharacterRepository.ts` — `snapshot` already writes `overworld_pos` from Phase 3 plumbing
- Any dungeon / `GameSession` code
- `WorldView.tsx` — the map is embedded via `WorldMapView`; no layout changes

---

## Task list

### Task 1: BFS pathfinder

**Files:**
- Create: `server/src/overworldPath.ts`
- Create: `server/src/overworldPath.test.ts`

- [ ] **Step 1: Implement BFS**

```ts
import type { OverworldMap } from '@caverns/shared';
import { getTile, isWalkable } from '@caverns/shared';

export function findPath(
  map: OverworldMap,
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number }[] | null {
  if (start.x === end.x && start.y === end.y) return [];
  const endTile = getTile(map, end.x, end.y);
  if (endTile === null || !isWalkable(endTile)) return null;

  const key = (x: number, y: number) => `${x},${y}`;
  const visited = new Set<string>([key(start.x, start.y)]);
  const cameFrom = new Map<string, string>();
  const queue: { x: number; y: number }[] = [start];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curKey = key(cur.x, cur.y);

    if (cur.x === end.x && cur.y === end.y) {
      // Reconstruct path, excluding start
      const path: { x: number; y: number }[] = [];
      let k = curKey;
      while (k !== key(start.x, start.y)) {
        const [xs, ys] = k.split(',').map(Number);
        path.push({ x: xs, y: ys });
        k = cameFrom.get(k)!;
      }
      return path.reverse();
    }

    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]] as const) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      const tile = getTile(map, nx, ny);
      if (tile === null || !isWalkable(tile)) continue;
      visited.add(nk);
      cameFrom.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}
```

The returned path excludes the start tile. Each element is one step. An empty array `[]` means "already there." `null` means "no path exists."

- [ ] **Step 2: Tests**

Using small fixture maps (build inline in the test file — don't use the real starter map; that makes assertion fragile):

- Start == end → returns `[]`
- Straight line through open tiles → returns N steps
- Wall blocks direct path → returns a path around it
- Fully enclosed target → returns `null`
- Out-of-bounds target → returns `null`
- Target is a wall → returns `null`
- Multiple equal-length paths → returns a valid one (BFS gives a deterministic-but-implementation-defined choice; test only "is valid," not which specific path)

### Task 2: Shared message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Client message**

```ts
| { type: 'overworld_move'; targetX: number; targetY: number }
```

- [ ] **Step 2: Server messages**

```ts
| {
    type: 'overworld_tick';
    // One entry per member whose position changed this tick.
    // Members not in the list did not move.
    steps: { connectionId: string; x: number; y: number; arrived: boolean }[];
  }
| { type: 'world_move_rejected'; reason: 'unreachable' | 'out_of_bounds' | 'not_walkable' }
```

`arrived: true` indicates the member finished their path on this step. Client can use this to clear the path preview.

### Task 3: WorldSession member path state

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Extend `WorldSessionMember`**

```ts
export interface WorldSessionMember {
  // ... existing fields
  pos: { x: number; y: number };
  path: { x: number; y: number }[]; // remaining steps (first element is the next tile to step onto)
}
```

Default `path: []` on creation.

- [ ] **Step 2: `requestMove` method**

```ts
requestMove(connectionId: string, target: { x: number; y: number }): 'ok' | 'unreachable' | 'out_of_bounds' | 'not_walkable' {
  const member = this.members.get(connectionId);
  if (!member) return 'unreachable';

  if (target.x < 0 || target.y < 0 || target.x >= this.map.width || target.y >= this.map.height) {
    return 'out_of_bounds';
  }
  const tile = getTile(this.map, target.x, target.y);
  if (!tile || !isWalkable(tile)) return 'not_walkable';

  const path = findPath(this.map, member.pos, target);
  if (path === null) return 'unreachable';

  member.path = path;
  return 'ok';
}
```

Important: `requestMove` recomputes from the member's *current resting position*, not from a mid-step position, because characters are always at rest between ticks by definition.

### Task 4: Tick loop

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Constants**

```ts
const TICK_INTERVAL_MS = 250;
```

- [ ] **Step 2: Start/stop lifecycle**

On first `addConnection` (when `members.size === 0` transitions to 1), start the interval:

```ts
private startTickLoop(): void {
  if (this.tickHandle) return;
  this.tickHandle = setInterval(() => this.tick().catch(e => console.error('[WorldSession] tick error', e)), TICK_INTERVAL_MS);
}

private stopTickLoop(): void {
  if (this.tickHandle) {
    clearInterval(this.tickHandle);
    this.tickHandle = undefined;
  }
}
```

Store `tickHandle: NodeJS.Timeout | undefined` as a private field.

`removeConnection` path: after removing, if `members.size === 0`, call `stopTickLoop()` *before* the `'destroyed'` return.

- [ ] **Step 3: `tick()` implementation**

```ts
private async tick(): Promise<void> {
  const steps: { connectionId: string; x: number; y: number; arrived: boolean }[] = [];
  const arrivedMembers: WorldSessionMember[] = [];

  for (const member of this.members.values()) {
    if (member.path.length === 0) continue;
    const next = member.path.shift()!;
    member.pos = next;
    const arrived = member.path.length === 0;
    steps.push({ connectionId: member.connectionId, x: next.x, y: next.y, arrived });
    if (arrived) arrivedMembers.push(member);
  }

  if (steps.length > 0) {
    this.broadcast({ type: 'overworld_tick', steps });
  }

  // Snapshot members who reached their destination this tick.
  for (const m of arrivedMembers) {
    try {
      await this.characterRepo.snapshotOverworldPos(m.characterId, m.pos);
    } catch (e) {
      console.error('[WorldSession] snapshot error', e);
    }
  }
}
```

- [ ] **Step 4: Add `snapshotOverworldPos` to `CharacterRepository`**

Thin wrapper — avoids passing a full `CharacterSnapshot` just to update one field.

```ts
async snapshotOverworldPos(id: string, pos: { x: number; y: number }): Promise<void> {
  await this.db.updateTable('characters')
    .set({ overworld_pos: JSON.stringify(pos) as never, last_played_at: new Date() })
    .where('id', '=', id)
    .execute();
}
```

- [ ] **Step 5: Snapshot on removal**

In `removeConnection`, before deleting the member from the map, if the member has a non-default position (i.e., not still on spawn), snapshot it. Actually — simpler rule: *always* snapshot on removal. The DB write is cheap and removes all edge-case reasoning.

```ts
async removeConnection(connectionId: string): Promise<'destroyed' | 'still_active'> {
  const member = this.members.get(connectionId);
  if (member) {
    try {
      await this.characterRepo.snapshotOverworldPos(member.characterId, member.pos);
    } catch (e) { console.error(e); }
  }
  // ... existing removal logic
}
```

### Task 5: `WorldSession` tests

**Files:**
- Modify: `server/src/WorldSession.test.ts`

- [ ] **Step 1: Movement tests**

Use fake timers (vitest `vi.useFakeTimers()`) so ticks are deterministic.

- `requestMove` with an invalid target returns the right error code; path is unchanged
- `requestMove` with a valid target sets the member's path
- After N ticks, the member has advanced N tiles along the path
- On the final tick of a path, `steps[i].arrived === true` and `member.path.length === 0`
- `characterRepo.snapshotOverworldPos` is called once per arrival (stub and assert)
- Tick loop does not run when `members.size === 0` (verify no broadcasts after teardown)
- Tick loop cleans up `setInterval` on teardown (assert no leaked handles — vitest `vi.getTimerCount()` stays at 0 after `removeConnection` destroys the session)

- [ ] **Step 2: Path replacement tests**

- Member A starts moving; mid-path, `requestMove` is called with a new target; A's path is replaced; A does not backtrack or teleport — it continues from its current resting tile toward the new destination
- `requestMove` to the current position clears the path (empty path = no-op, but existing movement stops)

### Task 6: Server routing

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: `overworld_move` handler**

```ts
case 'overworld_move': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const result = session.requestMove(playerId, { x: msg.targetX, y: msg.targetY });
  if (result !== 'ok') {
    sendTo(playerId, { type: 'world_move_rejected', reason: result });
  }
  break;
}
```

Reject messages go only to the requester. Success broadcasts happen via the tick loop.

### Task 7: Client action

**Files:**
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Sender**

```ts
overworldMove: (x: number, y: number) => send({ type: 'overworld_move', targetX: x, targetY: y }),
```

### Task 8: Client store

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: `overworld_tick` handler**

```ts
case 'overworld_tick': {
  const members = [...state.worldMembers];
  for (const step of msg.steps) {
    const idx = members.findIndex(m => m.connectionId === step.connectionId);
    if (idx >= 0) members[idx] = { ...members[idx], pos: { x: step.x, y: step.y } };
  }
  set({ worldMembers: members });

  // Clear path preview for self if self-arrived
  const myId = state.playerId;
  const mySelf = msg.steps.find(s => s.connectionId === myId);
  if (mySelf?.arrived) set({ overworldPathPreview: [] });
  break;
}
```

- [ ] **Step 2: Path preview state**

```ts
overworldPathPreview: { x: number; y: number }[];
```

Initialized to `[]`.

- [ ] **Step 3: `world_move_rejected` handler**

```ts
case 'world_move_rejected':
  set({ overworldPathPreview: [] });
  // Optional: surface a brief toast / log line
  break;
```

### Task 9: Click-to-move + path preview

**Files:**
- Modify: `client/src/components/WorldMapView.tsx`

- [ ] **Step 1: Tile click handler**

`TileGridView` doesn't currently accept click handlers — check before writing this task. If it doesn't, the cleanest option is to add an optional `onTileClick?: (x: number, y: number) => void` prop. Do it as a targeted addition, not a refactor.

In `WorldMapView`:

```tsx
const handleTileClick = useCallback((x: number, y: number) => {
  // Optimistic client-side path preview
  if (!worldMap) return;
  const mySelf = worldMembers.find(m => m.connectionId === myConnectionId);
  if (!mySelf) return;
  const preview = findPathClientSide(worldMap, mySelf.pos, { x, y });
  if (preview) {
    useGameStore.setState({ overworldPathPreview: preview });
  }
  actions.overworldMove(x, y);
}, [worldMap, worldMembers, myConnectionId]);
```

- [ ] **Step 2: Share the pathfinder**

Option A: Extract `findPath` into `shared/src/overworldPath.ts` so client and server both import it. Cleanest. Do this in Task 1 instead if the clients need to call it — move the pathfinder into `shared/` and have the server re-export / re-use. Decide during Task 1 implementation.

Option B: Duplicate a small BFS in the client. Avoid if possible — drift risk.

**Pick Option A.** Update Task 1 to place the file in `shared/src/overworldPath.ts`; adjust all the imports in this task accordingly. This note is load-bearing — make the decision at the top of Task 1.

- [ ] **Step 3: Render the preview trail**

Add path preview tiles as extra `EntityOverlay` entries in `WorldMapView`, drawn *under* the character sprites:

```tsx
for (const step of overworldPathPreview) {
  entities.push({ x: step.x, y: step.y, char: '·', className: 'overworld-path-preview' });
}
```

Make sure to splice them in before character entities so characters render on top.

- [ ] **Step 4: CSS for preview trail**

Add `.overworld-path-preview` — dim accent color, maybe a slight fade animation. Understated; it should look like a suggestion, not a commitment.

### Task 10: Smoke test

- [ ] **Step 1: Single-player movement**

1. Enter world → click a tile three tiles north.
2. Expect: immediate dim trail to the target, then sprite steps one tile every ~250ms, trail fades as the sprite reaches the end.
3. Click a tile behind a wall.
4. Expect: character routes around the wall via the BFS-chosen path.
5. Click a wall tile directly.
6. Expect: `world_move_rejected` — no trail, no movement, optional client feedback.
7. Disconnect → reconnect → select character.
8. Expect: character is at the last-reached position (wherever step 2's path ended), not the spawn tile.

- [ ] **Step 2: Multi-player movement**

1. Two tabs in the same world.
2. Tab 1 clicks destination A; tab 2 clicks destination B at the same time.
3. Expect: both sprites move in lockstep, stepping on the same tick boundaries. Each tab sees both characters moving.
4. Tab 1 mid-path, click a new destination.
5. Expect: tab 1's sprite finishes its current tile, then redirects. Tab 2 sees the redirect without glitching.

- [ ] **Step 3: Interval hygiene**

1. Both tabs leave. WorldSession tears down.
2. Expect: no tick messages logged after teardown. Server logs show `stopTickLoop` or equivalent.
3. Rejoin. Expect: tick loop restarts cleanly.

- [ ] **Step 4: Rapid-fire clicks**

Click 10 different tiles in quick succession. Expect: no crashes, each click recomputes the path from the current resting tile, the final click "wins" and the character walks to the final target.

---

## Known rough edges to leave alone

- **No camera / scroll.** Still the case. Click-to-move on a >screen-size map will break UX; not a Phase 4 concern unless the map grows.
- **No click affordance for non-self members.** You can click anywhere on the map, including under another member's sprite — that's fine; you're commanding your own character, not theirs.
- **No animation interpolation.** Characters teleport one tile per tick. 250ms is fast enough that it should read as "stepping." If it feels jumpy, add CSS transform transitions in Phase 4.5, not here.
- **No collision.** Members walk through each other. Visible but acceptable.
- **No interactables triggered by movement.** Stepping on the stash tile does nothing. Phase 6 adds the press-E / click interaction. Stepping on the portal does nothing. Phase 5 adds the party handoff.
- **Snapshot granularity.** Positions written only on arrival / removal. A server crash mid-walk rewinds the character to their last arrival tile. Acceptable for v1.

---

## Open questions to resolve during implementation

1. **`TileGridView` click support.** Does it already forward clicks? If yes, wire through. If no, add an `onTileClick` prop. Don't refactor its internals — add a minimal plumbing pass.
2. **Pathfinder location — `shared/` or `server/`?** Locked above: `shared/`. If there's a reason client can't import it (e.g., unused server-only imports), resolve by keeping `overworldPath.ts` in shared with no side effects and re-exporting from server.
3. **Fake timer shape in tests.** Vitest's fake timers don't always interact cleanly with async code inside `setInterval`. If `snapshotOverworldPos` assertions become flaky, switch to mocking the interval callback directly and calling `await session['tick']()` in tests. Document whichever approach works.
4. **Path preview pathfinder invocation on every click.** If the client map grows or path preview becomes expensive, memoize. Not a concern at 40×40.

---

## Done when

- All tasks checked off.
- `npm run test` passes in shared (pathfinder tests), server (WorldSession movement tests), and client (no new tests required but nothing regresses).
- `npm run build` in shared, client, and server is clean.
- Manual smoke test (Task 10) passes all four sub-scenarios end-to-end.
- Clicking an unreachable target never moves the character.
- Character positions persist across disconnect + rejoin.
- WorldSession teardown stops the tick loop. No leaked `setInterval` handles after all members disconnect.
- Two members moving simultaneously appear to step in lockstep in both browser tabs.
