# Energy System Design

**Date:** 2026-04-10
**Status:** Approved

## Overview

Replace the per-ability cooldown system with a single energy resource per player. Energy gates ability usage through costs rather than turn-based cooldowns.

## Constants

- **Max energy:** 30
- **Starting energy:** 30 (full)
- **Combat regen:** +2 per executed player turn
- **Persistence:** Energy persists between combat encounters (does not reset)

## Data Model Changes

### AbilityDefinition (`classTypes.ts`)

Remove `cooldown: number`. Add `energyCost: number`.

### AbilityCooldown (`classTypes.ts`)

Remove this type entirely.

### Player (`types.ts`)

- Add `energy: number` (current energy, 0-30)
- Remove `cooldowns: AbilityCooldown[]`

## Energy Costs

| Ability | Class | Cost | Rationale |
|---------|-------|------|-----------|
| Shield Wall | Vanguard | 15 | Strong defensive, moderate cost |
| Rally | Vanguard | 20 | Party-wide buff, high cost |
| Backstab | Shadowblade | 25 | Massive damage + ignores defense |
| Heal | Cleric | 10 | Core utility, usable often |
| Blessed Ward | Cleric | 20 | Prevents death, high value |
| Smoke Bomb | Artificer | 25 | Skips ALL enemy turns, very powerful |

Passive abilities (Pickpocket, Scout Drone) have no energy cost (they trigger automatically).

## Server Logic

### PlayerManager

Replace cooldown methods with energy methods:

- `spendEnergy(playerId, cost)` — deduct cost from player energy
- `regenEnergy(playerId, amount)` — add amount, capped at 30
- `hasEnergy(playerId, cost)` — return whether player has >= cost energy

Remove: `tickCooldowns()`, `setCooldown()`, `isAbilityReady()`.

### GameSession

- `handleUseAbility()`: check `hasEnergy(playerId, ability.energyCost)` instead of `isAbilityReady`. Call `spendEnergy(playerId, ability.energyCost)` instead of `setCooldown`. Error message changes from "on cooldown" to "not enough energy".
- After resolving each player turn in combat (all action types, not just abilities): call `regenEnergy(playerId, 2)`.

### Player initialization

- Set `energy: 30` when player joins
- Remove cooldown initialization from `PlayerManager.addPlayer()`

## Client Changes

### CombatView.tsx

- Show player energy near the ability buttons (e.g., "Energy: 22/30")
- Each ability button shows its energy cost (e.g., "Backstab (25)")
- Disable ability buttons when `player.energy < ability.energyCost` instead of checking cooldowns
- Remove cooldown badge rendering

### PlayerHUD.tsx

- Display energy as a small bar or numeric readout alongside HP

### Zustand store (`gameStore.ts`)

- Handle `energy` field from `player_update` messages
- Remove `cooldowns` handling

## Message Protocol

No new message types needed. The existing `player_update` message carries the full player state, which will now include `energy` instead of `cooldowns`.

## Future Considerations

- Out-of-combat ability usage (energy as shared resource)
- Real-time energy regen between fights
- Items or buffs that modify energy regen rate or max energy
- Class-specific max energy values
