# Overworld — Feature Overview

> **For agentic workers:** This is the overarching design document for the Overworld feature. Do NOT implement directly from this file — each phase has its own implementation plan under `docs/superpowers/plans/2026-04-12-overworld-phase-N-*.md`. Use this doc for context, cross-phase decisions, and invariants that individual phase plans rely on. **No git commits — user manages git themselves.**

**Goal:** Introduce a shared, persistent overworld as the top-level game save for a group of players. Characters live in a world, walk around a hand-authored tile map, group up, and enter procedurally-generated dungeon instances together. Dungeons remain ephemeral; the world persists.

**Spec:** No separate design spec — this document serves as both vision and architectural framing for the phase plans.

---

## End-state vision

- A **world** is a persistent, invite-based multiplayer save slot. Characters are created inside a world and bound to it for life. Multiple accounts are members of a world; any member can enter it whenever they want.
- The **overworld** is a shared tile map containing towns, dungeon portals, and open space. All online members of a world see each other moving around in real time.
- **Movement** is click-to-travel: players click a destination tile, the server pathfinds, and the character auto-steps along the path one tile per server tick, broadcast to everyone in the world.
- **Towns** are hand-authored sub-regions of the overworld map containing NPCs (stash for v1; shops, quest givers, and dialogue later).
- **Dungeons** are ephemeral instances generated on demand. A party stands on a portal tile, confirms entry, and is transferred into a fresh `GameSession`. On end/wipe/disconnect, the party returns to the portal tile.
- The world's in-memory state **snapshots to Postgres** whenever members enter/leave, and on graceful shutdown. A world can be loaded fresh on server restart from its last snapshot.

This is the shared-hub / Valheim-style direction, explicitly chosen over the simpler solo-hub alternative.

---

## Non-goals (for the whole overworld feature, not just v1)

- **Procedural overworld generation.** Maps are hand-authored. Procedural *dungeons* still happen inside instances.
- **Persistent dungeons.** A dungeon instance exists only for the duration of its run. Loot leaves with the party; nothing is saved back to the instance.
- **Cross-world travel or character migration.** A character belongs to exactly one world, forever.
- **Real-time combat in the overworld.** Combat happens inside dungeon instances. The overworld is a traversal/social space.
- **World chat scoping changes.** Chat stays as-is for now; revisit separately.
- **Shared stashes across characters in the same account.** Stash is per-character for v1; world stash / account stash is a later decision.

---

## Decisions already made

These are locked in. Phase plans must honour them without re-litigating.

1. **World membership model: invite-based + character-bound.** Characters are created *inside* a world. An account can be a member of multiple worlds and hold characters in each. There is no "migrate character to another world" operation.
2. **World lifecycle: lazy always-on.** A `WorldSession` spins up in memory when the first member connects; it tears down and snapshots when the last member disconnects *and* no active dungeon instances are tied to it. It is not held in memory 24/7.
3. **Movement: server-ticked stepping.** Click destination → server BFS pathfinds → character advances one tile per tick → each step broadcast. No client-side authoritative movement. Tick rate: 4/sec (250ms per step) as a starting point, tunable.
4. **Dungeon entry: party-based.** A dungeon is entered by a party, not a solo player. Multiple members step onto a portal tile; one member confirms; the party is locked in; an instance spawns. Solo entry is just a party of one.
5. **Persistence: characters own their position.** A character's last known overworld position lives on the `characters` row. World-level flags/state live on the `worlds` row. Dungeon instances persist nothing.
6. **Existing characters: nuked.** No migration path. We're still in smoke-test phase, so pre-overworld characters are wiped when the world schema lands.
7. **Town v1: walkable tiles + stash NPC only.** No shops, no dialogue, no inn. Explicitly constrained so Phase 6 stays small.
8. **WorldSession is not a GameSession.** It's a parallel class. They share concepts (broadcast, member list, connection lifecycle) but not inheritance. Shoehorning both into one class will get ugly.

---

## Architecture overview

### New server concept: `WorldSession`

Parallel to `GameSession`. Owned by the top-level connection router. Responsibilities:

- Hold the in-memory state of one active world: the loaded map, per-character positions, per-character movement paths, member connection list.
- Run a tick loop (started on first member join, stopped on teardown) that advances any characters currently travelling along a path.
- Broadcast presence and movement events to all connected members.
- Handle overworld interactions (stash NPC for v1).
- Coordinate with `GameSession` for dungeon entry/exit transfers.
- Snapshot to DB on significant state changes and on teardown.

A module-level `worldSessions: Map<worldId, WorldSession>` registry lives in `server/src/index.ts` alongside the existing `rooms` map. The old `rooms` / lobby-code flow is preserved during Phases 1–4 and retired in Phase 5 once dungeon entry through portals is working.

### Connection state machine

Today's implicit state machine (`authenticated` → `character_selected` → in lobby → in game) is replaced with an explicit one. Each connection is in exactly one of:

- `auth` — not logged in
- `character_select` — logged in, picking a character (or picking a world + character)
- `in_world` — attached to a `WorldSession`, walking around
- `in_dungeon` — attached to a `GameSession`, running a dungeon instance

Transitions:

- `auth` → `character_select`: successful login
- `character_select` → `in_world`: pick a character whose `world_id` matches a world the account is a member of
- `in_world` → `in_dungeon`: step on a portal with a confirmed party, instance is created
- `in_dungeon` → `in_world`: dungeon ends (victory, wipe, flee, disconnect) — connection returns to the WorldSession with the character positioned at the portal tile
- any → `auth`: logout
- any → disconnected: ws close. Disconnect from `in_world` snapshots and leaves; disconnect from `in_dungeon` ends the instance (or marks the player as dropped, TBD Phase 5).

The client mirrors this state machine in `gameStore.currentView` and `App.tsx` branches on it.

### Data model

Three schema changes, applied in Phase 1:

- **New `worlds` table**: `id` (PK, uuid), `name`, `seed` (int, for future procedural content), `owner_account_id` (FK), `created_at`, `state` (jsonb, world-level flags, empty `{}` for now).
- **New `world_members` table**: `world_id` (FK), `account_id` (FK), `joined_at`, PK `(world_id, account_id)`.
- **Existing `characters` table gains**: `world_id` (FK, NOT NULL after migration), `overworld_pos` (jsonb `{x, y}`, nullable — null means "use world spawn tile"). The existing character-wipe migration drops all rows before adding the NOT NULL column so we don't need a backfill.

### Map format

Defined in `shared/src/overworld.ts` so both client and server share the authoring:

```ts
interface OverworldMap {
  id: string;
  width: number;
  height: number;
  tiles: TileKind[][];         // walkable, wall, water, etc.
  spawnTile: { x: number; y: number };
  regions: OverworldRegion[];  // named sub-areas (towns)
  portals: OverworldPortal[];  // dungeon entrances
  interactables: OverworldInteractable[]; // stash NPC etc.
}
```

V1 ships with exactly one hand-authored map containing one town region, one portal, and one stash NPC.

### Tick loop

A `WorldSession` starts a `setInterval` on first join (250ms). Each tick:

1. For each character with a non-empty path: advance one tile, update their `pos`, queue an `overworld_step` broadcast.
2. If a character reaches their destination: clear their path.
3. Flush all queued broadcasts as a single `overworld_tick` message containing every movement that happened this tick.
4. If no active members and no outbound dungeon instances remain: stop the interval and destroy the session.

Idle worlds do not run a tick loop. Per-world intervals — never a single global one.

### Dungeon handoff

The single most bug-prone area, and the reason Phase 5 is its own PR.

On portal entry confirm:

1. `WorldSession` collects the party (members currently standing on the portal tile who've opted in).
2. Create a new `GameSession` via the existing constructor. Tag it with `originWorldId` and `originPortalTile` so we know where to return.
3. For each party member's connection: remove from `WorldSession.members`, add to `GameSession`, transition `currentView` to `in_dungeon` client-side. Characters stay marked as "in world X, in dungeon Y" server-side — they count toward WorldSession's "don't tear down yet" check.
4. Broadcast to remaining WorldSession members that the party has entered the dungeon (their sprites disappear from the map, or are replaced with an "occupied" marker — TBD in Phase 5 design).

On dungeon end:

1. `GameSession.endGame` snapshots characters as today.
2. The end hook checks `originWorldId`; if set, for each party member still connected, transfer their connection back to the `WorldSession`, set their position to `originPortalTile`, broadcast `world_member_returned`.
3. If a `GameSession` ends and the origin `WorldSession` no longer exists in memory (because it tore down while the dungeon was running — which *shouldn't* happen because of the "active dungeon instances" check, but defensively), spin it up from DB and attach the returning members.

This is the corner where the recently-debugged `playerRoom` / `activeSessions` / stuck-`in_use` bugs will try to come back. Phase 5 gets explicit tests for every path.

---

## Phase roadmap

Each phase has its own implementation plan document. Phases are intended to be shippable-ish in order — but Phases 1 + 2 are deliberately combined into one PR, and Phase 5 must not be combined with anything.

| Phase | Scope | Plan document |
| --- | --- | --- |
| 1 | World schema + membership plumbing + world-select UI | `2026-04-12-overworld-phase-1-schema.md` |
| 2 | Empty `WorldSession` lifecycle + connection state machine refactor | `2026-04-12-overworld-phase-2-session.md` |
| 3 | Overworld tile map rendering + static town + character placement | `2026-04-12-overworld-phase-3-map.md` |
| 4 | Click-to-travel movement with server tick loop | `2026-04-12-overworld-phase-4-movement.md` |
| 5 | Dungeon portal tiles + party entry + `GameSession` handoff | `2026-04-12-overworld-phase-5-dungeons.md` |
| 6 | Stash NPC interaction in town v1 | `2026-04-12-overworld-phase-6-stash.md` |

**Bundling guidance:**

- Phase 1 and Phase 2 are one PR. Both are plumbing with no visible gameplay. Splitting them wastes review cycles.
- Phase 3 and Phase 4 are separate PRs. Phase 3 proves the render path is cheap; Phase 4 is the real presence moment and deserves focused review.
- Phase 5 is its own PR under all circumstances. No bundling with anything.
- Phase 6 is small if stash UI already exists and large if not. Verify at the start of the phase.

---

## Cross-phase invariants

Rules that every phase must maintain. If a phase violates one of these, the plan is wrong — flag it before implementing.

1. **A character is in exactly one session at a time.** Either no session (logged out / in character select), a `WorldSession`, or a `GameSession`. Never both. The `in_dungeon` state explicitly removes them from `WorldSession.members`.
2. **A `WorldSession` cannot tear down while any of its origin `GameSession`s are still running.** Teardown check: `members.size === 0 && outboundDungeons.size === 0`.
3. **A character's authoritative position is their DB row.** In-memory positions in `WorldSession` are a cache; any operation that might lose in-memory state (teardown, crash, disconnect) must snapshot first.
4. **Characters are bound to one world for life.** No operation creates a character without a `world_id`. No operation mutates `characters.world_id`.
5. **Dungeon instances persist nothing.** No tables, no files, no DB rows reference a specific instance after it ends. Loot and XP go through the character snapshot path, same as today.
6. **WorldSession and GameSession do not share a base class.** Refactoring toward a shared `Session` abstraction is explicitly out of scope. Shared concepts are duplicated by design.
7. **No client-authoritative movement.** Every tile a character is on is chosen by the server. The client renders what it's told.
8. **Per-world tick loops only.** There is no global tick driving all worlds. Idle worlds cost zero CPU.
9. **Old lobby-code flow is preserved through Phases 1–4 and retired in Phase 5.** Don't delete `rooms` / `playerRoom` / the `join_lobby` → `start_game` path until Phase 5 moves dungeon entry onto portal tiles.

---

## Risks & things to watch

- **`App.tsx` state-machine refactor (Phase 2).** The current branching on `authStatus` + `roomCode` + `gameStarted` is already load-bearing and spread across multiple hooks. Replacing it with an explicit `currentView` touches a lot of files. Budget for one focused session.
- **`TileGridView` reuse (Phase 3).** The dungeon tile renderer may have fog-of-war / LOS / room-boundary assumptions that don't apply to the overworld. Read it before committing to direct reuse; may need a render-mode flag.
- **Tick loop robustness (Phase 4).** Ensure intervals are cleaned up on teardown, on server shutdown, and on `WorldSession` destruction from any path. A leaked interval holding a reference to a destroyed session is a classic memory leak.
- **Latency vs. tick rate (Phase 4).** 4 ticks/sec = 250ms per step. Input→first-step latency may feel sluggish. Mitigation: client renders the computed path as a trail on click so the player sees immediate feedback. If it still feels bad, raise tick rate or add client-side interpolation.
- **Dungeon handoff bugs (Phase 5).** Exact same bug shape as the stuck-`in_use` / stale-`playerRoom` bugs from account persistence. Mitigation: explicit unit/integration tests for enter → wipe → re-enter, disconnect mid-dungeon → reconnect → end up back in overworld, WorldSession teardown refusal while dungeon runs.
- **Server restart with active worlds (all phases).** On restart, in-memory `WorldSession`s are gone but DB snapshots remain. First member to reconnect re-hydrates. Make sure every phase's in-memory state has a corresponding snapshot path so a restart doesn't lose progress.
- **Authoring workflow.** A hand-authored tile map is currently a code file. That's fine for v1 (one map) but won't scale. Flag as a future concern, don't solve in this feature.

---

## Open questions deferred to individual phase plans

- **Phase 1:** Invite flow. Is joining a world owner-approved, open-to-anyone-with-an-ID, or requires an invite code? Leaning owner-approved + join code, decide in Phase 1 plan.
- **Phase 4:** Collision. Can two characters occupy the same tile? V1 says yes (no collision), revisit if it feels weird.
- **Phase 5:** Party formation UI. "Multiple members step on portal within 5 sec" vs. "one member clicks, others get a prompt to join" vs. explicit party-before-portal grouping. Pick in Phase 5 plan.
- **Phase 5:** Disconnect-during-dungeon behaviour. Drop the player and let the rest continue? Pause the dungeon? Mark them AFK and auto-skip turns (like existing combat AFK)? Decide in Phase 5 plan.
- **Phase 6:** If no stash UI exists today, the phase grows. Audit at phase start.

---

## Success criteria for the whole feature

The overworld feature is considered complete and shippable when:

- A player can log in, create a world, create a character in that world, walk around a town, and return to the same world/position on a later login.
- A second account can be added to the world, log in, and see the first player's character moving around in real time.
- Both players can walk onto a dungeon portal together, enter as a party, clear or wipe, and return to the overworld at the portal tile with their character state correctly persisted.
- The stash NPC in town accepts and returns items from character inventory.
- Server restart mid-session loses no character or world state.
- Zero reports of "character stuck in use" or "can't re-enter lobby" bugs after Phase 5 lands.
