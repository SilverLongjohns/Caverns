# QTE Crit Mechanic Design Spec

## Goal

Add two Undertale-inspired quick-time events to combat: a sweep bar for attack crits and a shrinking circle for active defense. Both overlay the combat battlefield area and tie into the initiative stat for speed scaling.

---

## Attack QTE — Sweep Bar

When a player selects Attack and picks a target, instead of immediately resolving damage, a horizontal bar appears as a centered overlay on the combat battlefield area.

A cursor sweeps from left to right. The player clicks to stop it. Where it lands determines a damage multiplier applied to the normal damage formula.

### Bar Zones (left to right)

| Zone | Bar Width | Multiplier |
|------|-----------|------------|
| Normal | 50% | 1.0x |
| Green | 25% | 1.5x |
| Perfect | 5% | 2.0x |
| Red | 20% | 0.75x |

The cursor auto-lands in the red zone if it reaches the end without input.

### Sweep Speed

- Base sweep duration: 1.5 seconds
- Initiative modifier: +30ms per point of initiative
- Example: 5 base init = 1.65s sweep, 15 init with gear = 1.95s sweep

### Client/Server Flow

1. Player clicks Attack, selects target — attack bar QTE plays on client
2. Player clicks to stop cursor — client determines multiplier (0.75 / 1.0 / 1.5 / 2.0)
3. Client sends `combat_action` with `action: 'attack'`, `targetId`, and `critMultiplier`
4. Server applies: `Math.max(1, Math.floor((actor.damage - effectiveDefense) * critMultiplier))`
5. Server broadcasts `combat_action_result` as normal, including the multiplier for narration

---

## Defense QTE — Shrinking Circle

When a player chooses Defend, the server records a taunt and a passive defending state. When the taunted mob attacks, the client shows a shrinking circle QTE. The player clicks when the outer circle aligns with the inner target circle.

### Taunt Mechanic

Choosing Defend forces one random living mob to target this player on its next attack. The taunt is tracked server-side. When the taunted mob's AI resolves, it overrides random target selection and attacks the defending player. Only one mob is taunted per defend action; other mobs still pick targets randomly.

If the defending player is not attacked (e.g., the taunted mob dies before its turn), the defend action is consumed with no effect.

### Circle Timing Windows

Precision is measured as the ratio of the outer circle's current radius to the inner circle's radius at the moment of click. A ratio of 1.0 means perfect overlap.

| Result | Radius Ratio Range | Damage Reduction |
|--------|-------------------|------------------|
| Perfect | 0.95 – 1.05 | 75% |
| Good | 0.80 – 0.95 or 1.05 – 1.20 | 50% |
| Graze | 0.65 – 0.80 or 1.20 – 1.35 | 25% |
| Miss | Outside 0.65 – 1.35 | 0% |

If the player doesn't click at all, it counts as a miss.

### Shrink Speed

- Base shrink duration: 1.2 seconds
- Initiative modifier: +25ms per point of initiative
- Example: 5 base init = 1.325s shrink, 15 init with gear = 1.575s shrink

### Client/Server Flow (Two-Step Resolve)

1. Player clicks Defend — client sends `combat_action` with `action: 'defend'`
2. Server marks player as defending, records taunt on one random living mob
3. When the taunted mob's turn comes, server resolves the attack but holds the damage. Server sends `combat_action_result` with a `defendQte: true` flag to the defending player, plus the raw damage in a `pendingDamage` field
4. Client shows shrinking circle QTE — player clicks — client determines reduction (0 / 0.25 / 0.5 / 0.75)
5. Client sends `defend_result` message with `damageReduction` (the fraction)
6. Server applies reduction: `finalDamage = Math.max(1, Math.floor(pendingDamage * (1 - damageReduction)))`, updates HP, broadcasts final `combat_action_result` to all players in the room
7. Server-side timeout: 5 seconds. If no `defend_result` received, full damage applied

---

## Shared Timing Config

Timing parameters live in `shared/` so both client and server agree on values. The server uses them to validate that responses arrive within reasonable windows.

```typescript
export const QTE_CONFIG = {
  attack: {
    baseDurationMs: 1500,
    initBonusMs: 30,       // per point of initiative
    zones: {
      normal:  { start: 0,    end: 0.50, multiplier: 1.0  },
      green:   { start: 0.50, end: 0.75, multiplier: 1.5  },
      perfect: { start: 0.75, end: 0.80, multiplier: 2.0  },
      red:     { start: 0.80, end: 1.00, multiplier: 0.75 },
    },
  },
  defense: {
    baseDurationMs: 1200,
    initBonusMs: 25,       // per point of initiative
    perfect: { min: 0.95, max: 1.05, reduction: 0.75 },
    good:    { min: 0.80, max: 1.20, reduction: 0.50 },
    graze:   { min: 0.65, max: 1.35, reduction: 0.25 },
  },
  defendTimeoutMs: 5000,
};
```

---

## Visual Presentation

### Overlay

Both QTEs render as a centered overlay on the **combat battlefield area** (the top section with party and enemy zones). A semi-transparent dark backdrop (`rgba(0,0,0,0.7)`) covers the battlefield to maintain readability. The action bar below shows status text ("Aim your strike..." / "Brace for impact...") but no buttons during the QTE.

### Attack Bar

- Horizontal bar rendered with block characters matching the CRT aesthetic
- Zones color-coded: normal (dim/default text color), green (`#559955`), perfect (bright amber `#d4a857`), red (`#cc4444`)
- Cursor is a blinking `▎` character that sweeps across
- On stop: brief flash (0.5s) showing which zone was hit and the multiplier text ("CRIT 1.5x", "PERFECT 2x", "MISS 0.75x")
- After flash, overlay dismisses and action bar returns to normal state

### Defense Circle

- Two concentric circles rendered with CSS (`border-radius: 50%`, border styling), not canvas
- Inner target circle: fixed size, styled with amber/gold color (`#d4a857`), subtle glow
- Outer circle: starts large, shrinks via CSS animation toward the inner circle
- On click: brief flash showing result ("PERFECT BLOCK 75%", "GOOD BLOCK 50%", "GRAZE 25%", "MISS")
- After flash, overlay dismisses

### Combat Log Narration

QTE results integrate with existing combat narration:
- Attack: "Alice lands a critical hit on Goblin for 18 damage!" / "Alice's strike goes wide — 6 damage to Goblin."
- Defense: "Bob perfectly blocks the Orc's attack! Takes only 4 damage." / "Bob fails to block — takes 15 damage."

---

## Message Protocol Changes

### Modified: `combat_action` (Client → Server)

Add optional `critMultiplier` field for attacks:

```typescript
{ type: 'combat_action', action: 'attack', targetId: string, critMultiplier: number }
```

Server clamps `critMultiplier` to the set of valid values `[0.75, 1.0, 1.5, 2.0]` to prevent tampering.

### Modified: `combat_action_result` (Server → Client)

Add optional fields:

```typescript
{
  // ...existing fields...
  critMultiplier?: number;       // included on attacks so client can narrate
  defendQte?: true;              // signals the defending player to show QTE
  pendingDamage?: number;        // raw damage before QTE reduction
}
```

### New: `defend_result` (Client → Server)

```typescript
{ type: 'defend_result', damageReduction: number }
```

Server clamps `damageReduction` to valid values `[0, 0.25, 0.5, 0.75]`.

### Modified: `combat_action_result` for defense resolution (Server → Client)

After receiving `defend_result`, server broadcasts a second `combat_action_result` with final damage applied. This message goes to all players in the room (not just the defender) so everyone sees the outcome.

---

## Server Changes

### CombatManager

- `resolvePlayerAction` for `defend`: records taunt (store which mob must target this player)
- `resolveMobTurn`: check for taunt before random target selection. If taunted, target the defending player
- New method to handle the two-step defense resolve: hold pending damage, wait for `defend_result` or timeout
- Taunt state is cleared after the taunted mob attacks (one-shot per defend action)

### GameSession

- `handleCombatAction` for `attack`: read `critMultiplier` from message, pass to `resolvePlayerAction`, clamp to valid values
- `handleCombatAction` for `defend`: pass through to CombatManager which records taunt
- New `handleDefendResult`: receive `defend_result`, apply reduction, broadcast final result, resume turn processing
- **Turn pause for defense QTE:** When `processMobTurn` detects the target is defending, it sends the `defendQte` combat_action_result and returns *without* calling `advanceTurn` or `afterCombatTurn`. Turn processing is suspended. When `handleDefendResult` (or the timeout) fires, it applies the final damage, broadcasts the result, then calls `advanceTurn` and `afterCombatTurn` to resume the turn sequence. This keeps the existing synchronous turn loop intact — the async gap only exists while waiting for the defender's input.
- Timeout logic: after sending `defendQte` result, set a 5-second `setTimeout`. If `defend_result` not received, apply full damage and resume turns. If `defend_result` arrives, clear the timeout and resume immediately.

---

## Scope Boundaries

### In Scope
- Attack sweep bar QTE overlay on battlefield area
- Defense shrinking circle QTE overlay on battlefield area
- Taunt mechanic (defend forces one mob to target you)
- `critMultiplier` field on attack combat actions
- Two-step defense resolve with `defend_result` message and server timeout
- Initiative stat affects QTE speed
- Timing parameters in shared config
- Combat log narration for QTE results
- Server-side clamping of multiplier/reduction values

### Out of Scope
- QTE on items/consumables
- Sound effects
- Keyboard shortcuts (click only)
- Difficulty-based QTE scaling (only initiative-based)
- QTE for mob attacks against non-defending players
- Mobile/touch optimization
