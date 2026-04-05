# Combat UI Design Spec

## Goal

Replace the current dropdown-based combat interface with a JRPG-style combat view that transforms the text log area during combat. Party on the left, enemies on the right, a compact combat log, and a state-machine-driven action menu.

---

## Layout Swap

When `activeCombat` is non-null in the Zustand store, the main column in `App.tsx` swaps from:
- TextLog + ActionBar

To:
- CombatView (single component, fills the entire main column)

The side column (MiniMap, PartyPanel, PlayerHUD) remains visible. PartyPanel can be visually dimmed during combat since the CombatView already shows party status.

When combat ends (`activeCombat` goes null), CombatView unmounts and TextLog + ActionBar return. The text log retains its full history so the player can scroll back.

---

## CombatView Component

A new `client/src/components/CombatView.tsx` component with three zones:

```
┌─────────────────────────────────┐
│  PARTY            │  ENEMIES    │
│                   │             │
│  Alice            │  ┌─────────┐│
│  ██████░░ HP      │  │ Goblin  ││
│  ► (turn)         │  │██████░░ ││
│                   │  └─────────┘│
│  Bob              │  ┌─────────┐│
│  ████░░░ HP       │  │Orc Chief││
│                   │  │████████ ││
│                   │  └─────────┘│
├───────────────────┴─────────────┤
│ > Goblin takes 12 damage!       │
│ > Alice's turn.                 │
├─────────────────────────────────┤
│  [Attack] [Defend] [Items] [Flee]│
└─────────────────────────────────┘
```

### Party Zone (top-left, ~50% width)

Each party member in the current room's combat shows:
- Player name
- HP bar (character-based: `████░░░░` colored green→yellow→red by percentage)
- Turn indicator: blinking `►` next to the active participant

Downed players: name in red, HP bar empty.

Data source: `activeCombat.participants` filtered to `type === 'player'`, cross-referenced with `players` from the store for current HP.

### Enemy Zone (top-right, ~50% width)

Each living enemy displayed as a "name plate":
- Mob name
- Skull rating (☠ repeated)
- HP bar (same style as party)

Clickable when in target-selection mode (pulsing border, highlighted on hover). Dead enemies briefly flash then are removed from display.

Data source: `activeCombat.participants` filtered to `type === 'mob'`.

### Combat Log Strip (middle)

A fixed-height area showing the 3 most recent combat-type messages. Styled with CRT monospace font, slightly dimmer than the action area. New messages push old ones up.

Source: the store's `textLog` array filtered to `logType === 'combat'`, taking the last 3 entries. Only messages added after combat started should be shown (track the textLog length at combat start to avoid showing stale messages from previous combats). The full text log still accumulates all messages — when combat ends and TextLog remounts, everything is preserved.

### Action Bar (bottom)

A state-machine-driven action menu. See Action Flow section below.

---

## Action Flow State Machine

The action bar within CombatView has the following states:

### Idle (not your turn)

Action buttons hidden. Displays "Waiting for turn..." text.

Active when: `currentTurnId !== playerId`

### Main Menu (your turn)

Four buttons displayed horizontally: `Attack`, `Defend`, `Items`, `Flee`

- **Defend** fires immediately — sends `combat_action` with `action: 'defend'`, returns to idle.
- **Attack**, **Items**, **Flee** transition to their respective sub-states.

Active when: `currentTurnId === playerId` and no sub-state selected.

### Target Selection (after Attack)

Enemy name plates in the enemy zone highlight as clickable (pulsing border). A `Back` button appears in the action area to return to main menu.

Clicking an enemy sends `combat_action` with `action: 'attack'` and `targetId` set to the clicked enemy's ID. Returns to idle.

Also used for damage consumables (see Item Selection).

### Item Selection (after Items)

Displays the player's consumable pouch slots as a vertical list. Each occupied slot shows the item name and a brief stat summary (e.g., "heals 25" or "20 dmg"). Empty slots are hidden. A `Back` button returns to main menu.

- **Healing item clicked:** Immediately sends `combat_action` with `action: 'use_item'` and the `itemIndex`. Returns to idle.
- **Damage item clicked:** Transitions to target selection mode. After enemy is clicked, sends `combat_action` with `action: 'use_item'`, `targetId`, and `itemIndex`. Returns to idle.

### Flee Direction (after Flee)

Shows directional buttons for available exits from the current room (same data as exploration movement). A `Back` button returns to main menu.

Clicking a direction sends `combat_action` with `action: 'flee'` and `fleeDirection`. Returns to idle.

---

## ActionBar Cleanup

Remove all combat rendering from `ActionBar.tsx`. The component should only handle:
- Exploration mode (directional movement buttons, revive)
- Loot prompt (need/greed/pass)
- Downed state ("Waiting for revival...")

All combat interaction moves to CombatView.

---

## Styling

All styling uses the existing CRT aesthetic — monospace font, dark background, existing CSS variables (`--color-text`, `--color-dim`, `--color-bg`).

- **HP bars:** Character-based using block characters (`█` for filled, `░` for empty). Colored green (>50%), yellow (25-50%), red (<25%) via CSS classes.
- **Turn indicator:** Blinking `►` character next to the active participant's name (CSS animation).
- **Target selection mode:** Enemy plates get a pulsing border when selectable. Highlighted border on hover. Cursor changes to pointer.
- **Downed players:** Name rendered in red, HP bar shows all empty blocks.
- **Dead enemies:** Removed from display (the `combat_action_result` handler already filters them out of `activeCombat.participants`).
- **Action buttons:** Same button style as existing game buttons, laid out horizontally in a clear row.
- **Combat log strip:** Slightly dimmer text (`--color-dim`), fixed height for 3 lines, no scroll.
- **Back button:** Styled distinctly (dimmer, smaller) to be clearly a "cancel" action.

No new CSS variables or theme changes needed.

---

## Data Flow

CombatView reads from the Zustand store:
- `activeCombat` — participants, turn order, current turn
- `currentTurnId` — whose turn it is
- `playerId` — the local player's ID
- `players` — full player data (for HP, consumables, room)
- `rooms` — current room exits (for flee directions)
- `currentRoomId` — current room
- `textLog` — for the combat log strip (filtered to combat type)

CombatView sends actions via the same `onCombatAction` callback currently used by ActionBar. No server-side changes needed.

---

## Props Interface

```typescript
interface CombatViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
    fleeDirection?: Direction
  ) => void;
  onRevive: (targetPlayerId: string) => void;
}
```

---

## Scope Boundaries

### In Scope
- New CombatView component with party/enemy/log/action zones
- JRPG action flow state machine (main menu → target/item/flee selection)
- Character-based HP bars with color coding
- Turn indicator
- Compact 3-line combat log strip
- Target selection via clickable enemy plates
- Remove combat mode from ActionBar
- Layout swap in App.tsx

### Out of Scope
- ASCII art for enemies (deferred)
- Combat animations or transitions
- Sound effects
- Keyboard shortcuts for combat actions
- Mobile/responsive layout
- Changes to combat logic or server code
