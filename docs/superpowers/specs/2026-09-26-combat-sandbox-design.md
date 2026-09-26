# Combat Sandbox — Design

Date: 2026-09-26
Status: Draft for review

## Goal

Make arena combat fast to reach and testable:

1. **Claude** can spin up a real combat, screenshot it and click through turns from a script, to verify changes (glyphs, camera, UI) without the user setting anything up.
2. **The user** can jump straight into a fight on test data, skipping login, Postgres, character select, overworld and dungeon travel.
3. **Automated tests** can run whole fights headlessly in milliseconds.

## Constraints

- Dev-only. Nothing sandbox-related is reachable in a production build or on a server started without the sandbox flag.
- Real combat code: after the fight starts, everything (movement, attacks, abilities, mob AI, victory, wipe) is the unmodified game path. Only the entry into combat is synthetic.
- Works without Postgres or Docker.
- Repeatable: a seeded fight replays identically.

## Background (current code)

- `GameSession` runs without a DB (`characters` repo = null); `server/src/GameSession.test.ts` already builds sessions standalone with inline `DungeonContent`.
- Arena combat starts in private `GameSession.startCombat(roomId, mobInstances)` (GameSession.ts:741), which builds the grid (`buildArenaGrid(roomType, biomeId)`), places units, constructs `ArenaCombatManager`, and broadcasts `arena_combat_start`.
- The client reaches `ArenaView` from just two messages: `game_start` (sets `connectionStatus: 'in_game'`, `playerId`, `players`, `rooms`) then `arena_combat_start` (sets `activeCombat`, `arenaGrid`, `arenaPositions`). No login required.
- Game-session message handlers in `server/src/index.ts` only need `dungeonConnections` → `dungeonInstances`, not auth.
- The server has no dev gate today; `debug_teleport`, `debug_reveal_all`, `debug_give_item` are handled unconditionally.
- The attack/defend timing minigames are shelved: the arena sends attacks with no `critMultiplier` and has no defend UI.

## Design

### 1. Presets and overrides — `shared/src/sandbox/`

```ts
interface SandboxPartyMember {
  className: string;                 // 'vanguard' | 'shadowblade' | 'cleric' | 'artificer'
  level?: number;                    // default 1
  name?: string;                     // default: class display name
  equipment?: Partial<Record<EquipmentSlot, string>>; // item ids (static items / uniques)
}

interface SandboxPreset {
  id: string;
  label: string;
  party: SandboxPartyMember[];       // 1–4; member 0 is the connected player, others are bots
  mobs: string[];                    // mob template ids from mobPool.json; mobs[0] is the leader
  roomType: RoomType;                // tunnel | chamber | cavern | dead_end | boss
  biome: string;                     // biome id (starter, fungal, crystal, flooded, bone, volcanic)
  seed?: number;
}

interface SandboxSetup extends Required<Omit<SandboxPreset, 'seed' | 'label'>> {
  label: string;
  seed: number | null;
}
```

- `presets.ts` exports `SANDBOX_PRESETS`. Starter set: `duel` (1 vanguard vs 1 tunnel rat, tunnel), one preset per biome (party of 2 vs 3–4 biome mobs, chamber/cavern), one per boss (party of 4 vs boss + 2 adds, boss room), and `showcase` (all 4 classes vs a spread of mobs, cavern).
- `resolveSetup(presetId, overrides)` merges a preset with overrides and validates every id against `mobPool.json`, `classes.json`, item data and the room-type/biome lists. Returns `{ ok: true, setup } | { ok: false, error }` with a readable error naming the bad field and value.
- Overrides (same names as URL params): `room`, `biome`, `mobs` (comma list), `party` (comma list of classes), `level` (applies to all members), `seed`.
- Sandbox fights spawn exactly `setup.mobs` — no random extra mobs.

### 2. Server entry — `server/src/sandbox/`

- **Gate:** `isSandboxEnabled()` = `process.env.CAVERNS_SANDBOX === '1'`.
  - New client→server message `sandbox_start { preset: string; overrides?: SandboxOverrides }`. Refused with `sandbox_error` (and a server log) when the gate is off.
  - The existing `debug_*` messages move behind the same gate (refused + logged when off).
- **`startSandbox(connId, setup, deps)`** (`startSandbox.ts`):
  1. Tear down any previous sandbox session for this connection.
  2. If `setup.seed !== null`, install the seeded RNG (below).
  3. Build a one-room `DungeonContent` (room id encodes the biome so biome inference works; room `type = setup.roomType`; `biomeId = setup.biome`).
  4. Create `GameSession` with no character repo; register it in `dungeonInstances` / `dungeonConnections` under id `sandbox-<n>`.
  5. Add member 0 as `connId`; add bots `sandbox-bot-<i>` for members 1..n. Each member gets a hydrated `Player` built through the same stat path as real characters (class base stats, level, `computePlayerStats`, equipment resolved from item data) and injected via `playerManager.addHydratedPlayer` before `startGame()`.
  6. `startGame()`, then new public `GameSession.startArenaCombat(roomId, mobInstances)`, a thin wrapper over the existing private `startCombat`.
  7. Mob instances are built from templates with a new `buildMobInstance(template, index)` helper (extracted from `buildEncounterMobs`, which reuses it).
- **Bots:** a `SandboxBotDriver` subscribes to the session's outgoing messages (it's handed the session's `sendTo`/broadcast taps for bot ids). On `combat_turn` for a bot, after `botTurnDelayMs` (default 600 ms, 0 in the simulator) it runs `autoPlayer` and calls the same `GameSession` methods the WebSocket handlers call (`handleArenaMove`, `handleCombatAction`, `handleArenaEndTurn`).
- **Seeded RNG** (`seededRandom.ts`): `installSeededRandom(seed)` replaces `Math.random` with a mulberry32 generator and returns `restore()`. Installed for the life of a seeded sandbox session and restored on teardown. Acceptable only because it's confined to a dev process; documented at the install site.
- **Teardown:** Restart, a new `sandbox_start`, `combat_end` + game over, or disconnect disposes the session: clear its timers (add `GameSession.dispose()` if no equivalent exists), stop the bot driver, restore `Math.random`, remove it from the instance maps.
- **Script:** root `npm run dev:sandbox` runs server (with `CAVERNS_SANDBOX=1`) and client together. No DB needed; the existing "DB unavailable" paths already let the server boot.

### 3. Client sandbox mode

- Active only when `import.meta.env.DEV` and the URL has `?sandbox=`. Parsing lives in `client/src/sandbox/sandboxParams.ts`.
- `useWebSocket`: on open, sends `sandbox_start { preset, overrides }` instead of `resume_session`.
- The existing store handlers take it from `game_start` / `arena_combat_start` to `ArenaView`; no special rendering path.
- **Sandbox bar** (`SandboxBar.tsx`, top of screen, dev only): preset label + seed, preset dropdown (navigates to that preset's URL), **Restart** (re-sends the same `sandbox_start`), **New seed** (random seed, updates URL), and any `sandbox_error` text.
- **Automation hook:** `window.__cavernsSandbox = { status: 'connecting' | 'ready' | 'my_turn' | 'waiting' | 'ended' | 'error', combat, currentTurnId, events: [...] }`, kept in sync from the store, so scripts wait on state rather than sleeps.

### 4. Headless simulator — `server/src/sandbox/simulate.ts`

- `simulateFight(setup, { maxRounds = 50 }) → Promise<SimResult>`:
  - Builds the session exactly as `startSandbox` does, with no WebSocket: member 0 is a bot too.
  - Timing overrides: mob turn delay, victory delay, bot delay and defend timeout all 0 (via an injectable timing option on `GameSession`, defaulting to `TIMING_CONFIG` / `QTE_CONFIG`).
  - Resolves on `combat_end`, or `timeout` after `maxRounds`.
- `SimResult = { result: 'victory' | 'wipe' | 'flee' | 'timeout', rounds, turns, damageDealt: Record<unitId, number>, damageTaken: Record<unitId, number>, log: ServerMessage[], errors: string[] }`. Exceptions thrown inside the session are caught into `errors`.
- **`autoPlayer.ts`** (shared by bots and the simulator): `decideTurn(state, selfId) → Action[]`:
  1. If an enemy is adjacent → `attack` it (lowest HP first).
  2. Else move along the arena pathing toward the nearest reachable enemy, spending available movement; if now adjacent → `attack`.
  3. Else `end_turn`.
  Deliberately simple; it exercises the rules, not strategy.
- **CLI:** `npm run sim -- <preset> [--seeds N] [--seed S] [--party ...] [--mobs ...]` prints win rate, mean/min/max rounds, and mean damage per unit.

### 5. Browser driver — `scripts/sandbox-drive.mjs`

- Uses Playwright with the installed Edge (`channel: 'msedge'`), so no browser download. Run on Windows Node (per CLAUDE.md).
- `node scripts/sandbox-drive.mjs "<preset>?<overrides>" [steps…] --out .sandbox/shots`
- Steps: `--wait ready`, `--shot <name>`, `--end-turn [n]`, `--attack-nearest`, `--click x,y`, `--pan dir[,n]`, `--wait ended`, `--viewport WxH`.
- Output: PNGs and `events.json` (the `__cavernsSandbox.events` log) in the out dir.
- If the client/server aren't reachable, exit non-zero with "start them with `npm run dev:sandbox`". It never starts servers itself.
- `.sandbox/` added to `.gitignore`.

### 6. Error handling

- Invalid preset/override → `sandbox_error { message }`, shown in the sandbox bar; the driver prints it and exits non-zero.
- Gate off → `sandbox_error` + server log line; `debug_*` refused the same way.
- Simulator exceptions → `SimResult.errors`; tests assert it's empty.

## Testing

- `shared`: `resolveSetup` — valid presets, each override, and rejection of unknown mob/class/item/room/biome ids.
- `server`:
  - `autoPlayer` decisions on small hand-built grids (adjacent attack, move-then-attack, blocked → end turn).
  - `seededRandom` determinism and restore.
  - Gate: with `CAVERNS_SANDBOX` unset, `sandbox_start` and `debug_*` are refused.
  - Simulator: every preset × 3 seeds finishes with no errors and no timeout; the same seed twice gives identical `SimResult` (excluding timestamps).
- The browser driver is a dev tool, not part of `npm test` (it needs running servers).

## Out of scope

- Multi-human sandbox sessions (bots cover multi-member parties).
- Sandbox entry for exploration, overworld or shops.
- Smarter AI for balance tuning beyond the simple auto player.
- Fixing the leftover arena defend-QTE wait (`CombatManager.ts:345` / `GameSession.ts:1195`): a defending player hit by a mob stalls for `QTE_CONFIG.defendTimeoutMs` (5 s). Noted separately; the simulator sets it to 0.
