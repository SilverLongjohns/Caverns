# Item Abilities Design Spec

## Overview

26 item abilities that can be assigned to unique (and potentially legendary) items during procedural generation. These abilities have mechanical combat impact and are intended to be build-defining — finding one should change how you play.

## Data Model

Hybrid approach: items keep the `effect` string identifier for display/lookup and gain an `effectParams` object for tunable values. Handlers live in server code; numbers live in JSON.

```ts
interface Item {
  // ...existing fields
  effect?: string;
  effectParams?: Record<string, number>;
}
```

Example item:
```json
{
  "id": "lifedrinker",
  "name": "Lifedrinker",
  "rarity": "unique",
  "slot": "weapon",
  "stats": { "damage": 18, "maxHp": 5 },
  "effect": "vampiric",
  "effectParams": { "leechPercent": 0.25 }
}
```

## Design Rules

- **Any slot**: Abilities are not restricted by equipment slot. A vampiric accessory or a thorns weapon are valid.
- **Combat only**: No exploration or utility effects. All abilities trigger during combat.
- **Mostly passive**: 23 abilities are passive or auto-triggered. 3 are activated (Overcharge, Revive Once, Rally).
- **Single-use abilities** (Self Revive, Revive Once) reset per dungeon run.
- **Stacking**: When multiple items have the same ability, effects stack additively unless noted.
- **Parameters in data**: All tunable values live in `effectParams` so the same ability can feel different across items.

## Ability Catalog

### Offensive (12)

#### 1. Cleave
- **Effect ID**: `cleave`
- **Trigger**: On attack
- **Behavior**: Deal a percentage of your damage to all other enemies in the combat.
- **Params**: `{ splashPercent: 0.5 }`
- **Example**: You attack for 20 damage. All other enemies take 10 splash damage (ignores their defense).

#### 2. Vampiric
- **Effect ID**: `vampiric`
- **Trigger**: On dealing damage
- **Behavior**: Heal for a percentage of damage dealt.
- **Params**: `{ leechPercent: 0.25 }`
- **Example**: Deal 20 damage, heal for 5.

#### 3. Executioner
- **Effect ID**: `executioner`
- **Trigger**: On attack, conditional
- **Behavior**: Deal bonus flat damage to enemies below a HP threshold (percentage of their max HP).
- **Params**: `{ hpThresholdPercent: 0.3, bonusDamage: 10 }`
- **Example**: Enemy at 25% HP (below 30% threshold) takes 10 extra damage.

#### 4. Momentum
- **Effect ID**: `momentum`
- **Trigger**: On consecutive attacks
- **Behavior**: Each consecutive attack action (without defending, using items, or using abilities) increases damage. Resets when doing anything other than attacking.
- **Params**: `{ damagePerStack: 2, maxStacks: 5 }`
- **Example**: Third consecutive attack deals +6 bonus damage.

#### 5. Overcharge
- **Effect ID**: `overcharge`
- **Trigger**: Activated (combat action)
- **Behavior**: Your next attack deals massively increased damage, but you take a percentage of your max HP as self-damage.
- **Params**: `{ damageMultiplier: 2.5, selfDamagePercent: 0.15 }`
- **Example**: Activate, take 15% max HP self-damage, next attack deals 2.5x damage.

#### 6. First Strike
- **Effect ID**: `first_strike`
- **Trigger**: On attack, conditional
- **Behavior**: If you act first in the current round (first in turn order), deal bonus flat damage on your attack.
- **Params**: `{ bonusDamage: 8 }`
- **Example**: You're first in initiative order this round — your attack deals +8 damage.

#### 7. Venomous
- **Effect ID**: `venomous`
- **Trigger**: On attack
- **Behavior**: Apply a poison debuff to the target that deals flat damage at the start of each of their turns.
- **Params**: `{ poisonDamage: 4, duration: 3 }`
- **Example**: Target takes 4 damage at the start of their next 3 turns (12 total).

#### 8. Flurry
- **Effect ID**: `flurry`
- **Trigger**: On attack
- **Behavior**: Your initiative stat determines bonus hits. Each threshold of initiative grants one bonus hit at reduced damage.
- **Params**: `{ hitsPerInitiativeThreshold: 5, bonusHitPercent: 0.3 }`
- **Example**: 15 initiative = 3 bonus hits, each dealing 30% of normal attack damage.

#### 9. Brutal Impact
- **Effect ID**: `brutal_impact`
- **Trigger**: On crit (QTE success)
- **Behavior**: Your damage stat amplifies your crit multiplier. Each point of damage adds to the crit multiplier.
- **Params**: `{ critBonusPerDamage: 0.02 }`
- **Example**: 20 damage stat = +0.4 added to crit multiplier. A 1.5x crit becomes 1.9x.

#### 10. Overwhelm
- **Effect ID**: `overwhelm`
- **Trigger**: On attack
- **Behavior**: Your attacks reduce the target's defense by an amount based on your damage stat, as a temporary debuff.
- **Params**: `{ defenseReductionPercent: 0.15, duration: 2 }`
- **Example**: 20 damage stat = target loses 3 defense for 2 turns.

#### 11. Blade Storm
- **Effect ID**: `blade_storm`
- **Trigger**: On attack, conditional
- **Behavior**: When your initiative is higher than the target's, deal bonus damage equal to the difference.
- **Params**: `{ damagePerInitiativeDiff: 1.0 }`
- **Example**: Your initiative 12, target initiative 4 = +8 bonus damage.

#### 12. Rampage
- **Effect ID**: `rampage`
- **Trigger**: On dealing damage (cumulative)
- **Behavior**: Each point of damage dealt in this combat permanently increases your damage by a small amount for the rest of the combat. Capped.
- **Params**: `{ damagePerPointDealt: 0.02, maxBonus: 10 }`
- **Example**: Dealt 500 total damage over the fight = +10 bonus damage (capped).

### Defensive (7)

#### 13. Thorns
- **Effect ID**: `thorns`
- **Trigger**: When attacked
- **Behavior**: Deal flat damage back to the attacker whenever you take damage.
- **Params**: `{ flatDamage: 7 }`
- **Example**: Enemy attacks you, takes 7 damage in return.

#### 14. Reflect
- **Effect ID**: `reflect`
- **Trigger**: When defending and attacked
- **Behavior**: While defending, reflect a percentage of incoming damage back at the attacker.
- **Params**: `{ reflectPercent: 0.5 }`
- **Example**: Defending, enemy hits you for 20 raw damage, attacker takes 10 reflected damage.

#### 15. Deathward
- **Effect ID**: `deathward`
- **Trigger**: When HP drops below threshold
- **Behavior**: When your HP drops below a percentage of max HP, gain a large temporary defense buff. Triggers once per combat.
- **Params**: `{ hpThresholdPercent: 0.25, bonusDefense: 10, duration: 2 }`
- **Example**: Drop below 25% HP, gain +10 defense for 2 turns.

#### 16. Siphon Armor
- **Effect ID**: `siphon_armor`
- **Trigger**: On dealing damage
- **Behavior**: Gain a small temporary defense buff that stacks each time you deal damage.
- **Params**: `{ defensePerHit: 1, maxStacks: 5, duration: 2 }`
- **Example**: After 5 attacks, you have +5 temporary defense.

#### 17. Fortify
- **Effect ID**: `fortify`
- **Trigger**: Passive
- **Behavior**: Gain bonus defense equal to a percentage of your max HP. Calculated at combat start.
- **Params**: `{ defensePerHpPercent: 0.08 }`
- **Example**: 100 max HP = +8 defense.

#### 18. Glass Cannon
- **Effect ID**: `glass_cannon`
- **Trigger**: Passive
- **Behavior**: Your defense is reduced to zero. Gain bonus damage equal to a multiplier of your lost defense.
- **Params**: `{ damagePerDefense: 2.0 }`
- **Example**: Had 10 defense, now 0 defense and +20 damage.

#### 19. Guardian
- **Effect ID**: `guardian`
- **Trigger**: When an ally is attacked
- **Behavior**: Intercept a percentage of damage dealt to allies in the same combat, taking it yourself instead.
- **Params**: `{ interceptPercent: 0.3 }`
- **Example**: Ally would take 20 damage, you take 6 instead, ally takes 14.

### Survival (3)

#### 20. Self Revive
- **Effect ID**: `self_revive`
- **Trigger**: On death
- **Behavior**: When you would be downed, instead revive at a percentage of max HP. Single use per dungeon.
- **Params**: `{ revivePercent: 0.25 }`
- **Example**: Would die, instead come back at 25% HP.

#### 21. Revive Once
- **Effect ID**: `revive_once`
- **Trigger**: Activated (combat action)
- **Behavior**: Target a downed ally and revive them at a percentage of their max HP. Single use per dungeon.
- **Params**: `{ revivePercent: 0.3 }`
- **Example**: Ally is downed, activate to bring them back at 30% HP.

#### 22. Undying Fury
- **Effect ID**: `undying_fury`
- **Trigger**: On death
- **Behavior**: When downed, continue acting for a number of extra turns before actually dying. Cannot be healed during this state.
- **Params**: `{ extraTurns: 2 }`
- **Example**: Get downed, keep fighting for 2 more turns, then die for real.

### Support (2)

#### 23. Party Buff
- **Effect ID**: `party_buff`
- **Trigger**: Passive aura
- **Behavior**: All allies in the same combat gain flat bonus damage.
- **Params**: `{ bonusDamage: 3 }`
- **Example**: All party members in this fight deal +3 damage.

#### 24. Rally
- **Effect ID**: `rally`
- **Trigger**: Activated (combat action, cooldown)
- **Behavior**: Heal all allies in the same combat for a percentage of your max HP.
- **Params**: `{ healPercent: 0.15, cooldown: 3 }`
- **Example**: 100 max HP = heal all allies for 15 HP. Usable every 3 turns.

### Scaling (2)

#### 25. Predator
- **Effect ID**: `predator`
- **Trigger**: On kill
- **Behavior**: Gain bonus initiative for each enemy killed in the current combat. Snowball effect.
- **Params**: `{ initiativePerKill: 3 }`
- **Example**: Killed 2 enemies this combat = +6 initiative.

#### 26. Berserk
- **Effect ID**: `berserk`
- **Trigger**: Passive (scales inversely with HP%)
- **Behavior**: Gain bonus damage that increases as your HP percentage decreases. Linear scale from 0 at full HP to max bonus at 1 HP.
- **Params**: `{ maxBonusDamage: 12 }`
- **Example**: At 50% HP, gain +6 damage. At 10% HP, gain ~+11 damage.

## Implementation Notes

### Handler Architecture

Item effect handlers will be added to the existing `AbilityResolver` pattern or a parallel `ItemEffectResolver` class. Each effect ID maps to a handler function that receives the combat context and `effectParams`.

### Combat Integration Points

Effects need hooks at these moments in the combat loop:
- **On attack resolution**: Cleave, Vampiric, Executioner, Momentum, Venomous, Flurry, Brutal Impact, Overwhelm, Blade Storm, Rampage
- **On taking damage**: Thorns, Reflect, Guardian, Deathward
- **On death/downed**: Self Revive, Undying Fury
- **On combat start**: Fortify, Glass Cannon, Party Buff
- **On turn start**: Venomous (poison tick), Predator (recalculate)
- **Activated actions**: Overcharge, Revive Once, Rally
- **Conditional checks**: First Strike (turn order), Momentum (action history)

### State Tracking

Some abilities need per-combat state:
- **Momentum**: consecutive attack count per player
- **Rampage**: total damage dealt per player
- **Predator**: kill count per player
- **Siphon Armor**: current stack count
- **Deathward**: whether it has triggered this combat
- **Self Revive / Revive Once**: whether used this dungeon run
- **Undying Fury**: remaining extra turns
- **Overcharge**: whether next attack is buffed

This state lives on the combat participant (server-side) and is cleared when combat ends. Dungeon-wide single-use flags live on the player.
