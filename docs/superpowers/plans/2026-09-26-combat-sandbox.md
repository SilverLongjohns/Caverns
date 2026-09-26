# Combat Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jump straight into a real arena fight from a URL or script (dev only), run whole fights headlessly in tests, and let Claude drive/screenshot fights in a headless browser.

**Architecture:** Presets + validation live in `shared/src/sandbox/`. The server gets a `server/src/sandbox/` module that builds a DB-less `GameSession` directly into arena combat (bots play extra party members), a headless simulator on top of the same builder, and a `SandboxHost` wired into `index.ts` behind a dev gate. The client sends `sandbox_start` instead of `resume_session` when the URL has `?sandbox=`, shows a sandbox bar, and publishes `window.__cavernsSandbox` for automation. A Playwright script drives the real UI in headless Edge.

**Tech Stack:** TypeScript, Node (`ws`, `tsx`), React + Zustand + Vite, Vitest, Playwright (Edge channel).

**Spec:** `docs/superpowers/specs/2026-09-26-combat-sandbox-design.md`

## Global Constraints

- **No git commands.** The user manages git. Where a step would commit, stop and report instead.
- **Node runs on Windows, not WSL.** From WSL, run every npm/npx/node command through `cmd.exe`, e.g. `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox"`. Never run `npm install` from WSL (it swaps native binaries to Linux).
- **Server and client consume `@caverns/shared` from `shared/dist`.** After changing anything in `shared/src`, run `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run build --workspace=shared"` before running server tests or client type checks.
- Sandbox features are **dev-only**: server gate = `process.env.CAVERNS_SANDBOX === '1'` or the `--sandbox` CLI flag; client gate = `import.meta.env.DEV`.
- Real combat code after the fight starts; only entry is synthetic.
- Must work without Postgres/Docker.
- Seeded fights replay identically.
- Match surrounding code style: 2-space indent, single quotes, `.js` extensions on relative imports, sparse comments.

## Review Focus

1. **Restarting a sandbox fight mid-combat** (Restart button while a mob turn timer is pending): the old session must be fully inert — no stray `arena_positions_update` or `combat_turn` from the old fight reaching the client. Pinned by the SandboxHost restart test in Task 6.
2. **Browser tab closed mid-fight**: the sandbox session is disposed (timers stopped, `Math.random` restored), not left as a disconnected dungeon slot. Pinned by the SandboxHost stop test in Task 6 (the close handler calls `sandboxHost.stop`).
3. **Duplicate mob ids in a preset** (e.g. two `tunnel_rat`): each gets a distinct instance id so targeting and positions work. Pinned in Task 3's `buildSandboxMobs` test.
4. **Malformed URL numbers** (`?seed=abc`, `?level=0`): rejected with a readable message rather than NaN leaking into the fight. Pinned in Task 1's `parseSandboxQuery` + `resolveSetup` tests.
5. **Bot whose path is fully blocked**: ends its turn instead of looping or throwing. Pinned in Task 4's blocked test.

---

## File Structure

**Create**
- `shared/src/sandbox/types.ts` — sandbox types + room-type list.
- `shared/src/sandbox/presets.ts` — `SANDBOX_PRESETS`.
- `shared/src/sandbox/resolveSetup.ts` — `resolveSetup`, `findSandboxItem`, `parseSandboxQuery`, `buildSandboxQuery`.
- `shared/src/sandbox/index.ts` — re-exports.
- `shared/src/sandbox/resolveSetup.test.ts`
- `server/src/sandbox/seededRandom.ts` (+ `.test.ts`) — `installSeededRandom`.
- `server/src/sandbox/sandboxContent.ts` (+ `.test.ts`) — dungeon content, mob instances, prebuilt players.
- `server/src/sandbox/autoPlayer.ts` (+ `.test.ts`) — `decideTurn`.
- `server/src/sandbox/sandboxSession.ts` — `createSandboxSession` (session + bot driver).
- `server/src/sandbox/simulate.ts` (+ `.test.ts`) — `simulateFight`.
- `server/src/sandbox/simCli.ts` — `npm run sim`.
- `server/src/sandbox/gate.ts` — `isSandboxEnabled`.
- `server/src/sandbox/SandboxHost.ts` (+ `.test.ts`) — per-connection sandbox lifecycle.
- `server/src/GameSession.sandbox.test.ts` — tests for new GameSession hooks.
- `client/src/sandbox/sandboxMode.ts` — `getSandboxRequest`.
- `client/src/sandbox/sandboxHook.ts` — `window.__cavernsSandbox`.
- `client/src/components/SandboxBar.tsx`
- `scripts/sandbox-drive.mjs` — Playwright driver.

**Modify**
- `shared/src/index.ts` — export sandbox module.
- `shared/src/messages.ts` — `SandboxStartMessage`, `SandboxErrorMessage`.
- `server/src/GameSession.ts` — `SessionTiming`/`setTiming`, `addPrebuiltPlayer`, `startArenaCombat`, `getArenaSnapshot`, `dispose`, disposed guards.
- `server/src/index.ts` — `SandboxHost` wiring, `sandbox_start` case, gate `debug_*`, close handling.
- `server/package.json`, `package.json` — scripts; root gets `playwright` devDependency.
- `client/src/hooks/useWebSocket.ts`, `client/src/hooks/useGameActions.ts`, `client/src/store/gameStore.ts`, `client/src/App.tsx`, `client/src/main.tsx`, `client/src/styles/index.css`.
- `.gitignore` — `.sandbox/`.

---

### Task 1: Shared presets, setup resolution and messages

**Files:**
- Create: `shared/src/sandbox/types.ts`, `shared/src/sandbox/presets.ts`, `shared/src/sandbox/resolveSetup.ts`, `shared/src/sandbox/index.ts`
- Modify: `shared/src/index.ts`, `shared/src/messages.ts`
- Test: `shared/src/sandbox/resolveSetup.test.ts`

**Interfaces:**
- Produces:
  - `type SandboxMember = { className: string; level: number; name: string; equipment: Partial<Record<EquipmentSlot, string>> }`
  - `interface SandboxSetup { presetId: string; label: string; party: SandboxMember[]; mobs: string[]; roomType: RoomType; biome: string; seed: number | null }`
  - `interface SandboxOverrides { room?: string; biome?: string; mobs?: string[]; party?: string[]; level?: number; seed?: number }`
  - `resolveSetup(presetId: string, overrides?: SandboxOverrides): { ok: true; setup: SandboxSetup } | { ok: false; error: string }`
  - `findSandboxItem(id: string): Item | undefined`
  - `parseSandboxQuery(search: string): { preset: string; overrides: SandboxOverrides } | null`
  - `buildSandboxQuery(preset: string, overrides?: SandboxOverrides): string` (returns `?sandbox=...`)
  - `SANDBOX_PRESETS: SandboxPreset[]`, `SANDBOX_ROOM_TYPES`, `SANDBOX_MAX_MOBS = 8`, `SANDBOX_MAX_LEVEL`
  - Messages: `SandboxStartMessage { type: 'sandbox_start'; preset: string; overrides?: SandboxOverrides }`, `SandboxErrorMessage { type: 'sandbox_error'; message: string }`

- [ ] **Step 1: Write the failing tests**

`shared/src/sandbox/resolveSetup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSetup, parseSandboxQuery, buildSandboxQuery, findSandboxItem } from './resolveSetup.js';
import { SANDBOX_PRESETS } from './presets.js';

describe('SANDBOX_PRESETS', () => {
  it('every preset resolves without overrides', () => {
    for (const p of SANDBOX_PRESETS) {
      const r = resolveSetup(p.id);
      expect(r, p.id).toMatchObject({ ok: true });
    }
  });

  it('has unique ids', () => {
    const ids = SANDBOX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveSetup', () => {
  it('fills defaults from the preset', () => {
    const r = resolveSetup('duel');
    if (!r.ok) throw new Error(r.error);
    expect(r.setup).toEqual({
      presetId: 'duel', label: 'Duel', roomType: 'tunnel', biome: 'starter',
      mobs: ['tunnel_rat'], seed: 1,
      party: [{ className: 'vanguard', level: 1, name: 'Templar', equipment: {} }],
    });
  });

  it('applies every override', () => {
    const r = resolveSetup('duel', {
      room: 'boss', biome: 'fungal', mobs: ['mycelium_king', 'fungal_crawler'],
      party: ['cleric', 'cleric'], level: 3, seed: 42,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.setup.roomType).toBe('boss');
    expect(r.setup.biome).toBe('fungal');
    expect(r.setup.mobs).toEqual(['mycelium_king', 'fungal_crawler']);
    expect(r.setup.party.map((m) => m.name)).toEqual(['Suturist 1', 'Suturist 2']);
    expect(r.setup.party.every((m) => m.level === 3)).toBe(true);
    expect(r.setup.seed).toBe(42);
  });

  it.each([
    [{ room: 'ballroom' }, 'room type "ballroom"'],
    [{ biome: 'moon' }, 'biome "moon"'],
    [{ mobs: ['dragon'] }, 'mob "dragon"'],
    [{ mobs: [] }, 'at least one mob'],
    [{ party: ['wizard'] }, 'class "wizard"'],
    [{ party: [] }, 'between 1 and 4'],
    [{ level: 0 }, 'level'],
    [{ level: Number.NaN }, 'level'],
    [{ seed: Number.NaN }, 'seed'],
  ])('rejects %j', (overrides, fragment) => {
    const r = resolveSetup('duel', overrides);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('rejects an unknown preset and lists known ones', () => {
    const r = resolveSetup('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('duel');
  });

  it('finds preset equipment with the slots the showcase preset relies on', () => {
    // Wrong-slot equipment can only come from a preset (URL overrides can't set gear);
    // the "every preset resolves" test above catches a mis-slotted preset item.
    expect(findSandboxItem('worldsplitter')?.slot).toBe('weapon');
    expect(findSandboxItem('aegis_of_the_fallen')?.slot).toBe('offhand');
  });
});

describe('parseSandboxQuery / buildSandboxQuery', () => {
  it('returns null without a sandbox param', () => {
    expect(parseSandboxQuery('?foo=1')).toBeNull();
  });

  it('parses every override', () => {
    expect(parseSandboxQuery('?sandbox=duel&room=boss&biome=bone&mobs=a,b&party=vanguard,cleric&level=2&seed=7')).toEqual({
      preset: 'duel',
      overrides: { room: 'boss', biome: 'bone', mobs: ['a', 'b'], party: ['vanguard', 'cleric'], level: 2, seed: 7 },
    });
  });

  it('keeps malformed numbers as NaN so resolveSetup rejects them', () => {
    const q = parseSandboxQuery('?sandbox=duel&seed=abc');
    expect(Number.isNaN(q?.overrides.seed)).toBe(true);
    const r = resolveSetup(q!.preset, q!.overrides);
    expect(r.ok).toBe(false);
  });

  it('round-trips', () => {
    const overrides = { room: 'cavern', mobs: ['tunnel_rat', 'tunnel_rat'], seed: 3 };
    expect(parseSandboxQuery(buildSandboxQuery('duel', overrides))).toEqual({ preset: 'duel', overrides });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run src/sandbox"`
Expected: FAIL — cannot resolve `./resolveSetup.js`.

- [ ] **Step 3: Write `shared/src/sandbox/types.ts`**

```ts
import type { EquipmentSlot, RoomType } from '../types.js';

export const SANDBOX_ROOM_TYPES: readonly RoomType[] = ['tunnel', 'chamber', 'cavern', 'dead_end', 'boss'];
export const SANDBOX_MAX_MOBS = 8;
export const SANDBOX_MAX_PARTY = 4;

export interface SandboxPartyMember {
  className: string;
  level?: number;
  name?: string;
  equipment?: Partial<Record<EquipmentSlot, string>>;
}

export interface SandboxPreset {
  id: string;
  label: string;
  /** Member 0 is the connected player; the rest are bots. */
  party: SandboxPartyMember[];
  /** Mob template ids from mobPool.json; mobs[0] is the leader. Spawned exactly, no random adds. */
  mobs: string[];
  roomType: RoomType;
  biome: string;
  seed?: number;
}

export interface SandboxOverrides {
  room?: string;
  biome?: string;
  mobs?: string[];
  party?: string[];
  level?: number;
  seed?: number;
}

export interface SandboxMember {
  className: string;
  level: number;
  name: string;
  equipment: Partial<Record<EquipmentSlot, string>>;
}

export interface SandboxSetup {
  presetId: string;
  label: string;
  party: SandboxMember[];
  mobs: string[];
  roomType: RoomType;
  biome: string;
  seed: number | null;
}

export type ResolveSetupResult = { ok: true; setup: SandboxSetup } | { ok: false; error: string };
```

- [ ] **Step 4: Write `shared/src/sandbox/presets.ts`**

```ts
import type { SandboxPreset } from './types.js';

const FULL_PARTY = (level: number) => [
  { className: 'vanguard', level },
  { className: 'shadowblade', level },
  { className: 'cleric', level },
  { className: 'artificer', level },
];

export const SANDBOX_PRESETS: SandboxPreset[] = [
  { id: 'duel', label: 'Duel', party: [{ className: 'vanguard' }], mobs: ['tunnel_rat'], roomType: 'tunnel', biome: 'starter', seed: 1 },
  {
    id: 'showcase', label: 'Showcase (all classes)', roomType: 'cavern', biome: 'starter', seed: 7,
    party: [
      { className: 'vanguard', level: 3, equipment: { weapon: 'worldsplitter', offhand: 'aegis_of_the_fallen' } },
      { className: 'shadowblade', level: 3 },
      { className: 'cleric', level: 3 },
      { className: 'artificer', level: 3 },
    ],
    mobs: ['cave_troll', 'goblin_scrapper', 'alpha_wolf', 'feral_miner'],
  },
  { id: 'starter-pack', label: 'Shallow Warrens pack', party: [{ className: 'vanguard' }, { className: 'cleric' }], mobs: ['goblin_scrapper', 'tunnel_rat', 'warren_spider'], roomType: 'chamber', biome: 'starter' },
  { id: 'fungal-pack', label: 'Fungal Depths pack', party: [{ className: 'shadowblade', level: 2 }, { className: 'cleric', level: 2 }], mobs: ['sporecap_brute', 'fungal_crawler', 'spore_shambler'], roomType: 'chamber', biome: 'fungal' },
  { id: 'crystal-pack', label: 'Crystal Caverns pack', party: [{ className: 'vanguard', level: 3 }, { className: 'artificer', level: 3 }], mobs: ['geode_golem', 'shard_beetle', 'prism_wisp', 'crystal_spider'], roomType: 'cavern', biome: 'crystal' },
  { id: 'flooded-pack', label: 'Drowned Passages pack', party: [{ className: 'shadowblade', level: 3 }, { className: 'vanguard', level: 3 }], mobs: ['abyssal_angler', 'cave_eel', 'tide_crawler'], roomType: 'cavern', biome: 'flooded' },
  { id: 'bone-pack', label: 'Ossuary Halls pack', party: [{ className: 'vanguard', level: 4 }, { className: 'cleric', level: 4 }], mobs: ['lich_remnant', 'bone_rattler', 'skull_sentinel', 'grave_warden'], roomType: 'cavern', biome: 'bone' },
  { id: 'volcanic-pack', label: 'Magma Rifts pack', party: [{ className: 'artificer', level: 4 }, { className: 'vanguard', level: 4 }], mobs: ['obsidian_sentinel', 'cinder_imp', 'lava_slime'], roomType: 'chamber', biome: 'volcanic' },
  { id: 'boss-rat-king', label: 'Boss: The Rat King', party: FULL_PARTY(3), mobs: ['the_rat_king', 'tunnel_rat', 'tunnel_rat'], roomType: 'boss', biome: 'starter' },
  { id: 'boss-mycelium-king', label: 'Boss: The Mycelium King', party: FULL_PARTY(4), mobs: ['mycelium_king', 'fungal_crawler', 'spore_shambler'], roomType: 'boss', biome: 'fungal' },
  { id: 'boss-prismatic-colossus', label: 'Boss: The Prismatic Colossus', party: FULL_PARTY(5), mobs: ['prismatic_colossus', 'shard_beetle', 'prism_wisp'], roomType: 'boss', biome: 'crystal' },
  { id: 'boss-drowned-leviathan', label: 'Boss: The Drowned Leviathan', party: FULL_PARTY(5), mobs: ['the_drowned_leviathan', 'cave_eel', 'drowned_shambler'], roomType: 'boss', biome: 'flooded' },
  { id: 'boss-charnel-king', label: 'Boss: The Charnel King', party: FULL_PARTY(6), mobs: ['the_charnel_king', 'bone_rattler', 'skull_sentinel'], roomType: 'boss', biome: 'bone' },
  { id: 'boss-forge-titan', label: 'Boss: The Forge Titan', party: FULL_PARTY(6), mobs: ['the_forge_titan', 'cinder_imp', 'magma_beetle'], roomType: 'boss', biome: 'volcanic' },
];
```

- [ ] **Step 5: Write `shared/src/sandbox/resolveSetup.ts`**

```ts
import mobPool from '../data/mobPool.json' with { type: 'json' };
import biomes from '../data/biomes.json' with { type: 'json' };
import uniqueItems from '../data/uniqueItems.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import { CLASS_DEFINITIONS } from '../classData.js';
import { CLASS_STARTER_ITEMS } from '../content.js';
import { PROGRESSION_CONFIG } from '../data/progression.js';
import type { EquipmentSlot, Item, RoomType } from '../types.js';
import { SANDBOX_PRESETS } from './presets.js';
import {
  SANDBOX_ROOM_TYPES, SANDBOX_MAX_MOBS, SANDBOX_MAX_PARTY,
  type ResolveSetupResult, type SandboxMember, type SandboxOverrides,
} from './types.js';

export const SANDBOX_MAX_LEVEL = PROGRESSION_CONFIG.levelThresholds.length;

const MOB_IDS = new Set((mobPool as { id: string }[]).map((m) => m.id));
const BIOME_IDS = new Set((biomes as { id: string }[]).map((b) => b.id));
const ALL_ITEMS: Item[] = [
  ...(uniqueItems as Item[]),
  ...(items as Item[]),
  ...Object.values(CLASS_STARTER_ITEMS).flatMap((s) => [s.weapon, s.offhand]),
];

export function findSandboxItem(id: string): Item | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}

const fail = (error: string): ResolveSetupResult => ({ ok: false, error });

export function resolveSetup(presetId: string, overrides: SandboxOverrides = {}): ResolveSetupResult {
  const preset = SANDBOX_PRESETS.find((p) => p.id === presetId);
  if (!preset) return fail(`Unknown sandbox preset "${presetId}". Known presets: ${SANDBOX_PRESETS.map((p) => p.id).join(', ')}`);

  const roomType = overrides.room ?? preset.roomType;
  if (!SANDBOX_ROOM_TYPES.includes(roomType as RoomType)) {
    return fail(`Unknown room type "${roomType}". Use one of: ${SANDBOX_ROOM_TYPES.join(', ')}`);
  }
  const biome = overrides.biome ?? preset.biome;
  if (!BIOME_IDS.has(biome)) return fail(`Unknown biome "${biome}". Use one of: ${[...BIOME_IDS].join(', ')}`);

  const mobs = overrides.mobs ?? preset.mobs;
  if (mobs.length === 0) return fail('A sandbox fight needs at least one mob.');
  if (mobs.length > SANDBOX_MAX_MOBS) return fail(`Too many mobs (${mobs.length}); the limit is ${SANDBOX_MAX_MOBS}.`);
  const badMob = mobs.find((id) => !MOB_IDS.has(id));
  if (badMob) return fail(`Unknown mob "${badMob}" (not in mobPool.json).`);

  const baseParty = overrides.party ? overrides.party.map((className) => ({ className })) : preset.party;
  if (baseParty.length < 1 || baseParty.length > SANDBOX_MAX_PARTY) {
    return fail(`Party size must be between 1 and ${SANDBOX_MAX_PARTY} (got ${baseParty.length}).`);
  }
  const badClass = baseParty.find((m) => !CLASS_DEFINITIONS.some((c) => c.id === m.className));
  if (badClass) return fail(`Unknown class "${badClass.className}". Use one of: ${CLASS_DEFINITIONS.map((c) => c.id).join(', ')}`);

  if (overrides.level !== undefined && !isValidLevel(overrides.level)) {
    return fail(`Level must be a whole number from 1 to ${SANDBOX_MAX_LEVEL} (got ${overrides.level}).`);
  }

  const classCounts = new Map<string, number>();
  for (const m of baseParty) classCounts.set(m.className, (classCounts.get(m.className) ?? 0) + 1);
  const classSeen = new Map<string, number>();
  const party: SandboxMember[] = [];
  for (const m of baseParty) {
    const level = overrides.level ?? ('level' in m && m.level !== undefined ? m.level : 1);
    if (!isValidLevel(level)) return fail(`Level must be a whole number from 1 to ${SANDBOX_MAX_LEVEL} (got ${level}).`);
    const displayName = CLASS_DEFINITIONS.find((c) => c.id === m.className)!.displayName;
    const n = (classSeen.get(m.className) ?? 0) + 1;
    classSeen.set(m.className, n);
    const defaultName = classCounts.get(m.className)! > 1 ? `${displayName} ${n}` : displayName;
    const equipment = ('equipment' in m && m.equipment) ? m.equipment : {};
    for (const [slot, itemId] of Object.entries(equipment) as [EquipmentSlot, string][]) {
      const item = findSandboxItem(itemId);
      if (!item) return fail(`Unknown item "${itemId}".`);
      if (item.slot !== slot) return fail(`Item "${itemId}" is a ${item.slot}, not a ${slot}.`);
    }
    party.push({ className: m.className, level, name: ('name' in m && m.name) ? m.name : defaultName, equipment: { ...equipment } });
  }

  const seed = overrides.seed ?? preset.seed ?? null;
  if (seed !== null && !Number.isInteger(seed)) return fail(`Seed must be a whole number (got ${seed}).`);

  return { ok: true, setup: { presetId: preset.id, label: preset.label, party, mobs: [...mobs], roomType: roomType as RoomType, biome, seed } };
}

function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= SANDBOX_MAX_LEVEL;
}

export function parseSandboxQuery(search: string): { preset: string; overrides: SandboxOverrides } | null {
  const params = new URLSearchParams(search);
  const preset = params.get('sandbox');
  if (!preset) return null;
  const overrides: SandboxOverrides = {};
  const list = (key: string) => params.get(key)!.split(',').map((s) => s.trim()).filter(Boolean);
  if (params.has('room')) overrides.room = params.get('room')!;
  if (params.has('biome')) overrides.biome = params.get('biome')!;
  if (params.has('mobs')) overrides.mobs = list('mobs');
  if (params.has('party')) overrides.party = list('party');
  if (params.has('level')) overrides.level = Number(params.get('level'));
  if (params.has('seed')) overrides.seed = Number(params.get('seed'));
  return { preset, overrides };
}

export function buildSandboxQuery(preset: string, overrides: SandboxOverrides = {}): string {
  const params = new URLSearchParams({ sandbox: preset });
  if (overrides.room) params.set('room', overrides.room);
  if (overrides.biome) params.set('biome', overrides.biome);
  if (overrides.mobs) params.set('mobs', overrides.mobs.join(','));
  if (overrides.party) params.set('party', overrides.party.join(','));
  if (overrides.level !== undefined) params.set('level', String(overrides.level));
  if (overrides.seed !== undefined) params.set('seed', String(overrides.seed));
  return `?${params.toString()}`;
}
```

Note: `PROGRESSION_CONFIG` is exported from `shared/src/data/progression.ts` (re-exported by `shared/src/index.ts`). If `CLASS_DEFINITIONS` entries lack `displayName`, check `shared/src/classTypes.ts` for the field name used by `classes.json` (it is `displayName` there).

- [ ] **Step 6: Write `shared/src/sandbox/index.ts` and export it**

```ts
export * from './types.js';
export * from './presets.js';
export * from './resolveSetup.js';
```

In `shared/src/index.ts`, add after the `export * from './characterCreation.js';` line:

```ts
export * from './sandbox/index.js';
```

- [ ] **Step 7: Add the messages to `shared/src/messages.ts`**

At the top imports of `messages.ts` add:

```ts
import type { SandboxOverrides } from './sandbox/types.js';
```

After `DebugGiveItemMessage`:

```ts
export interface SandboxStartMessage {
  type: 'sandbox_start';
  preset: string;
  overrides?: SandboxOverrides;
}
```

Next to `ErrorMessage`:

```ts
export interface SandboxErrorMessage {
  type: 'sandbox_error';
  message: string;
}
```

Add `| SandboxStartMessage` to the `ClientMessage` union (after `| DebugGiveItemMessage`) and `| SandboxErrorMessage` to the `ServerMessage` union (after `| CharacterPanelErrorMessage`, moving the `;`).

- [ ] **Step 8: Run tests and type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\shared && npx vitest run && npx tsc --noEmit -p ."`
Expected: all shared tests PASS; no type errors.

Then rebuild shared for downstream workspaces:
`cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run build --workspace=shared"`

- [ ] **Step 9: Stop for review** (no git — the user commits).

---

### Task 2: Seeded Math.random

**Files:**
- Create: `server/src/sandbox/seededRandom.ts`
- Test: `server/src/sandbox/seededRandom.test.ts`

**Interfaces:**
- Produces: `installSeededRandom(seed: number): () => void` — replaces `Math.random`, returns `restore`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { installSeededRandom } from './seededRandom.js';

describe('installSeededRandom', () => {
  it('produces the same sequence for the same seed and restores the original', () => {
    const original = Math.random;
    const restoreA = installSeededRandom(42);
    const a = [Math.random(), Math.random(), Math.random()];
    restoreA();
    expect(Math.random).toBe(original);

    const restoreB = installSeededRandom(42);
    const b = [Math.random(), Math.random(), Math.random()];
    restoreB();
    expect(b).toEqual(a);
  });

  it('gives different sequences for different seeds and stays in [0, 1)', () => {
    const r1 = installSeededRandom(1);
    const a = Array.from({ length: 100 }, () => Math.random());
    r1();
    const r2 = installSeededRandom(2);
    const b = Array.from({ length: 100 }, () => Math.random());
    r2();
    expect(a).not.toEqual(b);
    expect(a.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/seededRandom.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/sandbox/seededRandom.ts`**

```ts
/**
 * Replace Math.random with a seeded mulberry32 generator. Process-wide, so this is
 * only acceptable in dev sandbox/simulator runs; call the returned restore() on teardown.
 */
export function installSeededRandom(seed: number): () => void {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = original; };
}
```

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.

- [ ] **Step 5: Stop for review.**

---

### Task 3: GameSession hooks and sandbox content builders

**Files:**
- Modify: `server/src/GameSession.ts`
- Create: `server/src/sandbox/sandboxContent.ts`
- Test: `server/src/GameSession.sandbox.test.ts`, `server/src/sandbox/sandboxContent.test.ts`

**Interfaces:**
- Consumes: `SandboxSetup`, `SandboxMember`, `findSandboxItem` (Task 1).
- Produces (GameSession):
  - `export interface SessionTiming { mobTurnDelayMs: number; victoryDelayMs: number; postVictoryLootDelayMs: number; defendTimeoutMs: number }`
  - `setTiming(overrides: Partial<SessionTiming>): void`
  - `addPrebuiltPlayer(player: Player): void` (call before `startGame()`)
  - `startArenaCombat(roomId: string, mobInstances: MobInstance[]): void`
  - `export interface ArenaSnapshot { grid: TileGrid; positions: Record<string, { x: number; y: number }>; participants: { id: string; type: 'player' | 'mob'; hp: number }[]; currentTurnId: string; roundNumber: number; movementRemaining: number }`
  - `getArenaSnapshot(roomId: string): ArenaSnapshot | null`
  - `dispose(): void`
- Produces (sandboxContent):
  - `SANDBOX_ROOM_ID = 'sandbox_arena'`
  - `buildSandboxContent(setup: SandboxSetup): DungeonContent`
  - `buildSandboxMobs(setup: SandboxSetup): MobInstance[]` — instance ids `${templateId}_${index}`
  - `buildSandboxPlayer(id: string, member: SandboxMember, roomId: string): Player`

- [ ] **Step 1: Write the failing tests**

`server/src/sandbox/sandboxContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSetup, getClassDefinition, PROGRESSION_CONFIG } from '@caverns/shared';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandboxContent.js';

function setup(presetId: string, overrides = {}) {
  const r = resolveSetup(presetId, overrides);
  if (!r.ok) throw new Error(r.error);
  return r.setup;
}

describe('buildSandboxContent', () => {
  it('builds a single room of the requested type and biome', () => {
    const content = buildSandboxContent(setup('duel', { room: 'cavern', biome: 'bone' }));
    expect(content.biomeId).toBe('bone');
    expect(content.entranceRoomId).toBe(SANDBOX_ROOM_ID);
    expect(content.rooms).toHaveLength(1);
    expect(content.rooms[0]).toMatchObject({ id: SANDBOX_ROOM_ID, type: 'cavern', exits: {} });
    expect(content.rooms[0].encounter).toBeUndefined();
    expect(content.mobs.map((m) => m.id)).toEqual(['tunnel_rat']);
  });
});

describe('buildSandboxMobs', () => {
  it('gives duplicate mobs distinct instance ids', () => {
    const mobs = buildSandboxMobs(setup('duel', { mobs: ['tunnel_rat', 'tunnel_rat', 'goblin_scrapper'] }));
    expect(mobs.map((m) => m.instanceId)).toEqual(['tunnel_rat_0', 'tunnel_rat_1', 'goblin_scrapper_2']);
    expect(mobs[0].hp).toBe(mobs[0].maxHp);
    expect(mobs[0].templateId).toBe('tunnel_rat');
  });
});

describe('buildSandboxPlayer', () => {
  it('level 1 uses class base HP', () => {
    const s = setup('duel');
    const p = buildSandboxPlayer('p1', s.party[0], SANDBOX_ROOM_ID);
    expect(p.maxHp).toBe(getClassDefinition('vanguard')!.baseStats.maxHp);
    expect(p.hp).toBe(p.maxHp);
    expect(p.level).toBe(1);
  });

  it('spreads stat points by level and applies equipment', () => {
    const s = setup('showcase');
    const p = buildSandboxPlayer('p1', s.party[0], SANDBOX_ROOM_ID);
    const points = (3 - 1) * PROGRESSION_CONFIG.statPointsPerLevel;
    const spent = Object.values(p.statAllocations).reduce((a, b) => a + b, 0);
    expect(spent).toBe(points);
    expect(p.equipment.weapon?.id).toBe('worldsplitter');
    expect(p.equipment.offhand?.id).toBe('aegis_of_the_fallen');
  });
});
```

`server/src/GameSession.sandbox.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, type ServerMessage } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';

function makeSession() {
  const r = resolveSetup('duel');
  if (!r.ok) throw new Error(r.error);
  const sent: { to: string | null; msg: ServerMessage }[] = [];
  const session = new GameSession(
    (msg) => sent.push({ to: null, msg }),
    (to, msg) => sent.push({ to, msg }),
    buildSandboxContent(r.setup),
  );
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  return { session, sent, setup: r.setup };
}

describe('GameSession sandbox hooks', () => {
  it('starts arena combat directly and exposes a snapshot', () => {
    const { session, sent, setup } = makeSession();
    session.startGame();
    expect(sent.some((s) => s.to === 'p1' && s.msg.type === 'game_start')).toBe(true);

    session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
    expect(sent.some((s) => s.to === 'p1' && s.msg.type === 'arena_combat_start')).toBe(true);

    const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
    expect(snap).not.toBeNull();
    expect(snap.participants.map((p) => p.id).sort()).toEqual(['p1', 'tunnel_rat_0']);
    expect(snap.positions.p1).toBeDefined();
    expect(snap.grid.width).toBe(30); // tunnel
    session.dispose();
  });

  it('dispose stops pending mob turns from emitting', () => {
    vi.useFakeTimers();
    try {
      const { session, sent, setup } = makeSession();
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
      session.dispose();
      const before = sent.length;
      vi.advanceTimersByTime(60_000);
      expect(sent.length).toBe(before);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('setTiming overrides the mob turn delay', () => {
    vi.useFakeTimers();
    try {
      const { session, sent, setup } = makeSession();
      session.setTiming({ mobTurnDelayMs: 0 });
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
      const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
      if (snap.currentTurnId === 'p1') session.handleArenaEndTurn('p1');
      const before = sent.length;
      vi.advanceTimersByTime(1); // a 600 ms default delay would not have fired yet
      expect(sent.length).toBeGreaterThan(before);
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/sandboxContent.test.ts src/GameSession.sandbox.test.ts"`
Expected: FAIL — `./sandbox/sandboxContent.js` not found / `addPrebuiltPlayer` is not a function.

- [ ] **Step 3: Add the hooks to `server/src/GameSession.ts`**

3a. Above `export class GameSession`, add:

```ts
export interface SessionTiming {
  mobTurnDelayMs: number;
  victoryDelayMs: number;
  postVictoryLootDelayMs: number;
  defendTimeoutMs: number;
}

export interface ArenaSnapshot {
  grid: TileGrid;
  positions: Record<string, { x: number; y: number }>;
  participants: { id: string; type: 'player' | 'mob'; hp: number }[];
  currentTurnId: string;
  roundNumber: number;
  movementRemaining: number;
}
```

Make sure `TileGrid`, `Player` and `MobInstance` are in the `@caverns/shared` type import at the top of the file (add any that are missing).

3b. Inside the class, next to `private pendingDefend`, add:

```ts
  private timing: SessionTiming = {
    mobTurnDelayMs: TIMING_CONFIG.mobTurnDelayMs,
    victoryDelayMs: TIMING_CONFIG.victoryDelayMs,
    postVictoryLootDelayMs: TIMING_CONFIG.postVictoryLootDelayMs,
    defendTimeoutMs: QTE_CONFIG.defendTimeoutMs,
  };
  private disposed = false;
```

3c. Replace the four timing reads:
- `TIMING_CONFIG.victoryDelayMs` (in `afterCombatTurn`) → `this.timing.victoryDelayMs`
- `TIMING_CONFIG.mobTurnDelayMs` (in `afterCombatTurn`) → `this.timing.mobTurnDelayMs`
- `TIMING_CONFIG.postVictoryLootDelayMs` (in `finishCombat`) → `this.timing.postVictoryLootDelayMs`
- `QTE_CONFIG.defendTimeoutMs` (in `processMobTurn`) → `this.timing.defendTimeoutMs`

3d. Add guards as the first line of `processMobTurn`, `afterCombatTurn` and `finishCombat`:

```ts
    if (this.disposed) return;
```

3e. After `addPlayer(...)`, add:

```ts
  /** Register a fully built Player (sandbox); used instead of DB hydration. Call before startGame(). */
  addPrebuiltPlayer(player: Player): void {
    this.addPlayer(player.id, player.name, player.className);
    this.hydratedPlayers.set(player.id, player);
  }

  setTiming(overrides: Partial<SessionTiming>): void {
    this.timing = { ...this.timing, ...overrides };
  }

  /** Start arena combat in a room with exactly these mobs (sandbox entry point). */
  startArenaCombat(roomId: string, mobInstances: MobInstance[]): void {
    this.roomMobInstances.set(roomId, mobInstances);
    this.startCombat(roomId, mobInstances);
  }

  getArenaSnapshot(roomId: string): ArenaSnapshot | null {
    const combat = this.combats.get(roomId);
    if (!combat) return null;
    const state = combat.getState();
    return {
      grid: combat.getGrid(),
      positions: combat.getAllPositions(),
      participants: combat.getParticipantsArray()
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, type: p.type, hp: p.hp })),
      currentTurnId: state.currentTurnId,
      roundNumber: state.roundNumber,
      movementRemaining: combat.getTurnState(state.currentTurnId)?.movementRemaining ?? 0,
    };
  }

  /** Stop all timers and make pending callbacks no-ops. The session is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mobAIManager.destroy();
    for (const t of this.goldWriteTimers.values()) clearTimeout(t);
    this.goldWriteTimers.clear();
    if (this.pendingDefend) {
      clearTimeout(this.pendingDefend.timeout);
      this.pendingDefend = null;
    }
    for (const combat of this.combats.values()) combat.cancelAfkTimer();
    this.combats.clear();
  }
```

(`hydratedPlayers` is the existing private map used by `hydratePlayerFromCharacter`/`startGame`.)

- [ ] **Step 4: Write `server/src/sandbox/sandboxContent.ts`**

```ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  computePlayerStats, findSandboxItem, PROGRESSION_CONFIG,
  type DungeonContent, type EquipmentSlot, type MobInstance, type MobPoolEntry,
  type MobTemplate, type Player, type Room, type SandboxMember, type SandboxSetup,
} from '@caverns/shared';
import { PlayerManager } from '../PlayerManager.js';

const here = dirname(fileURLToPath(import.meta.url));
const MOB_POOL: MobPoolEntry[] = JSON.parse(
  readFileSync(resolve(here, '../../../shared/src/data/mobPool.json'), 'utf-8'),
);

export const SANDBOX_ROOM_ID = 'sandbox_arena';

function poolEntry(id: string): MobPoolEntry {
  const entry = MOB_POOL.find((m) => m.id === id);
  if (!entry) throw new Error(`Unknown mob template "${id}"`);
  return entry;
}

function templateFromEntry(e: MobPoolEntry): MobTemplate {
  return {
    id: e.id, name: e.name, description: e.description, skullRating: e.skullRating,
    maxHp: e.baseStats.maxHp, damage: e.baseStats.damage,
    defense: e.baseStats.defense, initiative: e.baseStats.initiative,
    drops: e.drops,
  };
}

export function buildSandboxContent(setup: SandboxSetup): DungeonContent {
  const templates = [...new Set(setup.mobs)].map((id) => templateFromEntry(poolEntry(id)));
  const room: Room = {
    id: SANDBOX_ROOM_ID,
    type: setup.roomType,
    name: setup.label,
    description: 'A sandbox arena.',
    exits: {},
  };
  return {
    name: `Sandbox: ${setup.label}`,
    theme: 'sandbox',
    atmosphere: '',
    biomeId: setup.biome,
    rooms: [room],
    mobs: templates,
    items: [],
    bossId: templates[0].id,
    entranceRoomId: SANDBOX_ROOM_ID,
  };
}

export function buildSandboxMobs(setup: SandboxSetup): MobInstance[] {
  return setup.mobs.map((id, i) => {
    const e = poolEntry(id);
    return {
      instanceId: `${id}_${i}`,
      templateId: id,
      name: e.name,
      maxHp: e.baseStats.maxHp,
      hp: e.baseStats.maxHp,
      damage: e.baseStats.damage,
      defense: e.baseStats.defense,
      initiative: e.baseStats.initiative,
    };
  });
}

/** Build a player the way the game does (class stats + starter gear), then apply level and equipment. */
export function buildSandboxPlayer(id: string, member: SandboxMember, roomId: string): Player {
  const player = new PlayerManager().addPlayer(id, member.name, roomId, member.className);
  for (const [slot, itemId] of Object.entries(member.equipment) as [EquipmentSlot, string][]) {
    const item = findSandboxItem(itemId);
    if (!item) throw new Error(`Unknown item "${itemId}"`);
    player.equipment[slot] = { ...item };
  }
  player.level = member.level;
  player.xp = PROGRESSION_CONFIG.levelThresholds[member.level - 1] ?? 0;
  const defs = PROGRESSION_CONFIG.statDefinitions;
  const points = (member.level - 1) * PROGRESSION_CONFIG.statPointsPerLevel;
  for (let i = 0; i < points; i++) {
    const statId = defs[i % defs.length].id;
    player.statAllocations[statId] = (player.statAllocations[statId] ?? 0) + 1;
  }
  const stats = computePlayerStats(player);
  player.maxHp = stats.maxHp;
  player.hp = stats.maxHp;
  player.energy = stats.maxEnergy;
  return player;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/sandboxContent.test.ts src/GameSession.sandbox.test.ts src/GameSession.test.ts src/ArenaCombatManager.test.ts"`
Expected: PASS (existing GameSession/Arena tests still pass).

- [ ] **Step 6: Type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx tsc --noEmit -p ."`
Expected: no errors.

- [ ] **Step 7: Stop for review.**

---

### Task 4: Auto player

**Files:**
- Create: `server/src/sandbox/autoPlayer.ts`
- Test: `server/src/sandbox/autoPlayer.test.ts`

**Interfaces:**
- Consumes: `ArenaSnapshot` (Task 3), `getMovementRange`, `isAdjacent` from `server/src/arenaMovement.ts`.
- Produces:
  - `type BotAction = { type: 'move'; x: number; y: number } | { type: 'attack'; targetId: string } | { type: 'end_turn' }`
  - `decideTurn(snap: ArenaSnapshot, selfId: string): BotAction[]` — always ends with `end_turn`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import type { TileGrid } from '@caverns/shared';
import type { ArenaSnapshot } from '../GameSession.js';
import { isAdjacent } from '../arenaMovement.js';
import { decideTurn } from './autoPlayer.js';

function grid(rows: string[]): TileGrid {
  return {
    width: rows[0].length,
    height: rows.length,
    tiles: rows.map((r) => [...r].map((c) => (c === '#' ? 'wall' : 'floor'))),
  };
}

const OPEN = grid([
  '########',
  '#......#',
  '#......#',
  '#......#',
  '#......#',
  '########',
]);

function snap(partial: Partial<ArenaSnapshot>): ArenaSnapshot {
  return {
    grid: OPEN, positions: {}, participants: [], currentTurnId: 'p1',
    roundNumber: 1, movementRemaining: 5, ...partial,
  };
}

const P1 = { id: 'p1', type: 'player' as const, hp: 50 };

describe('decideTurn', () => {
  it('attacks the weakest adjacent enemy', () => {
    const actions = decideTurn(snap({
      positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 }, m2: { x: 2, y: 3 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }, { id: 'm2', type: 'mob', hp: 5 }],
    }), 'p1');
    expect(actions).toEqual([{ type: 'attack', targetId: 'm2' }, { type: 'end_turn' }]);
  });

  it('moves next to a reachable enemy, then attacks', () => {
    const s = snap({
      positions: { p1: { x: 1, y: 1 }, m1: { x: 5, y: 1 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    });
    const actions = decideTurn(s, 'p1');
    expect(actions[0].type).toBe('move');
    const dest = actions[0] as { x: number; y: number };
    expect(isAdjacent(dest, { x: 5, y: 1 })).toBe(true);
    expect(actions.slice(1)).toEqual([{ type: 'attack', targetId: 'm1' }, { type: 'end_turn' }]);
  });

  it('moves closer when no enemy is reachable this turn', () => {
    const actions = decideTurn(snap({
      movementRemaining: 1,
      positions: { p1: { x: 1, y: 1 }, m1: { x: 6, y: 4 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'p1');
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('move');
    const dest = actions[0] as { x: number; y: number };
    expect(Math.abs(dest.x - 6) + Math.abs(dest.y - 4)).toBeLessThan(5 + 3);
    expect(actions[1]).toEqual({ type: 'end_turn' });
  });

  it('mobs target players', () => {
    const actions = decideTurn(snap({
      currentTurnId: 'm1',
      positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'm1');
    expect(actions[0]).toEqual({ type: 'attack', targetId: 'p1' });
  });

  it('ends the turn when fully blocked', () => {
    const walled = grid([
      '#####',
      '#.#.#',
      '#####',
    ]);
    const actions = decideTurn(snap({
      grid: walled,
      positions: { p1: { x: 1, y: 1 }, m1: { x: 3, y: 1 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'p1');
    expect(actions).toEqual([{ type: 'end_turn' }]);
  });

  it('ends the turn when there are no enemies', () => {
    expect(decideTurn(snap({ positions: { p1: { x: 1, y: 1 } }, participants: [P1] }), 'p1'))
      .toEqual([{ type: 'end_turn' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/autoPlayer.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/sandbox/autoPlayer.ts`**

```ts
import type { ArenaSnapshot } from '../GameSession.js';
import { getMovementRange, isAdjacent } from '../arenaMovement.js';

export type BotAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: string }
  | { type: 'end_turn' };

type Pos = { x: number; y: number };
const keyOf = (p: Pos) => `${p.x},${p.y}`;
const parseKey = (k: string): Pos => { const [x, y] = k.split(',').map(Number); return { x, y }; };
const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Simple, deterministic turn: attack if adjacent, else close in (and attack if that reaches), else end. */
export function decideTurn(snap: ArenaSnapshot, selfId: string): BotAction[] {
  const END: BotAction = { type: 'end_turn' };
  const self = snap.participants.find((p) => p.id === selfId);
  const selfPos = snap.positions[selfId];
  if (!self || !selfPos) return [END];

  const enemies = snap.participants
    .filter((p) => p.type !== self.type && snap.positions[p.id])
    .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
  if (enemies.length === 0) return [END];

  const adjacent = enemies.find((e) => isAdjacent(selfPos, snap.positions[e.id]));
  if (adjacent) return [{ type: 'attack', targetId: adjacent.id }, END];

  const occupied = new Set(
    snap.participants
      .filter((p) => p.id !== selfId && snap.positions[p.id])
      .map((p) => keyOf(snap.positions[p.id])),
  );
  const reachable = getMovementRange(snap.grid, selfPos, snap.movementRemaining, occupied);
  reachable.delete(keyOf(selfPos));
  const tiles = [...reachable.entries()]
    .map(([k, mp]) => ({ pos: parseKey(k), mp, key: k }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  // Enemies are sorted weakest-first, so the first enemy with a reachable neighbour tile wins.
  for (const enemy of enemies) {
    const ePos = snap.positions[enemy.id];
    const spots = tiles.filter((t) => isAdjacent(t.pos, ePos)).sort((a, b) => b.mp - a.mp);
    if (spots.length > 0) {
      return [{ type: 'move', ...spots[0].pos }, { type: 'attack', targetId: enemy.id }, END];
    }
  }

  const distTo = (p: Pos) => Math.min(...enemies.map((e) => manhattan(p, snap.positions[e.id])));
  const current = distTo(selfPos);
  let best: { pos: Pos; d: number; mp: number } | null = null;
  for (const t of tiles) {
    const d = distTo(t.pos);
    if (!best || d < best.d || (d === best.d && t.mp > best.mp)) best = { pos: t.pos, d, mp: t.mp };
  }
  if (best && best.d < current) return [{ type: 'move', ...best.pos }, END];
  return [END];
}
```

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.

- [ ] **Step 5: Stop for review.**

---

### Task 5: Sandbox session, simulator and CLI

**Files:**
- Create: `server/src/sandbox/sandboxSession.ts`, `server/src/sandbox/simulate.ts`, `server/src/sandbox/simCli.ts`
- Modify: `server/package.json`, `package.json`
- Test: `server/src/sandbox/simulate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `interface SandboxSessionOptions { sessionId: string; humanId: string | null; sendToHuman?: (msg: ServerMessage) => void; botTurnDelayMs: number; timing?: Partial<SessionTiming>; onMessage?: (recipientId: string | null, msg: ServerMessage) => void; onError?: (err: unknown) => void }`
  - `interface SandboxSession { session: GameSession; roomId: string; memberIds: string[]; dispose(): void }`
  - `createSandboxSession(setup: SandboxSetup, opts: SandboxSessionOptions): SandboxSession` — member 0 is `humanId` when given, else `sandbox-bot-0`; others `sandbox-bot-<i>`.
  - `interface SimResult { result: 'victory' | 'wipe' | 'flee' | 'timeout' | 'error'; rounds: number; actions: number; names: Record<string, string>; damageDealt: Record<string, number>; damageTaken: Record<string, number>; log: ServerMessage[]; errors: string[] }`
  - `simulateFight(setup: SandboxSetup, opts?: { maxRounds?: number }): Promise<SimResult>`

Note vs spec: `SimResult` counts `actions` (combat actions resolved) instead of `turns`, adds `names` (unit id → display name, for the CLI) and an `'error'` result for fights that fail to start.

- [ ] **Step 1: Write the failing tests**

`server/src/sandbox/simulate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSetup, SANDBOX_PRESETS } from '@caverns/shared';
import { simulateFight } from './simulate.js';

function setupFor(id: string, seed: number) {
  const r = resolveSetup(id, { seed });
  if (!r.ok) throw new Error(r.error);
  return r.setup;
}

describe('simulateFight', () => {
  describe.each(SANDBOX_PRESETS.map((p) => p.id))('preset %s', (id) => {
    it.each([1, 2, 3])('seed %i finishes cleanly', async (seed) => {
      const res = await simulateFight(setupFor(id, seed), { maxRounds: 100 });
      expect(res.errors).toEqual([]);
      expect(['victory', 'wipe']).toContain(res.result);
      expect(res.actions).toBeGreaterThan(0);
    }, 30_000);
  });

  it('replays identically for the same seed', async () => {
    const a = await simulateFight(setupFor('showcase', 11));
    const b = await simulateFight(setupFor('showcase', 11));
    const pick = (r: typeof a) => ({ result: r.result, rounds: r.rounds, actions: r.actions, damageDealt: r.damageDealt, damageTaken: r.damageTaken });
    expect(pick(b)).toEqual(pick(a));
  }, 30_000);

  it('restores Math.random afterwards', async () => {
    const original = Math.random;
    await simulateFight(setupFor('duel', 5));
    expect(Math.random).toBe(original);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/simulate.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/sandbox/sandboxSession.ts`**

```ts
import type { SandboxSetup, ServerMessage } from '@caverns/shared';
import { GameSession, type SessionTiming } from '../GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandboxContent.js';
import { decideTurn, type BotAction } from './autoPlayer.js';
import { installSeededRandom } from './seededRandom.js';

export interface SandboxSessionOptions {
  sessionId: string;
  /** Connection id of the human playing member 0, or null for all-bot (simulator) runs. */
  humanId: string | null;
  sendToHuman?: (msg: ServerMessage) => void;
  botTurnDelayMs: number;
  timing?: Partial<SessionTiming>;
  /** Tap for every outgoing message; recipientId is null for broadcasts. */
  onMessage?: (recipientId: string | null, msg: ServerMessage) => void;
  onError?: (err: unknown) => void;
}

export interface SandboxSession {
  session: GameSession;
  roomId: string;
  memberIds: string[];
  dispose(): void;
}

export function createSandboxSession(setup: SandboxSetup, opts: SandboxSessionOptions): SandboxSession {
  const restoreRandom = setup.seed !== null ? installSeededRandom(setup.seed) : null;
  const memberIds = setup.party.map((_, i) => (i === 0 && opts.humanId ? opts.humanId : `sandbox-bot-${i}`));
  const botIds = new Set(memberIds.filter((id) => id !== opts.humanId));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
  };

  const deliver = (recipientId: string | null, msg: ServerMessage) => {
    if (disposed) return;
    if (opts.humanId && (recipientId === null || recipientId === opts.humanId)) opts.sendToHuman?.(msg);
    opts.onMessage?.(recipientId, msg);
    // Each player in the room gets its own copy of combat_turn; a bot acts on its own copy only.
    if (msg.type === 'combat_turn' && recipientId && botIds.has(recipientId) && msg.currentTurnId === recipientId) {
      later(() => runBotTurn(recipientId), opts.botTurnDelayMs);
    }
  };

  let session: GameSession;
  try {
    session = new GameSession(
      (msg) => deliver(null, msg),
      (to, msg) => deliver(to, msg),
      buildSandboxContent(setup),
      undefined,
      null,
      null,
      opts.sessionId,
    );
    if (opts.timing) session.setTiming(opts.timing);
    setup.party.forEach((member, i) => session.addPrebuiltPlayer(buildSandboxPlayer(memberIds[i], member, SANDBOX_ROOM_ID)));
    session.startGame();
    session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
  } catch (err) {
    restoreRandom?.();
    throw err;
  }

  function apply(botId: string, action: BotAction): void {
    if (action.type === 'move') session.handleArenaMove(botId, action.x, action.y);
    else if (action.type === 'attack') session.handleCombatAction(botId, 'attack', action.targetId);
    else session.handleArenaEndTurn(botId);
  }

  function runBotTurn(botId: string): void {
    const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID);
    if (!snap || snap.currentTurnId !== botId) return;
    const actions = decideTurn(snap, botId);
    const step = (i: number) => {
      try {
        apply(botId, actions[i]);
      } catch (err) {
        opts.onError?.(err);
        return;
      }
      if (i + 1 < actions.length) later(() => step(i + 1), opts.botTurnDelayMs);
    };
    step(0);
  }

  return {
    session,
    roomId: SANDBOX_ROOM_ID,
    memberIds,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      session.dispose();
      restoreRandom?.();
    },
  };
}
```

- [ ] **Step 4: Implement `server/src/sandbox/simulate.ts`**

```ts
import type { SandboxSetup, ServerMessage } from '@caverns/shared';
import { createSandboxSession, type SandboxSession } from './sandboxSession.js';

export interface SimResult {
  result: 'victory' | 'wipe' | 'flee' | 'timeout' | 'error';
  rounds: number;
  actions: number;
  names: Record<string, string>;
  damageDealt: Record<string, number>;
  damageTaken: Record<string, number>;
  log: ServerMessage[];
  errors: string[];
}

// Member 0 in an all-bot run; every room broadcast reaches it, so its copy is the canonical log.
const OBSERVER = 'sandbox-bot-0';

export function simulateFight(setup: SandboxSetup, opts: { maxRounds?: number } = {}): Promise<SimResult> {
  const maxRounds = opts.maxRounds ?? 100;
  return new Promise((resolvePromise) => {
    const res: SimResult = { result: 'timeout', rounds: 0, actions: 0, names: {}, damageDealt: {}, damageTaken: {}, log: [], errors: [] };
    let sandbox: SandboxSession | undefined;
    let done = false;

    const finish = (result: SimResult['result']) => {
      if (done) return;
      done = true;
      res.result = result;
      sandbox?.dispose();
      resolvePromise(res);
    };

    const onMessage = (recipientId: string | null, msg: ServerMessage) => {
      if (recipientId !== null && recipientId !== OBSERVER) return;
      res.log.push(msg);
      if (msg.type === 'arena_combat_start') {
        for (const p of msg.combat.participants) res.names[p.id] = p.name;
      } else if (msg.type === 'combat_turn') {
        res.rounds = Math.max(res.rounds, msg.roundNumber);
        if (res.rounds > maxRounds) finish('timeout');
      } else if (msg.type === 'combat_action_result') {
        res.actions++;
        const r = msg as { actorId?: string; targetId?: string; damage?: number };
        if (r.actorId && r.targetId && r.damage) {
          res.damageDealt[r.actorId] = (res.damageDealt[r.actorId] ?? 0) + r.damage;
          res.damageTaken[r.targetId] = (res.damageTaken[r.targetId] ?? 0) + r.damage;
        }
      } else if (msg.type === 'combat_end') {
        finish(msg.result);
      }
    };

    try {
      sandbox = createSandboxSession(setup, {
        sessionId: 'sim',
        humanId: null,
        botTurnDelayMs: 0,
        timing: { mobTurnDelayMs: 0, victoryDelayMs: 0, postVictoryLootDelayMs: 0, defendTimeoutMs: 0 },
        onMessage,
        onError: (err) => res.errors.push(err instanceof Error ? err.stack ?? err.message : String(err)),
      });
    } catch (err) {
      res.errors.push(err instanceof Error ? err.stack ?? err.message : String(err));
      finish('error');
      return;
    }
    if (done) sandbox.dispose();
  });
}
```

If `msg.combat.participants` or `msg.roundNumber` don't type-narrow, check the exact interfaces in `shared/src/messages.ts` (`ArenaCombatStartMessage.combat: CombatState`, `CombatTurnMessage.roundNumber`) and adjust the narrowing, not the logic.

- [ ] **Step 5: Run the simulator tests**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/simulate.test.ts"`
Expected: PASS. If a preset times out, inspect with `npm run sim` (Step 7) before changing anything — a timeout is a real finding (e.g. unreachable spawn), not something to hide by raising `maxRounds`.

- [ ] **Step 6: Implement `server/src/sandbox/simCli.ts`**

```ts
import { resolveSetup, SANDBOX_PRESETS, type SandboxOverrides } from '@caverns/shared';
import { simulateFight, type SimResult } from './simulate.js';

const USAGE = `Usage: npm run sim -- <preset> [--seeds N] [--seed S] [--party a,b] [--mobs a,b] [--room R] [--biome B] [--level L]
Presets: ${SANDBOX_PRESETS.map((p) => p.id).join(', ')}`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const preset = args[0];
  if (!preset || preset.startsWith('--')) { console.error(USAGE); return 2; }
  let seeds = 20;
  let startSeed = 1;
  const overrides: SandboxOverrides = {};
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (value === undefined) { console.error(`Missing value for ${flag}\n${USAGE}`); return 2; }
    switch (flag) {
      case '--seeds': seeds = Number(value); break;
      case '--seed': startSeed = Number(value); break;
      case '--party': overrides.party = value.split(','); break;
      case '--mobs': overrides.mobs = value.split(','); break;
      case '--room': overrides.room = value; break;
      case '--biome': overrides.biome = value; break;
      case '--level': overrides.level = Number(value); break;
      default: console.error(`Unknown option ${flag}\n${USAGE}`); return 2;
    }
  }

  const results: SimResult[] = [];
  for (let n = 0; n < seeds; n++) {
    const r = resolveSetup(preset, { ...overrides, seed: startSeed + n });
    if (!r.ok) { console.error(r.error); return 2; }
    results.push(await simulateFight(r.setup));
  }

  const count = (k: SimResult['result']) => results.filter((r) => r.result === k).length;
  const rounds = results.map((r) => r.rounds);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`${preset} × ${seeds} seeds (from ${startSeed})`);
  console.log(`  victory ${count('victory')} (${Math.round((100 * count('victory')) / seeds)}%) · wipe ${count('wipe')} · timeout ${count('timeout')} · error ${count('error')}`);
  console.log(`  rounds mean ${mean(rounds).toFixed(1)} · min ${Math.min(...rounds)} · max ${Math.max(...rounds)}`);
  const ids = new Set(results.flatMap((r) => Object.keys(r.names)));
  console.log('  per unit (mean dealt / taken):');
  for (const id of ids) {
    const name = results.find((r) => r.names[id])!.names[id];
    const dealt = mean(results.map((r) => r.damageDealt[id] ?? 0));
    const taken = mean(results.map((r) => r.damageTaken[id] ?? 0));
    console.log(`    ${name.padEnd(24)} ${dealt.toFixed(1).padStart(7)} / ${taken.toFixed(1).padStart(7)}`);
  }
  const errors = results.flatMap((r) => r.errors);
  for (const e of errors.slice(0, 5)) console.error(`  error: ${e}`);
  return errors.length > 0 ? 1 : 0;
}

// Exit explicitly: post-combat loot timers would otherwise keep the process alive.
main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 7: Add scripts and try the CLI**

`server/package.json` scripts — add:

```json
"sim": "tsx src/sandbox/simCli.ts"
```

Root `package.json` scripts — add:

```json
"sim": "npm run sim --workspace=server --"
```

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run sim -- showcase --seeds 5"`
Expected: a summary block with victory/wipe counts, rounds, and a per-unit table; exit code 0.

- [ ] **Step 8: Type check** — `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx tsc --noEmit -p ."` → no errors.

- [ ] **Step 9: Stop for review.**

---

### Task 6: Gate, SandboxHost and server wiring

**Files:**
- Create: `server/src/sandbox/gate.ts`, `server/src/sandbox/SandboxHost.ts`
- Modify: `server/src/index.ts`, `server/package.json`, `package.json`
- Test: `server/src/sandbox/SandboxHost.test.ts`

**Interfaces:**
- Consumes: `createSandboxSession` (Task 5), `resolveSetup` (Task 1), `SandboxStartMessage` (Task 1).
- Produces:
  - `isSandboxEnabled(): boolean`
  - `interface SandboxHostDeps { sendTo(connId: string, msg: ServerMessage): void; register(sessionId: string, session: GameSession, connId: string): void; unregister(sessionId: string, connId: string): void; isEnabled?: () => boolean; botTurnDelayMs?: number }`
  - `class SandboxHost { constructor(deps); has(connId): boolean; handleStart(connId: string, msg: SandboxStartMessage): void; stop(connId: string): void }`

- [ ] **Step 1: Write the failing tests**

`server/src/sandbox/SandboxHost.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { SandboxHost } from './SandboxHost.js';
import { isSandboxEnabled } from './gate.js';

function makeHost(enabled: boolean) {
  const sent: { to: string; msg: ServerMessage }[] = [];
  const register = vi.fn();
  const unregister = vi.fn();
  const host = new SandboxHost({
    sendTo: (to, msg) => sent.push({ to, msg }),
    register, unregister,
    isEnabled: () => enabled,
    botTurnDelayMs: 0,
  });
  return { host, sent, register, unregister };
}

afterEach(() => { vi.useRealTimers(); });

describe('SandboxHost', () => {
  it('refuses sandbox_start when the gate is off', () => {
    const { host, sent, register } = makeHost(false);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel' });
    expect(register).not.toHaveBeenCalled();
    expect(sent).toEqual([{ to: 'c1', msg: expect.objectContaining({ type: 'sandbox_error' }) }]);
  });

  it('reports invalid setups', () => {
    const { host, sent } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { mobs: ['dragon'] } });
    expect(sent[0].msg).toMatchObject({ type: 'sandbox_error', message: expect.stringContaining('dragon') });
  });

  it('starts a fight and registers it', () => {
    const { host, sent, register } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    expect(register).toHaveBeenCalledWith('sandbox-1', expect.anything(), 'c1');
    const types = sent.filter((s) => s.to === 'c1').map((s) => s.msg.type);
    expect(types).toContain('game_start');
    expect(types).toContain('arena_combat_start');
    expect(host.has('c1')).toBe(true);
    host.stop('c1');
  });

  it('restart disposes the old fight so it sends nothing more', () => {
    vi.useFakeTimers();
    const { host, sent, unregister } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 4 } });
    expect(unregister).toHaveBeenCalledWith('sandbox-1', 'c1');
    host.stop('c1');
    const before = sent.length;
    vi.advanceTimersByTime(60_000);
    expect(sent.length).toBe(before);
  });

  it('stop unregisters and restores Math.random', () => {
    const original = Math.random;
    const { host, unregister } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 9 } });
    expect(Math.random).not.toBe(original);
    host.stop('c1');
    expect(unregister).toHaveBeenCalledWith('sandbox-1', 'c1');
    expect(Math.random).toBe(original);
    expect(host.has('c1')).toBe(false);
  });
});

describe('isSandboxEnabled', () => {
  it('reads CAVERNS_SANDBOX', () => {
    const prev = process.env.CAVERNS_SANDBOX;
    process.env.CAVERNS_SANDBOX = '1';
    expect(isSandboxEnabled()).toBe(true);
    delete process.env.CAVERNS_SANDBOX;
    expect(isSandboxEnabled()).toBe(process.argv.includes('--sandbox'));
    if (prev !== undefined) process.env.CAVERNS_SANDBOX = prev;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx vitest run src/sandbox/SandboxHost.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/sandbox/gate.ts`**

```ts
/** Sandbox and debug messages are dev-only: enabled by CAVERNS_SANDBOX=1 or the --sandbox flag. */
export function isSandboxEnabled(): boolean {
  return process.env.CAVERNS_SANDBOX === '1' || process.argv.includes('--sandbox');
}
```

- [ ] **Step 4: Implement `server/src/sandbox/SandboxHost.ts`**

```ts
import { resolveSetup, type SandboxStartMessage, type ServerMessage } from '@caverns/shared';
import type { GameSession } from '../GameSession.js';
import { createSandboxSession, type SandboxSession } from './sandboxSession.js';
import { isSandboxEnabled } from './gate.js';

export interface SandboxHostDeps {
  sendTo(connId: string, msg: ServerMessage): void;
  register(sessionId: string, session: GameSession, connId: string): void;
  unregister(sessionId: string, connId: string): void;
  isEnabled?: () => boolean;
  botTurnDelayMs?: number;
}

export class SandboxHost {
  private sessions = new Map<string, { sandbox: SandboxSession; sessionId: string }>();
  private nextId = 1;

  constructor(private deps: SandboxHostDeps) {}

  has(connId: string): boolean {
    return this.sessions.has(connId);
  }

  handleStart(connId: string, msg: SandboxStartMessage): void {
    const enabled = (this.deps.isEnabled ?? isSandboxEnabled)();
    if (!enabled) {
      console.warn(`[sandbox] refused sandbox_start from ${connId}: sandbox mode is off`);
      this.error(connId, 'Sandbox mode is off. Start the server with npm run dev:sandbox.');
      return;
    }
    const resolved = resolveSetup(msg.preset, msg.overrides ?? {});
    if (!resolved.ok) {
      this.error(connId, resolved.error);
      return;
    }
    this.stop(connId);
    const sessionId = `sandbox-${this.nextId++}`;
    try {
      const sandbox = createSandboxSession(resolved.setup, {
        sessionId,
        humanId: connId,
        sendToHuman: (m) => this.deps.sendTo(connId, m),
        botTurnDelayMs: this.deps.botTurnDelayMs ?? 600,
        onError: (err) => console.error(`[sandbox] ${sessionId} bot error`, err),
      });
      this.sessions.set(connId, { sandbox, sessionId });
      this.deps.register(sessionId, sandbox.session, connId);
      console.log(`[sandbox] ${sessionId} started for ${connId}: ${resolved.setup.presetId} seed=${resolved.setup.seed ?? 'random'}`);
    } catch (err) {
      console.error('[sandbox] failed to start', err);
      this.error(connId, `Sandbox failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop(connId: string): void {
    const entry = this.sessions.get(connId);
    if (!entry) return;
    entry.sandbox.dispose();
    this.deps.unregister(entry.sessionId, connId);
    this.sessions.delete(connId);
  }

  private error(connId: string, message: string): void {
    this.deps.sendTo(connId, { type: 'sandbox_error', message });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass** (same command as Step 2). Expected: PASS.

- [ ] **Step 6: Wire into `server/src/index.ts`**

6a. Imports (with the other local imports):

```ts
import { SandboxHost } from './sandbox/SandboxHost.js';
import { isSandboxEnabled } from './sandbox/gate.js';
```

6b. Directly after the `function sendTo(...) { ... }` definition (≈ line 292-297), add:

```ts
const sandboxHost = new SandboxHost({
  sendTo,
  register: (sessionId, gameSession, connId) => {
    dungeonInstances.set(sessionId, { sessionId, worldId: 'sandbox', gameSession, connections: new Set([connId]) });
    dungeonConnections.set(connId, sessionId);
  },
  unregister: (sessionId, connId) => {
    dungeonInstances.delete(sessionId);
    dungeonConnections.delete(connId);
  },
});

if (isSandboxEnabled()) console.log('[sandbox] Sandbox mode ON: sandbox_start and debug_* messages are enabled');

/** debug_* messages are dev-only; refuse them unless sandbox mode is on. */
function allowDebug(connId: string, type: string): boolean {
  if (isSandboxEnabled()) return true;
  console.warn(`[sandbox] refused ${type} from ${connId}: sandbox mode is off`);
  sendTo(connId, { type: 'sandbox_error', message: `${type} requires sandbox mode (npm run dev:sandbox)` });
  return false;
}
```

6c. In the message switch, add before `case 'debug_teleport'`:

```ts
      case 'sandbox_start': {
        sandboxHost.handleStart(playerId, msg);
        break;
      }
```

and change the three debug cases to:

```ts
      case 'debug_teleport': {
        if (!allowDebug(playerId, msg.type)) break;
        getGameSession(playerId)?.debugTeleport(playerId, msg.roomId);
        break;
      }
      case 'debug_reveal_all': {
        if (!allowDebug(playerId, msg.type)) break;
        getGameSession(playerId)?.debugRevealAll(playerId);
        break;
      }
      case 'debug_give_item': {
        if (!allowDebug(playerId, msg.type)) break;
        getGameSession(playerId)?.debugGiveItem(playerId, msg.itemId);
        break;
      }
```

6d. In `ws.on('close', ...)`, directly after `clients.delete(playerId);`:

```ts
    if (sandboxHost.has(playerId)) {
      sandboxHost.stop(playerId);
      connectionAccounts.delete(playerId);
      return;
    }
```

- [ ] **Step 7: Scripts**

`server/package.json`: keep the normal dev flow working with the debug panel by passing `--sandbox` in dev only (production `npm start` runs `node server/dist/index.js` without it):

```json
"dev": "tsx watch --env-file=../.env src/index.ts --sandbox",
```

Root `package.json` scripts — add (same processes as `dev`, named for discoverability):

```json
"dev:sandbox": "npx concurrently -n server,client -c blue,green \"npm run dev --workspace=server\" \"npm run dev --workspace=client\""
```

- [ ] **Step 8: Full server test run + type check**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\server && npx tsc --noEmit -p . && npx vitest run"`
Expected: no type errors; the new sandbox tests pass. The 3 pre-existing failures (PlayerManager class base stats, WorldSession movement ×2) may still fail — they're unrelated; report them, don't fix them here.

- [ ] **Step 9: Smoke test the server boots without Postgres**

Run (background): `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run dev:server"`
Expected log lines: `Caverns server listening on 0.0.0.0:3001` and `[sandbox] Sandbox mode ON ...`. DB connection errors are expected when Docker is off. Stop the process after checking.

- [ ] **Step 10: Stop for review.**

---

### Task 7: Client sandbox mode

**Files:**
- Create: `client/src/sandbox/sandboxMode.ts`, `client/src/sandbox/sandboxHook.ts`, `client/src/components/SandboxBar.tsx`
- Modify: `client/src/hooks/useWebSocket.ts`, `client/src/hooks/useGameActions.ts`, `client/src/store/gameStore.ts`, `client/src/App.tsx`, `client/src/main.tsx`, `client/src/styles/index.css`

**Interfaces:**
- Consumes: `parseSandboxQuery`, `buildSandboxQuery`, `SANDBOX_PRESETS`, `SandboxOverrides`, `SandboxStartMessage`, `SandboxErrorMessage` (Task 1).
- Produces:
  - `getSandboxRequest(): { preset: string; overrides: SandboxOverrides } | null`
  - `window.__cavernsSandbox: { status: 'connecting' | 'my_turn' | 'waiting' | 'ended' | 'error'; error: string | null; playerId: string; currentTurnId: string | null; combat: CombatState | null; positions: Record<string, { x: number; y: number }>; events: { t: number; type: string; detail?: unknown }[] }`
  - Store field `sandboxError: string | null`; action `actions.sandboxStart(preset, overrides?)`.

The client has no test runner files; this task is verified by type check + the driver in Task 8.

- [ ] **Step 1: `client/src/sandbox/sandboxMode.ts`**

```ts
import { parseSandboxQuery, type SandboxOverrides } from '@caverns/shared';

export interface SandboxRequest {
  preset: string;
  overrides: SandboxOverrides;
}

/** Dev builds only: the sandbox fight requested by ?sandbox=..., or null. */
export function getSandboxRequest(): SandboxRequest | null {
  if (!import.meta.env.DEV) return null;
  return parseSandboxQuery(window.location.search);
}
```

- [ ] **Step 2: Store support in `client/src/store/gameStore.ts`**

- In `interface GameStore`, next to `authError: string | null;`, add `sandboxError: string | null;`.
- In the initial state object, next to `authError: null,`, add `sandboxError: null,`.
- In `handleServerMessage`'s `case 'game_start':` `set({...})`, add `sandboxError: null,`.
- Add a case (anywhere in the switch):

```ts
      case 'sandbox_error':
        set({ sandboxError: msg.message });
        break;
```

- [ ] **Step 3: `client/src/sandbox/sandboxHook.ts`**

```ts
import type { CombatState, ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

type SandboxStatus = 'connecting' | 'my_turn' | 'waiting' | 'ended' | 'error';

interface SandboxEvent { t: number; type: string; detail?: unknown }

interface SandboxHook {
  status: SandboxStatus;
  error: string | null;
  playerId: string;
  currentTurnId: string | null;
  combat: CombatState | null;
  positions: Record<string, { x: number; y: number }>;
  events: SandboxEvent[];
}

declare global {
  interface Window { __cavernsSandbox?: SandboxHook }
}

const MAX_EVENTS = 500;
let sawCombat = false;

/** Publish sandbox state on window so automation can wait on it instead of sleeping. */
export function installSandboxHook(): void {
  const hook: SandboxHook = { status: 'connecting', error: null, playerId: '', currentTurnId: null, combat: null, positions: {}, events: [] };
  window.__cavernsSandbox = hook;
  const sync = (s: ReturnType<typeof useGameStore.getState>) => {
    if (s.activeCombat) sawCombat = true;
    hook.error = s.sandboxError;
    hook.playerId = s.playerId;
    hook.currentTurnId = s.currentTurnId;
    hook.combat = s.activeCombat;
    hook.positions = s.arenaPositions;
    if (s.sandboxError) hook.status = 'error';
    else if (s.gameOver || (sawCombat && !s.activeCombat)) hook.status = 'ended';
    else if (!s.activeCombat || !s.arenaGrid || s.arenaIntro) hook.status = 'connecting';
    else hook.status = s.currentTurnId === s.playerId ? 'my_turn' : 'waiting';
  };
  sync(useGameStore.getState());
  useGameStore.subscribe(sync);
}

export function recordSandboxEvent(msg: ServerMessage): void {
  const hook = window.__cavernsSandbox;
  if (!hook) return;
  if (msg.type === 'game_start') sawCombat = false;
  hook.events.push({ t: Date.now(), type: msg.type, detail: summarize(msg) });
  if (hook.events.length > MAX_EVENTS) hook.events.shift();
}

function summarize(msg: ServerMessage): unknown {
  switch (msg.type) {
    case 'combat_turn': return { currentTurnId: msg.currentTurnId, roundNumber: msg.roundNumber };
    case 'combat_end': return { result: msg.result };
    case 'sandbox_error': return { message: msg.message };
    case 'combat_action_result': {
      const r = msg as { actorId?: string; targetId?: string; damage?: number; action?: string };
      return { actorId: r.actorId, targetId: r.targetId, damage: r.damage, action: r.action };
    }
    default: return undefined;
  }
}
```

- [ ] **Step 4: Install the hook in `client/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { getSandboxRequest } from './sandbox/sandboxMode.js';
import { installSandboxHook } from './sandbox/sandboxHook.js';
import './styles/index.css';

if (getSandboxRequest()) installSandboxHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: `client/src/hooks/useWebSocket.ts`**

Add imports:

```ts
import { getSandboxRequest } from '../sandbox/sandboxMode.js';
import { recordSandboxEvent } from '../sandbox/sandboxHook.js';
```

Replace the body of `ws.onopen` after `setConnectionStatus('connected');` with:

```ts
      const sandbox = getSandboxRequest();
      if (sandbox) {
        ws.send(JSON.stringify({ type: 'sandbox_start', preset: sandbox.preset, overrides: sandbox.overrides }));
        return;
      }
      const token = loadSessionToken();
      if (token) {
        ws.send(JSON.stringify({ type: 'resume_session', token }));
      }
```

In `ws.onmessage`, after `handleServerMessage(msg);` add:

```ts
        recordSandboxEvent(msg);
```

(`recordSandboxEvent` no-ops when the hook isn't installed.)

- [ ] **Step 6: `client/src/hooks/useGameActions.ts`**

Add `SandboxOverrides` to the `@caverns/shared` type import, and add to the returned object:

```ts
    sandboxStart: (preset: string, overrides?: SandboxOverrides) => send({ type: 'sandbox_start', preset, overrides }),
```

- [ ] **Step 7: `client/src/components/SandboxBar.tsx`**

```tsx
import { SANDBOX_PRESETS, buildSandboxQuery, type SandboxOverrides } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import type { SandboxRequest } from '../sandbox/sandboxMode.js';

interface SandboxBarProps {
  request: SandboxRequest;
  onRestart: () => void;
}

export function SandboxBar({ request, onRestart }: SandboxBarProps) {
  const error = useGameStore((s) => s.sandboxError);
  const preset = SANDBOX_PRESETS.find((p) => p.id === request.preset);
  const seed = request.overrides.seed ?? preset?.seed;
  const go = (presetId: string, overrides: SandboxOverrides) => {
    window.location.search = buildSandboxQuery(presetId, overrides);
  };

  return (
    <div className="sandbox-bar">
      <span className="sandbox-bar-tag">SANDBOX</span>
      <select value={request.preset} onChange={(e) => go(e.target.value, {})}>
        {!preset && <option value={request.preset}>{request.preset}</option>}
        {SANDBOX_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <span className="sandbox-bar-seed">seed {seed ?? 'random'}</span>
      <button onClick={onRestart}>Restart</button>
      <button onClick={() => go(request.preset, { ...request.overrides, seed: Math.floor(Math.random() * 1_000_000) })}>New seed</button>
      {error && <span className="sandbox-bar-error">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 8: Render it in `client/src/App.tsx`**

Imports:

```ts
import { SandboxBar } from './components/SandboxBar.js';
import { getSandboxRequest } from './sandbox/sandboxMode.js';
```

In `App()`, after `const actions = useGameActions(wsRef);`:

```ts
  const sandboxRequest = getSandboxRequest();
```

In the returned fragment, directly after `{content}`:

```tsx
      {sandboxRequest && (
        <SandboxBar
          request={sandboxRequest}
          onRestart={() => actions.sandboxStart(sandboxRequest.preset, sandboxRequest.overrides)}
        />
      )}
```

- [ ] **Step 9: Styles — append to the arena section of `client/src/styles/index.css`**

```css
/* --- Dev sandbox bar --- */
.sandbox-bar {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #1a1410;
  border: 1px solid #5a4a2a;
  border-top: 0;
  font-size: 12px;
  color: #c8b89a;
}
.sandbox-bar-tag { color: #d4a857; letter-spacing: 0.1em; }
.sandbox-bar-seed { color: #888; }
.sandbox-bar select,
.sandbox-bar button {
  background: #110e0a;
  color: #c8b89a;
  border: 1px solid #3d3122;
  font-family: inherit;
  font-size: 12px;
  padding: 1px 6px;
  cursor: pointer;
}
.sandbox-bar button:hover { border-color: #d4a857; }
.sandbox-bar-error { color: #ff4444; }
```

- [ ] **Step 10: Type check and build**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns\client && npx tsc --noEmit -p . && npx vite build --outDir C:\Users\jakeh\AppData\Local\Temp\caverns-vite-check --emptyOutDir"`
Expected: no type errors; build succeeds. Then delete the temp dir. Check the production bundle doesn't contain sandbox code: `grep -c "sandbox_start" /mnt/c/Users/jakeh/AppData/Local/Temp/caverns-vite-check/assets/*.js` should print `0` (DEV-guarded code is stripped). If it isn't 0, report it — the gate in `getSandboxRequest` is what must keep it inert.

- [ ] **Step 11: Stop for review.**

---

### Task 8: Browser driver and end-to-end check

**Files:**
- Create: `scripts/sandbox-drive.mjs`
- Modify: root `package.json` (devDependency), `.gitignore`

**Interfaces:**
- Consumes: `window.__cavernsSandbox` (Task 7); `.arena-btn-end`, `.arena-btn-attack`, `.room-grid > .room-row > span` DOM from the arena.
- Produces: CLI `node scripts/sandbox-drive.mjs "<preset>[?query]" [steps] [--out dir] [--base url] [--viewport WxH]`; writes PNGs + `events.json`.

- [ ] **Step 1: Install Playwright (Windows side, no browser download)**

Run: `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 && npm install -D playwright"`
Expected: `playwright` appears in root `devDependencies`.

- [ ] **Step 2: `.gitignore`** — append:

```
# Sandbox driver output
.sandbox/
```

- [ ] **Step 3: Write `scripts/sandbox-drive.mjs`**

```js
// Drive a sandbox fight in headless Edge: node scripts/sandbox-drive.mjs "<preset>[?query]" [steps]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const USAGE = `Usage: node scripts/sandbox-drive.mjs "<preset>[?room=boss&seed=7]" [steps] [options]
Steps (run in order):
  --wait ready|my-turn|ended   wait for sandbox state (ready is added first if no --wait given)
  --shot <name>                screenshot to <out>/<name>.png
  --end-turn [n]               click End Turn on my next n turns (default 1)
  --attack-nearest             click Attack, then an adjacent enemy
  --click x,y                  click arena cell x,y (pan it into view first)
  --pan left|right|up|down[,n] press an arrow key n times
Options:
  --out <dir>        output directory (default .sandbox/shots)
  --base <url>       client URL (default http://localhost:5173)
  --viewport WxH     browser size (default 1600x1000)
Needs the dev servers: npm run dev:sandbox`;

const argv = process.argv.slice(2);
if (!argv[0] || argv[0].startsWith('--')) { console.error(USAGE); process.exit(2); }
const [preset, query = ''] = argv[0].split('?');
let base = 'http://localhost:5173';
let out = '.sandbox/shots';
let viewport = { width: 1600, height: 1000 };
const steps = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) { console.error(`Missing value for ${a}\n${USAGE}`); process.exit(2); }
    return v;
  };
  switch (a) {
    case '--base': base = next(); break;
    case '--out': out = next(); break;
    case '--viewport': { const [w, h] = next().split('x').map(Number); viewport = { width: w, height: h }; break; }
    case '--wait': steps.push({ kind: 'wait', what: next() }); break;
    case '--shot': steps.push({ kind: 'shot', name: next() }); break;
    case '--end-turn': {
      const n = argv[i + 1] && !argv[i + 1].startsWith('--') ? Number(next()) : 1;
      steps.push({ kind: 'end-turn', n });
      break;
    }
    case '--attack-nearest': steps.push({ kind: 'attack-nearest' }); break;
    case '--click': { const [x, y] = next().split(',').map(Number); steps.push({ kind: 'click', x, y }); break; }
    case '--pan': { const [dir, n = '1'] = next().split(','); steps.push({ kind: 'pan', dir, n: Number(n) }); break; }
    default: console.error(`Unknown option ${a}\n${USAGE}`); process.exit(2);
  }
}
if (!steps.some((s) => s.kind === 'wait')) steps.unshift({ kind: 'wait', what: 'ready' });

try {
  const r = await fetch(base);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.error(`Can't reach the client at ${base} (${e.message}). Start the dev servers with: npm run dev:sandbox`);
  process.exit(3);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const url = `${base}/?sandbox=${encodeURIComponent(preset)}${query ? `&${query}` : ''}`;
const hook = () => page.evaluate(() => window.__cavernsSandbox ?? null);
const ARROWS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };

async function waitFor(pred, what, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    const h = await hook();
    if (h?.status === 'error') throw new Error(`Sandbox error: ${h.error}`);
    if (h && pred(h)) return h;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what} (status: ${h?.status ?? 'no hook'})`);
    await page.waitForTimeout(100);
  }
}
const isReady = (h) => h.status === 'my_turn' || h.status === 'waiting';
const cell = (x, y) => page.locator(`.room-grid > .room-row:nth-child(${y + 1}) > span:nth-child(${x + 1})`);

let exitCode = 0;
try {
  await page.goto(url);
  for (const s of steps) {
    switch (s.kind) {
      case 'wait':
        if (s.what === 'ready') await waitFor(isReady, 'the arena');
        else if (s.what === 'my-turn') await waitFor((h) => h.status === 'my_turn', 'my turn', 60000);
        else if (s.what === 'ended') await waitFor((h) => h.status === 'ended', 'combat end', 180000);
        else throw new Error(`Unknown wait target "${s.what}"`);
        break;
      case 'shot': {
        const file = join(out, `${s.name}.png`);
        await page.screenshot({ path: file });
        console.log(`shot ${file}`);
        break;
      }
      case 'end-turn':
        for (let k = 0; k < s.n; k++) {
          const h = await waitFor((x) => x.status === 'my_turn' || x.status === 'ended', 'my turn', 60000);
          if (h.status === 'ended') break;
          await page.click('.arena-btn-end');
          await waitFor((x) => x.status !== 'my_turn', 'the turn to pass');
        }
        break;
      case 'attack-nearest': {
        const h = await waitFor((x) => x.status === 'my_turn', 'my turn', 60000);
        const me = h.positions[h.playerId];
        const target = h.combat.participants.find((p) => p.type === 'mob' && h.positions[p.id]
          && Math.abs(h.positions[p.id].x - me.x) + Math.abs(h.positions[p.id].y - me.y) === 1);
        if (!target) throw new Error('No enemy adjacent to the player');
        await page.click('.arena-btn-attack');
        const pos = h.positions[target.id];
        await cell(pos.x, pos.y).click();
        break;
      }
      case 'click':
        await cell(s.x, s.y).click();
        break;
      case 'pan':
        for (let k = 0; k < s.n; k++) await page.keyboard.press(ARROWS[s.dir]);
        break;
    }
  }
} catch (e) {
  exitCode = 1;
  console.error(String(e.message ?? e));
  await page.screenshot({ path: join(out, 'error.png') }).catch(() => {});
  console.error(`error screenshot: ${join(out, 'error.png')}`);
} finally {
  const h = await hook().catch(() => null);
  writeFileSync(join(out, 'events.json'), JSON.stringify({ url, finalStatus: h?.status ?? null, pageErrors, events: h?.events ?? [] }, null, 2));
  if (pageErrors.length) console.error(`page errors:\n  ${pageErrors.join('\n  ')}`);
  await browser.close();
}
process.exit(exitCode);
```

- [ ] **Step 4: End-to-end run**

Start the servers (background): `cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && npm run dev:sandbox"`

Then:

```
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/sandbox-drive.mjs duel --shot start --end-turn 2 --shot after"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/sandbox-drive.mjs showcase --shot showcase --wait ended --shot ended"
cmd.exe /c "cd /d C:\Users\jakeh\WebstormProjects\Caverns && node scripts/sandbox-drive.mjs boss-forge-titan --viewport 1280x800 --shot boss --pan down,3 --shot boss-panned"
```

Expected: exit code 0 each time; PNGs in `.sandbox/shots/`. Open them (Read tool) and confirm: the arena renders with glyph sprites and faction underlines; the sandbox bar shows the preset and seed; in `showcase` the three bots take turns on their own; `ended.png` shows the post-combat state; the boss room shows the minimap and the panned shot differs from the first. `events.json` should contain `game_start`, `arena_combat_start`, `combat_turn` and `combat_end` events and an empty `pageErrors`.

- [ ] **Step 5: Stop the dev servers and stop for review.**

---

## Self-review notes

- Spec §1 presets/overrides → Task 1. §2 server entry/gate/bots/seeding/teardown/script → Tasks 2, 3, 5, 6. §3 client → Task 7. §4 simulator + auto player + CLI → Tasks 4, 5. §5 driver → Task 8. §6 errors → Tasks 1, 5, 6, 7, 8. Testing section → tests in Tasks 1–6.
- Deviation from spec, deliberate: no extraction from `buildEncounterMobs` (sandbox mob instances are built in `sandboxContent.ts` from the pool directly, which avoids touching the live encounter code); `SimResult` uses `actions`/`names`/`'error'`; hook statuses drop a separate `ready` (ready = `my_turn` or `waiting`); the regular server `dev` script gets `--sandbox` so the existing DebugPanel keeps working in dev after gating.
