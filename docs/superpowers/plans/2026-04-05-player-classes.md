# Player Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four data-driven player classes (Vanguard, Shadowblade, Cleric, Artificer) with unique base stats, starter gear, and cooldown-based abilities.

**Architecture:** Classes are defined in JSON (`shared/src/data/classes.json`). Abilities are composed from reusable effect primitives resolved by a new `AbilityResolver` module. Passives fire via trigger hooks (`on_combat_victory`, `on_room_enter`). Cooldowns tick down 1/turn in combat and 1/room moved during exploration.

**Tech Stack:** TypeScript, Vitest, React/Zustand, WebSocket messages

---

## File Structure

**Create:**
- `shared/src/data/classes.json` — Class definitions (stats, starter item IDs, abilities with effect arrays)
- `shared/src/classTypes.ts` — TypeScript interfaces for class system (ClassDefinition, AbilityDefinition, AbilityEffect, AbilityCooldown, ActiveBuff)
- `shared/src/classData.ts` — Loads and exports class definitions, lookup helpers
- `server/src/AbilityResolver.ts` — Maps effect primitive names to handler functions, resolves ability effects
- `server/src/AbilityResolver.test.ts` — Tests for ability resolution

**Modify:**
- `shared/src/types.ts` — Add `className`, `cooldowns` to Player; `buffs` to CombatParticipant/MobInstance
- `shared/src/messages.ts` — Add `UseAbilityMessage`, `ScoutResultMessage`; modify `JoinLobbyMessage`, `LobbyStateMessage`, `CombatActionResultMessage`
- `shared/src/content.ts` — Add class-specific starter items
- `shared/src/index.ts` — Re-export new modules
- `server/src/PlayerManager.ts` — Class-aware player creation with per-class base stats and starter gear
- `server/src/CombatManager.ts` — Add `use_ability` action, buff/debuff tracking, taunt system, skip-turn support
- `server/src/GameSession.ts` — Wire up ability resolution, passive triggers, cooldown ticking on move
- `server/src/GameSession.test.ts` — Tests for class integration
- `server/src/Lobby.ts` — Track player class selection
- `server/src/index.ts` — Pass class name through join/start flow
- `client/src/store/gameStore.ts` — Handle new messages, track class data
- `client/src/hooks/useGameActions.ts` — Add `useAbility` action sender
- `client/src/components/Lobby.tsx` — Class selector UI
- `client/src/components/CombatView.tsx` — Ability buttons, buff indicators, target selection for abilities
- `client/src/components/MiniMap.tsx` — Scout drone threat indicators
- `client/src/components/PlayerHUD.tsx` — Display class name and cooldowns
- `client/src/styles/index.css` — Styles for class selector, ability buttons, buff indicators

---

### Task 1: Shared Types and Class Data

**Files:**
- Create: `shared/src/classTypes.ts`
- Create: `shared/src/data/classes.json`
- Create: `shared/src/classData.ts`
- Modify: `shared/src/types.ts:96-154`
- Modify: `shared/src/messages.ts:12-16,80-92,96-103,34-41,141-160,216-233`
- Modify: `shared/src/content.ts:1-19`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create `shared/src/classTypes.ts`**

```typescript
export interface AbilityEffect {
  type: string;
  [key: string]: unknown;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  targetType: 'none' | 'ally' | 'enemy';
  passive: boolean;
  trigger?: string;
  effects: AbilityEffect[];
}

export interface ClassDefinition {
  id: string;
  displayName: string;
  description: string;
  baseStats: { maxHp: number; damage: number; defense: number; initiative: number };
  starterWeaponId: string;
  starterOffhandId: string;
  abilities: AbilityDefinition[];
}

export interface AbilityCooldown {
  abilityId: string;
  turnsRemaining: number;
}

export interface ActiveBuff {
  type: string;
  turnsRemaining: number;
  sourcePlayerId: string;
  value?: number;
}
```

- [ ] **Step 2: Create `shared/src/data/classes.json`**

```json
[
  {
    "id": "vanguard",
    "displayName": "Vanguard",
    "description": "A stalwart defender who draws enemy attention and shields allies.",
    "baseStats": { "maxHp": 50, "damage": 5, "defense": 2, "initiative": 5 },
    "starterWeaponId": "vanguard_iron_mace",
    "starterOffhandId": "vanguard_tower_shield",
    "abilities": [
      {
        "id": "shield_wall",
        "name": "Shield Wall",
        "description": "Taunt all enemies for 2 turns. Gain +50% defense.",
        "cooldown": 3,
        "targetType": "none",
        "passive": false,
        "effects": [
          { "type": "taunt", "duration": 2 },
          { "type": "apply_buff", "buffType": "defense_multiply", "duration": 2, "value": 1.5, "target": "self" }
        ]
      },
      {
        "id": "rally",
        "name": "Rally",
        "description": "All allies gain +3 defense for 2 turns.",
        "cooldown": 4,
        "targetType": "none",
        "passive": false,
        "effects": [
          { "type": "apply_buff", "buffType": "defense_flat", "duration": 2, "value": 3, "target": "all_allies" }
        ]
      }
    ]
  },
  {
    "id": "shadowblade",
    "displayName": "Shadowblade",
    "description": "A lethal striker who hits fast and picks pockets.",
    "baseStats": { "maxHp": 35, "damage": 7, "defense": 1, "initiative": 9 },
    "starterWeaponId": "shadowblade_twin_daggers",
    "starterOffhandId": "shadowblade_smoke_cloak",
    "abilities": [
      {
        "id": "backstab",
        "name": "Backstab",
        "description": "Deal 2.5x damage, bypass target defense.",
        "cooldown": 2,
        "targetType": "enemy",
        "passive": false,
        "effects": [
          { "type": "deal_damage", "multiplier": 2.5, "ignoreDefense": true }
        ]
      },
      {
        "id": "pickpocket",
        "name": "Pickpocket",
        "description": "30% chance for extra loot after combat.",
        "cooldown": 0,
        "targetType": "none",
        "passive": true,
        "trigger": "on_combat_victory",
        "effects": [
          { "type": "extra_loot_roll", "chance": 0.3 }
        ]
      }
    ]
  },
  {
    "id": "cleric",
    "displayName": "Cleric",
    "description": "A holy healer who mends wounds and wards against death.",
    "baseStats": { "maxHp": 40, "damage": 4, "defense": 2, "initiative": 5 },
    "starterWeaponId": "cleric_blessed_staff",
    "starterOffhandId": "cleric_holy_symbol",
    "abilities": [
      {
        "id": "heal",
        "name": "Heal",
        "description": "Restore 30% of target ally's max HP.",
        "cooldown": 2,
        "targetType": "ally",
        "passive": false,
        "effects": [
          { "type": "heal", "percentMaxHp": 0.3 }
        ]
      },
      {
        "id": "blessed_ward",
        "name": "Blessed Ward",
        "description": "Target ally cannot be downed for 1 turn.",
        "cooldown": 4,
        "targetType": "ally",
        "passive": false,
        "effects": [
          { "type": "prevent_down", "duration": 1 }
        ]
      }
    ]
  },
  {
    "id": "artificer",
    "displayName": "Artificer",
    "description": "A cunning inventor who disrupts enemies and scouts ahead.",
    "baseStats": { "maxHp": 35, "damage": 5, "defense": 1, "initiative": 7 },
    "starterWeaponId": "artificer_repeating_crossbow",
    "starterOffhandId": "artificer_toolkit",
    "abilities": [
      {
        "id": "smoke_bomb",
        "name": "Smoke Bomb",
        "description": "All enemies skip their next turn.",
        "cooldown": 3,
        "targetType": "none",
        "passive": false,
        "effects": [
          { "type": "skip_turn", "duration": 1, "targets": "all_enemies" }
        ]
      },
      {
        "id": "scout_drone",
        "name": "Scout Drone",
        "description": "Detect enemies in adjacent rooms.",
        "cooldown": 0,
        "targetType": "none",
        "passive": true,
        "trigger": "on_room_enter",
        "effects": [
          { "type": "scout_adjacent" }
        ]
      }
    ]
  }
]
```

- [ ] **Step 3: Create `shared/src/classData.ts`**

```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { ClassDefinition } from './classTypes.js';

// For server-side use (loads from JSON file)
let _classes: ClassDefinition[] | null = null;

export function loadClasses(): ClassDefinition[] {
  if (_classes) return _classes;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fullPath = resolve(__dirname, 'data/classes.json');
  _classes = JSON.parse(readFileSync(fullPath, 'utf-8')) as ClassDefinition[];
  return _classes;
}

// Inline copy for client-side (no fs access) — imported at build time
import classesJson from './data/classes.json';
export const CLASS_DEFINITIONS: ClassDefinition[] = classesJson as ClassDefinition[];

export function getClassDefinition(className: string): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find(c => c.id === className);
}

export function getDefaultClassName(): string {
  return 'vanguard';
}
```

Note: The dual-loading approach (fs for server tests, JSON import for client) follows the same pattern used by `ProceduralGenerator.ts`. If the bundler can resolve JSON imports, use `CLASS_DEFINITIONS` directly. Otherwise fall back to `loadClasses()`.

- [ ] **Step 4: Add class-specific starter items to `shared/src/content.ts`**

Add after the existing `STARTER_POTION` (line 19):

```typescript
import type { Item } from './types.js';

export const CLASS_STARTER_ITEMS: Record<string, { weapon: Item; offhand: Item }> = {
  vanguard: {
    weapon: {
      id: 'vanguard_iron_mace', name: 'Iron Mace',
      description: 'A heavy flanged mace. Reliable and brutal.',
      rarity: 'common', slot: 'weapon', stats: { damage: 2 },
    },
    offhand: {
      id: 'vanguard_tower_shield', name: 'Tower Shield',
      description: 'A tall shield of banded oak and iron.',
      rarity: 'common', slot: 'offhand', stats: { defense: 3 },
    },
  },
  shadowblade: {
    weapon: {
      id: 'shadowblade_twin_daggers', name: 'Twin Daggers',
      description: 'A matched pair of razor-sharp blades.',
      rarity: 'common', slot: 'weapon', stats: { damage: 3, initiative: 2 },
    },
    offhand: {
      id: 'shadowblade_smoke_cloak', name: 'Smoke Cloak',
      description: 'A dark cloak woven with alchemical fibers.',
      rarity: 'common', slot: 'offhand', stats: { defense: 1 },
    },
  },
  cleric: {
    weapon: {
      id: 'cleric_blessed_staff', name: 'Blessed Staff',
      description: 'A staff inscribed with protective glyphs.',
      rarity: 'common', slot: 'weapon', stats: { damage: 2, initiative: 1 },
    },
    offhand: {
      id: 'cleric_holy_symbol', name: 'Holy Symbol',
      description: 'A silver pendant radiating faint warmth.',
      rarity: 'common', slot: 'offhand', stats: { defense: 2 },
    },
  },
  artificer: {
    weapon: {
      id: 'artificer_repeating_crossbow', name: 'Repeating Crossbow',
      description: 'A compact crossbow with a mechanical reload mechanism.',
      rarity: 'common', slot: 'weapon', stats: { damage: 3 },
    },
    offhand: {
      id: 'artificer_toolkit', name: 'Toolkit',
      description: 'A leather case of springs, gears, and small explosives.',
      rarity: 'common', slot: 'offhand', stats: { defense: 1, initiative: 2 },
    },
  },
};
```

- [ ] **Step 5: Modify `shared/src/types.ts` — Add class fields to Player**

In the `Player` interface (line 96-107), add `className` and `cooldowns`:

```typescript
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
}
```

Add the import at the top of types.ts:
```typescript
import type { AbilityCooldown, ActiveBuff } from './classTypes.js';
```

Update `createPlayer` (line 141-154) to accept className:

```typescript
export function createPlayer(id: string, name: string, roomId: string, className: string = 'vanguard'): Player {
  return {
    id,
    name,
    className,
    maxHp: BASE_STATS.maxHp,
    hp: BASE_STATS.maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    inventory: Array(INVENTORY_SLOTS).fill(null),
    status: 'exploring',
    keychain: [],
    cooldowns: [],
  };
}
```

Update `computePlayerStats` (line 123-139) to use class base stats instead of `BASE_STATS`:

```typescript
import { getClassDefinition } from './classData.js';

export function computePlayerStats(player: Player): ComputedStats {
  const classDef = getClassDefinition(player.className);
  const base = classDef?.baseStats ?? BASE_STATS;
  const stats: ComputedStats = { ...base };
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (!item) continue;
    stats.damage += item.stats.damage ?? 0;
    stats.defense += item.stats.defense ?? 0;
    stats.maxHp += item.stats.maxHp ?? 0;
    stats.initiative += item.stats.initiative ?? 0;
  }
  return stats;
}
```

Add `buffs` to `CombatParticipant` (line 157-164):

```typescript
export interface CombatParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  className?: string;
  buffs?: ActiveBuff[];
  cooldowns?: AbilityCooldown[];
}
```

- [ ] **Step 6: Modify `shared/src/messages.ts` — Add class-related messages**

Update `JoinLobbyMessage` (line 12-16):

```typescript
export interface JoinLobbyMessage {
  type: 'join_lobby';
  playerName: string;
  roomCode?: string;
  className?: string;
}
```

Update `LobbyStateMessage` (line 96-103):

```typescript
export interface LobbyStateMessage {
  type: 'lobby_state';
  players: { id: string; name: string; className: string }[];
  hostId: string;
  yourId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  roomCode: string;
}
```

Update `CombatActionMessage` (line 34-41) to add `use_ability`:

```typescript
export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
  critMultiplier?: number;
  abilityId?: string;
}
```

Update `CombatActionResultMessage` (line 141-160) to add ability fields:

```typescript
export interface CombatActionResultMessage {
  type: 'combat_action_result';
  actorId: string;
  actorName: string;
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability';
  targetId?: string;
  targetName?: string;
  damage?: number;
  healing?: number;
  actorHp?: number;
  targetHp?: number;
  targetMaxHp?: number;
  actorDowned?: boolean;
  targetDowned?: boolean;
  fled?: boolean;
  fleeDirection?: Direction;
  critMultiplier?: number;
  defendQte?: true;
  pendingDamage?: number;
  abilityId?: string;
  abilityName?: string;
  buffsApplied?: string[];
}
```

Add new `ScoutResultMessage`:

```typescript
export interface ScoutResultMessage {
  type: 'scout_result';
  roomId: string;
  adjacentThreats: Partial<Record<Direction, boolean>>;
}
```

Add `ScoutResultMessage` to the `ServerMessage` union.

- [ ] **Step 7: Update `shared/src/index.ts`**

```typescript
export * from './types.js';
export * from './messages.js';
export * from './content.js';
export * from './qteConfig.js';
export * from './data/types.js';
export * from './classTypes.js';
export * from './classData.js';
```

- [ ] **Step 8: Run tests to verify shared types compile**

Run: `npx vitest run shared/`
Expected: All shared tests pass (types.test.ts and content.test.ts may need minor updates if they reference `createPlayer` without className).

- [ ] **Step 9: Commit**

```
feat: add shared class types, definitions, and starter items
```

---

### Task 2: AbilityResolver — Effect Primitive Engine

**Files:**
- Create: `server/src/AbilityResolver.ts`
- Create: `server/src/AbilityResolver.test.ts`

- [ ] **Step 1: Write the failing tests for AbilityResolver**

```typescript
import { describe, it, expect } from 'vitest';
import { AbilityResolver } from './AbilityResolver.js';
import type { AbilityEffect, ActiveBuff } from '@caverns/shared';

describe('AbilityResolver', () => {
  const resolver = new AbilityResolver();

  function makeParticipant(overrides: Partial<{
    id: string; type: 'player' | 'mob'; name: string;
    hp: number; maxHp: number; damage: number; defense: number;
    alive: boolean; buffs: ActiveBuff[];
  }> = {}) {
    return {
      id: overrides.id ?? 'p1',
      type: overrides.type ?? 'player' as const,
      name: overrides.name ?? 'Alice',
      hp: overrides.hp ?? 50,
      maxHp: overrides.maxHp ?? 50,
      damage: overrides.damage ?? 10,
      defense: overrides.defense ?? 2,
      alive: overrides.alive ?? true,
      buffs: overrides.buffs ?? [],
    };
  }

  describe('deal_damage', () => {
    it('deals multiplied damage ignoring defense', () => {
      const caster = makeParticipant({ id: 'p1', damage: 10 });
      const target = makeParticipant({ id: 'mob1', type: 'mob', defense: 5, hp: 50, maxHp: 50 });
      const effect: AbilityEffect = { type: 'deal_damage', multiplier: 2.5, ignoreDefense: true };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.damage).toBe(25); // 10 * 2.5, defense ignored
      expect(target.hp).toBe(25);
    });

    it('applies defense when ignoreDefense is false', () => {
      const caster = makeParticipant({ id: 'p1', damage: 10 });
      const target = makeParticipant({ id: 'mob1', type: 'mob', defense: 3, hp: 50, maxHp: 50 });
      const effect: AbilityEffect = { type: 'deal_damage', multiplier: 2.0, ignoreDefense: false };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.damage).toBe(14); // (10 - 3) * 2.0
    });
  });

  describe('heal', () => {
    it('heals percentage of max hp', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', hp: 20, maxHp: 50 });
      const effect: AbilityEffect = { type: 'heal', percentMaxHp: 0.3 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.healing).toBe(15); // 50 * 0.3
      expect(target.hp).toBe(35);
    });

    it('does not overheal', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', hp: 45, maxHp: 50 });
      const effect: AbilityEffect = { type: 'heal', percentMaxHp: 0.3 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(result.healing).toBe(5);
      expect(target.hp).toBe(50);
    });
  });

  describe('apply_buff', () => {
    it('applies a flat defense buff to self', () => {
      const caster = makeParticipant({ id: 'p1', buffs: [] });
      const effect: AbilityEffect = { type: 'apply_buff', buffType: 'defense_flat', duration: 2, value: 3, target: 'self' };
      const result = resolver.resolveEffect(effect, caster, null, [caster]);
      expect(result.buffsApplied).toContain('defense_flat');
      expect(caster.buffs).toHaveLength(1);
      expect(caster.buffs[0]).toEqual({ type: 'defense_flat', turnsRemaining: 2, sourcePlayerId: 'p1', value: 3 });
    });

    it('applies buff to all allies', () => {
      const p1 = makeParticipant({ id: 'p1', buffs: [] });
      const p2 = makeParticipant({ id: 'p2', buffs: [] });
      const mob = makeParticipant({ id: 'mob1', type: 'mob', buffs: [] });
      const effect: AbilityEffect = { type: 'apply_buff', buffType: 'defense_flat', duration: 2, value: 3, target: 'all_allies' };
      resolver.resolveEffect(effect, p1, null, [p1, p2, mob]);
      expect(p1.buffs).toHaveLength(1);
      expect(p2.buffs).toHaveLength(1);
      expect(mob.buffs).toHaveLength(0);
    });
  });

  describe('taunt', () => {
    it('applies taunt buff to caster', () => {
      const caster = makeParticipant({ id: 'p1', buffs: [] });
      const effect: AbilityEffect = { type: 'taunt', duration: 2 };
      const result = resolver.resolveEffect(effect, caster, null, [caster]);
      expect(result.buffsApplied).toContain('taunt');
      expect(caster.buffs).toHaveLength(1);
      expect(caster.buffs[0].type).toBe('taunt');
    });
  });

  describe('skip_turn', () => {
    it('applies skip_turn debuff to all enemies', () => {
      const caster = makeParticipant({ id: 'p1' });
      const mob1 = makeParticipant({ id: 'mob1', type: 'mob', buffs: [] });
      const mob2 = makeParticipant({ id: 'mob2', type: 'mob', buffs: [] });
      const effect: AbilityEffect = { type: 'skip_turn', duration: 1, targets: 'all_enemies' };
      resolver.resolveEffect(effect, caster, null, [caster, mob1, mob2]);
      expect(mob1.buffs).toHaveLength(1);
      expect(mob1.buffs[0].type).toBe('skip_turn');
      expect(mob2.buffs).toHaveLength(1);
    });
  });

  describe('prevent_down', () => {
    it('applies prevent_down buff to target', () => {
      const caster = makeParticipant({ id: 'p1' });
      const target = makeParticipant({ id: 'p2', buffs: [] });
      const effect: AbilityEffect = { type: 'prevent_down', duration: 1 };
      const result = resolver.resolveEffect(effect, caster, target, [caster, target]);
      expect(target.buffs).toHaveLength(1);
      expect(target.buffs[0].type).toBe('prevent_down');
    });
  });

  describe('tickBuffs', () => {
    it('decrements buff durations and removes expired', () => {
      const participant = makeParticipant({
        id: 'p1',
        buffs: [
          { type: 'defense_flat', turnsRemaining: 1, sourcePlayerId: 'p1', value: 3 },
          { type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' },
        ],
      });
      resolver.tickBuffs(participant);
      expect(participant.buffs).toHaveLength(1);
      expect(participant.buffs[0].type).toBe('taunt');
      expect(participant.buffs[0].turnsRemaining).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/AbilityResolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AbilityResolver**

```typescript
import type { AbilityEffect, ActiveBuff } from '@caverns/shared';

export interface ResolverParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  alive: boolean;
  buffs: ActiveBuff[];
}

export interface EffectResult {
  damage?: number;
  healing?: number;
  buffsApplied?: string[];
  targetDowned?: boolean;
}

type EffectHandler = (
  effect: AbilityEffect,
  caster: ResolverParticipant,
  target: ResolverParticipant | null,
  allParticipants: ResolverParticipant[],
) => EffectResult;

export class AbilityResolver {
  private handlers = new Map<string, EffectHandler>();

  constructor() {
    this.handlers.set('deal_damage', this.handleDealDamage.bind(this));
    this.handlers.set('heal', this.handleHeal.bind(this));
    this.handlers.set('apply_buff', this.handleApplyBuff.bind(this));
    this.handlers.set('taunt', this.handleTaunt.bind(this));
    this.handlers.set('skip_turn', this.handleSkipTurn.bind(this));
    this.handlers.set('prevent_down', this.handlePreventDown.bind(this));
  }

  resolveEffect(
    effect: AbilityEffect,
    caster: ResolverParticipant,
    target: ResolverParticipant | null,
    allParticipants: ResolverParticipant[],
  ): EffectResult {
    const handler = this.handlers.get(effect.type);
    if (!handler) return {};
    return handler(effect, caster, target, allParticipants);
  }

  resolveAllEffects(
    effects: AbilityEffect[],
    caster: ResolverParticipant,
    target: ResolverParticipant | null,
    allParticipants: ResolverParticipant[],
  ): EffectResult {
    const combined: EffectResult = {};
    for (const effect of effects) {
      const result = this.resolveEffect(effect, caster, target, allParticipants);
      if (result.damage) combined.damage = (combined.damage ?? 0) + result.damage;
      if (result.healing) combined.healing = (combined.healing ?? 0) + result.healing;
      if (result.buffsApplied) {
        combined.buffsApplied = [...(combined.buffsApplied ?? []), ...result.buffsApplied];
      }
      if (result.targetDowned) combined.targetDowned = true;
    }
    return combined;
  }

  tickBuffs(participant: ResolverParticipant): void {
    participant.buffs = participant.buffs
      .map(b => ({ ...b, turnsRemaining: b.turnsRemaining - 1 }))
      .filter(b => b.turnsRemaining > 0);
  }

  getBuffValue(participant: ResolverParticipant, buffType: string): number {
    return participant.buffs
      .filter(b => b.type === buffType)
      .reduce((sum, b) => sum + (b.value ?? 0), 0);
  }

  hasBuff(participant: ResolverParticipant, buffType: string): boolean {
    return participant.buffs.some(b => b.type === buffType);
  }

  private handleDealDamage(
    effect: AbilityEffect, caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const multiplier = (effect.multiplier as number) ?? 1.0;
    const ignoreDefense = (effect.ignoreDefense as boolean) ?? false;
    const defense = ignoreDefense ? 0 : target.defense;
    const damage = Math.max(1, Math.floor((caster.damage - defense) * multiplier));
    target.hp = Math.max(0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    return { damage, targetDowned };
  }

  private handleHeal(
    effect: AbilityEffect, _caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const percent = (effect.percentMaxHp as number) ?? 0;
    const amount = Math.floor(target.maxHp * percent);
    const healed = Math.min(amount, target.maxHp - target.hp);
    target.hp += healed;
    return { healing: healed };
  }

  private handleApplyBuff(
    effect: AbilityEffect, caster: ResolverParticipant,
    _target: ResolverParticipant | null, allParticipants: ResolverParticipant[],
  ): EffectResult {
    const buffType = effect.buffType as string;
    const duration = (effect.duration as number) ?? 1;
    const value = effect.value as number | undefined;
    const targetScope = (effect.target as string) ?? 'self';
    const buff: ActiveBuff = { type: buffType, turnsRemaining: duration, sourcePlayerId: caster.id, value };

    const targets = this.resolveTargets(targetScope, caster, allParticipants);
    for (const t of targets) {
      // Replace existing buff of same type from same source (refresh)
      t.buffs = t.buffs.filter(b => !(b.type === buffType && b.sourcePlayerId === caster.id));
      t.buffs.push({ ...buff });
    }
    return { buffsApplied: [buffType] };
  }

  private handleTaunt(
    effect: AbilityEffect, caster: ResolverParticipant,
  ): EffectResult {
    const duration = (effect.duration as number) ?? 1;
    caster.buffs = caster.buffs.filter(b => b.type !== 'taunt');
    caster.buffs.push({ type: 'taunt', turnsRemaining: duration, sourcePlayerId: caster.id });
    return { buffsApplied: ['taunt'] };
  }

  private handleSkipTurn(
    effect: AbilityEffect, caster: ResolverParticipant,
    _target: ResolverParticipant | null, allParticipants: ResolverParticipant[],
  ): EffectResult {
    const duration = (effect.duration as number) ?? 1;
    const targetScope = (effect.targets as string) ?? 'all_enemies';
    const targets = this.resolveTargets(targetScope, caster, allParticipants);
    for (const t of targets) {
      t.buffs = t.buffs.filter(b => b.type !== 'skip_turn');
      t.buffs.push({ type: 'skip_turn', turnsRemaining: duration, sourcePlayerId: caster.id });
    }
    return { buffsApplied: ['skip_turn'] };
  }

  private handlePreventDown(
    effect: AbilityEffect, caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const duration = (effect.duration as number) ?? 1;
    target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    target.buffs.push({ type: 'prevent_down', turnsRemaining: duration, sourcePlayerId: caster.id });
    return { buffsApplied: ['prevent_down'] };
  }

  private resolveTargets(
    scope: string, caster: ResolverParticipant, allParticipants: ResolverParticipant[],
  ): ResolverParticipant[] {
    switch (scope) {
      case 'self': return [caster];
      case 'all_allies': return allParticipants.filter(p => p.type === caster.type && p.alive);
      case 'all_enemies': return allParticipants.filter(p => p.type !== caster.type && p.alive);
      default: return [caster];
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/AbilityResolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
feat: add AbilityResolver with effect primitive handlers
```

---

### Task 3: Server — PlayerManager Class Support

**Files:**
- Modify: `server/src/PlayerManager.ts:1-24,38-41,166-177`
- Modify: `server/src/PlayerManager.test.ts`

- [ ] **Step 1: Update PlayerManager imports and `addPlayer`**

Replace imports (line 1-12):

```typescript
import {
  type Player,
  type Item,
  type ComputedStats,
  type EquipmentSlot,
  createPlayer,
  computePlayerStats,
  STARTER_POTION,
  CONSUMABLE_SLOTS,
  INVENTORY_SLOTS,
  CLASS_STARTER_ITEMS,
  getClassDefinition,
} from '@caverns/shared';
```

Replace `addPlayer` method (line 17-24):

```typescript
  addPlayer(id: string, name: string, roomId: string, className: string = 'vanguard'): Player {
    const classDef = getClassDefinition(className);
    const player = createPlayer(id, name, roomId, className);

    // Apply class base stats
    if (classDef) {
      player.maxHp = classDef.baseStats.maxHp;
      player.hp = classDef.baseStats.maxHp;
    }

    // Equip class-specific starter gear
    const starterItems = CLASS_STARTER_ITEMS[className];
    if (starterItems) {
      player.equipment.weapon = { ...starterItems.weapon };
      player.equipment.offhand = { ...starterItems.offhand };
    }

    // Initialize ability cooldowns (all start at 0 = ready)
    if (classDef) {
      player.cooldowns = classDef.abilities
        .filter(a => !a.passive)
        .map(a => ({ abilityId: a.id, turnsRemaining: 0 }));
    }

    player.consumables[0] = { ...STARTER_POTION };
    player.consumables[1] = { ...STARTER_POTION };
    this.players.set(id, player);
    return player;
  }
```

- [ ] **Step 2: Add cooldown management methods**

Add to the PlayerManager class:

```typescript
  tickCooldowns(playerId: string, amount: number = 1): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.cooldowns = player.cooldowns.map(cd => ({
      ...cd,
      turnsRemaining: Math.max(0, cd.turnsRemaining - amount),
    }));
  }

  setCooldown(playerId: string, abilityId: string, turns: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const cd = player.cooldowns.find(c => c.abilityId === abilityId);
    if (cd) cd.turnsRemaining = turns;
  }

  isAbilityReady(playerId: string, abilityId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const cd = player.cooldowns.find(c => c.abilityId === abilityId);
    return cd ? cd.turnsRemaining === 0 : false;
  }
```

- [ ] **Step 3: Update PlayerManager tests**

Update existing `addPlayer` calls in `server/src/PlayerManager.test.ts` to verify class-based creation. Add new tests:

```typescript
  it('creates player with class-specific base stats', () => {
    const pm = new PlayerManager();
    const player = pm.addPlayer('p1', 'Alice', 'room1', 'shadowblade');
    expect(player.className).toBe('shadowblade');
    expect(player.maxHp).toBe(35);
    expect(player.hp).toBe(35);
    expect(player.equipment.weapon?.id).toBe('shadowblade_twin_daggers');
    expect(player.equipment.offhand?.id).toBe('shadowblade_smoke_cloak');
  });

  it('initializes ability cooldowns at 0', () => {
    const pm = new PlayerManager();
    const player = pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    expect(player.cooldowns).toHaveLength(2);
    expect(player.cooldowns.every(c => c.turnsRemaining === 0)).toBe(true);
  });

  it('ticks cooldowns down', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.setCooldown('p1', 'shield_wall', 3);
    pm.tickCooldowns('p1');
    const player = pm.getPlayer('p1')!;
    expect(player.cooldowns.find(c => c.abilityId === 'shield_wall')!.turnsRemaining).toBe(2);
  });

  it('does not tick cooldowns below 0', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.tickCooldowns('p1');
    const player = pm.getPlayer('p1')!;
    expect(player.cooldowns.every(c => c.turnsRemaining === 0)).toBe(true);
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/src/PlayerManager.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```
feat: class-aware PlayerManager with starter gear and cooldowns
```

---

### Task 4: CombatManager — Abilities, Buffs, and Taunt

**Files:**
- Modify: `server/src/CombatManager.ts`
- Modify: `server/src/CombatManager.test.ts`

- [ ] **Step 1: Add buff tracking to InternalParticipant**

Update `InternalParticipant` (line 19-30):

```typescript
interface InternalParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  isDefending: boolean;
  alive: boolean;
  className?: string;
  buffs: ActiveBuff[];
}
```

Update constructor to initialize buffs on all participants:

```typescript
// In player loop:
buffs: [],
// In mob loop:
buffs: [],
```

Update `CombatPlayerInfo` to include className:

```typescript
export interface CombatPlayerInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  className?: string;
}
```

- [ ] **Step 2: Add `use_ability` to resolvePlayerAction**

Update the `action` type in the method signature (line 92-94):

```typescript
  resolvePlayerAction(playerId: string, action: {
    action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability';
    targetId?: string; itemDamage?: number; itemHealing?: number; fleeDirection?: Direction;
    critMultiplier?: number; abilityId?: string;
  }): Partial<CombatActionResultMessage> | null {
```

Add the `use_ability` case before the closing brace of the switch:

```typescript
      case 'use_ability': {
        // Ability resolution is handled by GameSession via AbilityResolver
        // CombatManager just validates turn and returns the actor info
        return {
          actorId: playerId, actorName: actor.name, action: 'use_ability',
          abilityId: action.abilityId,
        };
      }
```

- [ ] **Step 3: Update mob targeting to respect taunt buff**

Replace the taunt logic in `resolveMobTurn` (line 164-178) to check buffs instead of the old `tauntedBy` map:

```typescript
  resolveMobTurn(mobId: string): Partial<CombatActionResultMessage> | null {
    const mob = this.participants.get(mobId);
    if (!mob || !mob.alive || mob.type !== 'mob') return null;

    // Check if mob should skip turn (smoke bomb)
    if (mob.buffs.some(b => b.type === 'skip_turn')) {
      mob.buffs = mob.buffs.filter(b => b.type !== 'skip_turn');
      return { actorId: mobId, actorName: mob.name, action: 'defend' };
    }

    const alivePlayers = Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive);
    if (alivePlayers.length === 0) return null;

    // Check for taunting player
    const taunter = alivePlayers.find(p => p.buffs.some(b => b.type === 'taunt'));
    let target: InternalParticipant;
    if (taunter) {
      target = taunter;
    } else {
      target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    }

    // Apply defense buffs
    const bonusDefense = target.buffs
      .filter(b => b.type === 'defense_flat')
      .reduce((sum, b) => sum + (b.value ?? 0), 0);
    const defenseMultiplier = target.buffs
      .filter(b => b.type === 'defense_multiply')
      .reduce((mult, b) => mult * (b.value ?? 1), 1);
    const effectiveDefense = target.isDefending
      ? Math.floor((target.defense + bonusDefense) * defenseMultiplier * 2)
      : Math.floor((target.defense + bonusDefense) * defenseMultiplier);

    const rawDamage = Math.max(1, mob.damage - effectiveDefense);

    if (target.isDefending) {
      return {
        actorId: mobId, actorName: mob.name, action: 'attack',
        targetId: target.id, targetName: target.name,
        pendingDamage: rawDamage, defendQte: true,
        targetHp: target.hp, targetMaxHp: target.maxHp,
      };
    }

    // Check prevent_down
    const hasPreventDown = target.buffs.some(b => b.type === 'prevent_down');
    target.hp = Math.max(hasPreventDown ? 1 : 0, target.hp - rawDamage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    if (hasPreventDown && target.hp === 1) {
      target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    }

    return {
      actorId: mobId, actorName: mob.name, action: 'attack',
      targetId: target.id, targetName: target.name, damage: rawDamage,
      targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
    };
  }
```

- [ ] **Step 4: Add buff tick on round change**

In `rollInitiativeOrder` (line 61-66), add buff ticking:

```typescript
  private rollInitiativeOrder(): void {
    // Tick buffs for all alive participants at round start
    for (const p of this.participants.values()) {
      if (p.alive) {
        p.buffs = p.buffs
          .map(b => ({ ...b, turnsRemaining: b.turnsRemaining - 1 }))
          .filter(b => b.turnsRemaining > 0);
      }
    }

    const alive = Array.from(this.participants.values()).filter((p) => p.alive);
    alive.sort((a, b) => b.initiative + Math.random() * 5 - (a.initiative + Math.random() * 5));
    this.turnOrder = alive.map((p) => p.id);
    this.turnIndex = 0;
  }
```

- [ ] **Step 5: Update getState to include buffs and className**

```typescript
  getState(): CombatState {
    const participants: CombatParticipant[] = Array.from(this.participants.values())
      .filter((p) => p.alive)
      .map((p) => ({
        id: p.id, type: p.type, name: p.name, hp: p.hp, maxHp: p.maxHp, initiative: p.initiative,
        className: p.className,
        buffs: p.buffs.length > 0 ? [...p.buffs] : undefined,
      }));
    return {
      roomId: this.roomId, participants,
      turnOrder: this.turnOrder.filter((id) => this.participants.get(id)?.alive),
      currentTurnId: this.getCurrentTurnId(), roundNumber: this.roundNumber,
    };
  }
```

- [ ] **Step 6: Add a method to apply damage/healing externally (for AbilityResolver integration)**

```typescript
  applyDamage(targetId: string, damage: number): { targetDowned: boolean; newHp: number } | null {
    const target = this.participants.get(targetId);
    if (!target || !target.alive) return null;
    const hasPreventDown = target.buffs.some(b => b.type === 'prevent_down');
    target.hp = Math.max(hasPreventDown ? 1 : 0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    if (hasPreventDown && target.hp === 1) {
      target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    }
    return { targetDowned, newHp: target.hp };
  }

  applyHealing(targetId: string, healing: number): number {
    const target = this.participants.get(targetId);
    if (!target || !target.alive) return 0;
    const healed = Math.min(healing, target.maxHp - target.hp);
    target.hp += healed;
    return healed;
  }

  getParticipant(id: string) {
    return this.participants.get(id) ?? null;
  }

  getParticipantsArray(): Array<{
    id: string; type: 'player' | 'mob'; name: string;
    hp: number; maxHp: number; damage: number; defense: number;
    alive: boolean; buffs: ActiveBuff[];
  }> {
    return Array.from(this.participants.values());
  }
```

- [ ] **Step 7: Remove old `tauntedBy` map**

Remove the `private tauntedBy` declaration (line 38) and all references to it (the defend case's taunting logic in `resolvePlayerAction`). Taunt is now handled via buffs.

Update the `defend` case (line 118-126) to remove the old taunt-on-defend behavior:

```typescript
      case 'defend': {
        actor.isDefending = true;
        return { actorId: playerId, actorName: actor.name, action: 'defend' };
      }
```

- [ ] **Step 8: Write CombatManager tests for new features**

```typescript
  it('mob skips turn when smoke bombed', () => {
    const players = [{ id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    // Manually add skip_turn buff to mob
    const mob = cm.getParticipant('mob1_inst')!;
    mob.buffs.push({ type: 'skip_turn', turnsRemaining: 1, sourcePlayerId: 'p1' });
    const result = cm.resolveMobTurn('mob1_inst');
    expect(result!.action).toBe('defend'); // skipped
    expect(mob.buffs.filter(b => b.type === 'skip_turn')).toHaveLength(0);
  });

  it('mob targets taunting player', () => {
    const players = [
      { id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 10 },
      { id: 'p2', name: 'Bob', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 5 },
    ];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const p1 = cm.getParticipant('p1')!;
    p1.buffs.push({ type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' });
    const result = cm.resolveMobTurn('mob1_inst');
    expect(result!.targetId).toBe('p1');
  });

  it('prevent_down keeps target at 1 HP', () => {
    const players = [{ id: 'p1', name: 'Alice', hp: 5, maxHp: 50, damage: 10, defense: 0, initiative: 10 }];
    const mobs = [makeMob()];
    const cm = new CombatManager('room1', players, mobs);
    const p1 = cm.getParticipant('p1')!;
    p1.buffs.push({ type: 'prevent_down', turnsRemaining: 1, sourcePlayerId: 'p1' });
    const dmgResult = cm.applyDamage('p1', 50);
    expect(dmgResult!.targetDowned).toBe(false);
    expect(dmgResult!.newHp).toBe(1);
  });
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run server/src/CombatManager.test.ts`
Expected: All PASS

- [ ] **Step 10: Commit**

```
feat: CombatManager supports abilities, buffs, taunt, and skip turn
```

---

### Task 5: Server — GameSession Ability Integration

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/GameSession.test.ts`

- [ ] **Step 1: Add AbilityResolver and class-aware player creation**

Add imports:
```typescript
import { AbilityResolver } from './AbilityResolver.js';
import { getClassDefinition, CLASS_DEFINITIONS } from '@caverns/shared';
```

Add to class fields:
```typescript
  private abilityResolver = new AbilityResolver();
  private playerClasses = new Map<string, string>(); // playerId -> className
```

Update `addPlayer` to accept className:
```typescript
  addPlayer(id: string, name: string, className: string = 'vanguard'): void {
    this.playerIds.push(id);
    this.playerNames.set(id, name);
    this.playerClasses.set(id, className);
  }
```

Update `startGame` — pass className to PlayerManager:
```typescript
  startGame(): void {
    this.started = true;
    const entranceId = this.content.entranceRoomId;
    for (const pid of this.playerIds) {
      const className = this.playerClasses.get(pid) ?? 'vanguard';
      this.playerManager.addPlayer(pid, this.playerNames.get(pid)!, entranceId, className);
    }
    // ... rest unchanged
  }
```

- [ ] **Step 2: Add handleUseAbility method**

```typescript
  handleUseAbility(playerId: string, abilityId: string, targetId?: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;

    const combat = this.combats.get(player.roomId);
    if (!combat || combat.getCurrentTurnId() !== playerId) return;

    const classDef = getClassDefinition(player.className);
    if (!classDef) return;

    const ability = classDef.abilities.find(a => a.id === abilityId && !a.passive);
    if (!ability) return;

    if (!this.playerManager.isAbilityReady(playerId, abilityId)) {
      this.sendTo(playerId, { type: 'error', message: `${ability.name} is on cooldown.` });
      return;
    }

    // Resolve ability effects through AbilityResolver
    const participants = combat.getParticipantsArray();
    const caster = participants.find(p => p.id === playerId);
    const target = targetId ? participants.find(p => p.id === targetId) : null;
    if (!caster) return;

    const result = this.abilityResolver.resolveAllEffects(ability.effects, caster, target ?? null, participants);

    // Apply damage/healing to CombatManager
    if (result.damage && targetId) {
      combat.applyDamage(targetId, result.damage);
    }
    if (result.healing && targetId) {
      combat.applyHealing(targetId, result.healing);
    }

    // Set cooldown
    this.playerManager.setCooldown(playerId, abilityId, ability.cooldown);

    // Broadcast result
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

    // Narrate
    this.narrateAbility(player.roomId, player.name, ability.name, targetParticipant?.name, result);

    // Sync player update (cooldowns changed)
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });

    combat.advanceTurn();
    this.afterCombatTurn(player.roomId, combat);
  }

  private narrateAbility(
    roomId: string, actorName: string, abilityName: string,
    targetName: string | undefined, result: { damage?: number; healing?: number; buffsApplied?: string[] },
  ): void {
    let message: string;
    if (result.damage) {
      message = `${actorName} uses ${abilityName} on ${targetName} for ${result.damage} damage!`;
    } else if (result.healing) {
      message = `${actorName} uses ${abilityName} on ${targetName}, restoring ${result.healing} HP!`;
    } else if (result.buffsApplied && result.buffsApplied.length > 0) {
      message = `${actorName} uses ${abilityName}!`;
    } else {
      message = `${actorName} uses ${abilityName}!`;
    }
    this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }
```

- [ ] **Step 3: Add cooldown ticking on move**

In `handleMove`, after `this.playerManager.movePlayer(playerId, targetRoomId)` (line 179), add:

```typescript
    this.playerManager.tickCooldowns(playerId);
```

- [ ] **Step 4: Add passive trigger hooks**

After the puzzle check in `handleMove` (around line 210), add scout drone trigger:

```typescript
    // Fire on_room_enter passive triggers
    this.firePassiveTrigger(playerId, 'on_room_enter', targetRoomId);
```

Add the passive trigger method:

```typescript
  private firePassiveTrigger(playerId: string, trigger: string, roomId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    const classDef = getClassDefinition(player.className);
    if (!classDef) return;

    for (const ability of classDef.abilities) {
      if (!ability.passive || ability.trigger !== trigger) continue;

      for (const effect of ability.effects) {
        if (effect.type === 'scout_adjacent') {
          this.handleScoutAdjacent(playerId, roomId);
        }
      }
    }
  }

  private handleScoutAdjacent(playerId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const threats: Partial<Record<Direction, boolean>> = {};
    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (!targetId) continue;
      const adjacentRoom = this.rooms.get(targetId);
      if (adjacentRoom) {
        threats[dir as Direction] = !!adjacentRoom.encounter;
      }
    }
    this.sendTo(playerId, { type: 'scout_result' as any, roomId, adjacentThreats: threats });
  }
```

In `finishCombat`, before `this.dropLoot(roomId)`, add pickpocket trigger:

```typescript
      // Fire on_combat_victory passives (e.g., Pickpocket)
      this.fireVictoryPassives(roomId);
```

```typescript
  private fireVictoryPassives(roomId: string): void {
    const playersInRoom = this.playerManager.getPlayersInRoom(roomId)
      .filter(p => p.status !== 'downed');

    // Find first player with on_combat_victory passive (initiative order)
    for (const player of playersInRoom) {
      const classDef = getClassDefinition(player.className);
      if (!classDef) continue;

      for (const ability of classDef.abilities) {
        if (!ability.passive || ability.trigger !== 'on_combat_victory') continue;

        for (const effect of ability.effects) {
          if (effect.type === 'extra_loot_roll') {
            const chance = (effect.chance as number) ?? 0;
            if (Math.random() < chance) {
              this.handleExtraLootRoll(roomId);
              this.broadcastToRoom(roomId, {
                type: 'text_log',
                message: `${player.name}'s quick fingers find extra loot!`,
                logType: 'loot',
              });
            }
            return; // Only one pickpocket roll per combat
          }
        }
      }
    }
  }

  private handleExtraLootRoll(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room?.encounter) return;
    const template = this.mobs.get(room.encounter.mobId);
    if (!template || template.lootTable.length === 0) return;
    const randomId = template.lootTable[Math.floor(Math.random() * template.lootTable.length)];
    const item = this.items.get(randomId);
    if (!item) return;

    const playerIds = this.playerManager.getPlayersInRoom(roomId)
      .filter(p => p.status !== 'downed').map(p => p.id);
    if (playerIds.length === 0) return;

    const instanceItem = { ...item, id: `${item.id}_${this.nextLootInstanceId++}` };
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `[${instanceItem.rarity.toUpperCase()}] ${instanceItem.name} found by pickpocket!`,
      logType: 'loot',
    });
    this.lootManager.startLootRound(roomId, [instanceItem], playerIds);
  }
```

- [ ] **Step 5: Wire `use_ability` in handleCombatAction or add separate handler**

In `server/src/index.ts`, update the `combat_action` case (line 224-226) to handle `use_ability`:

```typescript
      case 'combat_action': {
        if (msg.action === 'use_ability' && msg.abilityId) {
          getRoom(playerId)?.gameSession?.handleUseAbility(playerId, msg.abilityId, msg.targetId);
        } else {
          getRoom(playerId)?.gameSession?.handleCombatAction(playerId, msg.action, msg.targetId, msg.itemIndex, msg.fleeDirection, msg.critMultiplier);
        }
        break;
      }
```

- [ ] **Step 6: Update addPlayer calls in index.ts to pass className**

In the `start_game` handler (line 184-186):

```typescript
          for (const p of room.lobby.getPlayers()) {
            room.gameSession.addPlayer(p.id, p.name, p.className);
          }
```

And the API-generated path (line 203-205):

```typescript
          for (const p of room.lobby.getPlayers()) {
            room.gameSession.addPlayer(p.id, p.name, p.className);
          }
```

- [ ] **Step 7: Add GameSession tests**

```typescript
  describe('abilities', () => {
    const abilityContent: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' } },
        { id: 'room_b', type: 'chamber', name: 'B', description: '', exits: { south: 'room_a' },
          encounter: { mobId: 'mob_1', skullRating: 1 } },
      ],
      mobs: [{ id: 'mob_1', name: 'Slime', description: '', skullRating: 1, maxHp: 30, damage: 5, defense: 2, initiative: 3, lootTable: [] }],
      items: [],
    };

    function createAbilitySession(className: string) {
      const messages: { playerId: string; msg: any }[] = [];
      const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
      const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };
      const session = new GameSession(broadcast, sendTo, abilityContent);
      session.addPlayer('p1', 'Alice', className);
      session.startGame();
      return { session, messages };
    }

    it('ticks cooldowns when player moves', () => {
      const { session } = createAbilitySession('vanguard');
      // Set a cooldown manually
      (session as any).playerManager.setCooldown('p1', 'shield_wall', 3);
      session.handleMove('p1', 'north');
      // After moving, combat starts — but cooldown should have ticked
      const player = (session as any).playerManager.getPlayer('p1');
      const cd = player.cooldowns.find((c: any) => c.abilityId === 'shield_wall');
      expect(cd.turnsRemaining).toBe(2);
    });
  });
```

- [ ] **Step 8: Run all server tests**

Run: `npx vitest run server/`
Expected: All PASS

- [ ] **Step 9: Commit**

```
feat: GameSession ability resolution, passive triggers, cooldown ticking
```

---

### Task 6: Lobby — Class Selection

**Files:**
- Modify: `server/src/Lobby.ts:3-6,26-30,62-73`
- Modify: `server/src/index.ts:124-155`

- [ ] **Step 1: Update Lobby to track class selection**

Update `LobbyPlayer` interface:

```typescript
interface LobbyPlayer {
  id: string;
  name: string;
  className: string;
}
```

Update `addPlayer`:

```typescript
  addPlayer(id: string, name: string, className: string = 'vanguard'): void {
    this.players.push({ id, name, className });
    if (!this.hostId) this.hostId = id;
    this.broadcastState();
  }
```

Update `broadcastState` to include className:

```typescript
  broadcastState(): void {
    for (const p of this.players) {
      this.sendTo(p.id, {
        type: 'lobby_state',
        players: this.players.map(pl => ({ id: pl.id, name: pl.name, className: pl.className })),
        hostId: this.hostId!,
        yourId: p.id,
        difficulty: this.difficulty,
        roomCode: this.roomCode,
      });
    }
  }
```

- [ ] **Step 2: Update index.ts join_lobby to pass className**

In the `join_lobby` handler (line 124-155), pass className to `lobby.addPlayer`:

```typescript
          room.lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard');
```

And for room creation:

```typescript
          lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard');
```

- [ ] **Step 3: Commit**

```
feat: lobby tracks and broadcasts player class selection
```

---

### Task 7: Client — Class Selector in Lobby

**Files:**
- Modify: `client/src/components/Lobby.tsx`
- Modify: `client/src/hooks/useGameActions.ts:15`
- Modify: `client/src/store/gameStore.ts:21,80-90`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Update useGameActions to send className**

```typescript
    joinLobby: (playerName: string, roomCode?: string, className?: string) =>
      send({ type: 'join_lobby', playerName, roomCode, className }),
```

- [ ] **Step 2: Update gameStore for class-aware lobby**

Update `lobbyPlayers` type:

```typescript
  lobbyPlayers: { id: string; name: string; className: string }[];
```

- [ ] **Step 3: Add class selector to Lobby component**

Import class definitions at the top of Lobby.tsx:

```typescript
import { CLASS_DEFINITIONS } from '@caverns/shared';
```

Add state for class selection:

```typescript
  const [selectedClass, setSelectedClass] = useState('vanguard');
```

Add class selector screen between name entry and the choose/waiting screen. Insert after the `choose` screen (before `join_code` screen):

In the `choose` screen, replace the Create/Join buttons section to add class selection:

```tsx
  if (screen === 'choose') {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">Welcome, {name.trim()}</p>

        <div className="class-selector">
          <p className="lobby-label">Choose your class:</p>
          <div className="class-options">
            {CLASS_DEFINITIONS.map((cls) => (
              <button
                key={cls.id}
                className={`class-btn ${selectedClass === cls.id ? 'class-selected' : ''}`}
                onClick={() => setSelectedClass(cls.id)}
              >
                <span className="class-name">{cls.displayName}</span>
                <span className="class-desc">{cls.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-choose">
          <button className="lobby-start" onClick={() => onJoin(name.trim(), undefined, selectedClass)}>
            Create Lobby
          </button>
          <button className="lobby-start" onClick={() => setScreen('join_code')}>
            Join Lobby
          </button>
        </div>
      </div>
    );
  }
```

Update the join_code submit to pass className:

```typescript
        onJoin(name.trim(), codeInput.toUpperCase(), selectedClass);
```

In the waiting room, show class next to player names:

```tsx
          {lobbyPlayers.map((p) => (
            <div key={p.id} className="lobby-player">
              <span>{p.name}</span>
              <span className="lobby-player-class">{p.className}</span>
            </div>
          ))}
```

Update the `LobbyProps` interface:

```typescript
interface LobbyProps {
  onJoin: (name: string, roomCode?: string, className?: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}
```

Update App.tsx to pass the new signature:

```tsx
    content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} />;
```

(This already works since `actions.joinLobby` now accepts the third param.)

- [ ] **Step 4: Add CSS for class selector**

```css
/* === Class Selector === */
.class-selector { margin: 1rem 0; }
.class-options { display: flex; flex-direction: column; gap: 0.5rem; max-width: 400px; margin: 0 auto; }
.class-btn {
  background: #1a1410; border: 1px solid #3d3122; padding: 0.5rem 0.75rem;
  cursor: pointer; text-align: left; color: #c8b89a;
  display: flex; flex-direction: column; gap: 0.15rem;
}
.class-btn:hover { border-color: #d4a857; }
.class-selected { border-color: #d4a857; background: #2a2010; }
.class-name { font-weight: bold; color: #d4a857; }
.class-desc { font-size: 0.75rem; color: #8a7a60; }
.lobby-player-class { color: #d4a857; font-size: 0.8rem; margin-left: 0.5rem; text-transform: capitalize; }
```

- [ ] **Step 5: Commit**

```
feat: class selector UI in lobby
```

---

### Task 8: Client — Combat Abilities UI

**Files:**
- Modify: `client/src/components/CombatView.tsx`
- Modify: `client/src/hooks/useGameActions.ts`
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add useAbility action**

In `useGameActions.ts`, add to the return object:

```typescript
    useAbility: (abilityId: string, targetId?: string) =>
      send({ type: 'combat_action', action: 'use_ability', abilityId, targetId }),
```

- [ ] **Step 2: Update CombatView props and imports**

```typescript
import { CLASS_DEFINITIONS } from '@caverns/shared';
import type { Direction, ItemStats, CritMultiplier, DamageReduction, AbilityDefinition } from '@caverns/shared';

interface CombatViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string, itemIndex?: number, fleeDirection?: Direction, critMultiplier?: number
  ) => void;
  onRevive: (targetPlayerId: string) => void;
  onDefendResult: (damageReduction: number) => void;
  onUseAbility: (abilityId: string, targetId?: string) => void;
}
```

- [ ] **Step 3: Add ActionState modes for abilities**

Update the ActionState type:

```typescript
type ActionState =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'target'; afterSelect: 'attack' | 'use_item' | 'ability'; itemIndex?: number; abilityId?: string }
  | { mode: 'items' }
  | { mode: 'flee' };
```

- [ ] **Step 4: Add ability buttons to the main action state**

In the `main` mode section (line 240-253), add ability buttons after the Flee button:

```tsx
        {effectiveState.mode === 'main' && (
          <>
            <button onClick={() => setActionState({ mode: 'target', afterSelect: 'attack' })}>
              Attack
            </button>
            <button onClick={handleDefend}>Defend</button>
            <button onClick={() => setActionState({ mode: 'items' })}>Items</button>
            <button onClick={() => setActionState({ mode: 'flee' })}>Flee</button>
            {playerAbilities.map((ability) => {
              const cd = player.cooldowns?.find(c => c.abilityId === ability.id);
              const onCooldown = cd && cd.turnsRemaining > 0;
              return (
                <button
                  key={ability.id}
                  className={`ability-btn ${onCooldown ? 'on-cooldown' : ''}`}
                  disabled={!!onCooldown}
                  onClick={() => {
                    if (ability.targetType === 'none') {
                      onUseAbility(ability.id);
                      setActionState({ mode: 'idle' });
                    } else if (ability.targetType === 'enemy') {
                      setActionState({ mode: 'target', afterSelect: 'ability', abilityId: ability.id });
                    } else if (ability.targetType === 'ally') {
                      setActionState({ mode: 'target', afterSelect: 'ability', abilityId: ability.id });
                    }
                  }}
                >
                  {ability.name}
                  {onCooldown && <span className="cooldown-badge">{cd!.turnsRemaining}</span>}
                </button>
              );
            })}
            {downedAllies.map((ally) => (
              <button key={ally.id} className="revive-btn" onClick={() => onRevive(ally.id)}>
                Revive {ally.name}
              </button>
            ))}
          </>
        )}
```

Add `playerAbilities` computed value:

```typescript
  const playerAbilities = useMemo(() => {
    const classDef = CLASS_DEFINITIONS.find(c => c.id === player?.className);
    if (!classDef) return [];
    return classDef.abilities.filter(a => !a.passive);
  }, [player?.className]);
```

- [ ] **Step 5: Update target click handler for abilities**

Update `handleTargetClick`:

```typescript
  const handleTargetClick = (targetId: string) => {
    if (effectiveState.mode !== 'target') return;
    if (effectiveState.afterSelect === 'attack') {
      setActiveQte({ type: 'attack', targetId });
      setActionState({ mode: 'idle' });
    } else if (effectiveState.afterSelect === 'ability') {
      onUseAbility(effectiveState.abilityId!, targetId);
      setActionState({ mode: 'idle' });
    } else {
      onCombatAction('use_item', targetId, effectiveState.itemIndex);
      setActionState({ mode: 'idle' });
    }
  };
```

For ally-targeting abilities, make party members clickable in target mode:

```tsx
    {partyMembers.map((member) => {
      const isDowned = member.status === 'downed';
      const isActive = currentTurnId === member.id;
      const isAttacking = combatAnim?.attackerId === member.id;
      const isHit = combatAnim?.targetId === member.id;
      const isAllyTargetable = isTargeting && effectiveState.mode === 'target'
        && effectiveState.afterSelect === 'ability' && !isDowned;
      return (
        <div key={member.id}
          className={`combat-member${isAttacking ? ' anim-lunge' : ''}${isHit ? ' anim-shake' : ''}${isAllyTargetable ? ' targetable' : ''}`}
          onClick={() => isAllyTargetable && handleTargetClick(member.id)}
        >
          {/* ... existing content */}
        </div>
      );
    })}
```

- [ ] **Step 6: Update App.tsx to pass onUseAbility**

```tsx
            <CombatView
              onCombatAction={actions.combatAction}
              onRevive={actions.revive}
              onDefendResult={actions.defendResult}
              onUseAbility={actions.useAbility}
            />
```

- [ ] **Step 7: Add CSS for ability buttons**

```css
/* === Ability Buttons === */
.ability-btn {
  background: #1a1820; border: 1px solid #4a3d6a; color: #b8a0d4;
  position: relative;
}
.ability-btn:hover:not(:disabled) { border-color: #8a6abf; color: #d4c0f0; }
.ability-btn.on-cooldown { opacity: 0.5; }
.cooldown-badge {
  position: absolute; top: -4px; right: -4px;
  background: #7a2a2a; color: #c8b89a; font-size: 0.65rem;
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.combat-member.targetable { cursor: pointer; outline: 1px solid #5599cc; }
.combat-member.targetable:hover { outline-color: #88ccff; }
```

- [ ] **Step 8: Commit**

```
feat: ability buttons in combat UI with cooldown display
```

---

### Task 9: Client — Scout Drone and Minimap Integration

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/components/MiniMap.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add scout threat data to store**

Add to GameStore interface:

```typescript
  scoutThreats: Record<string, Partial<Record<Direction, boolean>>>; // roomId -> direction -> hasEnemy
```

Add to initialState:

```typescript
  scoutThreats: {},
```

Add handler in handleServerMessage switch:

```typescript
      case 'scout_result':
        set((state) => ({
          scoutThreats: { ...state.scoutThreats, [msg.roomId]: msg.adjacentThreats },
        }));
        break;
```

- [ ] **Step 2: Render threat indicators on MiniMap**

In MiniMap.tsx, add after the `?` indicators for unexplored exits (around line 155-167):

```tsx
              {/* Scout drone threat indicators */}
              {scoutThreats[roomId] && Object.entries(scoutThreats[roomId]).map(([dir, hasThreat]) => {
                const offset = DIR_OFFSET[dir as Direction];
                const targetId = room?.exits[dir as Direction];
                // Only show for unrevealed rooms
                if (targetId && rooms[targetId]) return null;
                return (
                  <text key={`scout-${dir}`}
                    x={pos.x * GAP_X + ROOM_W / 2 + offset.dx * (ROOM_W / 2 + 12)}
                    y={pos.y * GAP_Y + ROOM_H / 2 + offset.dy * (ROOM_H / 2 + 12)}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={hasThreat ? '#cc4444' : '#44cc44'} fontSize={10}
                  >{hasThreat ? '\u2620' : '\u2713'}</text>
                );
              })}
```

Add `scoutThreats` to the store selector at the top of MiniMap:

```typescript
  const scoutThreats = useGameStore((s) => s.scoutThreats);
```

- [ ] **Step 3: Commit**

```
feat: scout drone threat indicators on minimap
```

---

### Task 10: Client — PlayerHUD Class Display and Cooldowns

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Read current PlayerHUD**

Read `client/src/components/PlayerHUD.tsx` to find where to add class display.

- [ ] **Step 2: Add class name and cooldown display**

Import class definitions:

```typescript
import { CLASS_DEFINITIONS } from '@caverns/shared';
```

Below the player name, add:

```tsx
        <div className="hud-class">{player.className}</div>

        {/* Ability cooldowns */}
        {playerAbilities.length > 0 && (
          <div className="hud-cooldowns">
            {playerAbilities.map((ability) => {
              const cd = player.cooldowns?.find(c => c.abilityId === ability.id);
              const ready = !cd || cd.turnsRemaining === 0;
              return (
                <div key={ability.id} className={`hud-ability ${ready ? 'ability-ready' : 'ability-cooldown'}`}>
                  <span className="ability-label">{ability.name}</span>
                  {!ready && <span className="ability-cd">{cd!.turnsRemaining}</span>}
                  {ready && <span className="ability-cd ready">\u2713</span>}
                </div>
              );
            })}
          </div>
        )}
```

Add `playerAbilities` computed value:

```typescript
  const playerAbilities = useMemo(() => {
    const classDef = CLASS_DEFINITIONS.find(c => c.id === player?.className);
    if (!classDef) return [];
    return classDef.abilities.filter(a => !a.passive);
  }, [player?.className]);
```

- [ ] **Step 3: Add CSS**

```css
/* === HUD Class/Cooldown === */
.hud-class { color: #d4a857; font-size: 0.8rem; text-transform: capitalize; margin-bottom: 0.25rem; }
.hud-cooldowns { display: flex; flex-direction: column; gap: 0.2rem; margin: 0.5rem 0; padding: 0.25rem 0; border-top: 1px solid #2a2218; }
.hud-ability { display: flex; justify-content: space-between; font-size: 0.75rem; }
.ability-label { color: #b8a0d4; }
.ability-cd { color: #7a2a2a; }
.ability-cd.ready { color: #44cc44; }
.ability-ready .ability-label { color: #d4c0f0; }
.ability-cooldown .ability-label { color: #5a4a3a; }
```

- [ ] **Step 4: Commit**

```
feat: class name and ability cooldowns in PlayerHUD
```

---

### Task 11: Final Integration and Full Test Pass

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any compilation or test errors**

Address any TypeScript errors from the new `className` field on Player (existing tests may need to pass `className` to `createPlayer` or mock it).

Key areas to check:
- `shared/src/types.test.ts` — may reference `createPlayer` without className
- `shared/src/content.test.ts` — may reference player structure
- `server/src/GameSession.test.ts` — `createSession` helper doesn't pass className
- `server/src/CombatManager.test.ts` — `CombatPlayerInfo` may need className

For each test file, add `className: 'vanguard'` where Player objects are created, or rely on the default parameter.

- [ ] **Step 3: Verify the full test suite passes**

Run: `npx vitest run`
Expected: All tests pass (95+ tests)

- [ ] **Step 4: Commit**

```
feat: player classes integration complete — all tests passing
```
