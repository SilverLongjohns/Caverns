# XP & Leveling System Design

## Goal

Add experience points and leveling to Caverns. XP is shared party-wide, levels grant stat points, and players allocate points freely into obfuscated stats from the HUD.

## Obfuscated Stats

All player-facing UI uses display names instead of raw internal stat names.

| Display Name | Internal Stat | Per Point |
|---|---|---|
| Vitality | maxHp | +5 |
| Ferocity | damage | +1 |
| Toughness | defense | +1 |
| Speed | initiative | +1 |
| Tactics | maxEnergy | +5 |

These names appear in the HUD, stat allocation panel, combat tooltips, and equipment stat displays. Internal code continues to use the raw stat names (`maxHp`, `damage`, etc.) — the mapping lives in `progressionConfig.json` and is used by the UI layer.

## XP Rewards

XP is awarded on combat victory based on the defeated mob's skull rating. All players in the session receive the same XP — not just players in the room where the fight happened. This keeps the party at the same level regardless of who lands the killing blow or which room they're in.

XP is awarded in `GameSession.finishCombat` when the result is `'victory'`. The mob's skull rating is looked up and mapped to an XP value via config.

### Config

```json
{
  "xpPerSkull": {
    "1": 10,
    "2": 25,
    "3": 50
  }
}
```

### Broadcast

On XP gain, a `text_log` message is broadcast to all players:

```
"Gained 25 XP from defeating Alpha Wolf!"
```

## Leveling

### Level Thresholds

A config table defines the cumulative XP required to reach each level. Index 0 is level 1 (starting level, always 0). The player's level is the highest index whose threshold their total XP meets or exceeds.

```json
{
  "levelThresholds": [0, 30, 75, 140, 230, 350]
}
```

This means: level 1 at 0 XP, level 2 at 30 XP, level 3 at 75 XP, etc. The table can be extended to add more levels. Max level is the length of this array.

### Stat Points

A fixed number of stat points are granted per level-up, configured as:

```json
{
  "statPointsPerLevel": 2
}
```

Points are banked — they accumulate in `unspentStatPoints` on the `Player` object. The player assigns them from the HUD whenever they choose, with no time pressure or interruption to gameplay.

If a player gains multiple levels at once (e.g., from a boss kill), they receive points for each level gained.

### Level-Up Detection

After awarding XP, the server checks each player's new total against the threshold table. If the player's level has increased:

1. Increment `player.level`
2. Add `statPointsPerLevel` to `player.unspentStatPoints` (per level gained)
3. Heal the player to full HP (based on new computed maxHp)
4. Broadcast a `text_log`: `"PlayerName reached level 3!"`
5. Send `player_update` with the updated player state (which includes new level, XP, unspent points)
6. Send a `level_up` message to trigger the client glow animation

## Stat Allocation

### Player Data Changes

The `Player` type gains these fields:

```typescript
xp: number;              // cumulative XP earned
level: number;           // current level (starts at 1)
unspentStatPoints: number;
statAllocations: Record<string, number>;  // e.g. { "vitality": 3, "ferocity": 1 }
```

`createPlayer` initializes these to `xp: 0`, `level: 1`, `unspentStatPoints: 0`, `statAllocations: {}`.

### Computing Stats

`computePlayerStats` is updated to layer stat point allocations on top of base stats and equipment:

```
finalStat = classBase + equipmentBonus + (allocations[statId] * perPoint)
```

The `statDefinitions` array in config maps each allocatable stat to its internal stat name and per-point value, so `computePlayerStats` iterates this array and applies allocations.

For energy/maxEnergy: the same pattern applies. `Tactics` points increase `maxEnergy` via the energy config system. `computePlayerStats` returns a `ComputedStats` that now includes `maxEnergy`.

### Allocation Flow

1. Player opens stat allocation panel in HUD (visible when `unspentStatPoints > 0`)
2. Player clicks a stat to allocate 1 point
3. Client sends `allocate_stat` message: `{ type: 'allocate_stat', statId: 'vitality', points: 1 }`
4. Server validates: stat ID exists in `statDefinitions`, player has enough unspent points
5. Server updates `player.statAllocations[statId]` and decrements `player.unspentStatPoints`
6. If allocating Vitality, player's current HP increases by the per-point value (so they don't need to heal to benefit)
7. Server broadcasts `player_update` with new player state

## Config File

All progression tuning lives in `shared/src/data/progressionConfig.json`:

```json
{
  "xpPerSkull": {
    "1": 10,
    "2": 25,
    "3": 50
  },
  "levelThresholds": [0, 30, 75, 140, 230, 350],
  "statPointsPerLevel": 2,
  "statDefinitions": [
    { "id": "vitality", "displayName": "Vitality", "internalStat": "maxHp", "perPoint": 5 },
    { "id": "ferocity", "displayName": "Ferocity", "internalStat": "damage", "perPoint": 1 },
    { "id": "toughness", "displayName": "Toughness", "internalStat": "defense", "perPoint": 1 },
    { "id": "speed", "displayName": "Speed", "internalStat": "initiative", "perPoint": 1 },
    { "id": "tactics", "displayName": "Tactics", "internalStat": "maxEnergy", "perPoint": 5 }
  ]
}
```

Typed wrapper follows the existing config pattern:

- `configTypes.ts` gets a `ProgressionConfig` interface
- `shared/src/data/progression.ts` exports `PROGRESSION_CONFIG`
- `shared/src/index.ts` re-exports it

## Message Protocol Changes

### Client → Server

New message:

```typescript
export interface AllocateStatMessage {
  type: 'allocate_stat';
  statId: string;
  points: number;
}
```

Added to `ClientMessage` union.

### Server → Client

New message for the level-up glow animation:

```typescript
export interface LevelUpMessage {
  type: 'level_up';
  playerId: string;
  newLevel: number;
}
```

Added to `ServerMessage` union.

XP gain and level-up announcements use existing `text_log` messages. Player state changes (XP, level, unspent points, allocations) are communicated via existing `player_update` messages.

## UI Changes

### HUD

The PlayerHUD gains:

- **Level badge**: Shows current level (e.g., "Lv 3")
- **XP bar**: Below or near the HP bar, showing progress to next level. Displays `currentXP / nextThresholdXP`. At max level, shows "MAX".
- **Unspent points indicator**: When `unspentStatPoints > 0`, a glowing badge appears on the HUD indicating available points (e.g., "+2")

### Stat Allocation Panel

Accessible from the HUD when unspent points are available. Shows:

- Each stat with its display name, current allocated points, and a `[+]` button
- Remaining unspent points count
- Current computed value of each stat (so the player can see the effect)

This panel can be opened/closed freely and does not block gameplay.

### Stat Display Renaming

Everywhere stats are shown to the player (equipment tooltips, combat info, HUD), use the display names from `statDefinitions`:

- `maxHp` → Vitality
- `damage` → Ferocity
- `defense` → Toughness
- `initiative` → Speed
- `maxEnergy` → Tactics

Equipment stats like "+3 damage" become "+3 Ferocity".

### Level-Up Glow Animation

When the client receives a `level_up` message where `playerId` matches the local player:

- A golden glow animation fires from the four corners of the screen, expanding inward and fading out
- The animation is purely cosmetic, ~1 second duration
- Implemented as a CSS overlay with keyframe animation
- Triggered by a transient `levelUpGlow` flag in the Zustand store, cleared after the animation completes via `setTimeout`

## Server Changes

### GameSession

- `finishCombat`: On victory, look up the defeated mob's skull rating, resolve XP from config, award to all players, check for level-ups
- New `handleAllocateStat` method: validates and applies stat point allocation
- `index.ts`: Route `allocate_stat` messages to `handleAllocateStat`

### PlayerManager

- `awardXp(playerId, amount)`: Adds XP, returns new total
- `checkLevelUp(playerId)`: Compares XP to thresholds, increments level, grants stat points, returns levels gained
- `allocateStat(playerId, statId, points)`: Validates and applies allocation

## Files Changed

### New Files
- `shared/src/data/progressionConfig.json` — all progression tuning values
- `shared/src/data/progression.ts` — typed config wrapper

### Modified Files
- `shared/src/data/configTypes.ts` — add `ProgressionConfig` interface
- `shared/src/types.ts` — add XP/level/allocation fields to `Player`, update `ComputedStats` to include `maxEnergy`, update `computePlayerStats`
- `shared/src/messages.ts` — add `AllocateStatMessage`, `LevelUpMessage`
- `shared/src/index.ts` — re-export progression config
- `server/src/index.ts` — route `allocate_stat` message
- `server/src/GameSession.ts` — XP award in `finishCombat`, `handleAllocateStat` method
- `server/src/PlayerManager.ts` — `awardXp`, `checkLevelUp`, `allocateStat` methods
- `client/src/store/gameStore.ts` — handle `level_up` message, `levelUpGlow` state
- `client/src/components/PlayerHUD.tsx` — level badge, XP bar, unspent points indicator, stat allocation panel, rename stats to display names
- `client/src/styles/index.css` — XP bar styles, stat allocation panel styles, level-up glow keyframes and overlay

## Testing

- `PlayerManager.test.ts`: XP award, level-up detection (single and multi-level), stat allocation (valid, invalid stat ID, insufficient points)
- `GameSession.test.ts`: XP broadcast on combat victory, party-wide distribution
- Config validation: thresholds are ascending, stat definitions have valid internal stat names
