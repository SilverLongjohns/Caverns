# SFX Pass — Design

**Date:** 2026-09-28
**Status:** Awaiting review
**Idea bank:** `docs/superpowers/ideas/2026-09-28-exploration-fun.md` (idea 12, juice layer — audio half)

## Goal

Give the whole game a coherent, generated sound layer: exploration (currently silent), combat (currently three synth blips), and UI/town (currently synth blips plus four ad-hoc `.mp3`s). Sounds are generated with ElevenLabs (`eleven_text_to_sound_v2`), curated by the user in an in-game audition page, and played through the existing Web Audio engine.

## Decisions (from brainstorm)

- **Scope:** everything — exploration, combat, UI/town. Music is out of scope.
- **Palette: relic-tech foley.** Physical cave sources (grit, drip, fungus, water) fused with decayed machinery (servo whine, relay clack, static bursts, capacitor hum). Guns are junk-built scrap weapons, not modern firearms. UI sounds like old terminal hardware. No classic-fantasy clichés (no sword "shing", no magic sparkle harps).
- **Curation:** in-game dev audition page; the user keeps/rejects takes by ear, in context. Claude never picks takes (it cannot hear them).
- **Architecture:** manifest + event director (not scattered component calls, not Howler.js).
- **Budget:** ~220 credits (~$0.04) per prompt × 4 takes; ~56 prompts ≈ 12k credits (~$2). Re-rolls are cheap; don't agonise over prompts.

## 1. Sound list

Numbers in `[n]` are round-robin takes to keep (default 1).

### Exploration (18)
| Id | Trigger |
|---|---|
| `step` [4] | own `player_position`; other players' steps play at ~40% volume |
| `step_wet` [3] | step onto a water tile |
| `room_enter` | `room_reveal` for the local player |
| `exit_blocked` | `error` with `code: 'exit_locked'` (new field, see Protocol) |
| `unlock` | `text_log` with `event: 'unlock'` (new field) |
| `key_pickup` | local player's `keychain` grows (store before/after diff) |
| `torch_pickup` | `torch_pickup` |
| `torch_out` | local torch fuel transitions to 0 |
| `mob_alert` | `mob_alert`, only if the alert tile is visible or in the local player's room |
| `hazard_tick` | `text_log` with `event: 'hazard'` for the local player (new field) |
| `interact_start` | local player sends `interact_action` |
| `interact_loot` / `interact_hazard` / `interact_secret` / `interact_flavor` | `interact_result`, by outcome type |
| `puzzle_ping` | `puzzle_prompt` (reserved — puzzles are currently dead code) |
| `gold` | `gold_update` with an increase |
| `level_up` | `level_up` |

### Biome ambience beds (6 loops, 20–30 s)
`amb_starter`, `amb_fungal`, `amb_crystal`, `amb_flooded`, `amb_volcanic`, `amb_bone`. Crossfade on biome change; duck under combat.

### Combat (20, plus 3 migrated)
`combat_start`, `melee_hit` [3], `melee_crit`, `melee_miss`, `gun_shot` [3], `gun_miss`, `reload`, `dry_click`, `defend`, `mob_hit` [3], `player_down`, `mob_death` [2], `heal`, `ability_generic`, `flee`, `qte_prompt`, `qte_success`, `qte_fail`, `victory`, `wipe`.

Close-up sounds `crack`, `boom`, `shimmer` (`shared/src/combat/closeUp.ts` `CLOSE_UP_SOUNDS`) get sample versions under the same ids — shared code unchanged.

### UI / town (12)
`ui_click`, `ui_tick`, `ui_power` (replace synth; synth stays as fallback), `ui_open`, `ui_close`, `shop_buy`, `shop_sell`, `shop_reroll`, `stash_move` (replace current `/audio/*.mp3`), `equip`, `portal_ready`, `portal_enter`.

### Out of scope
Music, voice lines, per-mob / per-ability / per-gun unique sounds (follow-ups).

## 2. Engine, manifest, director

### Buses (`client/src/audio/audioEngine.ts`)
Added under the existing `master` gain:
- `sfx` — one-shots.
- `bed` — biome ambience. Ducks to 0.4 during combat (ramp ~0.3 s), crossfades ~2 s between biomes. Gapless looping via `AudioBufferSourceNode.loop` (same technique as the existing menu ambience).

Existing `intro`, `amb` (menu ambience) and `world` (music) buses are unchanged.

### Manifest
- `client/src/audio/sfxManifest.ts` — hand-edited tuning: `SfxId` union and `SFX: Record<SfxId, { volume: number; pitchJitter?: number; minGapMs?: number; maxVoices?: number; bus: 'sfx' | 'bed' }>`. Defaults: `pitchJitter` 0, `minGapMs` 0, `maxVoices` 3.
- `client/src/audio/sfxFiles.json` — **generated** by the promote script: `{ [id]: string[] }` of URLs under `/audio/sfx/`. Kept separate so re-curation never clobbers tuning.
- Round-robin picks randomly among an id's files, never repeating the previous take.

### Playback API
- `audioEngine.playSfx(id: SfxId, opts?: { volume?: number; pitch?: number }): void` — lazy fetch + `decodeAudioData`, cached per URL; applies manifest volume × opts, random pitch within `pitchJitter` (via `playbackRate`); enforces `minGapMs` and `maxVoices`. Best-effort: silent until unlocked or if no files; never throws.
- `audioEngine.preloadSfx(ids: SfxId[])` — called on `dungeon_entered` with the exploration + combat set.
- `audioEngine.setBed(id: SfxId | null)` and `audioEngine.setDuck(on: boolean)`.
- `playUi(sound)` keeps its signature: maps `click→ui_click`, `tick→ui_tick`, `power→ui_power`, `crack/boom/shimmer` → same ids; plays the sample if `sfxFiles.json` has one, else falls back to `synthUiSound`. The existing hover throttle stays.

### Director (`client/src/audio/sfxDirector.ts`)
- Pure function `soundsFor(msg: ServerMessage, before: GameState, after: GameState, me: string): SfxCue[]` where `SfxCue = { id: SfxId; volume?: number }` plus bed/duck directives. Unit-tested.
- Hooked once in `client/src/hooks/useWebSocket.ts`: snapshot store → `handleServerMessage` → snapshot → `soundsFor` → play cues.
- Before/after diffing covers non-message transitions: gold increase, torch fuel → 0, biome change (bed), combat start/end (duck).
- Client-local inputs call `audioEngine.playSfx` directly from their component: QTE prompt/success/fail (`AttackQTE`, `DefenseQTE`), modal open/close, equip, portal ready/enter. The `new Audio(...)` calls in `ShopModal`, `StashModal`, `TownView` are replaced with `playSfx`.

### Protocol (small server change)
Some exploration events only exist as free text today (`GameSession.ts` locked-exit check ~:681, hazard ~:767 and ~:1942). Rather than string-match narration, add optional structured tags:
- `ErrorMessage.code?: 'exit_locked'` — set on the locked-exit refusal.
- `TextLogMessage.event?: 'unlock' | 'hazard'` — set on the unlock and hazard narration; hazard also carries `playerId`.
Both optional, so no other consumer changes. Server tests assert the tags are present.

## 3. Generation and curation pipeline

### Prompts
`art/sfx/prompts.json`: `{ [id]: { prompt: string; takes: number /* kept */; kind: 'oneshot' | 'bed' } }`. Prompts follow the model guide: one concrete sound, texture/transient, space; no visual words; one sound per prompt. Palette words are baked into each prompt (e.g. "scrap-metal", "servo", "static crackle", "gritty cave stone"), not appended generically.

### Generation (Claude-driven, via ElevenLabs MCP)
- One flow, "Caverns SFX pass". Each id: `creative_generate_in_flow` (`node_type: 'sfx'`, `eleven_text_to_sound_v2`, 4 generations). Poll `creative_get_flow_run_status`.
- Download every take to `client/public/audio/_staging/<id>/take_<n>.mp3` (gitignored; Vite serves it in dev) and write `client/public/audio/_staging/index.json` (`{ [id]: { prompt, kind, takes: string[] } }`).
- Generated in batches by group (exploration → combat → UI → beds) so the user can audition early batches while later ones generate. Re-rolls per id on request.

### Audition page (dev only)
- `client/src/audio/audition/AuditionPage.tsx`, lazy-loaded; reachable at `/?audition` only when `import.meta.env.DEV`. Plays through `audioEngine` (so it hears the real buses/volume).
- Per id: prompt text, each take with play button and keep toggle, a "re-roll" note field.
- Context players: `step`/`step_wet` play the kept set at the real 150 ms cadence with round-robin; beds loop continuously (to hear the seam) with an optional one-shot fired on top; `combat_start`/`victory` can be heard against a ducked bed.
- State in `localStorage`; **Export picks** downloads `picks.json` (`{ [id]: { keep: number[]; reroll?: string } }`).

### Promotion (`scripts/sfx-promote.sh`, run in WSL: ffmpeg + python3)
- Reads `picks.json` and staging; for each kept take:
  - one-shots: trim leading/trailing silence (`silenceremove`), loudness-normalise to −18 LUFS (`loudnorm`), mono, 128 kbps mp3.
  - beds: loudness-normalise to −26 LUFS, stereo, apply a loop crossfade (last ~1.5 s blended into the head) so the loop is seamless, 160 kbps mp3.
- Writes `client/public/audio/sfx/<id>_<n>.mp3` and regenerates `client/src/audio/sfxFiles.json`.
- Re-rolls listed in `picks.json` are reported so Claude can regenerate those ids.

## Rollout
1. **Infra** — buses, manifest (tuning only, empty `sfxFiles.json`), `playSfx`/beds/duck, director + hooks, component call sites. Everything silent-safe with synth fallback for UI. Tests green.
2. **Generate + audition** — prompts, batch generation, audition page; user curates.
3. **Promote + tune** — promotion script, per-sound volume tuning in `sfxManifest.ts`, play-test pass.

## Testing
- `sfxDirector.test.ts`: message → cue mapping for every trigger in §1, including visibility gating for `mob_alert`, other-player step volume, gold/torch/biome diffs.
- `audioEngine.test.ts` (extend, mocked `AudioContext`): round-robin never repeats, `minGapMs`, `maxVoices`, silent when locked or no files, `playUi` sample-vs-synth fallback, duck/crossfade gain ramps.
- `sfxManifest.test.ts`: every `SfxId` has tuning; every URL in `sfxFiles.json` exists on disk under `client/public`; after rollout step 3, every `SfxId` has ≥1 file and variant ids have their target count.

## Risks
- **Bed looping:** the model may drift over 20–30 s; the promote crossfade handles seams, and the audition page loops beds so bad ones are caught by ear.
- **Loudness mismatch** between generations: handled by `loudnorm` at promotion, then per-id `volume` in the manifest.
- **Mob-alert spam** in multi-room parties: gated by visibility/room.
