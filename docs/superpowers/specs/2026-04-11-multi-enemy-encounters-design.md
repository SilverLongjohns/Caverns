# Multi-Enemy Encounters Design

## Goal

Replace single-mob encounters with scaled multi-enemy encounters. The encounter's mob count adapts to the party's current strength — more players and higher levels mean more enemies. Each encounter has a "leader" (the existing mob from the room encounter) plus skull-1 "adds" from the same biome.

## Encounter Scaling

When a player first enters an uncleared room with an encounter, the server calculates party power and determines how many adds spawn alongside the leader.

### Party Power

Party power = sum across all players of: `damage + defense + (maxHp / 5)`, using `computePlayerStats` (includes equipment and stat allocations). The `/5` normalizes HP contribution to be on the same scale as damage/defense.

### Add Count Formula

```
addCount = clamp(floor((partyPower - baseline) / step), 0, maxAdds)
```

Reference values at default config (`baseline: 50`, `step: 15`, `maxAdds: 3`):

| Scenario | Power | Adds |
|---|---|---|
| Solo level 1 | ~17 | 0 |
| 2-player level 2 | ~45 | 0 |
| 4-player level 1 | ~68 | 1 |
| 4-player level 2 | ~80 | 2 |
| 4-player level 4 | ~110 | 3 (max) |

### Add Composition

Adds are always skull-1 mobs from the same biome as the room's encounter. The leader is the mob defined in `room.encounter.mobId` as it works today. Add mobs are picked randomly from the biome's skull-1 pool. Duplicate mob types in the same encounter are allowed (e.g., 2x Tunnel Rat).

### Encounter Lock-In

The add count is calculated and locked when the first player enters the room. If players leave and re-enter before combat, the same mobs are still there — no recalculation.

## XP and Loot

XP per encounter = leader's skull-rating XP (from `progressionConfig.json`) + `addXpBonus` per add killed. XP is still awarded party-wide.

Loot comes from the leader's `lootTable` + room loot only. Adds do not drop loot.

## Config

New file `shared/src/data/encounterConfig.json`:

```json
{
  "baseline": 50,
  "step": 15,
  "maxAdds": 3,
  "addXpBonus": 5,
  "detectionRange": 1,
  "pursuitRange": 10
}
```

Typed wrapper follows the existing config pattern:
- `configTypes.ts` gets an `EncounterConfig` interface
- `shared/src/data/encounter.ts` exports `ENCOUNTER_CONFIG`
- `shared/src/index.ts` re-exports it

`detectionRange` and `pursuitRange` move from hardcoded constants in `MobAIManager.ts` into this config.

## MobAIManager Changes

### Multi-Mob Per Room

`MobAIManager` changes from tracking one mob per room to multiple. The `MobRoom` interface gains an array of mob entries (each with position, mob instance, and grid entity) instead of a single mob.

### Room-Wide Behavior

`pursuing` and `paused` flags remain room-wide. When any mob enters pursuit range of a player, all mobs in the room pursue. When any mob reaches detection range (1 tile), combat starts with all mobs.

### Spawn Positions

Each mob gets an independent spawn position from `findSpawnPosition`. The grid entity system prevents overlapping — if a position is occupied, retry.

### Movement

Each mob moves independently in the tick loop. Non-pursuing mobs wander randomly. Pursuing mobs each pathfind toward the nearest player. Mobs can block each other via grid collision, creating natural staggering.

### Detection

`onDetection` fires when any mob in the room reaches detection range (1 tile) of any player. `onPursuitStart` fires when any mob reaches pursuit range (10 tiles). Both fire once per room, not per mob.

### API Changes

- `registerRoom(roomId, grid, mobs: MobInstance[])` — takes an array instead of a single mob
- `removeMob(roomId)` — removes all mobs in the room (rename consideration: `removeRoom` or keep as-is)
- `pauseMob(roomId)` / `reactivateMob(roomId)` — pause/resume all mobs in the room
- `getMobPosition(roomId)` → `getMobPositions(roomId)` — returns array
- `getMobId(roomId)` → `getMobIds(roomId)` — returns array

### Flee Bug Fix

When combat ends via flee, `reactivateMob` re-adds all mobs to the grid and broadcasts `mob_spawn` for each. Currently this works for the single mob case but the mobs appear invisible on re-entry — the fix ensures grid entities are properly re-registered and spawn messages are broadcast.

## GameSession Changes

### startCombat

`startCombat` changes signature from `(roomId, mobTemplateId)` to `(roomId, mobInstances: MobInstance[])`. The caller is responsible for building the mob list (leader + adds).

### Encounter Entry Flow

When a player enters an uncleared room with an encounter:

1. Calculate party power from all players' computed stats
2. Determine add count using the formula
3. Pick add mobs: random skull-1 mobs from the same biome
4. Create `MobInstance` for leader + each add
5. Register all with `MobAIManager`
6. Store the spawned mob instances on the room so re-entry doesn't recalculate

### Biome Lookup

The encounter system needs to know the room's biome to pick appropriate adds. The biome is inferred from the room ID prefix (existing pattern used in `DebugPanel`), or looked up from zone data stored during generation.

### Combat Text

When combat starts:
- Leader only: `"A Tunnel Rat appears! (☠)"`
- Leader + adds: `"A Tunnel Rat appears with 2 Cave Bats! (☠)"`

### XP Award

`finishCombat` changes XP calculation: base XP from leader skull rating + `addXpBonus * addCount`. The add count is derived from the combat's mob participants.

## Client-Side Changes

### Store

`mobPositions` type changes from `Record<string, { mobId, mobName, x, y }>` (one per room) to `Record<string, { mobId, mobName, x, y }[]>` (array per room).

- `mob_spawn`: push to the room's array (create array if first mob)
- `mob_position`: find by `mobId` in the room's array, update position
- `mob_despawn`: filter out by `mobId` from the room's array; delete room key if empty

### Room View / TileGridView

Mob entities are rendered from the grid data — multiple mobs appear automatically since each gets its own grid entity. No structural changes needed.

### Mob Alert

The "!" alert fires once per room on pursuit start, positioned at the mob that triggered it. No change needed — `onPursuitStart` already fires once.

### CombatView

Already renders all `participants` from `CombatState`. Multiple mobs show up automatically. No changes needed.

## Files Changed

### New Files
- `shared/src/data/encounterConfig.json` — scaling config
- `shared/src/data/encounter.ts` — typed config wrapper

### Modified Files
- `shared/src/data/configTypes.ts` — add `EncounterConfig` interface
- `shared/src/index.ts` — re-export encounter config
- `server/src/MobAIManager.ts` — multi-mob support, config-driven ranges
- `server/src/MobAIManager.test.ts` — update tests for multi-mob API
- `server/src/GameSession.ts` — encounter scaling, startCombat signature, XP calculation, biome lookup
- `client/src/store/gameStore.ts` — mobPositions type change, mob_spawn/position/despawn handlers

## Testing

- `MobAIManager.test.ts`: multi-mob registration, independent movement, room-wide pursuit, detection from any mob, pause/reactivate all
- `GameSession.test.ts`: add count formula at various party powers, biome-correct add selection, XP bonus from adds, encounter lock-in on re-entry
- Config validation: baseline > 0, step > 0, maxAdds >= 0
