# Exploration Fun — Idea Bank

> **Status:** Ideation only. Not a spec. Pick ideas from here into a proper brainstorm → spec → plan when ready.
> **Date:** 2026-09-28

## Problem

In-dungeon exploration (walking between fights) is dead time: no decisions, no pressure, no feedback. It feeling *different* from combat is fine — it just lacks real gameplay.

### Diagnosis (state of the code, 2026-09-28)

- **No stakes.** Torch fuel is client-side only (`client/src/store/gameStore.ts` drains 1/step, pickup resets to 60); running out just drops vision 7 → 4. No clock of any kind.
- **No information to act on.** Mobs aggro on a 10-tile Chebyshev radius with no LoS (`server/src/MobAIManager.ts`). Interactable "intel" outcomes send a `targetRoomId` the client ignores. Puzzles are generated per zone but `sendPuzzlePrompt` is never called.
- **No agency over engagement.** Combat starts on contact (`detectionRange: 1`). Only avoidance is outrunning (players step every 150ms, pursuing mobs every 600ms). No ambush / first-strike.
- **No feedback.** No exploration SFX, no step/transition/pickup animation. Only juice is the 800ms "!" alert and the torch bar. Combat, by contrast, has close-ups, QTEs, attack juice.

Existing hooks worth building on: torch walls, 106 interactable actions (39 class-gated), secret "Hidden Alcove" rooms, key/lock to boss, RoomGrid hazard/water/chasm tiles, guns (ranged branch), QTE + close-up systems.

## Decisions so far

- **No clock/pressure first.** Don't add a timer (e.g. light-as-clock) until there's something fun to do under pressure. Revisit once the core loop is fun.
- **Keep the arena split.** Exploration and combat stay separate modes; exploration needs its own substance.
- **Direction:** tight loops, fast feedback, flashy visuals.

## Idea bank

### Micro-loops (something every few steps)

1. **Smash & scavenge** — rooms littered with breakables (junk piles, relic husks, fungal pods, crates). Bump to smash → scrap / ammo / consumable burst, particle spray, screen nudge; rapid smashes build a combo counter. Scrap feeds the shop. Constant drip of small rewards (Hades/Diablo pot-smashing).
2. **Loot fountains** — drops fly out and land on tiles with rarity-coloured ASCII light beams; walking near pulls them in (magnet), with a pickup chime and ticking counter. Discovery should feel like a slot machine paying out.
3. **Scanner ping** — key on cooldown sends a sonar ring rippling across the ASCII grid; briefly outlines mobs through walls, hidden loot, cracked walls you can bash. Information delivered as a visual payoff. Could revive the dead "intel" outcomes / secret-room discovery.

### Movement that feels good

4. **Dash** — 3-tile burst with afterimage trail. Dash through a sight cone, over a chasm, out of trouble. Dashing *into* an unaware mob = ambush opener (see 7).
5. **Collapse chases** — occasionally a room "wakes": ceiling falls / flood surges; sprint for the exit while tiles crumble behind you. Rare, short adrenaline bursts.

### Engage with style (exploration feeds combat)

6. **Readable sight cones** — mobs show tinted vision cones on the grid. Getting spotted = freeze-frame "!" + sting, and the mob gets a free opener. Sneaking behind one is a clean, readable skill test.
7. **Ambush openers** — reach a mob unseen (or dash into its back) → trigger the existing QTE for a close-up opening strike before initiative is rolled. Reuses combat investment.
8. **Pot-shots** — fire your gun in exploration mode (tracer, recoil). Hit a wandering mob → combat starts with it wounded; miss → it comes running. Builds on ranged-combat branch.
9. **Volatile props** — relic cells / gas vents. Lure mobs near, shoot → chain explosion, screen shake, debris. Clever players clear rooms without entering the arena.

### Short events

10. **Vault cracks** — locked relic caches opened with a 5-second glyph-match / timing minigame; fail = alarm. Many small ones rather than one big puzzle.
11. **Co-op locks** — one holds a lever while another grabs the prize; twin pressure plates. Quick reasons for the party to coordinate.

### Juice everywhere

12. **Juice layer** — step dust puffs, reveal wave rippling across tiles on room entry, CRT glitch on secret found, room-cleared flourish, "style" streaks (untouched ambush, no-damage room) that multiply scrap. Needed regardless of which mechanics ship.

### Suggested core loop

**Scan → sneak → strike → scavenge:** ping to read the room (3) → slip or line up on mobs (6) → open with ambush / pot-shot / barrel (7, 8, 9) → smash the room for loot fountains (1, 2). Dash (4) and juice (12) wrap everything.

## Parked ideas (earlier in the session)

- **Light as the clock** — server-authoritative torch fuel; darkness has teeth (dark-only mobs, ambushes, faster drain); relightable braziers as safe points. *Parked until the core loop is fun.*
- **Route choice** — fewer, denser rooms; readable forks on the minimap ("loot, dark" vs "shrine, guarded").
- **Class exploration roles** — scout / disarmer / sensor; class verbs that act on terrain.

## Qud lessons (reference)

What makes Caves of Qud fun, and what it suggests here:

1. **Systemic simulation** — liquids, fire, gas, limbs interact; fun is spotting unscripted combos. → rooms as systems (spreading spores, flammable fungus, water conducting).
2. **World-affecting verbs** — phasing, burrowing, jumping, wall-cutting; builds traverse differently. → class/relic verbs on terrain (Junk Prophet rewires a dead lamp-turret, etc.).
3. **Inhabited, not just hostile** — factions fight each other, neutrals trade/talk. → mob factions you can lure into each other; neutral scavengers who sell map fragments or call you "sump" and attack.
4. **Unknowns** — unidentified artifacts; curiosity is a loop. → relics whose use you learn by examining or risking.
5. **Emergent stories** — you remember the incident, not the loot.
6. **Exploration = combat space** — Qud has one grid; Caverns deliberately splits it, so exploration must carry its own weight.

## Notes from the SFX pass (2026-09-28)

- **Music masks the biome beds.** In play-testing, the music track mostly covers the ambience beds. Not a problem yet — revisit when mixing (duck music in dungeons, or raise bed levels in `sfxManifest.ts`).
