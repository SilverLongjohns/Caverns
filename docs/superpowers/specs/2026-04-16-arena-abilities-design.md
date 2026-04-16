# Arena Ability Targeting Design

## Goal

Integrate the existing class ability system into arena combat with spatial targeting: ranged single-target abilities, area-of-effect abilities with visual radius preview, and line-of-sight validation through the tile grid.

## Current State

- Abilities are defined in `shared/src/data/classes.json` with `AbilityDefinition` types
- `AbilityResolver` handles effect resolution (damage, heal, buff, taunt, skip_turn, prevent_down)
- `GameSession.handleUseAbility` validates energy, resolves effects, broadcasts results
- `CombatView` has ability buttons with tooltip pattern (`.ability-btn > .ability-tooltip`)
- Arena combat has a tile grid with walls, chasms, floor, water, hazards
- Energy: max 30, starts at 30, regen 2/turn. Stored on `Player` object.
- No spatial validation exists for abilities — they currently just target by ID

## Design

### 1. AbilityDefinition Schema Changes

Add two optional fields to `AbilityDefinition` in `shared/src/classTypes.ts`:

```typescript
export interface AbilityDefinition {
  // ... existing fields ...
  range?: number;       // max Chebyshev distance (diagonals count as 1). Omitted = melee/self.
  areaRadius?: number;  // if present, hits all valid targets within this Manhattan radius of the targeted tile. 1 = 3x3 area.
}
```

Extend `targetType` to include area variants:

```typescript
targetType: 'none' | 'ally' | 'enemy' | 'area_enemy' | 'area_ally';
```

### 2. Ability Changes

**Suturist — new ability: Bone Spike**
- `id`: `"bone_spike"`
- `name`: `"Bone Spike"`
- `description`: `"Hurl a shard of sharpened bone at a distant enemy."`
- `energyCost`: 10
- `targetType`: `"enemy"`
- `range`: 6
- `passive`: false
- `effects`: `[{ "type": "deal_damage", "multiplier": 1.0, "ignoreDefense": false }]`

**Artificer — new ability: Scrap Volley**
- `id`: `"scrap_volley"`
- `name`: `"Scrap Volley"`
- `description`: `"Lob a cluster of jagged scrap into an area."`
- `energyCost`: 15
- `targetType`: `"area_enemy"`
- `range`: 5
- `areaRadius`: 1
- `passive`: false
- `effects`: `[{ "type": "deal_damage", "multiplier": 0.5, "ignoreDefense": false }]`

**Artificer — modify Static Hymn**
- Change `targetType` from `"none"` to `"area_enemy"`
- Add `"range": 5`
- Add `"areaRadius": 1`
- Change effect from `{ "type": "skip_turn", "duration": 1, "targets": "all_enemies" }` to `{ "type": "skip_turn", "duration": 1 }` — area targeting handles who gets hit
- Reduce `energyCost` from 25 to 20 (now spatial rather than global)

### 3. Line-of-Sight Utility

New function in `server/src/arenaMovement.ts`:

```typescript
function hasLineOfSight(
  grid: TileGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
  maxRange: number
): boolean
```

- Checks Chebyshev distance (`max(|dx|, |dy|)`) <= maxRange
- Walks a Bresenham line from `from` to `to`
- Returns false if any intermediate tile (excluding start and end) is wall or chasm
- Also export for client-side use (LoS highlight calculation)

Duplicate or share this logic on the client for immediate UI feedback. The client already duplicates BFS movement logic, so this follows the same pattern.

### 4. Server: handleUseAbility Spatial Validation

Modify `GameSession.handleUseAbility`:

1. If ability has `range`:
   - Look up caster position and target position from `ArenaCombatManager`
   - Validate `hasLineOfSight(grid, casterPos, targetPos, ability.range)`
   - Reject with error if out of range or blocked

2. If ability has `areaRadius`:
   - Client sends a **target tile** coordinate instead of a target entity ID
   - Validate the tile is within range + LoS from caster
   - Find all enemy participants within `areaRadius` Manhattan distance of the target tile
   - Resolve effects against each of them individually
   - Broadcast a combined result

3. If ability has no `range` (melee-range abilities like existing Templar/Phaseknife):
   - Validate adjacency for enemy-targeted abilities (same as attack)
   - Self/none abilities work as before

4. After resolving, call `combat.markActionTaken(playerId)` so the move-act-move pattern works

### 5. Message Protocol Changes

**Client → Server for area abilities:**

Add a new message type or extend `CombatActionMessage`:

```typescript
export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  abilityId?: string;
  targetId?: string;
  targetX?: number;  // for area abilities: the targeted tile
  targetY?: number;
}
```

`handleUseAbility` signature changes to accept optional coordinates.

### 6. Client: ArenaActionBar Ability Mode

Add an "Abilities" button to the main action bar (between Items and Flee). When clicked, shows the list of active (non-passive) abilities for the player's class, each as a button with:
- Ability name + energy cost
- Tooltip on hover (reuse `.ability-btn` + `.ability-tooltip` pattern)
- Disabled if insufficient energy or action already taken

When an ability button is clicked:
- If `targetType === 'none'`: fire immediately (no targeting needed)
- If `targetType === 'enemy'` with `range`: enter `target_ability_single` mode
- If `targetType === 'enemy'` without `range`: enter `target_ability_single` mode but only adjacent enemies are valid
- If `targetType === 'ally'` with `range`: enter `target_ability_single` mode for allies
- If `targetType === 'area_enemy'`: enter `target_ability_area` mode

### 7. Client: ArenaView Targeting Modes

**`target_ability_single` mode:**
- Highlight all tiles containing valid targets within range + LoS
- Click a highlighted entity to use the ability on them
- Back button to cancel

**`target_ability_area` mode:**
- On hover, show a pale red 3x3 highlight (radius 1 Manhattan) centered on the cursor tile
- Only show the highlight if the center tile is within range + LoS from caster
- Tiles outside the grid or containing walls are still highlighted (the area effect just won't hit entities on impassable tiles)
- Click to confirm — send `targetX`/`targetY` to server
- Back button to cancel

### 8. Client: LoS Calculation

Duplicate the Bresenham LoS check on the client (same as server). Used to:
- Determine which tiles/enemies are valid targets for range highlighting
- Determine if the AoE cursor position is valid

This follows the existing pattern where client duplicates server BFS logic for movement range.

### 9. Files Changed

- `shared/src/classTypes.ts` — add `range`, `areaRadius` to `AbilityDefinition`, extend `targetType`
- `shared/src/data/classes.json` — add Bone Spike, add Scrap Volley, modify Static Hymn
- `server/src/arenaMovement.ts` — add `hasLineOfSight` function
- `server/src/GameSession.ts` — modify `handleUseAbility` for spatial validation + area resolution
- `server/src/index.ts` — pass `targetX`/`targetY` through from message
- `shared/src/messages.ts` — add `targetX`/`targetY` to `CombatActionMessage`
- `client/src/components/ArenaActionBar.tsx` — add abilities button + ability list + modes
- `client/src/components/ArenaView.tsx` — add `target_ability_single` and `target_ability_area` interaction modes, LoS calculation, area highlight
- `client/src/styles/index.css` — add `.arena-area-highlight` style (pale red)
- `client/src/hooks/useGameActions.ts` — extend `useAbility` to accept optional coordinates

### 10. What's NOT Changing

- AbilityResolver effect handlers — they already work on individual targets
- Buff system — unchanged
- Energy system — unchanged  
- Existing melee abilities (Templar, Phaseknife) — they keep working with adjacency checks
- Passive abilities — unchanged
