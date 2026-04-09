# Interactables System — Implementation Design (First Slice)

## Scope

First slice: Fungal Depths biome only, all system layers, placeholder narrations. Establishes the full vertical path from data definition through server resolution to client rendering.

### In Scope

- Shared types for interactable definitions, instances, slots, and outcomes
- Fungal Depths interactable pool (15 definitions as JSON)
- Interactable slots on Fungal Depths room chits
- ASCII room templates (4 room types: dead_end, tunnel, chamber, cavern)
- ExamineResolver server class (all 5 outcome types)
- ProceduralGenerator post-processing step for interactable placement
- GameSession message routing for examine flow
- Message protocol (examine, examine_result, interactable_state)
- RoomView client component (ASCII grid with clickable interactables)
- ActionBar examine button integration
- Store updates for interactable state and selection

### Out of Scope (deferred)

- Other 5 biome interactable pools (only Fungal Depths)
- Polished narrations (placeholder text only)
- Secret outcome bonus rooms (secrets resolve as flavor in this slice)
- Intel minimap annotations (intel text goes to TextLog only)
- Anti-spam cooldown on examine actions
- `requiredClass` gating (only `bonusClass` weight shifting)

---

## Data Model

### New Types (`shared/src/types.ts`)

```typescript
type InteractableSize = 'small' | 'medium' | 'large';

interface InteractableSlot {
  position: { x: number; y: number };
  size: InteractableSize;
}

type OutcomeType = 'loot' | 'hazard' | 'intel' | 'secret' | 'flavor';

interface OutcomeTable {
  weights: Record<OutcomeType, number>;
  bonusClassWeights?: Record<OutcomeType, number>;
}

interface InteractableDefinition {
  id: string;
  name: string;
  asciiChar: string;
  biomes: string[];
  slotSize: InteractableSize;
  bonusClass?: string;        // vanguard | shadowblade | cleric | artificer
  outcomes: OutcomeTable;
}

interface InteractableInstance {
  definitionId: string;
  instanceId: string;         // unique per room, e.g. "int_001"
  position: { x: number; y: number };
  examined: boolean;
  examinedBy?: string;        // playerId
}
```

### Extensions to Existing Types

- `RoomChit` gains `interactableSlots?: InteractableSlot[]`
- `Room` gains `interactables?: InteractableInstance[]`

### Data Files

- **New:** `shared/src/data/interactables.json` — pool of interactable definitions (15 for Fungal Depths)
- **Modified:** `shared/src/data/roomChits.json` — Fungal Depths chits gain `interactableSlots` arrays

Interactable slot positions are relative to the ASCII template grid for each room type.

### Fungal Depths Pool (15 definitions)

| ID | Name | Char | Size | Bonus Class |
|----|------|------|------|-------------|
| `fungal_glowing_cluster` | Glowing cluster | ♧ | small | cleric |
| `fungal_spore_vent` | Spore vent | ○ | medium | artificer |
| `fungal_mycelium_corpse` | Overgrown remains | ¤ | medium | cleric |
| `fungal_hollow_stump` | Hollow stump | Ω | large | shadowblade |
| `fungal_dripping_cap` | Dripping cap | ♠ | small | — |
| `fungal_web_sac` | Silk cocoon | § | medium | vanguard |
| `fungal_mossy_pool` | Still pool | ≈ | large | artificer |
| `fungal_puffball_ring` | Puffball ring | ◊ | small | — |
| `fungal_root_tangle` | Root tangle | ∞ | medium | shadowblade |
| `fungal_bark_face` | Bark face | ☺ | small | cleric |
| `fungal_rotting_crate` | Rotting crate | ■ | medium | shadowblade |
| `fungal_crystal_node` | Embedded crystal | ◆ | small | vanguard |
| `fungal_burrow` | Animal burrow | ∪ | small | artificer |
| `fungal_altar_stump` | Carved stump | † | large | cleric |
| `fungal_hanging_vines` | Curtain of vines | ║ | medium | — |

Class bonus mapping (from INTERACTABLES.md, adjusted for actual class names):

| Design Doc Class | Actual Class | Bonus On |
|---|---|---|
| Fighter | Vanguard | Structural objects (rubble, doors, walls) |
| Rogue | Shadowblade | Locked/trapped objects |
| Cleric | Cleric | Bones, altars, cursed objects |
| Ranger | Artificer | Scouting/arcane objects |

---

## ASCII Room Templates

Four templates, one per room type. Stored as string arrays in a new shared data file.

| Room Type | Dimensions | Exits |
|-----------|-----------|-------|
| dead_end | 30x8 | 1 |
| tunnel | 40x6 | 2 |
| chamber | 44x12 | 2-3 |
| cavern | 50x14 | 2-4 |

Templates use box-drawing characters for walls (`║`, `═`, `╔`, `╗`, `╚`, `╝`), gaps for exits, and biome-specific scatter characters for floor tiles.

### Floor Characters (Fungal Depths)

`. , \` '` — organic, soft feel.

### Character Coloring

| Element | Color | Hex |
|---------|-------|-----|
| Walls | dim green | `#336633` |
| Exits | bright green | `#44ff44` |
| Floor | very dim green | `#223322` |
| Interactable (unexamined) | amber | `#ffaa33` |
| Interactable (selected/hover) | bright amber + glow | `#ffcc55` |
| Interactable (examined) | dim amber | `#665522` |
| Player `@` | cyan | `#44dddd` |

---

## Message Protocol

### Client → Server

```typescript
interface ExamineMessage {
  type: 'examine';
  interactableId: string;  // instanceId from room state
}
```

Added to `ClientMessage` union type.

### Server → Client (private, examining player only)

```typescript
interface ExamineResultMessage {
  type: 'examine_result';
  interactableId: string;
  narration: string;
  outcome: {
    type: OutcomeType;
    loot?: Item;           // item added to inventory
    damage?: number;       // HP lost from hazard
    intel?: {
      targetRoomId: string;
      text: string;
    };
    // secret and flavor have no payload in this slice
  };
}
```

### Server → Client (broadcast to all players in room)

```typescript
interface InteractableStateMessage {
  type: 'interactable_state';
  interactableId: string;
  examined: boolean;
  examinedBy: string;      // player name for display
}
```

The broadcast excludes narration and outcome — other players see that an object was examined but not what happened. This forces verbal communication in multiplayer.

Both new server message types added to `ServerMessage` union.

### Existing Messages — No Changes Needed

`room_reveal` and `game_start` already send `Room` objects. Since `interactables` is added to `Room`, these messages carry interactable state automatically.

---

## Server Implementation

### ExamineResolver (`server/src/ExamineResolver.ts`)

New class following the AbilityResolver/ItemEffectResolver pattern.

```
resolve(playerId, interactableId, room, playerManager) → ExamineResult
  1. Look up interactable instance in room.interactables
  2. Reject if: not found, already examined, player not in room, room has active combat
  3. Load interactable definition from pool
  4. Get player's class, check against definition's bonusClass
  5. Pick weight table (bonusClassWeights if class matches, else normal weights)
  6. Weighted random roll → outcome type
  7. Resolve by type:
     - loot: pick random item from biome loot table, add to player inventory
     - hazard: roll damage (5-15), apply to player HP
     - intel: pick an adjacent room, generate placeholder hint text
     - secret: resolve as flavor (no bonus rooms in this slice)
     - flavor: no mechanical effect
  8. Mark instance as examined, set examinedBy
  9. Return { narration, outcomeType, mechanicalEffect }
```

### GameSession Changes

New `handleExamine(playerId, interactableId)` method:

1. Validate player is exploring (not in combat, not downed)
2. Get player's current room
3. Call `ExamineResolver.resolve()`
4. Send `examine_result` to examining player only (`sendTo`)
5. Broadcast `interactable_state` to all players in room (`broadcastToRoom`)
6. If HP changed (hazard): broadcast `player_update`
7. If inventory changed (loot): broadcast `player_update`

Message routing in `handleMessage`: add `case 'examine'` → `handleExamine()`.

### ProceduralGenerator Changes

New post-processing step added after loot distribution:

```
For each room:
  1. Skip if room type is 'boss' or room is entrance
  2. Roll density check (60-70% chance of having interactables)
  3. Get the room chit's interactableSlots (skip if none defined)
  4. For each slot:
     a. Filter biome's interactable pool by matching slotSize
     b. Weighted random select (avoid duplicates within same room)
     c. Create InteractableInstance with slot's position
  5. Attach interactables array to room
```

Interactable definitions are loaded from `interactables.json` alongside existing content pools.

---

## Client Implementation

### RoomView Component (`client/src/components/RoomView.tsx`)

New component — ASCII grid renderer.

- Renders the room's ASCII template as a grid of `<span>` elements inside a `<pre>` block
- Each character gets a CSS class based on type (wall, floor, exit, interactable)
- Interactable positions from `room.interactables` overlay the template — the definition's `asciiChar` replaces the floor character at that position
- Interactable spans are clickable — clicking sets `selectedInteractableId` in the store
- Selected interactable brightens; a tooltip shows the name
- Examined interactables render dimmed

Character count for the largest template (cavern 50x14) is ~700 spans — trivial for React.

### Interaction Flow

1. Player sees amber characters in the ASCII grid
2. Player clicks an amber character → it highlights, tooltip shows name
3. ActionBar shows "Examine" button
4. Player clicks Examine → sends `examine` message
5. Server resolves → sends `examine_result` (private) + `interactable_state` (broadcast)
6. Client appends narration to TextLog, dims the interactable in the grid
7. Other players in the room see the object dim but don't see the narration

No interactable tag list — discovery comes from visually scanning the room.

### ActionBar Changes

When `selectedInteractableId` is set and player is exploring:
- Show "Examine" button alongside movement buttons
- Clicking Examine sends the message and clears selection
- Clicking a different interactable switches selection
- Clicking floor/wall or the selected interactable again deselects

### Store Changes (`gameStore.ts`)

New state:
- `selectedInteractableId: string | null`

New handlers:
- `examine_result`: append narration to textLog (logType: 'narration'), update player state if loot/damage occurred
- `interactable_state`: find the interactable in the room's array, set `examined: true` and `examinedBy`

### App.tsx Layout Change

Exploration mode (no combat, no loot, no puzzle) becomes:

```
┌─────────────────┐
│   RoomView      │  ← ASCII room with interactable characters
├─────────────────┤
│   TextLog       │  ← narration, examine results
├─────────────────┤
│   ActionBar     │  ← move buttons + examine button
└─────────────────┘
```

Mirrors the combat layout (CombatView → combat log strip → action bar).

### No Changes To

MiniMap, PlayerHUD, PartyPanel, CombatView — these are unaffected in this slice.

---

## Interactable State Persistence

Interactable instances live on the `Room` object server-side. State is authoritative on the server and consistent across all connected clients:

- When a player examines an object, the server marks it `examined: true` and broadcasts to all players in the room
- Players entering a previously explored room receive the room via `room_reveal` with examined state already set
- No player can examine an already-examined object (server rejects)

---

## Outcome Weights

Default weights for interactable definitions:

| Outcome | Default Weight | Bonus Class Weight |
|---------|---------------|-------------------|
| Loot | 40 | 55 |
| Hazard | 15 | 3 |
| Intel | 15 | 20 |
| Secret | 10 | 10 |
| Flavor | 20 | 12 |

These are starting points. Each definition can override with its own weights. The `bonusClassWeights` shift reduces hazard risk and improves loot/intel chances when the examining player's class matches.

Note: In this slice, "secret" outcomes resolve identically to "flavor" (narration only, no bonus room). The weight is kept so the distribution is realistic for tuning.

---

## Files Changed / Created

### New Files
- `server/src/ExamineResolver.ts` — outcome resolution logic
- `server/src/ExamineResolver.test.ts` — unit tests
- `client/src/components/RoomView.tsx` — ASCII room display
- `shared/src/data/interactables.json` — interactable definition pool
- `shared/src/data/roomTemplates.ts` — ASCII template strings per room type

### Modified Files
- `shared/src/types.ts` — new interactable types, Room extension
- `shared/src/data/types.ts` — RoomChit interactableSlots
- `shared/src/messages.ts` — examine/examine_result/interactable_state messages
- `shared/src/index.ts` — re-exports
- `shared/src/data/roomChits.json` — Fungal Depths chits gain slot data
- `server/src/GameSession.ts` — handleExamine, message routing
- `server/src/ProceduralGenerator.ts` — interactable placement post-processing
- `server/src/index.ts` — message routing for 'examine'
- `client/src/store/gameStore.ts` — selectedInteractableId, new message handlers
- `client/src/components/ActionBar.tsx` — examine button
- `client/src/components/App.tsx` — layout change for RoomView
- `client/src/hooks/useGameActions.ts` — examine action sender
- `client/src/styles/index.css` — RoomView styles, interactable colors
