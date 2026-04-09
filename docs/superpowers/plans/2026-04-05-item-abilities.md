# Item Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 26 item abilities that trigger during combat, giving unique items mechanical impact and build-defining power.

**Architecture:** A new `ItemEffectResolver` class handles all item effect logic, called by `CombatManager` at specific combat lifecycle points (on attack, on damage taken, on death, on combat start, on turn start, activated actions). Per-combat state (momentum stacks, rampage damage, etc.) lives in the resolver. Dungeon-wide single-use flags (self_revive, revive_once) live on the `Player` object.

**Tech Stack:** TypeScript, Vitest for testing. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-05-item-abilities-design.md`

---

### Task 1: Data Model Changes

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/messages.ts`
- Test: `shared/src/types.test.ts`

- [ ] **Step 1: Add `effectParams` to Item and `usedEffects` to Player**

In `shared/src/types.ts`, update the `Item` interface:

```ts
export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  slot: ItemSlot;
  stats: ItemStats;
  effect?: string;
  effectParams?: Record<string, number>;
}
```

In `shared/src/types.ts`, update the `Player` interface to add dungeon-wide single-use tracking:

```ts
export interface Player {
  id: string;
  name: string;
  className: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: Equipment;
  consumables: (Item | null)[];
  inventory: (Item | null)[];
  status: PlayerStatus;
  keychain: string[];
  cooldowns: AbilityCooldown[];
  usedEffects: string[]; // consumed single-use item effects (e.g. 'self_revive')
}
```

Update `createPlayer` to initialize `usedEffects: []`.

- [ ] **Step 2: Add EquippedEffect type**

In `shared/src/types.ts`, add:

```ts
export interface EquippedEffect {
  effectId: string;
  params: Record<string, number>;
  sourceItemId: string;
}
```

Add a helper function to extract effects from a player's equipment:

```ts
export function getPlayerEquippedEffects(player: Player): EquippedEffect[] {
  const effects: EquippedEffect[] = [];
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (item?.effect && item.effectParams) {
      effects.push({
        effectId: item.effect,
        params: item.effectParams,
        sourceItemId: item.id,
      });
    }
  }
  return effects;
}
```

- [ ] **Step 3: Add `use_item_effect` to combat action messages**

In `shared/src/messages.ts`, update `CombatActionMessage`:

```ts
export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
  critMultiplier?: number;
  abilityId?: string;
  effectId?: string; // for activated item effects (overcharge, revive_once, rally)
}
```

Update `CombatActionResultMessage` to include item effect info:

```ts
export interface CombatActionResultMessage {
  type: 'combat_action_result';
  actorId: string;
  actorName: string;
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  // ...existing fields...
  itemEffect?: string;        // effect ID that triggered (e.g. 'vampiric', 'cleave')
  itemEffectDamage?: number;  // splash/bonus damage from effect
  itemEffectHealing?: number; // healing from effect (vampiric, rally)
}
```

- [ ] **Step 4: Write test for data model changes**

In `shared/src/types.test.ts`, add:

```ts
describe('getPlayerEquippedEffects', () => {
  it('extracts effects from equipped items', () => {
    const player = createPlayer('p1', 'Test', 'room1');
    player.equipment.weapon = {
      id: 'test_sword', name: 'Test Sword', description: '', rarity: 'unique',
      slot: 'weapon', stats: { damage: 10 },
      effect: 'vampiric', effectParams: { leechPercent: 0.25 },
    };
    player.equipment.armor = {
      id: 'test_armor', name: 'Test Armor', description: '', rarity: 'unique',
      slot: 'armor', stats: { defense: 5 },
      effect: 'thorns', effectParams: { flatDamage: 7 },
    };
    const effects = getPlayerEquippedEffects(player);
    expect(effects).toHaveLength(2);
    expect(effects[0].effectId).toBe('vampiric');
    expect(effects[0].params.leechPercent).toBe(0.25);
    expect(effects[1].effectId).toBe('thorns');
  });

  it('skips items without effects', () => {
    const player = createPlayer('p1', 'Test', 'room1');
    player.equipment.weapon = {
      id: 'plain_sword', name: 'Plain Sword', description: '', rarity: 'common',
      slot: 'weapon', stats: { damage: 10 },
    };
    const effects = getPlayerEquippedEffects(player);
    expect(effects).toHaveLength(0);
  });

  it('initializes usedEffects as empty array', () => {
    const player = createPlayer('p1', 'Test', 'room1');
    expect(player.usedEffects).toEqual([]);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run shared/src/types.test.ts`
Expected: PASS

- [ ] **Step 6: Export new types from shared index**

In `shared/src/index.ts`, ensure `EquippedEffect` and `getPlayerEquippedEffects` are exported.

- [ ] **Step 7: Commit**

```
feat: add effectParams to Item, usedEffects to Player, EquippedEffect type
```

---

### Task 2: ItemEffectResolver — Foundation and Combat State

**Files:**
- Create: `server/src/ItemEffectResolver.ts`
- Create: `server/src/ItemEffectResolver.test.ts`

- [ ] **Step 1: Define CombatEffectState and the resolver class skeleton**

Create `server/src/ItemEffectResolver.ts`:

```ts
import type { EquippedEffect } from '@caverns/shared';

export interface EffectParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  alive: boolean;
}

export interface AttackEffectResult {
  bonusDamage: number;          // added to base damage before defense calc
  postDamageEffects: PostDamageEffect[];
  modifiedCritMultiplier?: number; // brutal_impact
}

export interface PostDamageEffect {
  type: 'vampiric' | 'cleave' | 'venomous' | 'overwhelm' | 'siphon_armor' | 'rampage';
  value: number;
  targetId?: string;
  duration?: number;
}

export interface DamageTakenResult {
  reflectDamage: number;        // damage dealt back to attacker
  interceptedDamage: number;    // damage redirected to guardian
  guardianId?: string;          // who intercepted
  deathwardTriggered: boolean;  // gained defense buff
  deathwardDefense?: number;
  deathwardDuration?: number;
}

export interface DeathPreventionResult {
  prevented: boolean;
  effectId?: string;            // 'self_revive' or 'undying_fury'
  reviveHp?: number;            // for self_revive
  extraTurns?: number;          // for undying_fury
}

export interface ActivatedEffectResult {
  success: boolean;
  effectId: string;
  healing?: number;             // rally: healing per ally
  targetIds?: string[];         // who was affected
  selfDamage?: number;          // overcharge: self-damage
  reviveHp?: number;            // revive_once: HP to restore
}

export interface CombatEffectState {
  momentumStacks: Map<string, number>;
  lastAction: Map<string, string>;
  rampageTotalDamage: Map<string, number>;
  predatorKills: Map<string, number>;
  siphonStacks: Map<string, number>;
  deathwardTriggered: Set<string>;
  overcharged: Set<string>;
  undyingTurns: Map<string, number>;
  poisoned: Map<string, { damage: number; turnsRemaining: number; sourceId: string }[]>;
  overwhelmDebuffs: Map<string, { reduction: number; turnsRemaining: number }[]>;
}

export class ItemEffectResolver {
  private state: CombatEffectState;
  private playerEffects: Map<string, EquippedEffect[]>;
  private usedDungeonEffects: Map<string, string[]>; // playerId -> consumed effect IDs

  constructor(
    playerEffectsMap: Map<string, EquippedEffect[]>,
    usedDungeonEffects: Map<string, string[]>,
  ) {
    this.playerEffects = playerEffectsMap;
    this.usedDungeonEffects = usedDungeonEffects;
    this.state = {
      momentumStacks: new Map(),
      lastAction: new Map(),
      rampageTotalDamage: new Map(),
      predatorKills: new Map(),
      siphonStacks: new Map(),
      deathwardTriggered: new Set(),
      overcharged: new Set(),
      undyingTurns: new Map(),
      poisoned: new Map(),
      overwhelmDebuffs: new Map(),
    };
  }

  /** Get all effects for a participant (empty array for mobs). */
  getEffects(participantId: string): EquippedEffect[] {
    return this.playerEffects.get(participantId) ?? [];
  }

  /** Check if participant has a specific effect equipped. */
  hasEffect(participantId: string, effectId: string): boolean {
    return this.getEffects(participantId).some(e => e.effectId === effectId);
  }

  /** Get params for a specific effect. Returns undefined if not equipped. */
  getEffectParams(participantId: string, effectId: string): Record<string, number> | undefined {
    return this.getEffects(participantId).find(e => e.effectId === effectId)?.params;
  }

  /** Check if a dungeon-wide single-use effect has been consumed. */
  isEffectConsumed(playerId: string, effectId: string): boolean {
    return (this.usedDungeonEffects.get(playerId) ?? []).includes(effectId);
  }

  /** Mark a dungeon-wide single-use effect as consumed. */
  consumeEffect(playerId: string, effectId: string): void {
    const used = this.usedDungeonEffects.get(playerId) ?? [];
    used.push(effectId);
    this.usedDungeonEffects.set(playerId, used);
  }

  /** Track that a player performed an action (for momentum). */
  trackAction(playerId: string, action: string): void {
    const last = this.state.lastAction.get(playerId);
    if (action === 'attack' && last === 'attack') {
      this.state.momentumStacks.set(playerId, (this.state.momentumStacks.get(playerId) ?? 0) + 1);
    } else if (action !== 'attack') {
      this.state.momentumStacks.set(playerId, 0);
    }
    this.state.lastAction.set(playerId, action);
  }

  /** Track damage dealt for rampage. */
  trackDamageDealt(playerId: string, damage: number): void {
    this.state.rampageTotalDamage.set(
      playerId, (this.state.rampageTotalDamage.get(playerId) ?? 0) + damage,
    );
  }

  /** Track a kill for predator. */
  trackKill(playerId: string): void {
    this.state.predatorKills.set(playerId, (this.state.predatorKills.get(playerId) ?? 0) + 1);
  }

  getState(): CombatEffectState {
    return this.state;
  }
}
```

- [ ] **Step 2: Write foundation tests**

Create `server/src/ItemEffectResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ItemEffectResolver } from './ItemEffectResolver.js';
import type { EquippedEffect } from '@caverns/shared';

function makeResolver(
  effects: Map<string, EquippedEffect[]> = new Map(),
  usedEffects: Map<string, string[]> = new Map(),
): ItemEffectResolver {
  return new ItemEffectResolver(effects, usedEffects);
}

function makeEffects(playerId: string, ...effects: { id: string; params: Record<string, number> }[]): Map<string, EquippedEffect[]> {
  const map = new Map<string, EquippedEffect[]>();
  map.set(playerId, effects.map(e => ({ effectId: e.id, params: e.params, sourceItemId: `item_${e.id}` })));
  return map;
}

describe('ItemEffectResolver — Foundation', () => {
  it('returns empty effects for unknown participant', () => {
    const resolver = makeResolver();
    expect(resolver.getEffects('unknown')).toEqual([]);
  });

  it('returns equipped effects for a player', () => {
    const effects = makeEffects('p1', { id: 'vampiric', params: { leechPercent: 0.25 } });
    const resolver = makeResolver(effects);
    expect(resolver.hasEffect('p1', 'vampiric')).toBe(true);
    expect(resolver.hasEffect('p1', 'cleave')).toBe(false);
  });

  it('tracks momentum stacks on consecutive attacks', () => {
    const resolver = makeResolver();
    resolver.trackAction('p1', 'attack');
    expect(resolver.getState().momentumStacks.get('p1')).toBeUndefined();
    resolver.trackAction('p1', 'attack');
    expect(resolver.getState().momentumStacks.get('p1')).toBe(1);
    resolver.trackAction('p1', 'attack');
    expect(resolver.getState().momentumStacks.get('p1')).toBe(2);
    resolver.trackAction('p1', 'defend');
    expect(resolver.getState().momentumStacks.get('p1')).toBe(0);
  });

  it('tracks rampage damage accumulation', () => {
    const resolver = makeResolver();
    resolver.trackDamageDealt('p1', 10);
    resolver.trackDamageDealt('p1', 15);
    expect(resolver.getState().rampageTotalDamage.get('p1')).toBe(25);
  });

  it('tracks predator kills', () => {
    const resolver = makeResolver();
    resolver.trackKill('p1');
    resolver.trackKill('p1');
    expect(resolver.getState().predatorKills.get('p1')).toBe(2);
  });

  it('tracks consumed dungeon-wide effects', () => {
    const resolver = makeResolver(new Map(), new Map([['p1', ['self_revive']]]));
    expect(resolver.isEffectConsumed('p1', 'self_revive')).toBe(true);
    expect(resolver.isEffectConsumed('p1', 'revive_once')).toBe(false);
    resolver.consumeEffect('p1', 'revive_once');
    expect(resolver.isEffectConsumed('p1', 'revive_once')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: add ItemEffectResolver foundation with combat state tracking
```

---

### Task 3: On-Attack Effects

**Files:**
- Modify: `server/src/ItemEffectResolver.ts`
- Modify: `server/src/ItemEffectResolver.test.ts`

This task adds the `resolveOnAttack` method that computes all attack-phase item effects.

- [ ] **Step 1: Write tests for on-attack effects**

Add to `server/src/ItemEffectResolver.test.ts`:

```ts
import type { EffectParticipant } from './ItemEffectResolver.js';

function makeParticipant(overrides: Partial<EffectParticipant> & { id: string }): EffectParticipant {
  return {
    type: 'player', name: 'Test', hp: 50, maxHp: 50,
    damage: 10, defense: 2, initiative: 5, alive: true,
    ...overrides,
  };
}

describe('ItemEffectResolver — On Attack', () => {
  it('vampiric: returns leech healing based on damage dealt', () => {
    const effects = makeEffects('p1', { id: 'vampiric', params: { leechPercent: 0.25 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', damage: 10 });
    const target = makeParticipant({ id: 'mob1', type: 'mob', defense: 2 });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    const vampEffect = result.postDamageEffects.find(e => e.type === 'vampiric');
    expect(vampEffect).toBeDefined();
    expect(vampEffect!.value).toBe(2); // floor(8 * 0.25)
  });

  it('cleave: returns splash damage to other enemies', () => {
    const effects = makeEffects('p1', { id: 'cleave', params: { splashPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', damage: 10 });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const other = makeParticipant({ id: 'mob2', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target, other]);
    const cleaveEffect = result.postDamageEffects.find(e => e.type === 'cleave');
    expect(cleaveEffect).toBeDefined();
    expect(cleaveEffect!.value).toBe(4); // floor(8 * 0.5)
    expect(cleaveEffect!.targetId).toBe('mob2');
  });

  it('executioner: adds bonus damage when target below threshold', () => {
    const effects = makeEffects('p1', { id: 'executioner', params: { hpThresholdPercent: 0.3, bonusDamage: 10 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob', hp: 10, maxHp: 50 }); // 20% HP
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBeGreaterThanOrEqual(10);
  });

  it('executioner: no bonus when target above threshold', () => {
    const effects = makeEffects('p1', { id: 'executioner', params: { hpThresholdPercent: 0.3, bonusDamage: 10 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob', hp: 40, maxHp: 50 }); // 80% HP
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(0);
  });

  it('momentum: adds bonus damage based on stack count', () => {
    const effects = makeEffects('p1', { id: 'momentum', params: { damagePerStack: 2, maxStacks: 5 } });
    const resolver = makeResolver(effects);
    resolver.trackAction('p1', 'attack');
    resolver.trackAction('p1', 'attack'); // 1 stack
    resolver.trackAction('p1', 'attack'); // 2 stacks
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(4); // 2 stacks * 2 damage
  });

  it('first_strike: adds bonus when attacker is first in turn order', () => {
    const effects = makeEffects('p1', { id: 'first_strike', params: { bonusDamage: 8 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target], true);
    expect(result.bonusDamage).toBe(8);
  });

  it('first_strike: no bonus when not first in turn order', () => {
    const effects = makeEffects('p1', { id: 'first_strike', params: { bonusDamage: 8 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target], false);
    expect(result.bonusDamage).toBe(0);
  });

  it('blade_storm: adds damage based on initiative difference', () => {
    const effects = makeEffects('p1', { id: 'blade_storm', params: { damagePerInitiativeDiff: 1.0 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', initiative: 12 });
    const target = makeParticipant({ id: 'mob1', type: 'mob', initiative: 4 });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(8); // (12 - 4) * 1.0
  });

  it('blade_storm: no bonus when target has higher initiative', () => {
    const effects = makeEffects('p1', { id: 'blade_storm', params: { damagePerInitiativeDiff: 1.0 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', initiative: 3 });
    const target = makeParticipant({ id: 'mob1', type: 'mob', initiative: 10 });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(0);
  });

  it('flurry: returns bonus hits based on initiative', () => {
    const effects = makeEffects('p1', { id: 'flurry', params: { hitsPerInitiativeThreshold: 5, bonusHitPercent: 0.3 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', initiative: 15 });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    // 15 / 5 = 3 bonus hits, each at floor(8 * 0.3) = 2 damage
    expect(result.flurryHits).toBe(3);
    expect(result.flurryDamagePerHit).toBe(2);
  });

  it('brutal_impact: increases crit multiplier based on damage stat', () => {
    const effects = makeEffects('p1', { id: 'brutal_impact', params: { critBonusPerDamage: 0.02 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', damage: 20 });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.5, [attacker, target]);
    expect(result.modifiedCritMultiplier).toBeCloseTo(1.9); // 1.5 + (20 * 0.02)
  });

  it('brutal_impact: no modification when crit is 1.0', () => {
    const effects = makeEffects('p1', { id: 'brutal_impact', params: { critBonusPerDamage: 0.02 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', damage: 20 });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.modifiedCritMultiplier).toBeUndefined();
  });

  it('venomous: applies poison debuff', () => {
    const effects = makeEffects('p1', { id: 'venomous', params: { poisonDamage: 4, duration: 3 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    const venomEffect = result.postDamageEffects.find(e => e.type === 'venomous');
    expect(venomEffect).toBeDefined();
    expect(venomEffect!.value).toBe(4);
    expect(venomEffect!.duration).toBe(3);
  });

  it('overwhelm: reduces target defense based on attacker damage', () => {
    const effects = makeEffects('p1', { id: 'overwhelm', params: { defenseReductionPercent: 0.15, duration: 2 } });
    const resolver = makeResolver(effects);
    const attacker = makeParticipant({ id: 'p1', damage: 20 });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    const overwhelmEffect = result.postDamageEffects.find(e => e.type === 'overwhelm');
    expect(overwhelmEffect).toBeDefined();
    expect(overwhelmEffect!.value).toBe(3); // floor(20 * 0.15)
    expect(overwhelmEffect!.duration).toBe(2);
  });

  it('rampage: bonus damage scales with total damage dealt', () => {
    const effects = makeEffects('p1', { id: 'rampage', params: { damagePerPointDealt: 0.02, maxBonus: 10 } });
    const resolver = makeResolver(effects);
    // Simulate having dealt 250 damage previously
    for (let i = 0; i < 25; i++) resolver.trackDamageDealt('p1', 10);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(5); // floor(250 * 0.02) = 5
  });

  it('rampage: caps at maxBonus', () => {
    const effects = makeEffects('p1', { id: 'rampage', params: { damagePerPointDealt: 0.02, maxBonus: 10 } });
    const resolver = makeResolver(effects);
    resolver.trackDamageDealt('p1', 1000);
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.bonusDamage).toBe(10); // capped
  });

  it('overcharge: doubles damage when active, then clears', () => {
    const effects = makeEffects('p1', { id: 'overcharge', params: { damageMultiplier: 2.5, selfDamagePercent: 0.15 } });
    const resolver = makeResolver(effects);
    resolver.getState().overcharged.add('p1');
    const attacker = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnAttack(attacker, target, 8, 1.0, [attacker, target]);
    expect(result.overchargeMultiplier).toBe(2.5);
    expect(resolver.getState().overcharged.has('p1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: FAIL — `resolveOnAttack` does not exist yet

- [ ] **Step 3: Implement resolveOnAttack**

Add to `ItemEffectResolver` class and update `AttackEffectResult`:

```ts
export interface AttackEffectResult {
  bonusDamage: number;
  postDamageEffects: PostDamageEffect[];
  modifiedCritMultiplier?: number;
  flurryHits?: number;
  flurryDamagePerHit?: number;
  overchargeMultiplier?: number;
}
```

```ts
resolveOnAttack(
  attacker: EffectParticipant,
  target: EffectParticipant,
  baseDamage: number,
  critMultiplier: number,
  allParticipants: EffectParticipant[],
  isFirstInTurnOrder: boolean = false,
): AttackEffectResult {
  const effects = this.getEffects(attacker.id);
  const result: AttackEffectResult = { bonusDamage: 0, postDamageEffects: [] };

  for (const effect of effects) {
    switch (effect.effectId) {
      case 'executioner': {
        const threshold = effect.params.hpThresholdPercent ?? 0.3;
        const bonus = effect.params.bonusDamage ?? 0;
        if (target.hp / target.maxHp < threshold) {
          result.bonusDamage += bonus;
        }
        break;
      }
      case 'momentum': {
        const stacks = Math.min(
          this.state.momentumStacks.get(attacker.id) ?? 0,
          effect.params.maxStacks ?? 5,
        );
        result.bonusDamage += stacks * (effect.params.damagePerStack ?? 0);
        break;
      }
      case 'first_strike': {
        if (isFirstInTurnOrder) {
          result.bonusDamage += effect.params.bonusDamage ?? 0;
        }
        break;
      }
      case 'blade_storm': {
        const diff = attacker.initiative - target.initiative;
        if (diff > 0) {
          result.bonusDamage += Math.floor(diff * (effect.params.damagePerInitiativeDiff ?? 1.0));
        }
        break;
      }
      case 'rampage': {
        const totalDealt = this.state.rampageTotalDamage.get(attacker.id) ?? 0;
        const bonus = Math.min(
          Math.floor(totalDealt * (effect.params.damagePerPointDealt ?? 0)),
          effect.params.maxBonus ?? 10,
        );
        result.bonusDamage += bonus;
        break;
      }
      case 'brutal_impact': {
        if (critMultiplier > 1.0) {
          const bonus = attacker.damage * (effect.params.critBonusPerDamage ?? 0);
          result.modifiedCritMultiplier = critMultiplier + bonus;
        }
        break;
      }
      case 'flurry': {
        const threshold = effect.params.hitsPerInitiativeThreshold ?? 5;
        const percent = effect.params.bonusHitPercent ?? 0.3;
        const hits = Math.floor(attacker.initiative / threshold);
        if (hits > 0) {
          result.flurryHits = hits;
          result.flurryDamagePerHit = Math.floor(baseDamage * percent);
        }
        break;
      }
      case 'vampiric': {
        const percent = effect.params.leechPercent ?? 0.25;
        result.postDamageEffects.push({
          type: 'vampiric', value: Math.floor(baseDamage * percent),
        });
        break;
      }
      case 'cleave': {
        const splashPercent = effect.params.splashPercent ?? 0.5;
        const splashDamage = Math.floor(baseDamage * splashPercent);
        const otherEnemies = allParticipants.filter(
          p => p.type !== attacker.type && p.alive && p.id !== target.id,
        );
        for (const enemy of otherEnemies) {
          result.postDamageEffects.push({
            type: 'cleave', value: splashDamage, targetId: enemy.id,
          });
        }
        break;
      }
      case 'venomous': {
        result.postDamageEffects.push({
          type: 'venomous',
          value: effect.params.poisonDamage ?? 4,
          targetId: target.id,
          duration: effect.params.duration ?? 3,
        });
        break;
      }
      case 'overwhelm': {
        const reduction = Math.floor(attacker.damage * (effect.params.defenseReductionPercent ?? 0.15));
        result.postDamageEffects.push({
          type: 'overwhelm',
          value: reduction,
          targetId: target.id,
          duration: effect.params.duration ?? 2,
        });
        break;
      }
    }
  }

  // Overcharge (state-based, not effect-based — activates on next attack after activation)
  if (this.state.overcharged.has(attacker.id)) {
    const params = this.getEffectParams(attacker.id, 'overcharge');
    if (params) {
      result.overchargeMultiplier = params.damageMultiplier ?? 2.5;
    }
    this.state.overcharged.delete(attacker.id);
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: implement on-attack item effects (12 offensive abilities)
```

---

### Task 4: Defensive and Passive Effects

**Files:**
- Modify: `server/src/ItemEffectResolver.ts`
- Modify: `server/src/ItemEffectResolver.test.ts`

- [ ] **Step 1: Write tests for defensive and passive effects**

Add to `server/src/ItemEffectResolver.test.ts`:

```ts
describe('ItemEffectResolver — Defensive', () => {
  it('thorns: returns flat damage back to attacker', () => {
    const effects = makeEffects('p1', { id: 'thorns', params: { flatDamage: 7 } });
    const resolver = makeResolver(effects);
    const target = makeParticipant({ id: 'p1' });
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 10, false, [target, attacker]);
    expect(result.reflectDamage).toBe(7);
  });

  it('reflect: returns percentage damage when defending', () => {
    const effects = makeEffects('p1', { id: 'reflect', params: { reflectPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const target = makeParticipant({ id: 'p1' });
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 20, true, [target, attacker]);
    expect(result.reflectDamage).toBe(10); // floor(20 * 0.5)
  });

  it('reflect: no reflect damage when not defending', () => {
    const effects = makeEffects('p1', { id: 'reflect', params: { reflectPercent: 0.5 } });
    const resolver = makeResolver(effects);
    const target = makeParticipant({ id: 'p1' });
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 20, false, [target, attacker]);
    expect(result.reflectDamage).toBe(0);
  });

  it('deathward: triggers defense buff when HP drops below threshold', () => {
    const effects = makeEffects('p1', { id: 'deathward', params: { hpThresholdPercent: 0.25, bonusDefense: 10, duration: 2 } });
    const resolver = makeResolver(effects);
    const target = makeParticipant({ id: 'p1', hp: 15, maxHp: 50 }); // 30%, will drop below 25%
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 5, false, [target, attacker]);
    expect(result.deathwardTriggered).toBe(true);
    expect(result.deathwardDefense).toBe(10);
    expect(result.deathwardDuration).toBe(2);
  });

  it('deathward: only triggers once per combat', () => {
    const effects = makeEffects('p1', { id: 'deathward', params: { hpThresholdPercent: 0.25, bonusDefense: 10, duration: 2 } });
    const resolver = makeResolver(effects);
    resolver.getState().deathwardTriggered.add('p1');
    const target = makeParticipant({ id: 'p1', hp: 10, maxHp: 50 });
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 5, false, [target, attacker]);
    expect(result.deathwardTriggered).toBe(false);
  });

  it('guardian: intercepts damage from ally', () => {
    const effects = makeEffects('p1', { id: 'guardian', params: { interceptPercent: 0.3 } });
    const resolver = makeResolver(effects);
    const guardian = makeParticipant({ id: 'p1', hp: 50 });
    const target = makeParticipant({ id: 'p2' });
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 20, false, [guardian, target, attacker]);
    expect(result.interceptedDamage).toBe(6); // floor(20 * 0.3)
    expect(result.guardianId).toBe('p1');
  });

  it('guardian: does not intercept own damage', () => {
    const effects = makeEffects('p1', { id: 'guardian', params: { interceptPercent: 0.3 } });
    const resolver = makeResolver(effects);
    const target = makeParticipant({ id: 'p1', hp: 50 }); // guardian IS the target
    const attacker = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveOnDamageTaken(target, attacker, 20, false, [target, attacker]);
    expect(result.interceptedDamage).toBe(0);
  });
});

describe('ItemEffectResolver — Passive/Combat Start', () => {
  it('fortify: returns bonus defense from maxHp', () => {
    const effects = makeEffects('p1', { id: 'fortify', params: { defensePerHpPercent: 0.08 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', maxHp: 100 });
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusDefense).toBe(8); // floor(100 * 0.08)
  });

  it('glass_cannon: zeroes defense and converts to damage', () => {
    const effects = makeEffects('p1', { id: 'glass_cannon', params: { damagePerDefense: 2.0 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', defense: 10 });
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusDamage).toBe(20); // 10 * 2.0
    expect(mods.overrideDefense).toBe(0);
  });

  it('party_buff: returns bonus damage for allies', () => {
    const effects = makeEffects('p1', { id: 'party_buff', params: { bonusDamage: 3 } });
    const resolver = makeResolver(effects);
    const buffHolder = makeParticipant({ id: 'p1' });
    const ally = makeParticipant({ id: 'p2' });
    const mob = makeParticipant({ id: 'mob1', type: 'mob' });
    const mods = resolver.resolvePartyBuffs([buffHolder, ally, mob]);
    expect(mods.get('p1')).toBe(3);
    expect(mods.get('p2')).toBe(3);
    expect(mods.has('mob1')).toBe(false);
  });

  it('berserk: returns bonus damage based on missing HP', () => {
    const effects = makeEffects('p1', { id: 'berserk', params: { maxBonusDamage: 12 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', hp: 25, maxHp: 50 }); // 50% HP
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusDamage).toBe(6); // 12 * (1 - 0.5) = 6
  });

  it('berserk: zero bonus at full HP', () => {
    const effects = makeEffects('p1', { id: 'berserk', params: { maxBonusDamage: 12 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', hp: 50, maxHp: 50 });
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusDamage).toBe(0);
  });

  it('predator: returns bonus initiative based on kills', () => {
    const effects = makeEffects('p1', { id: 'predator', params: { initiativePerKill: 3 } });
    const resolver = makeResolver(effects);
    resolver.trackKill('p1');
    resolver.trackKill('p1');
    const participant = makeParticipant({ id: 'p1' });
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusInitiative).toBe(6); // 2 kills * 3
  });

  it('siphon_armor: returns bonus defense from stacks', () => {
    const effects = makeEffects('p1', { id: 'siphon_armor', params: { defensePerHit: 1, maxStacks: 5, duration: 2 } });
    const resolver = makeResolver(effects);
    resolver.getState().siphonStacks.set('p1', 3);
    const participant = makeParticipant({ id: 'p1' });
    const mods = resolver.resolvePassiveStats(participant);
    expect(mods.bonusDefense).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: FAIL — `resolveOnDamageTaken`, `resolvePassiveStats`, `resolvePartyBuffs` do not exist

- [ ] **Step 3: Add PassiveStatModifiers interface and implement methods**

Add interface:

```ts
export interface PassiveStatModifiers {
  bonusDamage: number;
  bonusDefense: number;
  bonusInitiative: number;
  overrideDefense?: number; // glass_cannon sets this to 0
}
```

Implement `resolveOnDamageTaken`:

```ts
resolveOnDamageTaken(
  target: EffectParticipant,
  attacker: EffectParticipant,
  incomingDamage: number,
  isDefending: boolean,
  allParticipants: EffectParticipant[],
): DamageTakenResult {
  const result: DamageTakenResult = {
    reflectDamage: 0, interceptedDamage: 0, deathwardTriggered: false,
  };

  // Target's own effects
  const targetEffects = this.getEffects(target.id);
  for (const effect of targetEffects) {
    switch (effect.effectId) {
      case 'thorns': {
        result.reflectDamage += effect.params.flatDamage ?? 0;
        break;
      }
      case 'reflect': {
        if (isDefending) {
          result.reflectDamage += Math.floor(incomingDamage * (effect.params.reflectPercent ?? 0));
        }
        break;
      }
      case 'deathward': {
        if (!this.state.deathwardTriggered.has(target.id)) {
          const threshold = effect.params.hpThresholdPercent ?? 0.25;
          const hpAfterDamage = target.hp - incomingDamage;
          if (hpAfterDamage < target.maxHp * threshold && hpAfterDamage > 0) {
            result.deathwardTriggered = true;
            result.deathwardDefense = effect.params.bonusDefense ?? 10;
            result.deathwardDuration = effect.params.duration ?? 2;
            this.state.deathwardTriggered.add(target.id);
          }
        }
        break;
      }
    }
  }

  // Guardian: check if any OTHER ally has guardian effect
  const allies = allParticipants.filter(
    p => p.type === target.type && p.alive && p.id !== target.id,
  );
  for (const ally of allies) {
    const guardianParams = this.getEffectParams(ally.id, 'guardian');
    if (guardianParams) {
      const intercepted = Math.floor(incomingDamage * (guardianParams.interceptPercent ?? 0));
      if (intercepted > 0) {
        result.interceptedDamage = intercepted;
        result.guardianId = ally.id;
        break; // Only one guardian intercepts
      }
    }
  }

  return result;
}
```

Implement `resolvePassiveStats`:

```ts
resolvePassiveStats(participant: EffectParticipant): PassiveStatModifiers {
  const mods: PassiveStatModifiers = { bonusDamage: 0, bonusDefense: 0, bonusInitiative: 0 };
  const effects = this.getEffects(participant.id);

  for (const effect of effects) {
    switch (effect.effectId) {
      case 'fortify': {
        mods.bonusDefense += Math.floor(participant.maxHp * (effect.params.defensePerHpPercent ?? 0));
        break;
      }
      case 'glass_cannon': {
        mods.bonusDamage += Math.floor(participant.defense * (effect.params.damagePerDefense ?? 0));
        mods.overrideDefense = 0;
        break;
      }
      case 'berserk': {
        const missingHpPercent = 1 - (participant.hp / participant.maxHp);
        mods.bonusDamage += Math.floor((effect.params.maxBonusDamage ?? 0) * missingHpPercent);
        break;
      }
      case 'predator': {
        const kills = this.state.predatorKills.get(participant.id) ?? 0;
        mods.bonusInitiative += kills * (effect.params.initiativePerKill ?? 0);
        break;
      }
      case 'siphon_armor': {
        const stacks = this.state.siphonStacks.get(participant.id) ?? 0;
        mods.bonusDefense += stacks * (effect.params.defensePerHit ?? 0);
        break;
      }
    }
  }

  return mods;
}
```

Implement `resolvePartyBuffs`:

```ts
resolvePartyBuffs(allParticipants: EffectParticipant[]): Map<string, number> {
  const bonusDamage = new Map<string, number>();

  for (const participant of allParticipants) {
    const params = this.getEffectParams(participant.id, 'party_buff');
    if (params) {
      const bonus = params.bonusDamage ?? 0;
      // Apply to all allies of the same type
      for (const ally of allParticipants) {
        if (ally.type === participant.type && ally.alive) {
          bonusDamage.set(ally.id, (bonusDamage.get(ally.id) ?? 0) + bonus);
        }
      }
    }
  }

  return bonusDamage;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: implement defensive and passive item effects
```

---

### Task 5: Survival Effects and Poison Tick

**Files:**
- Modify: `server/src/ItemEffectResolver.ts`
- Modify: `server/src/ItemEffectResolver.test.ts`

- [ ] **Step 1: Write tests for survival effects and poison tick**

Add to `server/src/ItemEffectResolver.test.ts`:

```ts
describe('ItemEffectResolver — Survival', () => {
  it('self_revive: prevents death and returns revive HP', () => {
    const effects = makeEffects('p1', { id: 'self_revive', params: { revivePercent: 0.25 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', maxHp: 100 });
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(true);
    expect(result.effectId).toBe('self_revive');
    expect(result.reviveHp).toBe(25);
  });

  it('self_revive: does not trigger if already consumed', () => {
    const effects = makeEffects('p1', { id: 'self_revive', params: { revivePercent: 0.25 } });
    const resolver = makeResolver(effects, new Map([['p1', ['self_revive']]]));
    const participant = makeParticipant({ id: 'p1', maxHp: 100 });
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(false);
  });

  it('undying_fury: grants extra turns on death', () => {
    const effects = makeEffects('p1', { id: 'undying_fury', params: { extraTurns: 2 } });
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1' });
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(true);
    expect(result.effectId).toBe('undying_fury');
    expect(result.extraTurns).toBe(2);
  });

  it('undying_fury: does not trigger if already consumed', () => {
    const effects = makeEffects('p1', { id: 'undying_fury', params: { extraTurns: 2 } });
    const resolver = makeResolver(effects, new Map([['p1', ['undying_fury']]]));
    const participant = makeParticipant({ id: 'p1' });
    const result = resolver.resolveOnDeath(participant);
    expect(result.prevented).toBe(false);
  });

  it('self_revive takes priority over undying_fury', () => {
    const effects = makeEffects('p1',
      { id: 'self_revive', params: { revivePercent: 0.25 } },
      { id: 'undying_fury', params: { extraTurns: 2 } },
    );
    const resolver = makeResolver(effects);
    const participant = makeParticipant({ id: 'p1', maxHp: 100 });
    const result = resolver.resolveOnDeath(participant);
    expect(result.effectId).toBe('self_revive');
  });
});

describe('ItemEffectResolver — Poison Tick', () => {
  it('returns poison damage for poisoned participant', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('mob1', [
      { damage: 4, turnsRemaining: 3, sourceId: 'p1' },
    ]);
    const result = resolver.resolveOnTurnStart('mob1');
    expect(result.poisonDamage).toBe(4);
  });

  it('decrements poison duration and removes expired', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('mob1', [
      { damage: 4, turnsRemaining: 1, sourceId: 'p1' },
    ]);
    resolver.resolveOnTurnStart('mob1');
    expect(resolver.getState().poisoned.get('mob1')).toHaveLength(0);
  });

  it('stacks multiple poisons', () => {
    const resolver = makeResolver();
    resolver.getState().poisoned.set('mob1', [
      { damage: 4, turnsRemaining: 2, sourceId: 'p1' },
      { damage: 3, turnsRemaining: 1, sourceId: 'p2' },
    ]);
    const result = resolver.resolveOnTurnStart('mob1');
    expect(result.poisonDamage).toBe(7);
  });

  it('decrements overwhelm debuffs and removes expired', () => {
    const resolver = makeResolver();
    resolver.getState().overwhelmDebuffs.set('mob1', [
      { reduction: 3, turnsRemaining: 1 },
    ]);
    const result = resolver.resolveOnTurnStart('mob1');
    expect(result.defenseReduction).toBe(3);
    expect(resolver.getState().overwhelmDebuffs.get('mob1')).toHaveLength(0);
  });

  it('undying_fury: decrements turns and signals expiry', () => {
    const resolver = makeResolver();
    resolver.getState().undyingTurns.set('p1', 1);
    const result = resolver.resolveOnTurnStart('p1');
    expect(result.undyingExpired).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement resolveOnDeath, resolveOnTurnStart**

Add interface:

```ts
export interface TurnStartResult {
  poisonDamage: number;
  defenseReduction: number;
  undyingExpired: boolean;
}
```

Implement `resolveOnDeath`:

```ts
resolveOnDeath(participant: EffectParticipant): DeathPreventionResult {
  const effects = this.getEffects(participant.id);

  // Self revive takes priority
  const selfRevive = effects.find(e => e.effectId === 'self_revive');
  if (selfRevive && !this.isEffectConsumed(participant.id, 'self_revive')) {
    this.consumeEffect(participant.id, 'self_revive');
    const reviveHp = Math.max(1, Math.floor(participant.maxHp * (selfRevive.params.revivePercent ?? 0.25)));
    return { prevented: true, effectId: 'self_revive', reviveHp };
  }

  // Undying fury
  const undying = effects.find(e => e.effectId === 'undying_fury');
  if (undying && !this.isEffectConsumed(participant.id, 'undying_fury')) {
    this.consumeEffect(participant.id, 'undying_fury');
    const extraTurns = undying.params.extraTurns ?? 2;
    this.state.undyingTurns.set(participant.id, extraTurns);
    return { prevented: true, effectId: 'undying_fury', extraTurns };
  }

  return { prevented: false };
}
```

Implement `resolveOnTurnStart`:

```ts
resolveOnTurnStart(participantId: string): TurnStartResult {
  const result: TurnStartResult = { poisonDamage: 0, defenseReduction: 0, undyingExpired: false };

  // Poison ticks
  const poisons = this.state.poisoned.get(participantId);
  if (poisons && poisons.length > 0) {
    for (const poison of poisons) {
      result.poisonDamage += poison.damage;
      poison.turnsRemaining--;
    }
    this.state.poisoned.set(participantId, poisons.filter(p => p.turnsRemaining > 0));
  }

  // Overwhelm debuffs
  const debuffs = this.state.overwhelmDebuffs.get(participantId);
  if (debuffs && debuffs.length > 0) {
    for (const debuff of debuffs) {
      result.defenseReduction += debuff.reduction;
      debuff.turnsRemaining--;
    }
    this.state.overwhelmDebuffs.set(participantId, debuffs.filter(d => d.turnsRemaining > 0));
  }

  // Undying fury countdown
  const undyingTurns = this.state.undyingTurns.get(participantId);
  if (undyingTurns !== undefined) {
    const remaining = undyingTurns - 1;
    if (remaining <= 0) {
      this.state.undyingTurns.delete(participantId);
      result.undyingExpired = true;
    } else {
      this.state.undyingTurns.set(participantId, remaining);
    }
  }

  return result;
}
```

Also add a method to apply post-damage effects to state (called by CombatManager after damage is dealt):

```ts
applyPostDamageEffects(effects: PostDamageEffect[]): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'venomous': {
        if (effect.targetId) {
          const existing = this.state.poisoned.get(effect.targetId) ?? [];
          existing.push({
            damage: effect.value,
            turnsRemaining: effect.duration ?? 3,
            sourceId: effect.targetId,
          });
          this.state.poisoned.set(effect.targetId, existing);
        }
        break;
      }
      case 'overwhelm': {
        if (effect.targetId) {
          const existing = this.state.overwhelmDebuffs.get(effect.targetId) ?? [];
          existing.push({ reduction: effect.value, turnsRemaining: effect.duration ?? 2 });
          this.state.overwhelmDebuffs.set(effect.targetId, existing);
        }
        break;
      }
      case 'siphon_armor': {
        // Handled via direct siphon stack increment
        break;
      }
    }
  }
}

incrementSiphonStacks(playerId: string): void {
  const params = this.getEffectParams(playerId, 'siphon_armor');
  if (!params) return;
  const maxStacks = params.maxStacks ?? 5;
  const current = this.state.siphonStacks.get(playerId) ?? 0;
  this.state.siphonStacks.set(playerId, Math.min(current + 1, maxStacks));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: implement survival effects, poison tick, and overwhelm debuffs
```

---

### Task 6: Activated Effects

**Files:**
- Modify: `server/src/ItemEffectResolver.ts`
- Modify: `server/src/ItemEffectResolver.test.ts`

- [ ] **Step 1: Write tests for activated effects**

Add to `server/src/ItemEffectResolver.test.ts`:

```ts
describe('ItemEffectResolver — Activated', () => {
  it('overcharge: activates and applies self-damage', () => {
    const effects = makeEffects('p1', { id: 'overcharge', params: { damageMultiplier: 2.5, selfDamagePercent: 0.15 } });
    const resolver = makeResolver(effects);
    const caster = makeParticipant({ id: 'p1', maxHp: 100 });
    const result = resolver.resolveActivatedEffect('p1', 'overcharge', caster, undefined, [caster]);
    expect(result.success).toBe(true);
    expect(result.selfDamage).toBe(15); // floor(100 * 0.15)
    expect(resolver.getState().overcharged.has('p1')).toBe(true);
  });

  it('overcharge: fails if player does not have the effect', () => {
    const resolver = makeResolver();
    const caster = makeParticipant({ id: 'p1' });
    const result = resolver.resolveActivatedEffect('p1', 'overcharge', caster, undefined, [caster]);
    expect(result.success).toBe(false);
  });

  it('revive_once: revives downed ally', () => {
    const effects = makeEffects('p1', { id: 'revive_once', params: { revivePercent: 0.3 } });
    const resolver = makeResolver(effects);
    const caster = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'p2', hp: 0, maxHp: 80, alive: false });
    const result = resolver.resolveActivatedEffect('p1', 'revive_once', caster, target, [caster, target]);
    expect(result.success).toBe(true);
    expect(result.reviveHp).toBe(24); // floor(80 * 0.3)
    expect(resolver.isEffectConsumed('p1', 'revive_once')).toBe(true);
  });

  it('revive_once: fails if already consumed', () => {
    const effects = makeEffects('p1', { id: 'revive_once', params: { revivePercent: 0.3 } });
    const resolver = makeResolver(effects, new Map([['p1', ['revive_once']]]));
    const caster = makeParticipant({ id: 'p1' });
    const target = makeParticipant({ id: 'p2', hp: 0, alive: false });
    const result = resolver.resolveActivatedEffect('p1', 'revive_once', caster, target, [caster, target]);
    expect(result.success).toBe(false);
  });

  it('rally: heals all allies based on caster maxHp', () => {
    const effects = makeEffects('p1', { id: 'rally', params: { healPercent: 0.15, cooldown: 3 } });
    const resolver = makeResolver(effects);
    const caster = makeParticipant({ id: 'p1', maxHp: 100 });
    const ally = makeParticipant({ id: 'p2', hp: 30, maxHp: 50 });
    const mob = makeParticipant({ id: 'mob1', type: 'mob' });
    const result = resolver.resolveActivatedEffect('p1', 'rally', caster, undefined, [caster, ally, mob]);
    expect(result.success).toBe(true);
    expect(result.healing).toBe(15); // floor(100 * 0.15)
    expect(result.targetIds).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement resolveActivatedEffect**

```ts
resolveActivatedEffect(
  playerId: string,
  effectId: string,
  caster: EffectParticipant,
  target: EffectParticipant | undefined,
  allParticipants: EffectParticipant[],
): ActivatedEffectResult {
  const params = this.getEffectParams(playerId, effectId);
  if (!params) return { success: false, effectId };

  switch (effectId) {
    case 'overcharge': {
      const selfDamage = Math.floor(caster.maxHp * (params.selfDamagePercent ?? 0.15));
      this.state.overcharged.add(playerId);
      return { success: true, effectId, selfDamage };
    }
    case 'revive_once': {
      if (this.isEffectConsumed(playerId, 'revive_once')) {
        return { success: false, effectId };
      }
      if (!target || target.alive) {
        return { success: false, effectId };
      }
      const reviveHp = Math.max(1, Math.floor(target.maxHp * (params.revivePercent ?? 0.3)));
      this.consumeEffect(playerId, 'revive_once');
      return { success: true, effectId, reviveHp, targetIds: [target.id] };
    }
    case 'rally': {
      const healing = Math.floor(caster.maxHp * (params.healPercent ?? 0.15));
      const allies = allParticipants
        .filter(p => p.type === caster.type && p.alive)
        .map(p => p.id);
      return { success: true, effectId, healing, targetIds: allies };
    }
    default:
      return { success: false, effectId };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/ItemEffectResolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: implement activated item effects (overcharge, revive_once, rally)
```

---

### Task 7: CombatManager Integration

**Files:**
- Modify: `server/src/CombatManager.ts`
- Modify: `server/src/CombatManager.test.ts`

This is the core integration task — hooking `ItemEffectResolver` into the combat loop.

- [ ] **Step 1: Write integration tests**

Add to `server/src/CombatManager.test.ts`:

```ts
import type { EquippedEffect } from '@caverns/shared';

describe('CombatManager — Item Effects', () => {
  it('vampiric weapon heals attacker on hit', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'vampiric', params: { leechPercent: 0.5 }, sourceItemId: 'lifedrinker' }]],
    ]);
    const players = [
      { id: 'p1', name: 'Alice', hp: 30, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result).not.toBeNull();
    expect(result!.damage).toBe(8);
    expect(result!.itemEffectHealing).toBe(4); // floor(8 * 0.5)
  });

  it('thorns damages mob when player is attacked', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'thorns', params: { flatDamage: 7 }, sourceItemId: 'mantle' }]],
    ]);
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 1 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolveMobTurn('mob1');
    expect(result).not.toBeNull();
    expect(result!.itemEffectDamage).toBe(7); // thorns reflect
  });

  it('self_revive prevents death once', () => {
    const playerEffects = new Map<string, EquippedEffect[]>([
      ['p1', [{ effectId: 'self_revive', params: { revivePercent: 0.25 }, sourceItemId: 'phoenix' }]],
    ]);
    const players = [
      { id: 'p1', name: 'Alice', hp: 5, maxHp: 100, damage: 10, defense: 0, initiative: 1 },
    ];
    const mobs = [makeMob({ damage: 20 })];
    const cm = new CombatManager('room1', players, mobs, playerEffects);
    const result = cm.resolveMobTurn('mob1');
    expect(result!.targetDowned).toBe(false);
    expect(result!.targetHp).toBe(25); // revived at 25% of 100
    expect(result!.itemEffect).toBe('self_revive');
  });

  it('backwards compatible: works without playerEffects param', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const result = cm.resolvePlayerAction('p1', { action: 'attack', targetId: 'mob1' });
    expect(result!.damage).toBe(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/CombatManager.test.ts`
Expected: FAIL — CombatManager constructor doesn't accept playerEffects yet

- [ ] **Step 3: Integrate ItemEffectResolver into CombatManager**

Update the `CombatManager` constructor to accept an optional `playerEffects` map and create an `ItemEffectResolver`:

```ts
import { ItemEffectResolver } from './ItemEffectResolver.js';
import type { EquippedEffect } from '@caverns/shared';

export class CombatManager {
  private roomId: string;
  private participants: Map<string, InternalParticipant> = new Map();
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private roundNumber = 1;
  private effectResolver: ItemEffectResolver;

  constructor(
    roomId: string,
    players: CombatPlayerInfo[],
    mobs: MobInstance[],
    playerEffects?: Map<string, EquippedEffect[]>,
    usedDungeonEffects?: Map<string, string[]>,
  ) {
    this.roomId = roomId;
    this.effectResolver = new ItemEffectResolver(
      playerEffects ?? new Map(),
      usedDungeonEffects ?? new Map(),
    );
    // ...existing player/mob setup...
    this.rollInitiativeOrder();
  }
```

Update `resolvePlayerAction` for the `'attack'` case. After the existing damage calculation, add item effect processing:

```ts
case 'attack': {
  const target = this.participants.get(action.targetId!);
  if (!target || !target.alive) return null;
  const effectiveDefense = target.isDefending ? target.defense * 2 : target.defense;
  const multiplier = action.critMultiplier ?? 1.0;

  // Item effect: resolve on-attack
  const isFirst = this.turnOrder[0] === playerId;
  const attackEffects = this.effectResolver.resolveOnAttack(
    actor, target, actor.damage, multiplier,
    Array.from(this.participants.values()),
    isFirst,
  );

  // Apply passive stat mods (berserk, rampage, predator, etc.)
  const passiveMods = this.effectResolver.resolvePassiveStats(actor);
  const effectiveDamage = actor.damage + attackEffects.bonusDamage + passiveMods.bonusDamage;

  // Apply crit modification (brutal_impact)
  const finalMultiplier = attackEffects.modifiedCritMultiplier ?? multiplier;

  // Apply overcharge multiplier
  const overchargeMultiplier = attackEffects.overchargeMultiplier ?? 1.0;

  const damage = Math.max(1, Math.floor((effectiveDamage - effectiveDefense) * finalMultiplier * overchargeMultiplier));
  target.hp = Math.max(0, target.hp - damage);

  // Track for momentum and rampage
  this.effectResolver.trackAction(playerId, 'attack');
  this.effectResolver.trackDamageDealt(playerId, damage);

  // Siphon armor
  if (this.effectResolver.hasEffect(playerId, 'siphon_armor')) {
    this.effectResolver.incrementSiphonStacks(playerId);
  }

  // Vampiric healing
  let itemEffectHealing: number | undefined;
  const vampEffect = attackEffects.postDamageEffects.find(e => e.type === 'vampiric');
  if (vampEffect) {
    const healed = Math.min(vampEffect.value, actor.maxHp - actor.hp);
    actor.hp += healed;
    itemEffectHealing = healed;
  }

  // Cleave splash
  let itemEffectDamage: number | undefined;
  for (const effect of attackEffects.postDamageEffects.filter(e => e.type === 'cleave')) {
    const splashTarget = this.participants.get(effect.targetId!);
    if (splashTarget && splashTarget.alive) {
      splashTarget.hp = Math.max(0, splashTarget.hp - effect.value);
      if (splashTarget.hp === 0) splashTarget.alive = false;
      itemEffectDamage = (itemEffectDamage ?? 0) + effect.value;
    }
  }

  // Apply state-tracked post-damage effects (venomous, overwhelm)
  this.effectResolver.applyPostDamageEffects(attackEffects.postDamageEffects);

  // Flurry bonus hits
  if (attackEffects.flurryHits && attackEffects.flurryDamagePerHit) {
    for (let i = 0; i < attackEffects.flurryHits; i++) {
      if (target.alive) {
        target.hp = Math.max(0, target.hp - attackEffects.flurryDamagePerHit);
        if (target.hp === 0) target.alive = false;
        itemEffectDamage = (itemEffectDamage ?? 0) + attackEffects.flurryDamagePerHit;
      }
    }
  }

  // Check death prevention
  let targetDowned = target.hp === 0;
  let itemEffect: string | undefined;
  if (targetDowned && target.type === 'player') {
    const deathResult = this.effectResolver.resolveOnDeath(target);
    if (deathResult.prevented) {
      targetDowned = false;
      target.alive = true;
      target.hp = deathResult.reviveHp ?? 1;
      itemEffect = deathResult.effectId;
    }
  }
  if (targetDowned) target.alive = false;

  // Track kill for predator
  if (targetDowned) this.effectResolver.trackKill(playerId);

  return {
    actorId: playerId, actorName: actor.name, action: 'attack',
    targetId: target.id, targetName: target.name, damage,
    targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
    critMultiplier: finalMultiplier,
    itemEffect, itemEffectDamage, itemEffectHealing,
  };
}
```

Update `resolveMobTurn` to process defensive effects after damage is applied to a player:

After computing `rawDamage` and applying it to the target, add:

```ts
// Item effects on damage taken
const damageTakenResult = this.effectResolver.resolveOnDamageTaken(
  target, mob, rawDamage, target.isDefending,
  Array.from(this.participants.values()),
);

// Guardian intercept
let actualDamage = rawDamage;
if (damageTakenResult.interceptedDamage > 0 && damageTakenResult.guardianId) {
  const guardian = this.participants.get(damageTakenResult.guardianId);
  if (guardian && guardian.alive) {
    guardian.hp = Math.max(0, guardian.hp - damageTakenResult.interceptedDamage);
    if (guardian.hp === 0) guardian.alive = false;
    actualDamage -= damageTakenResult.interceptedDamage;
  }
}

// Apply actual damage to target
const hasPreventDown = target.buffs.some(b => b.type === 'prevent_down');
target.hp = Math.max(hasPreventDown ? 1 : 0, target.hp - actualDamage);

// Thorns + reflect damage back to mob
let itemEffectDamage: number | undefined;
if (damageTakenResult.reflectDamage > 0) {
  mob.hp = Math.max(0, mob.hp - damageTakenResult.reflectDamage);
  if (mob.hp === 0) mob.alive = false;
  itemEffectDamage = damageTakenResult.reflectDamage;
}

// Deathward buff
if (damageTakenResult.deathwardTriggered) {
  target.buffs.push({
    type: 'defense_flat',
    turnsRemaining: damageTakenResult.deathwardDuration ?? 2,
    sourcePlayerId: target.id,
    value: damageTakenResult.deathwardDefense ?? 10,
  });
}

// Death prevention (self_revive, undying_fury)
let targetDowned = target.hp === 0;
let itemEffect: string | undefined;
if (targetDowned) {
  const deathResult = this.effectResolver.resolveOnDeath(target);
  if (deathResult.prevented) {
    targetDowned = false;
    target.alive = true;
    target.hp = deathResult.reviveHp ?? 1;
    itemEffect = deathResult.effectId;
  }
}
if (targetDowned) target.alive = false;
```

Add a method to expose the effect resolver's consumed effects (for syncing back to Player):

```ts
getConsumedEffects(): Map<string, string[]> {
  return this.effectResolver.getConsumedEffects();
}
```

Add `getConsumedEffects` to `ItemEffectResolver`:

```ts
getConsumedEffects(): Map<string, string[]> {
  return this.usedDungeonEffects;
}
```

Also add `getEffectResolver()` for GameSession to call turn-start effects:

```ts
getEffectResolver(): ItemEffectResolver {
  return this.effectResolver;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/CombatManager.test.ts`
Expected: PASS (both existing and new tests)

- [ ] **Step 5: Run all server tests**

Run: `npx vitest run server/`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: integrate ItemEffectResolver into CombatManager combat loop
```

---

### Task 8: PlayerManager — Add healPlayer method and usedEffects support

**Files:**
- Modify: `server/src/PlayerManager.ts`

- [ ] **Step 1: Add healPlayer method**

In `server/src/PlayerManager.ts`, add:

```ts
healPlayer(playerId: string, amount: number): number {
  const player = this.players.get(playerId);
  if (!player) return 0;
  const healed = Math.min(amount, player.maxHp - player.hp);
  player.hp += healed;
  return healed;
}
```

- [ ] **Step 2: Update revivePlayer to accept optional HP amount**

```ts
revivePlayer(playerId: string, hp?: number): void {
  const player = this.players.get(playerId);
  if (!player) return;
  player.status = 'exploring';
  player.hp = hp ?? Math.floor(player.maxHp * 0.25);
}
```

- [ ] **Step 3: Commit**

```
feat: add healPlayer and update revivePlayer in PlayerManager
```

---

### Task 9: GameSession Integration

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Pass equipment effects when creating CombatManager**

In `startCombat`, collect each player's equipped effects and pass them:

```ts
private startCombat(roomId: string, mobTemplateId: string): void {
  // ...existing mob setup...

  const playersInRoom = this.playerManager.getPlayersInRoom(roomId);
  const combatPlayers: CombatPlayerInfo[] = playersInRoom.map((p) => {
    const stats = this.playerManager.getComputedStats(p.id);
    return { id: p.id, name: p.name, hp: p.hp, maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, initiative: stats.initiative, className: p.className };
  });

  // Collect item effects from equipment
  const playerEffects = new Map<string, EquippedEffect[]>();
  const usedDungeonEffects = new Map<string, string[]>();
  for (const p of playersInRoom) {
    playerEffects.set(p.id, getPlayerEquippedEffects(p));
    usedDungeonEffects.set(p.id, [...p.usedEffects]);
  }

  // ...existing status updates...

  const combat = new CombatManager(roomId, combatPlayers, [mobInstance], playerEffects, usedDungeonEffects);
  this.combats.set(roomId, combat);
  // ...rest unchanged...
}
```

Add the import at the top of GameSession.ts:

```ts
import { getPlayerEquippedEffects, type EquippedEffect } from '@caverns/shared';
```

- [ ] **Step 2: Sync consumed effects back to Player after combat ends**

In `finishCombat`, after combat ends, sync consumed single-use effects back to player state:

```ts
private finishCombat(roomId: string, result: 'victory' | 'flee' | 'wipe'): void {
  const combat = this.combats.get(roomId);

  // Sync consumed item effects back to player
  if (combat) {
    const consumed = combat.getConsumedEffects();
    for (const [playerId, effects] of consumed) {
      const player = this.playerManager.getPlayer(playerId);
      if (player) {
        for (const eff of effects) {
          if (!player.usedEffects.includes(eff)) {
            player.usedEffects.push(eff);
          }
        }
      }
    }
  }

  this.broadcastToRoom(roomId, { type: 'combat_end', result });
  // ...rest unchanged...
}
```

- [ ] **Step 3: Handle activated item effects (use_item_effect action)**

Add a new handler in GameSession for `use_item_effect` combat actions. In the message router (in `server/src/index.ts` or wherever combat_action is dispatched), route `use_item_effect` to a new method:

```ts
handleItemEffectAction(playerId: string, effectId: string, targetId?: string): void {
  const player = this.playerManager.getPlayer(playerId);
  if (!player || player.status !== 'in_combat') return;
  const combat = this.combats.get(player.roomId);
  if (!combat || !combat.isPlayerTurn(playerId)) return;

  const resolver = combat.getEffectResolver();
  const participants = combat.getParticipantsArray();
  const caster = participants.find(p => p.id === playerId);
  const target = targetId ? participants.find(p => p.id === targetId) : undefined;
  if (!caster) return;

  const result = resolver.resolveActivatedEffect(playerId, effectId, caster, target, participants);
  if (!result.success) {
    this.sendTo(playerId, { type: 'error', message: 'Cannot use that ability right now.' });
    return;
  }

  // Apply effects
  if (result.selfDamage) {
    combat.applyDamage(playerId, result.selfDamage);
  }
  if (result.reviveHp && result.targetIds?.[0]) {
    const reviveTarget = combat.getParticipant(result.targetIds[0]);
    if (reviveTarget) {
      reviveTarget.alive = true;
      reviveTarget.hp = result.reviveHp;
      this.playerManager.revivePlayer(result.targetIds[0], result.reviveHp);
    }
  }
  if (result.healing && result.targetIds) {
    for (const allyId of result.targetIds) {
      combat.applyHealing(allyId, result.healing);
      const allyPlayer = this.playerManager.getPlayer(allyId);
      if (allyPlayer) {
        this.playerManager.healPlayer(allyId, result.healing);
      }
    }
  }

  // Broadcast
  this.broadcastToRoom(player.roomId, {
    type: 'combat_action_result',
    actorId: playerId,
    actorName: player.name,
    action: 'use_item_effect',
    itemEffect: effectId,
    itemEffectHealing: result.healing,
    itemEffectDamage: result.selfDamage,
    targetId,
  } as any);

  // Narrate
  this.narrateItemEffect(player.roomId, player.name, effectId, result);

  combat.advanceTurn();
  this.afterCombatTurn(player.roomId, combat);
}

private narrateItemEffect(roomId: string, actorName: string, effectId: string, result: any): void {
  let message = '';
  switch (effectId) {
    case 'overcharge':
      message = `${actorName} activates Overcharge! Power surges through their weapon...`;
      break;
    case 'revive_once':
      message = `${actorName} uses the Aegis to pull an ally back from death!`;
      break;
    case 'rally':
      message = `${actorName} rallies the party! Everyone is healed for ${result.healing} HP.`;
      break;
  }
  if (message) this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
}
```

- [ ] **Step 4: Add narration for passive item effects**

Update `narrateCombatAction` to include item effect info when present in results:

```ts
// After the existing attack narration:
if (result.itemEffect === 'self_revive') {
  message += ` But a Phoenix Plume ignites — ${result.targetName} rises from the ashes!`;
}
if (result.itemEffectHealing) {
  message += ` (Leeched ${result.itemEffectHealing} HP)`;
}
if (result.itemEffectDamage) {
  message += ` (${result.itemEffectDamage} splash damage)`;
}
```

- [ ] **Step 5: Route use_item_effect in message handler**

In `server/src/index.ts`, add handling for the `use_item_effect` action in the combat_action message handler:

```ts
case 'combat_action': {
  if (msg.action === 'use_ability' && msg.abilityId) {
    gameSession.handleUseAbility(ws.playerId, msg.abilityId, msg.targetId);
  } else if (msg.action === 'use_item_effect' && msg.effectId) {
    gameSession.handleItemEffectAction(ws.playerId, msg.effectId, msg.targetId);
  } else {
    gameSession.handleCombatAction(ws.playerId, msg.action, msg.targetId, msg.itemIndex, msg.fleeDirection, msg.critMultiplier);
  }
  break;
}
```

- [ ] **Step 6: Add poison tick processing to mob turns**

In `processMobTurn`, before the mob acts, check for poison and overwhelm debuffs:

```ts
private processMobTurn(roomId: string, combat: CombatManager): void {
  const mobId = combat.getCurrentTurnId();
  const resolver = combat.getEffectResolver();

  // Process turn-start effects (poison, overwhelm debuff tick)
  const turnStartResult = resolver.resolveOnTurnStart(mobId);
  if (turnStartResult.poisonDamage > 0) {
    const dmgResult = combat.applyDamage(mobId, turnStartResult.poisonDamage);
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `Poison deals ${turnStartResult.poisonDamage} damage!`,
      logType: 'combat',
    });
    if (dmgResult?.targetDowned) {
      combat.advanceTurn();
      this.afterCombatTurn(roomId, combat);
      return;
    }
  }

  // ...existing mob turn logic...
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat: integrate item effects into GameSession combat flow
```

---

### Task 10: Update Unique Items Data

**Files:**
- Modify: `shared/src/data/uniqueItems.json`

- [ ] **Step 1: Add effectParams to all existing unique items**

Update `shared/src/data/uniqueItems.json`:

```json
[
  {
    "id": "worldsplitter",
    "name": "Worldsplitter",
    "description": "An ancient blade that hums with barely contained power. Each swing tears the air itself, striking everything nearby.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 20, "initiative": 2 },
    "effect": "cleave",
    "effectParams": { "splashPercent": 0.5 }
  },
  {
    "id": "lifedrinker",
    "name": "Lifedrinker",
    "description": "A dark blade that pulses with a hungry crimson light. Each wound it inflicts feeds vitality back to the wielder.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 18, "maxHp": 5 },
    "effect": "vampiric",
    "effectParams": { "leechPercent": 0.25 }
  },
  {
    "id": "aegis_of_the_fallen",
    "name": "Aegis of the Fallen",
    "description": "A shield bearing the crest of a forgotten order. Once per delve, it can pull a fallen ally back from the brink of death.",
    "rarity": "unique",
    "slot": "offhand",
    "stats": { "defense": 6, "maxHp": 10 },
    "effect": "revive_once",
    "effectParams": { "revivePercent": 0.3 }
  },
  {
    "id": "mantle_of_thorns",
    "name": "Mantle of Thorns",
    "description": "Armor woven from petrified brambles. Anything that strikes the wearer is cut in return.",
    "rarity": "unique",
    "slot": "armor",
    "stats": { "defense": 10, "maxHp": 8 },
    "effect": "thorns",
    "effectParams": { "flatDamage": 7 }
  },
  {
    "id": "phoenix_plume",
    "name": "Phoenix Plume",
    "description": "A single feather that radiates impossible warmth. When death comes, the plume ignites and the wearer rises from the ashes — once.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "maxHp": 15, "initiative": 3 },
    "effect": "self_revive",
    "effectParams": { "revivePercent": 0.25 }
  },
  {
    "id": "crown_of_command",
    "name": "Crown of Command",
    "description": "A circlet of dark iron that compels obedience. Allies near the wearer fight with renewed purpose and vigor.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "maxHp": 12, "damage": 3, "defense": 2 },
    "effect": "party_buff",
    "effectParams": { "bonusDamage": 3 }
  },
  {
    "id": "mirror_guard",
    "name": "Mirror Guard",
    "description": "A shield of perfectly polished crystal that reflects hostile intent. A portion of incoming damage is redirected back at the attacker.",
    "rarity": "unique",
    "slot": "offhand",
    "stats": { "defense": 5, "initiative": 2 },
    "effect": "reflect",
    "effectParams": { "reflectPercent": 0.5 }
  },
  {
    "id": "berserker_harness",
    "name": "Berserker Harness",
    "description": "Spiked armor that channels pain into fury. The lower your health, the harder you strike.",
    "rarity": "unique",
    "slot": "armor",
    "stats": { "defense": 6, "damage": 5, "maxHp": 10 },
    "effect": "berserk",
    "effectParams": { "maxBonusDamage": 12 }
  },
  {
    "id": "venom_fang",
    "name": "Venom Fang",
    "description": "A curved blade dripping with an oily green substance. Each cut leaves a lingering poison that eats at the victim.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 14, "initiative": 3 },
    "effect": "venomous",
    "effectParams": { "poisonDamage": 4, "duration": 3 }
  },
  {
    "id": "windrunner_boots",
    "name": "Windrunner Greaves",
    "description": "Boots so light they barely touch the ground. The wearer strikes with blinding speed, landing a flurry of blows.",
    "rarity": "unique",
    "slot": "armor",
    "stats": { "defense": 4, "initiative": 5 },
    "effect": "flurry",
    "effectParams": { "hitsPerInitiativeThreshold": 5, "bonusHitPercent": 0.3 }
  },
  {
    "id": "executioners_axe",
    "name": "Executioner's Axe",
    "description": "A massive axe with a blade stained permanently red. It hungers for the wounded.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 16, "maxHp": 5 },
    "effect": "executioner",
    "effectParams": { "hpThresholdPercent": 0.3, "bonusDamage": 10 }
  },
  {
    "id": "ironwall_bulwark",
    "name": "Ironwall Bulwark",
    "description": "A shield that grows heavier — and stronger — the more vital the wielder becomes. Built for those who stack endurance.",
    "rarity": "unique",
    "slot": "offhand",
    "stats": { "defense": 4, "maxHp": 15 },
    "effect": "fortify",
    "effectParams": { "defensePerHpPercent": 0.08 }
  },
  {
    "id": "glass_cannon_ring",
    "name": "Ring of Shattered Wards",
    "description": "A ring that devours your defenses and channels them into pure destructive force. Wear it if you dare.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "damage": 8, "maxHp": 10 },
    "effect": "glass_cannon",
    "effectParams": { "damagePerDefense": 2.0 }
  },
  {
    "id": "guardian_plate",
    "name": "Guardian's Oath Plate",
    "description": "Armor inscribed with ancient vows. The wearer instinctively steps between allies and danger.",
    "rarity": "unique",
    "slot": "armor",
    "stats": { "defense": 9, "maxHp": 15 },
    "effect": "guardian",
    "effectParams": { "interceptPercent": 0.3 }
  },
  {
    "id": "deathward_amulet",
    "name": "Amulet of Last Resort",
    "description": "When death draws near, the amulet erupts with protective energy, buying precious seconds.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "maxHp": 12, "defense": 3 },
    "effect": "deathward",
    "effectParams": { "hpThresholdPercent": 0.25, "bonusDefense": 10, "duration": 2 }
  },
  {
    "id": "momentum_blade",
    "name": "Blade of Endless Strikes",
    "description": "A sword that accelerates with each swing. Stop attacking and it grows heavy again.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 12, "initiative": 2 },
    "effect": "momentum",
    "effectParams": { "damagePerStack": 2, "maxStacks": 5 }
  },
  {
    "id": "overcharge_gauntlet",
    "name": "Gauntlet of Ruin",
    "description": "A spiked gauntlet that can be charged with devastating force — at a cost to the wearer's body.",
    "rarity": "unique",
    "slot": "offhand",
    "stats": { "damage": 6, "maxHp": 8 },
    "effect": "overcharge",
    "effectParams": { "damageMultiplier": 2.5, "selfDamagePercent": 0.15 }
  },
  {
    "id": "first_strike_dagger",
    "name": "Ambush Stiletto",
    "description": "A needle-thin blade designed for the opening blow. Strike first, strike hard.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 10, "initiative": 5 },
    "effect": "first_strike",
    "effectParams": { "bonusDamage": 8 }
  },
  {
    "id": "siphon_armor_ring",
    "name": "Bloodforged Band",
    "description": "A ring that hardens your skin with each blow you land. Offense becomes defense.",
    "rarity": "unique",
    "slot": "accessory",
    "stats": { "damage": 4, "defense": 2 },
    "effect": "siphon_armor",
    "effectParams": { "defensePerHit": 1, "maxStacks": 5, "duration": 2 }
  },
  {
    "id": "rally_horn",
    "name": "Horn of the Warband",
    "description": "A battered war horn that, when sounded, fills allies with renewed vigor.",
    "rarity": "unique",
    "slot": "offhand",
    "stats": { "defense": 3, "maxHp": 12 },
    "effect": "rally",
    "effectParams": { "healPercent": 0.15, "cooldown": 3 }
  },
  {
    "id": "undying_fury_helm",
    "name": "Helm of Undying Fury",
    "description": "A helm forged in rage. Even death cannot stop the wearer immediately — they fight on, burning the last of their life force.",
    "rarity": "unique",
    "slot": "armor",
    "stats": { "damage": 6, "defense": 5, "maxHp": 8 },
    "effect": "undying_fury",
    "effectParams": { "extraTurns": 2 }
  },
  {
    "id": "predator_claws",
    "name": "Predator's Claws",
    "description": "Gauntlets tipped with serrated claws. Each kill sharpens the wearer's instincts, letting them act faster.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 14, "initiative": 2 },
    "effect": "predator",
    "effectParams": { "initiativePerKill": 3 }
  },
  {
    "id": "brutal_impact_hammer",
    "name": "Cataclysm Hammer",
    "description": "An impossibly heavy hammer. When you time the swing perfectly, the impact is catastrophic.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 20 },
    "effect": "brutal_impact",
    "effectParams": { "critBonusPerDamage": 0.02 }
  },
  {
    "id": "overwhelm_gauntlets",
    "name": "Gauntlets of Rending",
    "description": "Clawed gauntlets that tear through armor with each hit, leaving the target increasingly vulnerable.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 15, "initiative": 1 },
    "effect": "overwhelm",
    "effectParams": { "defenseReductionPercent": 0.15, "duration": 2 }
  },
  {
    "id": "blade_storm_katana",
    "name": "Gale Katana",
    "description": "A blade forged from wind-tempered steel. The faster you are than your foe, the deeper it cuts.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 12, "initiative": 4 },
    "effect": "blade_storm",
    "effectParams": { "damagePerInitiativeDiff": 1.0 }
  },
  {
    "id": "rampage_cleaver",
    "name": "Butcher's Momentum",
    "description": "A cleaver that feeds on carnage. The more damage you deal, the more it wants to deal.",
    "rarity": "unique",
    "slot": "weapon",
    "stats": { "damage": 14, "maxHp": 8 },
    "effect": "rampage",
    "effectParams": { "damagePerPointDealt": 0.02, "maxBonus": 10 }
  }
]
```

- [ ] **Step 2: Run tests to verify items load correctly**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat: add effectParams to all 26 unique items
```

---

### Task 11: Client — Display Item Effects and Activated Abilities

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`
- Modify: `client/src/components/ActionBar.tsx`
- Modify: `client/src/hooks/useGameActions.ts`
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add useItemEffect action to useGameActions**

In `client/src/hooks/useGameActions.ts`, add:

```ts
useItemEffect: (effectId: string, targetId?: string) => {
  ws?.send(JSON.stringify({
    type: 'combat_action',
    action: 'use_item_effect',
    effectId,
    targetId,
  }));
},
```

- [ ] **Step 2: Display item effect name in PlayerHUD equipment section**

In `client/src/components/PlayerHUD.tsx`, when rendering equipment items, show the effect name if present:

```tsx
{item.effect && (
  <span className="item-effect">[{item.effect.replace(/_/g, ' ')}]</span>
)}
```

- [ ] **Step 3: Add activated ability buttons to ActionBar**

In `client/src/components/ActionBar.tsx`, during combat mode, check if the player has any activated item effects (overcharge, revive_once, rally) and render buttons:

```tsx
const activatedEffects = ['overcharge', 'revive_once', 'rally'];
const playerEquipment = [
  localPlayer?.equipment.weapon,
  localPlayer?.equipment.offhand,
  localPlayer?.equipment.armor,
  localPlayer?.equipment.accessory,
].filter(Boolean);

const availableActivated = playerEquipment
  .filter(item => item?.effect && activatedEffects.includes(item.effect))
  .filter(item => !localPlayer?.usedEffects.includes(item!.effect!))
  .map(item => ({ effectId: item!.effect!, itemName: item!.name }));
```

Render as buttons alongside existing combat actions:

```tsx
{availableActivated.map(({ effectId, itemName }) => (
  <button
    key={effectId}
    onClick={() => {
      if (effectId === 'revive_once') {
        // Need to select a downed ally target
        // Use existing target selection flow
        actions.useItemEffect(effectId, selectedTargetId);
      } else {
        actions.useItemEffect(effectId);
      }
    }}
    className="action-btn effect-btn"
  >
    {itemName}
  </button>
))}
```

- [ ] **Step 4: Handle item effect narration in gameStore**

In `client/src/store/gameStore.ts`, update `handleServerMessage` for `combat_action_result` to include item effect info in log entries:

```ts
case 'combat_action_result': {
  // ...existing handling...
  if (msg.itemEffect) {
    // The server already sends narration via text_log, no extra handling needed
  }
  break;
}
```

- [ ] **Step 5: Add CSS for effect labels**

In `client/src/styles/index.css`, add:

```css
.item-effect {
  color: #b388ff;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.effect-btn {
  border-color: #b388ff;
  color: #b388ff;
}

.effect-btn:hover {
  background: rgba(179, 136, 255, 0.15);
}
```

- [ ] **Step 6: Commit**

```
feat: display item effects in UI and add activated ability buttons
```

---

