# Energy System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-ability cooldown system with a single energy resource that gates ability usage through costs.

**Architecture:** Energy is a numeric field on each Player (0-30). Abilities define an `energyCost` instead of `cooldown`. Energy regenerates +2 per executed player combat turn and persists between fights. The `AbilityCooldown` type and all cooldown-tracking methods are removed.

**Tech Stack:** TypeScript, Vitest, React, Zustand

**Spec:** `docs/superpowers/specs/2026-04-10-energy-system-design.md`

---

### Task 1: Update shared types — remove cooldowns, add energy

**Files:**
- Modify: `shared/src/classTypes.ts`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Remove AbilityCooldown type from classTypes.ts**

In `shared/src/classTypes.ts`, delete the `AbilityCooldown` interface (lines 27-30) and replace the `cooldown` field in `AbilityDefinition` with `energyCost`:

```ts
// In AbilityDefinition, replace:
//   cooldown: number;
// With:
  energyCost: number;
```

Delete:
```ts
export interface AbilityCooldown {
  abilityId: string;
  turnsRemaining: number;
}
```

- [ ] **Step 2: Update Player type in types.ts**

In `shared/src/types.ts`, update the `Player` interface:
- Remove `cooldowns: AbilityCooldown[];`
- Add `energy: number;`

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
  energy: number;
  usedEffects: string[];
}
```

- [ ] **Step 3: Update createPlayer in types.ts**

In the `createPlayer` function, replace `cooldowns: []` with `energy: 30`:

```ts
export function createPlayer(id: string, name: string, roomId: string, className: string = 'vanguard'): Player {
  const classDef = getClassDefinition(className);
  const maxHp = classDef?.baseStats.maxHp ?? BASE_STATS.maxHp;
  return {
    id,
    name,
    className,
    maxHp,
    hp: maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    inventory: Array(INVENTORY_SLOTS).fill(null),
    status: 'exploring',
    keychain: [],
    energy: 30,
    usedEffects: [],
  };
}
```

- [ ] **Step 4: Update CombatParticipant in types.ts**

Remove `cooldowns?: AbilityCooldown[];` from the `CombatParticipant` interface. Add `energy?: number;`:

```ts
export interface CombatParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  className?: string;
  buffs?: ActiveBuff[];
  energy?: number;
}
```

- [ ] **Step 5: Remove AbilityCooldown from shared index exports**

In `shared/src/index.ts`, find and remove `AbilityCooldown` from any export/re-export statements. The `ActiveBuff` export stays.

- [ ] **Step 6: Fix compilation errors from removed AbilityCooldown import**

Run: `npx tsc --noEmit -p shared/tsconfig.json`

Fix any remaining references to `AbilityCooldown` across shared/. This may include removing it from the `import` in `types.ts` if it imports from `classTypes.ts`.

- [ ] **Step 7: Commit**

```bash
git add shared/src/classTypes.ts shared/src/types.ts shared/src/index.ts
git commit -m "feat: replace cooldown types with energy on Player and AbilityDefinition"
```

---

### Task 2: Update ability data — cooldown to energyCost

**Files:**
- Modify: `shared/src/data/classes.json`

- [ ] **Step 1: Replace cooldown with energyCost in classes.json**

Update every ability entry in `shared/src/data/classes.json`. Passive abilities (cooldown: 0) get `energyCost: 0`.

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
        "energyCost": 15,
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
        "energyCost": 20,
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
        "energyCost": 25,
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
        "energyCost": 0,
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
        "energyCost": 10,
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
        "energyCost": 20,
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
        "energyCost": 25,
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
        "energyCost": 0,
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

- [ ] **Step 2: Commit**

```bash
git add shared/src/data/classes.json
git commit -m "feat: replace cooldown with energyCost in ability definitions"
```

---

### Task 3: Update PlayerManager — replace cooldown methods with energy methods

**Files:**
- Test: `server/src/PlayerManager.test.ts`
- Modify: `server/src/PlayerManager.ts`

- [ ] **Step 1: Write failing tests for energy methods**

Replace the three cooldown tests at the end of `server/src/PlayerManager.test.ts` (lines 116-138) with energy tests:

```ts
  it('initializes player with full energy', () => {
    const pm = new PlayerManager();
    const player = pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    expect(player.energy).toBe(30);
  });

  it('spends energy', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 15);
    const player = pm.getPlayer('p1')!;
    expect(player.energy).toBe(15);
  });

  it('regens energy capped at 30', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 5);
    pm.regenEnergy('p1', 10);
    const player = pm.getPlayer('p1')!;
    expect(player.energy).toBe(30);
  });

  it('hasEnergy returns false when not enough', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    pm.spendEnergy('p1', 20);
    expect(pm.hasEnergy('p1', 15)).toBe(false);
  });

  it('hasEnergy returns true when enough', () => {
    const pm = new PlayerManager();
    pm.addPlayer('p1', 'Alice', 'room1', 'vanguard');
    expect(pm.hasEnergy('p1', 25)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/PlayerManager.test.ts`
Expected: FAIL — `spendEnergy`, `regenEnergy`, `hasEnergy` don't exist yet.

- [ ] **Step 3: Replace cooldown methods with energy methods in PlayerManager.ts**

In `server/src/PlayerManager.ts`:

1. Remove the cooldown initialization block in `addPlayer` (lines 35-39):
```ts
    // Delete these lines:
    if (classDef) {
      player.cooldowns = classDef.abilities
        .filter(a => !a.passive)
        .map(a => ({ abilityId: a.id, turnsRemaining: 0 }));
    }
```

2. Replace `tickCooldowns`, `setCooldown`, and `isAbilityReady` (lines 196-217) with:

```ts
  spendEnergy(playerId: string, cost: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.energy = Math.max(0, player.energy - cost);
  }

  regenEnergy(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.energy = Math.min(30, player.energy + amount);
  }

  hasEnergy(playerId: string, cost: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    return player.energy >= cost;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/PlayerManager.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/PlayerManager.ts server/src/PlayerManager.test.ts
git commit -m "feat: replace cooldown methods with energy methods in PlayerManager"
```

---

### Task 4: Update GameSession — use energy instead of cooldowns

**Files:**
- Test: `server/src/GameSession.test.ts`
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Update handleUseAbility in GameSession.ts**

In `server/src/GameSession.ts`, modify `handleUseAbility` (around line 1139):

Replace the cooldown check:
```ts
    if (!this.playerManager.isAbilityReady(playerId, abilityId)) {
      this.sendTo(playerId, { type: 'error', message: `${ability.name} is on cooldown.` });
      return;
    }
```
With energy check:
```ts
    if (!this.playerManager.hasEnergy(playerId, ability.energyCost)) {
      this.sendTo(playerId, { type: 'error', message: `Not enough energy for ${ability.name}.` });
      return;
    }
```

Replace the cooldown set:
```ts
    // Set cooldown
    this.playerManager.setCooldown(playerId, abilityId, ability.cooldown);
```
With energy spend:
```ts
    // Spend energy
    this.playerManager.spendEnergy(playerId, ability.energyCost);
```

Update the comment on the player_update broadcast:
```ts
    // Sync player update (energy changed)
```

- [ ] **Step 2: Add energy regen after player combat turns**

In `handleCombatAction` (around line 298), add energy regen *before* the existing `this.broadcast({ type: 'player_update', ... })` call at line 358 (so the broadcast includes the updated energy). Add this line just before that broadcast:

```ts
    this.playerManager.regenEnergy(playerId, 2);
```

In `handleUseAbility`, add the same regen call just before the existing `player_update` broadcast (around line 1191):

```ts
    this.playerManager.regenEnergy(playerId, 2);
```

The existing `player_update` broadcasts will carry the updated energy value — no extra broadcast needed.

- [ ] **Step 3: Remove tickCooldowns from handleMove**

In `handleMove` (around line 202), remove the line:
```ts
    this.playerManager.tickCooldowns(playerId);
```

- [ ] **Step 4: Update the abilities test in GameSession.test.ts**

Replace the `ticks cooldowns when player moves` test (lines 230-237) with an energy test:

```ts
    it('player starts with full energy', () => {
      const { session } = createAbilitySession('vanguard');
      const player = (session as any).playerManager.getPlayer('p1');
      expect(player.energy).toBe(30);
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/src/GameSession.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/GameSession.ts server/src/GameSession.test.ts
git commit -m "feat: use energy instead of cooldowns in GameSession"
```

---

### Task 5: Update CombatManager — remove cooldown references from combat state

**Files:**
- Modify: `server/src/CombatManager.ts`
- Test: `server/src/CombatManager.test.ts`

- [ ] **Step 1: Check CombatManager for cooldown references**

Search `server/src/CombatManager.ts` for any references to `cooldowns` or `AbilityCooldown`. If the `getState()` method copies cooldowns into `CombatParticipant`, update it to copy `energy` instead.

In `addParticipant` or `getState`, if there is code like:
```ts
cooldowns: participant.cooldowns,
```
Replace with:
```ts
energy: participant.energy,
```

If `CombatManager` doesn't reference cooldowns at all (which appears likely from the earlier grep), this step is a no-op.

- [ ] **Step 2: Run all server tests**

Run: `npx vitest run server/`
Expected: All tests PASS. Fix any remaining compilation errors from removed cooldown types.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add server/src/CombatManager.ts
git commit -m "feat: remove cooldown references from CombatManager"
```

---

### Task 6: Update client CombatView — show energy, disable by cost

**Files:**
- Modify: `client/src/components/CombatView.tsx`

- [ ] **Step 1: Replace cooldown display with energy cost display**

In `client/src/components/CombatView.tsx`, find the ability button rendering block (around line 298-321).

Replace:
```tsx
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
```

With:
```tsx
{playerAbilities.map((ability) => {
  const notEnoughEnergy = (player.energy ?? 0) < ability.energyCost;
  return (
    <button
      key={ability.id}
      className={`ability-btn ${notEnoughEnergy ? 'no-energy' : ''}`}
      disabled={notEnoughEnergy}
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
      {ability.name} <span className="energy-cost">{ability.energyCost}</span>
    </button>
  );
})}
```

- [ ] **Step 2: Add energy display above ability buttons**

In the same section of CombatView, just before the ability buttons map (before the `{playerAbilities.map(` line), add an energy readout:

```tsx
<div className="energy-display">Energy: {player.energy ?? 0}/30</div>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CombatView.tsx
git commit -m "feat: show energy cost on ability buttons, disable when insufficient"
```

---

### Task 7: Update PlayerHUD — show energy bar

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`

- [ ] **Step 1: Check current PlayerHUD structure**

Read `client/src/components/PlayerHUD.tsx` to find where HP is displayed. Add an energy bar/readout near it.

- [ ] **Step 2: Add energy display to PlayerHUD**

After the HP bar section, add:

```tsx
<div className="energy-bar-container">
  <div className="energy-bar" style={{ width: `${((player.energy ?? 0) / 30) * 100}%` }} />
  <span className="energy-text">{player.energy ?? 0}/30 Energy</span>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PlayerHUD.tsx
git commit -m "feat: add energy bar to PlayerHUD"
```

---

### Task 8: Add CSS styles for energy UI

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add energy styles**

Add to `client/src/styles/index.css`:

```css
/* Energy display in combat */
.energy-display {
  color: #4fc3f7;
  font-size: 0.9em;
  margin-bottom: 4px;
  text-shadow: 0 0 6px rgba(79, 195, 247, 0.5);
}

.energy-cost {
  color: #4fc3f7;
  font-size: 0.8em;
  opacity: 0.8;
}

.ability-btn.no-energy {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Energy bar in PlayerHUD */
.energy-bar-container {
  position: relative;
  height: 14px;
  background: #1a1a2e;
  border: 1px solid #4fc3f7;
  margin-top: 4px;
}

.energy-bar {
  height: 100%;
  background: linear-gradient(90deg, #0d47a1, #4fc3f7);
  transition: width 0.3s ease;
}

.energy-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.7em;
  line-height: 14px;
  color: #e0e0e0;
  text-shadow: 0 0 2px #000;
}
```

- [ ] **Step 2: Remove old cooldown styles (if any exist)**

Search `client/src/styles/index.css` for `.on-cooldown` and `.cooldown-badge` styles. Remove them if found.

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/index.css
git commit -m "feat: add energy bar and cost styles, remove cooldown styles"
```

---

### Task 9: Clean up — remove stale cooldown references

**Files:**
- Various files across shared/, server/, client/

- [ ] **Step 1: Search for remaining cooldown references**

Search the entire codebase for `cooldown`, `AbilityCooldown`, `tickCooldowns`, `setCooldown`, `isAbilityReady`, and `on-cooldown`. Fix or remove any remaining references.

Key places to check:
- `shared/src/index.ts` — ensure `AbilityCooldown` is not exported
- Any import statements referencing `AbilityCooldown`
- `server/src/AbilityResolver.test.ts` — check for cooldown references
- `client/src/store/gameStore.ts` — check for cooldown references

- [ ] **Step 2: Run full build check**

Run: `npx tsc --noEmit` from the project root (or each workspace).
Expected: No type errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove remaining cooldown references"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Start the server and client**

From a Windows terminal:
```bash
npm run dev:server
npm run dev:client
```

- [ ] **Step 2: Verify energy system in-game**

1. Join a game, pick any class
2. Enter combat (move to a room with a mob)
3. Verify energy shows as 30/30 in the HUD and combat view
4. Use an ability — verify energy decreases by the correct cost
5. Take a normal action (attack/defend) — verify energy regenerates by 2
6. Drain energy below an ability's cost — verify the button is disabled
7. Win a fight, enter another fight — verify energy persisted from the previous fight
