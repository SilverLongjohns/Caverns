# Line of Sight Shadow — Design Document

## Overview

Add within-room line of sight (LoS) shadow rendering to the tile grid. Tiles exist in three visibility states: **unseen** (black), **explored** (dimmed terrain, no actors), and **visible** (full brightness, all entities). Vision is computed client-side using the existing `getVisibleTiles` function from `roomgrid/src/lineOfSight.ts`. A torch pickup mechanic extends vision range as an exploration reward.

### Design Goals

- Make rooms feel spatial — you can't see around corners or behind walls
- Create tension through limited information — mobs and interactables hidden until sighted
- Reward thorough exploration — walking through a room reveals its layout permanently
- Torch pickups add a resource-management layer without consuming inventory slots

---

## Vision Model

### Three Visibility States

Every tile in a room exists in one of three states per player:

| State | Terrain | Entities (mobs, interactables, players, items) | Rendering |
|---|---|---|---|
| **Unseen** | Hidden | Hidden | Empty/black — renders as a space character with no styling |
| **Explored** | Visible (dimmed) | Hidden | Terrain at ~30% opacity, no entity overlays |
| **Visible** | Visible (full) | Visible | Current rendering behavior, unchanged |

The player's own `@` character is always rendered at full brightness regardless of state.

### Explored State Persistence

- Tiles transition from unseen → visible when they enter the player's field of view
- Tiles transition from visible → explored when the player moves and they leave the field of view
- Tiles never revert from explored → unseen — once seen, the terrain layout is remembered
- Explored state is tracked per-room per-player in client-side state (a `Set<string>` of `"x,y"` keys)
- Explored state resets when the player leaves a room and re-enters (rooms are small enough that this is fine)

### What Gets Hidden

In shadow (unseen or explored tiles):
- Mobs (pre-combat wandering positions)
- Interactables (both used and unused)
- Other players
- Items on the floor

Always visible regardless of LoS:
- The local player's `@` character

---

## Vision Range

### Base Range

**6 tiles** (Chebyshev distance). This means a 13x13 diamond of potential visibility centered on the player, subject to wall occlusion.

At range 6, a player standing in the middle of a small room (dead-end, tunnel) sees most of it. Larger rooms (chambers, caverns) require walking through to fully explore. Walls and obstacles create meaningful blind spots at any room size.

### Torch Extension

Torches extend vision range to **9 tiles** while active. See Torch Mechanic section below.

---

## Torch Mechanic

### Concept

Torches are environmental objects placed on walls during room generation. Players collect them automatically by walking adjacent. A torch extends vision range and burns down with movement.

### Torch Placement

- Torches are a wall decoration placed during tile grid generation
- They appear as a distinct character on wall tiles (e.g., `†` or `!`) rendered in warm amber/orange
- Placement density: ~1-2 torches per room, weighted toward larger rooms
- Not every room has a torch — maybe 50-60% of rooms
- Torch wall tiles are walkable-adjacent (the torch is on the wall, player walks next to it)

### Pickup Behavior

- When a player moves to a floor tile orthogonally adjacent to a wall torch, the torch is auto-collected
- The torch disappears from the wall (tile reverts to normal wall)
- A torch HUD element appears at the top of the screen
- If the player already has an active torch, picking up a new one refills the fuel bar

### Torch HUD

- Displays at the top of the room view area
- Shows a torch icon (e.g., `🔥` or ASCII art) and a horizontal fuel bar
- Fuel bar decreases as the player moves
- Bar color transitions: amber → orange → red as fuel depletes
- When fuel hits zero, the torch icon and bar disappear

### Fuel System

- Each torch has a fuel value of **30 moves** (tiles walked)
- Fuel decreases by 1 per tile moved while torch is active
- Standing still does not consume fuel
- Torch extends vision range from 6 → 9 while active
- When fuel reaches 0, vision reverts to base range (6)
- Torch fuel persists across rooms — entering a new room with an active torch starts with extended vision

### Multiplayer

- Each player has their own torch state
- Picking up a wall torch removes it for all players in the room (first-come-first-served)
- Torch state is local to each client — no server protocol changes needed
- However, torch pickup needs to be broadcast so the wall tile updates for all players

---

## Client-Side Implementation

### Visibility Computation

All LoS computation happens on the client. The existing `getVisibleTiles` function from `roomgrid` does the heavy lifting:

```typescript
import { getVisibleTiles } from '@caverns/roomgrid';

// On each player position change:
const range = hasTorch ? 9 : 6;
const visiblePositions = getVisibleTiles(tileGrid.tiles, playerPos, range);
const visibleSet = new Set(visiblePositions.map(p => `${p.x},${p.y}`));

// Update explored set (union of all previously visible tiles)
for (const key of visibleSet) {
  exploredSet.add(key);
}
```

### State Shape

New state in the game store (or local component state in `RoomView`):

```typescript
// Per-room explored tiles — reset on room change
exploredTiles: Set<string>        // "x,y" keys of tiles the player has seen
currentVisibleTiles: Set<string>  // "x,y" keys of tiles currently in LoS

// Torch state
torchFuel: number                 // remaining moves, 0 = no torch
```

### TileGridView Changes

`TileGridView` receives a visibility map and uses it to determine rendering per tile:

```typescript
interface TileGridViewProps {
  tileGrid: { ... };
  entities: EntityOverlay[];
  alert?: { x: number; y: number } | null;
  visibleTiles: Set<string>;      // currently in LoS
  exploredTiles: Set<string>;     // previously seen
}
```

Rendering logic per tile:

```typescript
const key = `${x},${y}`;
const isVisible = visibleTiles.has(key);
const isExplored = exploredTiles.has(key);

if (!isVisible && !isExplored) {
  // Unseen — render empty space
  cells.push(<span key={x} className="tile-unseen">{' '}</span>);
} else if (!isVisible && isExplored) {
  // Explored — render terrain only, dimmed
  cells.push(<span key={x} className={`${tileClass} tile-explored`}>{char}</span>);
} else {
  // Visible — render normally (existing behavior)
  // entities rendered as before
}
```

Entity filtering: entities on non-visible tiles are excluded from the overlay list before passing to `TileGridView`. This filtering happens in `RoomView`'s entity memo.

### CSS

```css
.tile-unseen {
  color: transparent;
  background: transparent;
}

.tile-explored {
  opacity: 0.3;
}
```

The CRT scanline and vignette effects layer on top of this naturally — dimmed tiles will look even darker through the CRT filter, which reinforces the atmosphere.

### Torch HUD Component

A small component rendered above the tile grid in `RoomView`:

```
  [†========----]    (amber bar, partially depleted)
```

- Only renders when `torchFuel > 0`
- Bar width proportional to `torchFuel / maxFuel`
- Color classes: `torch-full` (amber), `torch-mid` (orange, < 50%), `torch-low` (red, < 20%)

---

## Server-Side Changes

### Torch Wall Theme

Torches use the existing wall theme system rather than adding a new tile type. A wall tile tagged with theme `"torch"` renders with a torch character and warm color on the client. This avoids changes to the room grid engine's tile type system.

### Torch Pickup Message

When a player moves adjacent to a torch wall, the server broadcasts:

```typescript
// Client → Server (piggybacks on existing move/grid_move)
// No new message needed — server detects adjacency on movement

// Server → Client (broadcast to room)
interface TorchPickupMessage {
  type: 'torch_pickup';
  playerId: string;
  position: { x: number; y: number };  // wall tile position
  fuel: number;                          // fuel amount (30)
}
```

On receiving `torch_pickup`:
- The torch wall tile is updated (theme removed) for all clients
- The picking-up player's torch state is set

### Tile Grid Generation

Add torch placement as a post-processing step in `tileGridBuilder.ts`:

1. After room grid is finalized, find wall tiles that are orthogonally adjacent to at least one floor tile
2. From eligible positions, randomly select 1-2 for torch placement (50-60% of rooms get any)
3. Tag selected wall tiles with a `"torch"` theme

---

## Multiplayer Considerations

- Each player computes their own LoS independently from their own position
- Players standing near each other effectively share vision since they see similar areas
- There is no shared vision merging — each client only knows what its own player can see
- Torch pickups are first-come-first-served and broadcast to all players in the room
- Explored tile state is per-client, not shared

---

## Edge Cases

### Combat

During active combat (`activeCombat` is set for the room), LoS shadow is **disabled** — all tiles render at full visibility. Combat is already its own focused view and adding shadow to it would complicate the turn-based UI without adding value. Shadow resumes when combat ends.

### Room Entry

When entering a room for the first time, the explored set is empty. The player's initial position determines the first visible area. This creates a natural "reveal" moment as the room fades in from darkness.

### Room Re-entry

Explored tiles reset when leaving a room. Re-entering starts fresh. This keeps shadow relevant on backtracking without requiring persistent per-room state. However, torch fuel carries over — if you had 15 moves of fuel when leaving, you enter the next room with extended vision and 15 moves remaining.

### Mob Alert

The mob alert `!` indicator should only display if the mob's position is within the player's visible tiles. If the mob is in shadow, no alert shows — the player won't know it's there until they have line of sight.

---

## Summary of Changes

| Area | Change |
|---|---|
| `roomgrid` | No changes — `getVisibleTiles` already exists |
| `TileGridView` | Add `visibleTiles` and `exploredTiles` props, three-state rendering |
| `RoomView` | Compute LoS on player position change, filter entities by visibility, manage explored state |
| `gameStore` | Add `torchFuel` and torch-related state |
| `tileGridBuilder.ts` | Add torch wall placement during generation |
| `GameSession.ts` | Detect torch adjacency on movement, broadcast `torch_pickup` |
| `messages.ts` | Add `torch_pickup` server message type |
| `styles/index.css` | Add `.tile-unseen`, `.tile-explored`, torch HUD styles |
| New component | `TorchHUD` — small fuel bar display |
