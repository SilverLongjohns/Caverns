# Player Classes Design Spec

## Overview

Four player classes — Vanguard, Shadowblade, Cleric, Artificer — each with distinct base stats, starter gear, and 2 abilities. Classes are selected in the lobby with no duplicate restrictions. Cooldowns tick down 1 per combat turn AND 1 per room moved during exploration.

## Class Selection

- Dropdown or button selector in the lobby screen, after entering name but before readying up
- Default selection: Vanguard
- No restrictions on duplicates — any combination allowed
- Class choice is broadcast to all lobby players (shown next to player name in the lobby list)
- `join_lobby` message gains a `className: PlayerClassName` field
- `lobby_state` message includes each player's chosen class

## Base Stats

| Class       | HP | Damage | Defense | Initiative |
|-------------|---:|-------:|--------:|-----------:|
| Vanguard    | 50 |      5 |       2 |          5 |
| Shadowblade | 35 |      7 |       1 |          9 |
| Cleric      | 40 |      4 |       2 |          5 |
| Artificer   | 35 |      5 |       1 |          7 |

## Starter Equipment

Each class begins with a unique weapon, offhand, and one Starter Potion.

| Class       | Weapon                          | Offhand                      |
|-------------|---------------------------------|------------------------------|
| Vanguard    | Iron Mace (+2 dmg)              | Tower Shield (+3 def)        |
| Shadowblade | Twin Daggers (+3 dmg, +2 init)  | Smoke Cloak (+1 def)         |
| Cleric      | Blessed Staff (+2 dmg, +1 init) | Holy Symbol (+2 def)         |
| Artificer   | Repeating Crossbow (+3 dmg)     | Toolkit (+1 def, +2 init)    |

## Cooldown System

- Each ability has a fixed cooldown expressed in turns.
- Cooldown begins on the turn the ability is used (that turn = turn 0, so a 2-cd ability is available again 2 turns later).
- During exploration, cooldowns tick down 1 per room moved.
- All abilities start off cooldown at game start.

## Abilities

### Vanguard

**Shield Wall** (3 cd)
- Taunts all enemies to target the Vanguard for 2 turns.
- Vanguard gains +50% defense (rounded down) for the duration.
- If the Vanguard is downed, taunt ends immediately.

**Rally** (4 cd)
- All allies in the room gain +3 defense for 2 turns.
- Does not stack with itself — reapplying refreshes the duration.

### Shadowblade

**Backstab** (2 cd)
- Deals 2.5x base damage to a single target.
- Bypasses target defense entirely (defense treated as 0 for this attack).
- No attack QTE — this is a guaranteed precision strike.

**Pickpocket** (passive, no cooldown)
- After combat victory, 30% chance to roll one extra loot item from the defeated mob's loot table.
- The extra item enters the normal loot distribution flow (need/greed/pass in multiplayer, auto-award in solo).
- Only one Pickpocket roll per combat regardless of how many Shadowblades are in the party — first Shadowblade in initiative order gets the roll.

### Cleric

**Heal** (2 cd)
- Restore 30% of target ally's max HP (rounded down). Can target self.
- Cannot target downed allies — use the existing Revive mechanic for that.

**Blessed Ward** (4 cd)
- Target ally becomes immune to being downed for 1 turn.
- If they would reach 0 HP, they stay at 1 HP instead.
- Visual indicator on the warded player in the combat UI.

### Artificer

**Smoke Bomb** (3 cd)
- All enemies skip their next turn.
- If multiple mobs are present, all are affected.
- Does not stack — using it while enemies are already skipping refreshes to 1 turn.

**Scout Drone** (passive, exploration)
- When the Artificer enters a room, all adjacent unrevealed rooms gain an "enemies detected" or "all clear" indicator on the minimap.
- This does NOT reveal the room (no room data sent to client) — it only adds the enemy indicator.
- The indicator is based on whether the room has an `encounter` field.
- If no Artificer is in the party, no scouting occurs.

## Combat Integration

### Action UI
- Abilities appear as additional combat action buttons alongside Attack / Defend / Use Item / Flee.
- Buttons are greyed out with a numeric cooldown counter when on cooldown.
- Targeted abilities (Backstab, Heal, Blessed Ward) show a target selection prompt — ally list for Heal/Ward, enemy list for Backstab.
- Non-targeted abilities (Shield Wall, Rally, Smoke Bomb) activate immediately.

### Buff/Debuff Tracking
- Active buffs/debuffs are tracked per-combat as a list of `{ type, turnsRemaining, sourcePlayerId, value? }` on each participant.
- Buffs tick down at the start of the buffed entity's turn.
- Taunt is tracked on mob AI — taunted mobs must target the taunt source. If the source is not a valid target (downed, fled), taunt ends and mob resumes normal targeting.

### Combat Action Resolution
- `use_ability` is a new combat action type: `{ action: 'use_ability', abilityId: string, targetId?: string }`.
- Ability resolution happens in the same phase as other player actions (during the player's turn in initiative order).
- CombatManager validates: player has the ability (looked up from class definition), not on cooldown, valid target type.
- Resolution delegates to `AbilityResolver` which iterates the ability's `effects` array and applies each primitive. No ability-specific branching in CombatManager.

### AbilityResolver
- A new module (`server/src/AbilityResolver.ts`) that maps effect primitive names to handler functions.
- Each handler receives the combat state, caster, target(s), and effect params.
- Adding a new primitive means adding one handler function and registering it — all existing abilities and the resolver loop remain untouched.

## Exploration Integration

### Cooldown Ticking
- When `handleMove` resolves a successful move, all ability cooldowns for the moving player tick down by 1.
- This is independent of combat — walking through empty rooms recovers abilities.

### Passive Ability Triggers
Passives are not class-specific code paths. The server maintains a registry of trigger hooks (`on_room_enter`, `on_combat_victory`, etc.). After the relevant game event, it checks all players in the room for passive abilities matching that trigger, then executes their effects through the same `AbilityResolver` used for active abilities.

- **`on_room_enter`**: fires in `handleMove` after a successful move. Example: Scout Drone checks adjacent rooms for encounters and sends `scout_result`.
- **`on_combat_victory`**: fires in `finishCombat` before loot distribution. Example: Pickpocket rolls for extra loot. Only the first matching player in initiative order gets the roll to prevent stacking.

## Data Architecture — Swappable Classes

Classes and abilities are fully data-driven. Class definitions live in a JSON file (`shared/src/data/classes.json`). Ability effects are composed from a fixed set of reusable **effect primitives** — adding a new ability means combining existing primitives in JSON, not writing new code. New primitives only need code when a genuinely new mechanic is introduced.

### Design Principles
- **Classes defined in JSON** — base stats, starter item IDs, and ability definitions are all data. Swapping a class means editing JSON.
- **Abilities composed from effect primitives** — each ability has an `effects` array describing what it does. The server's `AbilityResolver` reads these and applies them generically.
- **Passive abilities use trigger hooks** — passives declare a `trigger` (e.g., `on_combat_victory`, `on_room_enter`) and the server fires them at the appropriate point. No class-specific `if (className === 'shadowblade')` checks.
- **Starter items are regular items** — defined in the items JSON with unique IDs, referenced by the class definition. They go through the same equip/inventory system as any other gear.

### Effect Primitives

These are the building blocks that abilities compose from:

| Primitive | Params | Description |
|-----------|--------|-------------|
| `deal_damage` | `multiplier`, `ignoreDefense` | Deal damage to target. Multiplier applied to base damage. |
| `heal` | `percentMaxHp` | Restore % of target's max HP. |
| `apply_buff` | `buffType`, `duration`, `value?` | Apply a buff to target(s). |
| `apply_debuff` | `debuffType`, `duration`, `targets` | Apply debuff to enemies. `targets`: `all` or `single`. |
| `skip_turn` | `duration`, `targets` | Cause target(s) to skip turns. |
| `taunt` | `duration` | Force all enemies to target the caster. |
| `prevent_down` | `duration` | Target stays at 1 HP instead of being downed. |
| `extra_loot_roll` | `chance` | % chance to roll extra loot on combat victory. |
| `scout_adjacent` | (none) | Reveal enemy presence in adjacent rooms. |

New primitives (e.g., `summon_ally`, `apply_dot`) are added by implementing a handler function in `AbilityResolver` and registering the primitive name — no other code changes needed.

### Data Format

`shared/src/data/classes.json`:
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
  }
]
```

The other three classes follow the same structure. Passive abilities use a `trigger` field:
```json
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
```

```json
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
```

### New Types (shared)

```typescript
type PlayerClassName = string; // not a union — driven by classes.json

interface ClassDefinition {
  id: string;
  displayName: string;
  description: string;
  baseStats: { maxHp: number; damage: number; defense: number; initiative: number };
  starterWeaponId: string;
  starterOffhandId: string;
  abilities: AbilityDefinition[];
}

interface AbilityEffect {
  type: string; // primitive name: 'deal_damage' | 'heal' | 'apply_buff' | etc.
  [key: string]: unknown; // params vary by primitive
}

interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  targetType: 'none' | 'ally' | 'enemy';
  passive: boolean;
  trigger?: string; // for passives: 'on_combat_victory' | 'on_room_enter' | etc.
  effects: AbilityEffect[];
}

interface AbilityCooldown {
  abilityId: string;
  turnsRemaining: number;
}

interface ActiveBuff {
  type: string;
  turnsRemaining: number;
  sourcePlayerId: string;
  value?: number;
}
```

### Modified Types

- `Player` gains: `className: PlayerClassName`, `cooldowns: AbilityCooldown[]`
- `CombatPlayerInfo` gains: `className: PlayerClassName`, `cooldowns: AbilityCooldown[]`, `buffs: ActiveBuff[]`
- `MobInstance` gains: `buffs: ActiveBuff[]` (for tracking smoke bomb skip)

### New Messages

```typescript
// Client -> Server
interface UseAbilityMessage {
  type: 'use_ability';
  abilityId: string;
  targetId?: string;
}

// Server -> Client
interface ScoutResultMessage {
  type: 'scout_result';
  roomId: string;
  adjacentThreats: Partial<Record<Direction, boolean>>;
}

interface AbilityCooldownMessage {
  type: 'ability_cooldown';
  playerId: string;
  cooldowns: AbilityCooldown[];
}
```

### Modified Messages

- `join_lobby` gains: `className: PlayerClassName`
- `lobby_state` player entries gain: `className: PlayerClassName`
- `combat_action_result` gains: `abilityId?: string` for ability-specific narration
- `combat_turn` gains: `buffs` state for display updates

## UI Changes

### Lobby
- Class selector appears between name input and the player list.
- Four buttons or a dropdown, each showing class name and a one-line description.
- Selected class shown next to each player's name in the lobby list.

### Combat
- Ability buttons rendered in the action bar below the existing Attack/Defend/Use Item/Flee row.
- Greyed out + cooldown number overlay when on cooldown.
- Target selection: clicking a targeted ability highlights valid targets; clicking a target confirms.
- Active buffs shown as small icons on the participant's combat portrait (shield icon for Rally, ward glow for Blessed Ward, taunt icon on taunted mobs).

### Minimap
- Scout drone threat indicators: small skull icon or checkmark beside unexplored exits, only visible to the Artificer's client (or broadcast to party — either works, recommend broadcast so the whole party benefits from the intel).

### PlayerHUD
- Class name displayed below player name.
- Ability cooldowns visible outside combat as well (so players can see recovery progress while exploring).
