# Arena Ability Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spatial targeting (ranged single-target, area-of-effect with radius preview, line-of-sight validation) to class abilities in arena combat.

**Architecture:** Extend `AbilityDefinition` with `range` and `areaRadius` fields. Add Bresenham line-of-sight to both server and client. Server validates spatial constraints in `handleUseAbility`; client shows targeting modes with highlights and AoE preview. Two new abilities (Bone Spike, Scrap Volley) and one modified ability (Static Hymn).

**Tech Stack:** TypeScript, React, Zustand, ws (WebSocket), Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-arena-abilities-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/src/classTypes.ts` | Modify | Add `range`, `areaRadius` to `AbilityDefinition`; extend `targetType` |
| `shared/src/data/classes.json` | Modify | Add Bone Spike, Scrap Volley; modify Static Hymn |
| `shared/src/messages.ts` | Modify | Add `targetX`/`targetY` to `CombatActionMessage` |
| `server/src/arenaMovement.ts` | Modify | Add `hasLineOfSight` function |
| `server/src/arenaMovement.test.ts` | Create | Tests for `hasLineOfSight` |
| `server/src/GameSession.ts` | Modify | Spatial validation + area resolution in `handleUseAbility` |
| `server/src/index.ts` | Modify | Pass `targetX`/`targetY` through to `handleUseAbility` |
| `client/src/hooks/useGameActions.ts` | Modify | Extend `useAbility` to accept optional coordinates |
| `client/src/components/ArenaActionBar.tsx` | Modify | Add Abilities button + ability list + targeting modes |
| `client/src/components/ArenaView.tsx` | Modify | Add `target_ability_single`/`target_ability_area` interaction modes, LoS calc, area highlight |
| `client/src/styles/index.css` | Modify | Add `.arena-area-highlight` style |

---

### Task 1: Schema Changes — AbilityDefinition & Messages

**Files:**
- Modify: `shared/src/classTypes.ts:1-15`
- Modify: `shared/src/messages.ts:22-29`

- [ ] **Step 1: Extend AbilityDefinition type**

In `shared/src/classTypes.ts`, add `range`, `areaRadius`, and new target types:

```typescript
export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  energyCost: number;
  targetType: 'none' | 'ally' | 'enemy' | 'area_enemy' | 'area_ally';
  passive: boolean;
  trigger?: string;
  effects: AbilityEffect[];
  range?: number;       // max Chebyshev distance. Omitted = melee/self.
  areaRadius?: number;  // Manhattan radius of AoE. 1 = 3x3 area.
}
```

- [ ] **Step 2: Add targetX/targetY to CombatActionMessage**

In `shared/src/messages.ts`, add two optional fields to `CombatActionMessage`:

```typescript
export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
  critMultiplier?: number;
  abilityId?: string;
  effectId?: string;
  targetX?: number;  // for area abilities: the targeted tile
  targetY?: number;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/typescript/bin/tsc --noEmit -p shared/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: extend AbilityDefinition with range/areaRadius and CombatActionMessage with targetX/targetY
```

---

### Task 2: Add Abilities to classes.json

**Files:**
- Modify: `shared/src/data/classes.json`

- [ ] **Step 1: Add Bone Spike to Suturist (cleric)**

In `shared/src/data/classes.json`, add a new ability to the `cleric` class's `abilities` array, after `blessed_ward`:

```json
{
  "id": "bone_spike",
  "name": "Bone Spike",
  "description": "Hurl a shard of sharpened bone at a distant enemy.",
  "energyCost": 10,
  "targetType": "enemy",
  "range": 6,
  "passive": false,
  "effects": [
    { "type": "deal_damage", "multiplier": 1.0, "ignoreDefense": false }
  ]
}
```

- [ ] **Step 2: Add Scrap Volley to Artificer**

Add a new ability to the `artificer` class's `abilities` array, after `smoke_bomb`:

```json
{
  "id": "scrap_volley",
  "name": "Scrap Volley",
  "description": "Lob a cluster of jagged scrap into an area.",
  "energyCost": 15,
  "targetType": "area_enemy",
  "range": 5,
  "areaRadius": 1,
  "passive": false,
  "effects": [
    { "type": "deal_damage", "multiplier": 0.5, "ignoreDefense": false }
  ]
}
```

- [ ] **Step 3: Modify Static Hymn on Artificer**

Change the `smoke_bomb` ability in `artificer`:

```json
{
  "id": "smoke_bomb",
  "name": "Static Hymn",
  "description": "Disrupt all enemies in an area, skipping their next turn.",
  "energyCost": 20,
  "targetType": "area_enemy",
  "range": 5,
  "areaRadius": 1,
  "passive": false,
  "effects": [
    { "type": "skip_turn", "duration": 1 }
  ]
}
```

Key changes from before: `targetType` was `"none"` → `"area_enemy"`, added `range: 5` and `areaRadius: 1`, `energyCost` was `25` → `20`, removed `"targets": "all_enemies"` from the effect (area targeting handles target selection).

- [ ] **Step 4: Verify classes.json loads cleanly**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe -e "const c = require('./shared/src/data/classes.json'); console.log(c.map(cl => cl.id + ': ' + cl.abilities.map(a => a.id).join(', ')).join('\n'))"`
Expected: All four classes listed with their abilities including `bone_spike` and `scrap_volley`.

- [ ] **Step 5: Commit**

```
feat: add Bone Spike, Scrap Volley abilities; make Static Hymn area-targeted
```

---

### Task 3: Line-of-Sight Utility

**Files:**
- Modify: `server/src/arenaMovement.ts`
- Create: `server/src/arenaMovement.test.ts` (or add to existing test file)

- [ ] **Step 1: Write failing tests for hasLineOfSight**

Create `server/src/arenaMovement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hasLineOfSight } from './arenaMovement.js';
import type { TileGrid } from '@caverns/shared';

function makeGrid(tiles: string[][]): TileGrid {
  return { width: tiles[0].length, height: tiles.length, tiles };
}

describe('hasLineOfSight', () => {
  const openGrid = makeGrid([
    ['wall','wall','wall','wall','wall','wall','wall','wall','wall','wall'],
    ['wall','floor','floor','floor','floor','floor','floor','floor','floor','wall'],
    ['wall','floor','floor','floor','floor','floor','floor','floor','floor','wall'],
    ['wall','floor','floor','floor','floor','floor','floor','floor','floor','wall'],
    ['wall','floor','floor','floor','floor','floor','floor','floor','floor','wall'],
    ['wall','wall','wall','wall','wall','wall','wall','wall','wall','wall'],
  ]);

  it('returns true for same tile', () => {
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 1, y: 1 }, 6)).toBe(true);
  });

  it('returns true for adjacent tile', () => {
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 2, y: 1 }, 6)).toBe(true);
  });

  it('returns true for diagonal within range', () => {
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 4, y: 4 }, 6)).toBe(true);
  });

  it('returns false when out of range', () => {
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 8, y: 4 }, 3)).toBe(false);
  });

  it('returns false when wall blocks LoS', () => {
    const blockedGrid = makeGrid([
      ['wall','wall','wall','wall','wall','wall','wall'],
      ['wall','floor','floor','wall','floor','floor','wall'],
      ['wall','floor','floor','wall','floor','floor','wall'],
      ['wall','wall','wall','wall','wall','wall','wall'],
    ]);
    expect(hasLineOfSight(blockedGrid, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
  });

  it('returns false when chasm blocks LoS', () => {
    const chasmGrid = makeGrid([
      ['wall','wall','wall','wall','wall','wall','wall'],
      ['wall','floor','floor','chasm','floor','floor','wall'],
      ['wall','wall','wall','wall','wall','wall','wall'],
    ]);
    expect(hasLineOfSight(chasmGrid, { x: 1, y: 1 }, { x: 5, y: 1 }, 6)).toBe(false);
  });

  it('uses Chebyshev distance (diagonals cost 1)', () => {
    // Chebyshev: max(|3|, |3|) = 3, so range 3 should reach diagonal (4,4) from (1,1)
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 4, y: 4 }, 3)).toBe(true);
    // But range 2 should not
    expect(hasLineOfSight(openGrid, { x: 1, y: 1 }, { x: 4, y: 4 }, 2)).toBe(false);
  });

  it('does not block on start or end tile even if wall', () => {
    // Wall at start/end should not block — only intermediate tiles block
    const edgeGrid = makeGrid([
      ['wall','wall','wall','wall','wall'],
      ['wall','floor','floor','floor','wall'],
      ['wall','wall','wall','wall','wall'],
    ]);
    // From (1,1) to (3,1): no intermediate walls on this line
    expect(hasLineOfSight(edgeGrid, { x: 1, y: 1 }, { x: 3, y: 1 }, 6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/vitest run server/src/arenaMovement.test.ts`
Expected: FAIL — `hasLineOfSight` is not exported

- [ ] **Step 3: Implement hasLineOfSight**

Add to `server/src/arenaMovement.ts`:

```typescript
/**
 * Bresenham line-of-sight check.
 * Returns true if there is a clear line from `from` to `to` within `maxRange` (Chebyshev distance).
 * Intermediate tiles that are wall or chasm block LoS. Start and end tiles are not checked.
 */
export function hasLineOfSight(
  grid: TileGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
  maxRange: number,
): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);

  // Chebyshev distance check
  if (Math.max(dx, dy) > maxRange) return false;

  // Same tile
  if (dx === 0 && dy === 0) return true;

  // Bresenham line walk — check intermediate tiles
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = from.x;
  let y = from.y;

  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }

    // Reached destination — don't check end tile
    if (x === to.x && y === to.y) break;

    // Check intermediate tile
    const tile = grid.tiles[y]?.[x];
    if (!tile || tile === 'wall' || tile === 'chasm') return false;
  }

  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/vitest run server/src/arenaMovement.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
feat: add Bresenham line-of-sight check to arenaMovement
```

---

### Task 4: Server — Spatial Validation in handleUseAbility

**Files:**
- Modify: `server/src/GameSession.ts:2046-2121`
- Modify: `server/src/index.ts:929-931`

- [ ] **Step 1: Update server/src/index.ts to pass targetX/targetY**

In `server/src/index.ts`, at the `use_ability` branch (around line 930):

Change:
```typescript
if (msg.action === 'use_ability' && msg.abilityId) {
  getGameSession(playerId)?.handleUseAbility(playerId, msg.abilityId, msg.targetId);
```

To:
```typescript
if (msg.action === 'use_ability' && msg.abilityId) {
  getGameSession(playerId)?.handleUseAbility(playerId, msg.abilityId, msg.targetId, msg.targetX, msg.targetY);
```

- [ ] **Step 2: Import hasLineOfSight in GameSession.ts**

Add to the imports at the top of `server/src/GameSession.ts`:

```typescript
import { hasLineOfSight, isAdjacent } from './arenaMovement.js';
```

(Check if `isAdjacent` is already imported — if not, add it.)

- [ ] **Step 3: Rewrite handleUseAbility for arena spatial validation**

Replace the existing `handleUseAbility` method in `server/src/GameSession.ts` with:

```typescript
handleUseAbility(playerId: string, abilityId: string, targetId?: string, targetX?: number, targetY?: number): void {
  const player = this.playerManager.getPlayer(playerId);
  if (!player || player.status !== 'in_combat') return;

  // Determine whether this is arena or classic combat
  const arenaCombat = this.arenaCombats.get(player.roomId);
  const classicCombat = this.combats.get(player.roomId);
  const combat = arenaCombat ?? classicCombat;
  if (!combat || !combat.isPlayerTurn(playerId)) return;

  const classDef = getClassDefinition(player.className);
  if (!classDef) return;

  const ability = classDef.abilities.find(a => a.id === abilityId && !a.passive);
  if (!ability) return;

  if (!this.playerManager.hasEnergy(playerId, ability.energyCost)) {
    this.sendTo(playerId, { type: 'error', message: `Not enough energy for ${ability.name}.` });
    return;
  }

  // Check if action already taken in arena
  if (arenaCombat) {
    const turnState = arenaCombat.getTurnState(playerId);
    if (turnState?.actionTaken) {
      this.sendTo(playerId, { type: 'error', message: 'Action already taken this turn.' });
      return;
    }
  }

  const participants = combat.getParticipantsArray();
  const caster = participants.find(p => p.id === playerId);
  if (!caster) return;

  // --- Area ability (area_enemy / area_ally) ---
  if ((ability.targetType === 'area_enemy' || ability.targetType === 'area_ally') && arenaCombat) {
    if (targetX === undefined || targetY === undefined) {
      this.sendTo(playerId, { type: 'error', message: 'Area ability requires target coordinates.' });
      return;
    }

    const casterPos = arenaCombat.getPosition(playerId);
    if (!casterPos) return;
    const targetTile = { x: targetX, y: targetY };

    if (ability.range && !hasLineOfSight(arenaCombat.getGrid(), casterPos, targetTile, ability.range)) {
      this.sendTo(playerId, { type: 'error', message: 'Target out of range or blocked.' });
      return;
    }

    // Find all valid targets within areaRadius (Manhattan distance)
    const radius = ability.areaRadius ?? 0;
    const isEnemy = ability.targetType === 'area_enemy';
    const hitTargets = participants.filter(p => {
      if (!p.alive) return false;
      if (isEnemy ? (p.type === caster.type || p.id === playerId) : (p.type !== caster.type)) return false;
      const pos = arenaCombat.getPosition(p.id);
      if (!pos) return false;
      return Math.abs(pos.x - targetX) + Math.abs(pos.y - targetY) <= radius;
    });

    // Resolve effects against each target individually
    let totalDamage = 0;
    let totalHealing = 0;
    const allBuffs: string[] = [];
    const downedTargets: string[] = [];

    for (const hitTarget of hitTargets) {
      const result = this.abilityResolver.resolveAllEffects(ability.effects, caster, hitTarget, participants);
      if (result.damage) totalDamage += result.damage;
      if (result.healing) totalHealing += result.healing;
      if (result.buffsApplied) allBuffs.push(...result.buffsApplied);
      if (result.targetDowned) downedTargets.push(hitTarget.id);

      // Sync healing to PlayerManager
      if (result.healing) {
        const targetPlayer = this.playerManager.getPlayer(hitTarget.id);
        if (targetPlayer) {
          this.playerManager.healPlayer(hitTarget.id, result.healing);
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(hitTarget.id)! });
        }
      }
    }

    this.playerManager.spendEnergy(playerId, ability.energyCost);

    // Broadcast combined result
    this.broadcastToRoom(player.roomId, {
      type: 'combat_action_result',
      actorId: playerId,
      actorName: player.name,
      action: 'use_ability',
      abilityId: ability.id,
      abilityName: ability.name,
      damage: totalDamage || undefined,
      healing: totalHealing || undefined,
      buffsApplied: allBuffs.length > 0 ? allBuffs : undefined,
    } as any);

    // Narrate
    if (hitTargets.length > 0) {
      const hitNames = hitTargets.map(t => t.name).join(', ');
      if (totalDamage) {
        this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, hitting ${hitNames} for ${totalDamage} total damage!`, logType: 'combat' });
      } else {
        this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, affecting ${hitNames}!`, logType: 'combat' });
      }
    } else {
      this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, but hits nothing!`, logType: 'combat' });
    }

    // Handle downed targets
    for (const downedId of downedTargets) {
      const targetPlayer = this.playerManager.getPlayer(downedId);
      if (targetPlayer) {
        this.playerManager.takeDamage(downedId, 999);
        this.broadcast({ type: 'player_update', player: targetPlayer });
      }
    }

    arenaCombat.markActionTaken(playerId);
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    arenaCombat.advanceTurn();
    this.afterArenaTurn(player.roomId, arenaCombat);
    return;
  }

  // --- Ranged single-target ability (has range, not area) ---
  if (ability.range && ability.targetType === 'enemy' && arenaCombat) {
    if (!targetId) {
      this.sendTo(playerId, { type: 'error', message: 'Ability requires a target.' });
      return;
    }

    const casterPos = arenaCombat.getPosition(playerId);
    const targetPos = arenaCombat.getPosition(targetId);
    if (!casterPos || !targetPos) return;

    if (!hasLineOfSight(arenaCombat.getGrid(), casterPos, targetPos, ability.range)) {
      this.sendTo(playerId, { type: 'error', message: 'Target out of range or blocked.' });
      return;
    }

    // Fall through to standard single-target resolution below
  }

  // --- Melee-range enemy ability in arena (no range field) ---
  if (!ability.range && ability.targetType === 'enemy' && arenaCombat && targetId) {
    const casterPos = arenaCombat.getPosition(playerId);
    const targetPos = arenaCombat.getPosition(targetId);
    if (!casterPos || !targetPos || !isAdjacent(casterPos, targetPos)) {
      this.sendTo(playerId, { type: 'error', message: 'Target is not adjacent.' });
      return;
    }
  }

  // --- Standard single-target / self resolution (works for both arena and classic) ---
  const target = targetId ? participants.find(p => p.id === targetId) : null;
  const result = this.abilityResolver.resolveAllEffects(ability.effects, caster, target ?? null, participants);

  if (result.healing && targetId) {
    const targetPlayer = this.playerManager.getPlayer(targetId);
    if (targetPlayer) {
      this.playerManager.healPlayer(targetId, result.healing);
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(targetId)! });
    }
  }

  this.playerManager.spendEnergy(playerId, ability.energyCost);

  const targetParticipant = targetId ? participants.find(p => p.id === targetId) : null;
  this.broadcastToRoom(player.roomId, {
    type: 'combat_action_result',
    actorId: playerId,
    actorName: player.name,
    action: 'use_ability',
    abilityId: ability.id,
    abilityName: ability.name,
    targetId,
    targetName: targetParticipant?.name,
    damage: result.damage,
    healing: result.healing,
    targetHp: targetParticipant?.hp,
    targetMaxHp: targetParticipant?.maxHp,
    targetDowned: result.targetDowned,
    buffsApplied: result.buffsApplied,
  } as any);

  this.narrateAbility(player.roomId, player.name, ability.name, targetParticipant?.name, result);

  if (result.targetDowned && targetId) {
    const targetPlayer = this.playerManager.getPlayer(targetId);
    if (targetPlayer) {
      this.playerManager.takeDamage(targetId, 999);
      this.broadcast({ type: 'player_update', player: targetPlayer });
    }
  }

  // Mark action taken in arena, advance turn for arena combat
  if (arenaCombat) {
    arenaCombat.markActionTaken(playerId);
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    arenaCombat.advanceTurn();
    this.afterArenaTurn(player.roomId, arenaCombat);
  } else {
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    classicCombat!.advanceTurn();
    this.afterCombatTurn(player.roomId, classicCombat!);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json`
Expected: No errors (or only pre-existing errors unrelated to this change)

- [ ] **Step 5: Run existing tests to check nothing broke**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/vitest run server/src/ArenaCombatManager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: add spatial validation for arena abilities in handleUseAbility
```

---

### Task 5: Client — useGameActions Extension

**Files:**
- Modify: `client/src/hooks/useGameActions.ts:37`

- [ ] **Step 1: Extend useAbility to accept coordinates**

In `client/src/hooks/useGameActions.ts`, change the `useAbility` line from:

```typescript
useAbility: (abilityId: string, targetId?: string) =>
  send({ type: 'combat_action', action: 'use_ability', abilityId, targetId }),
```

To:

```typescript
useAbility: (abilityId: string, targetId?: string, targetX?: number, targetY?: number) =>
  send({ type: 'combat_action', action: 'use_ability', abilityId, targetId, targetX, targetY }),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: extend useAbility to pass target coordinates for area abilities
```

---

### Task 6: Client — ArenaActionBar Abilities UI

**Files:**
- Modify: `client/src/components/ArenaActionBar.tsx`

- [ ] **Step 1: Add abilities mode and callbacks to ArenaActionBar**

Replace the full `ArenaActionBar.tsx` content with:

```typescript
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getClassDefinition } from '@caverns/shared';
import type { AbilityDefinition, ItemStats } from '@caverns/shared';

type ArenaActionMode =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'move' }
  | { mode: 'target_attack' }
  | { mode: 'items' }
  | { mode: 'target_item'; itemIndex: number }
  | { mode: 'abilities' }
  | { mode: 'target_ability'; ability: AbilityDefinition };

interface ArenaActionBarProps {
  isMyTurn: boolean;
  actionTaken: boolean;
  movementRemaining: number;
  canFlee: boolean;
  onMoveMode: () => void;
  onCancelMove: () => void;
  onAttackMode: () => void;
  onCancelAttack: () => void;
  onDefend: () => void;
  onFlee: () => void;
  onEndTurn: () => void;
  onUseItem: (index: number, targetId?: string) => void;
  onAbilityMode: (ability: AbilityDefinition) => void;
  onCancelAbility: () => void;
  onUseAbility: (abilityId: string, targetId?: string, targetX?: number, targetY?: number) => void;
}

function formatItemStat(stats: ItemStats): string {
  if (stats.healAmount) return `heals ${stats.healAmount}`;
  if (stats.damage) return `${stats.damage} dmg`;
  return '';
}

export function ArenaActionBar({
  isMyTurn, actionTaken, movementRemaining, canFlee,
  onMoveMode, onCancelMove, onAttackMode, onCancelAttack,
  onDefend, onFlee, onEndTurn, onUseItem,
  onAbilityMode, onCancelAbility, onUseAbility,
}: ArenaActionBarProps) {
  const player = useGameStore((s) => s.players[s.playerId]);
  const [mode, setMode] = useState<ArenaActionMode>({ mode: 'idle' });

  const effectiveMode: ArenaActionMode =
    !isMyTurn ? { mode: 'idle' } :
    mode.mode === 'idle' ? { mode: 'main' } :
    mode;

  const classDef = player ? getClassDefinition(player.className) : null;
  const activeAbilities = classDef?.abilities.filter(a => !a.passive) ?? [];

  const handleMoveClick = () => {
    setMode({ mode: 'move' });
    onMoveMode();
  };

  const handleAttackClick = () => {
    setMode({ mode: 'target_attack' });
    onAttackMode();
  };

  const handleBackToMain = () => {
    setMode({ mode: 'main' });
    onCancelMove();
    onCancelAttack();
    onCancelAbility();
  };

  const handleDefend = () => {
    onDefend();
    setMode({ mode: 'idle' });
  };

  const handleFlee = () => {
    onFlee();
    setMode({ mode: 'idle' });
  };

  const handleEndTurn = () => {
    onEndTurn();
    setMode({ mode: 'idle' });
  };

  const handleItemClick = (index: number) => {
    const item = player?.consumables[index];
    if (!item) return;
    if (item.stats.healAmount) {
      onUseItem(index);
      setMode({ mode: 'idle' });
    } else {
      setMode({ mode: 'target_item', itemIndex: index });
    }
  };

  const handleAbilityClick = (ability: AbilityDefinition) => {
    if (ability.targetType === 'none') {
      // Fire immediately — no targeting needed
      onUseAbility(ability.id);
      setMode({ mode: 'idle' });
      return;
    }
    // Enter targeting mode
    setMode({ mode: 'target_ability', ability });
    onAbilityMode(ability);
  };

  // Reset mode when turn changes
  if (!isMyTurn && mode.mode !== 'idle') {
    setMode({ mode: 'idle' });
  }

  return (
    <div className="arena-action-bar">
      {effectiveMode.mode === 'idle' && (
        <span className="waiting-text">Waiting for turn...</span>
      )}

      {effectiveMode.mode === 'main' && (
        <>
          <button className="arena-btn arena-btn-move" onClick={handleMoveClick}
            disabled={movementRemaining <= 0}>
            Move
          </button>
          <button className="arena-btn arena-btn-attack" onClick={handleAttackClick}
            disabled={actionTaken}>
            Attack
          </button>
          <button className="arena-btn arena-btn-defend" onClick={handleDefend}
            disabled={actionTaken}>
            Defend
          </button>
          <button className="arena-btn" onClick={() => setMode({ mode: 'abilities' })}
            disabled={actionTaken || activeAbilities.length === 0}>
            Abilities
          </button>
          <button className="arena-btn" onClick={() => setMode({ mode: 'items' })}
            disabled={actionTaken}>
            Items
          </button>
          <button className="arena-btn" onClick={handleFlee}
            disabled={!canFlee || actionTaken}>
            Flee
          </button>
          <button className="arena-btn arena-btn-end" onClick={handleEndTurn}>
            End Turn
          </button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'move' && (
        <>
          <span className="waiting-text">Click a highlighted tile to move...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'target_attack' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to attack...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'abilities' && (
        <>
          <div className="combat-item-list">
            {activeAbilities.map((ability) => {
              const notEnoughEnergy = !player || player.energy < ability.energyCost;
              return (
                <button
                  key={ability.id}
                  className={`ability-btn ${notEnoughEnergy ? 'no-energy' : ''}`}
                  disabled={notEnoughEnergy}
                  onClick={() => handleAbilityClick(ability)}
                >
                  {ability.name} <span className="energy-cost">{ability.energyCost}</span>
                  <span className="ability-tooltip">{ability.description}</span>
                </button>
              );
            })}
          </div>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'target_ability' && (
        <>
          <span className="waiting-text">
            {effectiveMode.ability.targetType === 'area_enemy' || effectiveMode.ability.targetType === 'area_ally'
              ? `Click a tile to target ${effectiveMode.ability.name}...`
              : `Click a target for ${effectiveMode.ability.name}...`
            }
          </span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'items' && (
        <>
          <div className="combat-item-list">
            {player?.consumables.map((item, i) =>
              item ? (
                <button key={i} className="combat-item-btn" onClick={() => handleItemClick(i)}>
                  {item.name}
                  <span className="combat-item-stat">{formatItemStat(item.stats)}</span>
                </button>
              ) : null
            )}
          </div>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'target_item' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to use item...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json`
Expected: Errors in ArenaView.tsx because it doesn't pass `onAbilityMode`, `onCancelAbility`, `onUseAbility` yet — that's fine, Task 7 will fix it.

- [ ] **Step 3: Commit**

```
feat: add abilities button and ability targeting modes to ArenaActionBar
```

---

### Task 7: Client — ArenaView Targeting Modes & LoS

**Files:**
- Modify: `client/src/components/ArenaView.tsx`
- Modify: `client/src/styles/index.css`

This is the largest task. It adds:
1. Client-side `hasLineOfSight` (duplicates server logic — matches existing pattern)
2. `target_ability_single` and `target_ability_area` interaction modes
3. LoS-based range highlighting for single-target abilities
4. AoE cursor preview (pale red 3x3 highlight on hover)
5. Click handlers for ability targeting

- [ ] **Step 1: Add .arena-area-highlight CSS**

In `client/src/styles/index.css`, after the `.arena-path-trace` rule, add:

```css
.arena-area-highlight { background: rgba(180, 40, 40, 0.25) !important; }
.arena-range-highlight { background: rgba(80, 120, 200, 0.15) !important; }
```

- [ ] **Step 2: Add client-side hasLineOfSight to ArenaView**

Add this function inside `ArenaView.tsx` (above the component function), alongside the existing `bfsMovement` and `tracePath` utilities:

```typescript
/** Bresenham LoS — duplicated from server (same pattern as BFS duplication) */
function hasLineOfSight(
  grid: { width: number; height: number; tiles: string[][] },
  from: { x: number; y: number },
  to: { x: number; y: number },
  maxRange: number,
): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (Math.max(dx, dy) > maxRange) return false;
  if (dx === 0 && dy === 0) return true;

  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = from.x;
  let y = from.y;

  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === to.x && y === to.y) break;
    const tile = grid.tiles[y]?.[x];
    if (!tile || tile === 'wall' || tile === 'chasm') return false;
  }
  return true;
}
```

- [ ] **Step 3: Update ArenaView interaction modes and state**

Update the `InteractionMode` type and add ability state:

```typescript
type InteractionMode = 'none' | 'move' | 'attack' | 'target_ability_single' | 'target_ability_area';
```

Add state inside the `ArenaView` component, after the existing state declarations:

```typescript
const [targetingAbility, setTargetingAbility] = useState<AbilityDefinition | null>(null);
```

Add the import for `AbilityDefinition`:

```typescript
import type { AbilityDefinition } from '@caverns/shared';
```

- [ ] **Step 4: Add ability range/area highlights to tileHighlights memo**

Update the `tileHighlights` useMemo to include ability-related highlights. Replace the existing `tileHighlights` useMemo:

```typescript
const tileHighlights = useMemo(() => {
  const highlights = new Map<string, string>();

  if (movementRange && interactionMode === 'move') {
    for (const key of movementRange) {
      highlights.set(key, 'arena-move-highlight');
    }
  }

  if (hoverPath) {
    for (const step of hoverPath) {
      highlights.set(`${step.x},${step.y}`, 'arena-path-trace');
    }
  }

  // Single-target ability: highlight valid targets in range + LoS
  if (interactionMode === 'target_ability_single' && targetingAbility && arenaGrid) {
    const myPos = arenaPositions[playerId];
    if (myPos) {
      const range = targetingAbility.range ?? 1; // no range = adjacent only
      for (const p of activeCombat!.participants) {
        if (!p.alive) continue;
        const isEnemy = p.type !== 'player';
        const isAlly = p.type === 'player' && p.id !== playerId;
        const wantEnemy = targetingAbility.targetType === 'enemy';
        const wantAlly = targetingAbility.targetType === 'ally';
        if ((wantEnemy && !isEnemy) || (wantAlly && !isAlly)) continue;

        const pos = arenaPositions[p.id];
        if (!pos) continue;

        if (targetingAbility.range) {
          if (hasLineOfSight(arenaGrid, myPos, pos, range)) {
            highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight');
          }
        } else {
          // Melee range: adjacent only
          if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) === 1) {
            highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight');
          }
        }
      }
    }
  }

  // Area ability: highlight AoE radius around hovered tile
  if (interactionMode === 'target_ability_area' && targetingAbility && arenaGrid && hoverTile) {
    const myPos = arenaPositions[playerId];
    if (myPos && targetingAbility.range) {
      if (hasLineOfSight(arenaGrid, myPos, hoverTile, targetingAbility.range)) {
        const radius = targetingAbility.areaRadius ?? 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > radius) continue;
            const ax = hoverTile.x + dx;
            const ay = hoverTile.y + dy;
            if (ax >= 0 && ax < arenaGrid.width && ay >= 0 && ay < arenaGrid.height) {
              highlights.set(`${ax},${ay}`, 'arena-area-highlight');
            }
          }
        }
      }
    }
  }

  return highlights;
}, [movementRange, interactionMode, hoverPath, targetingAbility, arenaGrid, arenaPositions, playerId, activeCombat, hoverTile]);
```

- [ ] **Step 5: Update handleTileClick for ability targeting**

Replace the existing `handleTileClick` callback:

```typescript
const handleTileClick = useCallback((x: number, y: number) => {
  if (!isMyTurn) return;

  if (interactionMode === 'move') {
    if (ghostPos) {
      onArenaMove(ghostPos.x, ghostPos.y);
    }
    return;
  }

  if (interactionMode === 'attack') {
    for (const [id, pos] of Object.entries(arenaPositions)) {
      if (pos.x === x && pos.y === y && adjacentEnemies.has(id)) {
        onCombatAction('attack', id);
        useGameStore.setState({ arenaActionTaken: true });
        setInteractionMode('none');
        return;
      }
    }
  }

  if (interactionMode === 'target_ability_single' && targetingAbility && arenaGrid) {
    const myPos = arenaPositions[playerId];
    if (!myPos) return;

    // Find entity at clicked tile that is a valid target
    for (const [id, pos] of Object.entries(arenaPositions)) {
      if (pos.x !== x || pos.y !== y) continue;
      const participant = activeCombat?.participants.find(p => p.id === id);
      if (!participant?.alive) continue;

      const isEnemy = participant.type !== 'player';
      const isAlly = participant.type === 'player' && participant.id !== playerId;
      const wantEnemy = targetingAbility.targetType === 'enemy';
      const wantAlly = targetingAbility.targetType === 'ally';
      if ((wantEnemy && !isEnemy) || (wantAlly && !isAlly)) continue;

      // Validate range + LoS
      if (targetingAbility.range) {
        if (!hasLineOfSight(arenaGrid, myPos, pos, targetingAbility.range)) continue;
      } else {
        if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) !== 1) continue;
      }

      onUseAbility(targetingAbility.id, id);
      useGameStore.setState({ arenaActionTaken: true });
      setInteractionMode('none');
      setTargetingAbility(null);
      return;
    }
  }

  if (interactionMode === 'target_ability_area' && targetingAbility && arenaGrid) {
    const myPos = arenaPositions[playerId];
    if (!myPos || !targetingAbility.range) return;

    if (hasLineOfSight(arenaGrid, myPos, { x, y }, targetingAbility.range)) {
      onUseAbility(targetingAbility.id, undefined, x, y);
      useGameStore.setState({ arenaActionTaken: true });
      setInteractionMode('none');
      setTargetingAbility(null);
    }
  }
}, [isMyTurn, interactionMode, ghostPos, arenaPositions, adjacentEnemies, onArenaMove, onCombatAction, targetingAbility, arenaGrid, playerId, activeCombat, onUseAbility]);
```

- [ ] **Step 6: Update ArenaView props and ArenaActionBar usage**

Update the `onCombatAction` prop type in `ArenaViewProps`:

```typescript
interface ArenaViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
  ) => void;
  onArenaMove: (targetX: number, targetY: number) => void;
  onArenaEndTurn: () => void;
  onUseAbility: (abilityId: string, targetId?: string, targetX?: number, targetY?: number) => void;
}
```

Update the component destructuring:

```typescript
export function ArenaView({ onCombatAction, onArenaMove, onArenaEndTurn, onUseAbility }: ArenaViewProps) {
```

Add the ability mode callbacks and pass them to `ArenaActionBar`:

```typescript
<ArenaActionBar
  isMyTurn={isMyTurn}
  actionTaken={arenaActionTaken}
  movementRemaining={arenaMovementRemaining}
  canFlee={canFlee}
  onMoveMode={() => setInteractionMode('move')}
  onCancelMove={() => setInteractionMode('none')}
  onAttackMode={() => setInteractionMode('attack')}
  onCancelAttack={() => setInteractionMode('none')}
  onDefend={() => { onCombatAction('defend'); useGameStore.setState({ arenaActionTaken: true }); }}
  onFlee={() => onCombatAction('flee')}
  onEndTurn={onArenaEndTurn}
  onUseItem={(index, targetId) => {
    onCombatAction('use_item', targetId, index);
    useGameStore.setState({ arenaActionTaken: true });
  }}
  onAbilityMode={(ability) => {
    if (ability.targetType === 'area_enemy' || ability.targetType === 'area_ally') {
      setInteractionMode('target_ability_area');
    } else {
      setInteractionMode('target_ability_single');
    }
    setTargetingAbility(ability);
  }}
  onCancelAbility={() => {
    setInteractionMode('none');
    setTargetingAbility(null);
  }}
  onUseAbility={onUseAbility}
/>
```

Also enable hover for ability targeting modes in `ArenaGrid`:

```typescript
<ArenaGrid
  grid={arenaGrid}
  positions={arenaPositions}
  participants={activeCombat.participants}
  playerId={playerId}
  movementRange={interactionMode === 'move' ? movementRange : null}
  isTargeting={interactionMode === 'attack' || interactionMode === 'target_ability_single' || interactionMode === 'target_ability_area'}
  onTileClick={handleTileClick}
  onTileHover={interactionMode === 'move' || interactionMode === 'target_ability_area' ? handleTileHover : undefined}
  onTileHoverEnd={interactionMode === 'move' || interactionMode === 'target_ability_area' ? handleTileHoverEnd : undefined}
  tileHighlights={tileHighlights}
  ghostEntity={interactionMode === 'move' ? ghostPos : null}
  animatingId={animatingId}
  animPath={animPath}
/>
```

- [ ] **Step 7: Update App.tsx to pass onUseAbility**

In `client/src/App.tsx`, find where `ArenaView` is rendered and add the `onUseAbility` prop. It should use the `useAbility` action from `useGameActions`:

```typescript
onUseAbility={(abilityId, targetId, targetX, targetY) => actions.useAbility(abilityId, targetId, targetX, targetY)}
```

(Check how `ArenaView` is currently rendered in App.tsx to find the exact location.)

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 9: Commit**

```
feat: add ability targeting modes with LoS highlighting and AoE preview to ArenaView
```

---

### Task 8: Integration Testing

**Files:** None new — manual testing

- [ ] **Step 1: Start the dev server**

Run the server and client:
```bash
# Terminal 1
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsx server/src/index.ts
# Terminal 2
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/vite --config client/vite.config.ts
```

- [ ] **Step 2: Test Suturist Bone Spike**

1. Create a Suturist character, enter a dungeon, trigger arena combat
2. On your turn, click Abilities → verify Bone Spike appears with tooltip
3. Click Bone Spike → verify valid enemies within range 6 are highlighted (blue tint)
4. Click a highlighted enemy → verify damage is dealt, action is consumed
5. Verify clicking an out-of-range enemy does nothing
6. Verify insufficient energy disables the ability button

- [ ] **Step 3: Test Artificer Scrap Volley (AoE)**

1. Create an Artificer character, enter arena combat
2. Click Abilities → verify Scrap Volley appears (15 energy)
3. Click Scrap Volley → hover over tiles → verify pale red 3x3 area follows cursor
4. Verify the AoE preview only shows when the center tile is within range 5 + LoS
5. Click to confirm → verify damage hits all enemies in the area
6. Verify the combat log says who was hit

- [ ] **Step 4: Test Static Hymn (AoE skip turn)**

1. With Artificer, click Abilities → verify Static Hymn costs 20 energy
2. Click Static Hymn → verify AoE targeting mode activates (same as Scrap Volley)
3. Confirm on a tile near enemies → verify enemies skip their next turn

- [ ] **Step 5: Test LoS blocking**

1. Position so a wall is between you and an enemy
2. Try to use a ranged ability through the wall → verify it fails (enemy not highlighted)

- [ ] **Step 6: Test existing abilities still work**

1. Create a Templar, enter arena combat
2. Verify Null Ward (self-target) still works — click Abilities → click Null Ward → fires immediately
3. Create a Phaseknife, verify Phase Strike (melee enemy target) requires adjacency

- [ ] **Step 7: Run automated tests**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/vitest run`
Expected: All arena-related tests pass. Pre-existing failures in unrelated tests are acceptable.
