# LoS Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add within-room line of sight shadow rendering with three visibility states (unseen/explored/visible) and a torch pickup mechanic that extends vision range.

**Architecture:** Client-side LoS computation using the existing `getVisibleTiles` from `roomgrid/src/lineOfSight.ts`. Torch placement happens server-side during tile grid generation. Torch pickup is detected server-side on movement and broadcast to all players. All visibility rendering is client-only.

**Tech Stack:** React (TileGridView component), Zustand (gameStore), roomgrid package (LoS functions), server tile grid builder

---

### Task 1: Add Torch State to Game Store

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add torch_pickup to ServerMessage union in shared/messages.ts**

Add after the `LevelUpMessage` interface:

```typescript
export interface TorchPickupMessage {
  type: 'torch_pickup';
  playerId: string;
  position: { x: number; y: number };
  fuel: number;
}
```

Add `TorchPickupMessage` to the `ServerMessage` union type:

```typescript
export type ServerMessage =
  // ...existing types...
  | LevelUpMessage
  | TorchPickupMessage;
```

- [ ] **Step 2: Add torch state and explored tiles to gameStore**

Add to the `GameStore` interface:

```typescript
torchFuel: number;
torchMaxFuel: number;
exploredTiles: Set<string>;
```

Add to `initialState`:

```typescript
torchFuel: 0,
torchMaxFuel: 0,
exploredTiles: new Set<string>(),
```

- [ ] **Step 3: Handle torch_pickup message in handleServerMessage**

Add a new case in `handleServerMessage`:

```typescript
case 'torch_pickup': {
  if (msg.playerId === get().playerId) {
    set({ torchFuel: msg.fuel, torchMaxFuel: msg.fuel });
  }
  // Update the wall tile theme to remove the torch for all players
  set((state) => {
    const roomId = state.currentRoomId;
    const room = state.rooms[roomId];
    if (!room?.tileGrid?.themes) return {};
    const newThemes = room.tileGrid.themes.map((row, y) =>
      row.map((theme, x) =>
        x === msg.position.x && y === msg.position.y && theme === 'torch' ? null : theme
      )
    );
    return {
      rooms: {
        ...state.rooms,
        [roomId]: {
          ...room,
          tileGrid: { ...room.tileGrid, themes: newThemes },
        },
      },
    };
  });
  break;
}
```

- [ ] **Step 4: Decrement torch fuel on local player movement**

In the `player_position` case, after updating positions, decrement torch fuel if the message is for the local player:

```typescript
case 'player_position': {
  const isLocal = msg.playerId === get().playerId;
  set((state) => ({
    playerPositions: {
      ...state.playerPositions,
      [msg.playerId]: { x: msg.x, y: msg.y },
    },
    ...(isLocal ? {
      selectedInteractableId: null,
      pendingInteractActions: null,
      torchFuel: Math.max(0, state.torchFuel - 1),
    } : {}),
  }));
  break;
}
```

- [ ] **Step 5: Reset explored tiles on room change**

In the `player_moved` case (which fires on room transitions), reset `exploredTiles` when the local player changes rooms:

```typescript
...(isMe ? {
  activePuzzle: null,
  selectedInteractableId: null,
  pendingInteractActions: null,
  exploredTiles: new Set<string>(),
} : {}),
```

- [ ] **Step 6: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add shared/src/messages.ts client/src/store/gameStore.ts
git commit -m "feat: add torch state and explored tiles to game store"
```

---

### Task 2: Add LoS Computation to RoomView

**Files:**
- Modify: `client/src/components/RoomView.tsx`

- [ ] **Step 1: Import getVisibleTiles and add LoS computation**

Add import at top of `RoomView.tsx`:

```typescript
import { getVisibleTiles } from '@caverns/roomgrid';
import type { Tile } from '@caverns/roomgrid';
```

Add new store selectors:

```typescript
const torchFuel = useGameStore((s) => s.torchFuel);
const exploredTiles = useGameStore((s) => s.exploredTiles);
```

- [ ] **Step 2: Compute visible tiles from player position**

Add a `useMemo` that computes the visible tile set. Place this after the `tileGrid` memo. The return type is `Set<string> | undefined` — `undefined` means "show everything" (used during combat in Task 8):

```typescript
const visibleTiles = useMemo<Set<string> | undefined>(() => {
  if (!tileGrid) return undefined;
  const myPos = playerPositions[playerId];
  if (!myPos) return undefined;

  const BASE_VISION = 6;
  const TORCH_VISION = 9;
  const range = torchFuel > 0 ? TORCH_VISION : BASE_VISION;

  // Convert string[][] tiles to Tile[][] for getVisibleTiles
  const tileObjects: Tile[] [] = tileGrid.tiles.map((row: string[]) =>
    row.map((t: string) => ({ type: t as any }))
  );

  const visible = getVisibleTiles(tileObjects, myPos, range);
  const set = new Set(visible.map((p) => `${p.x},${p.y}`));

  // Update explored tiles in the store (side effect, but needs to happen on position change)
  const store = useGameStore.getState();
  const newExplored = new Set(store.exploredTiles);
  let changed = false;
  for (const key of set) {
    if (!newExplored.has(key)) {
      newExplored.add(key);
      changed = true;
    }
  }
  if (changed) {
    useGameStore.setState({ exploredTiles: newExplored });
  }

  return set;
}, [tileGrid, playerPositions, playerId, torchFuel]);
```

- [ ] **Step 3: Filter entities by visibility**

Wrap the entity filtering at the end of the `entities` memo. Replace the `return overlays;` line with:

```typescript
// Filter out entities not in visible tiles (undefined = show all)
if (visibleTiles) {
  return overlays.filter((e) => visibleTiles.has(`${e.x},${e.y}`));
}
return overlays;
```

Update the memo's dependency array to include `visibleTiles`.

- [ ] **Step 4: Pass visibility sets to TileGridView**

Update the `TileGridView` call in the JSX:

```tsx
<TileGridView
  tileGrid={tileGrid}
  entities={entities}
  alert={mobAlert && mobAlert.roomId === currentRoomId && visibleTiles.has(`${mobAlert.x},${mobAlert.y}`) ? { x: mobAlert.x, y: mobAlert.y } : null}
  visibleTiles={visibleTiles}
  exploredTiles={exploredTiles}
/>
```

Note the mob alert is now also gated by visibility.

- [ ] **Step 5: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: Type errors in TileGridView (props don't exist yet — fixed in Task 3)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/RoomView.tsx
git commit -m "feat: compute LoS visibility and filter entities in RoomView"
```

---

### Task 3: Three-State Rendering in TileGridView

**Files:**
- Modify: `client/src/components/TileGridView.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add visibility props to TileGridView**

Update the `TileGridViewProps` interface:

```typescript
interface TileGridViewProps {
  tileGrid: {
    width: number;
    height: number;
    tiles: string[][];
    themes?: (string | null)[][];
  };
  entities: EntityOverlay[];
  alert?: { x: number; y: number } | null;
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
}
```

Both are optional so existing callers (if any) don't break.

- [ ] **Step 2: Add three-state rendering logic**

In the inner tile loop (the `for (let x = 0; x < width; x++)` block), add visibility checks before the existing entity/tile rendering:

```typescript
for (let x = 0; x < width; x++) {
  const key = `${x},${y}`;
  const isVisible = !visibleTiles || visibleTiles.has(key);
  const isExplored = exploredTiles?.has(key) ?? false;

  // Unseen — render empty space
  if (!isVisible && !isExplored) {
    cells.push(<span key={x} className="tile-unseen">{' '}</span>);
    continue;
  }

  // Explored but not currently visible — show terrain only, dimmed
  if (!isVisible && isExplored) {
    const tileType = tiles[y][x];
    const theme = themes?.[y]?.[x];
    const tileClass = theme
      ? `tile-${tileType} tile-theme-${theme} tile-explored`
      : `tile-${tileType} tile-explored`;

    if (tileType === 'water') {
      cells.push(
        <span key={x} className={tileClass}>
          <WaterChar theme={theme} />
        </span>
      );
    } else {
      const char = getTileChar(tiles as any, x, y);
      cells.push(
        <span key={x} className={tileClass}>
          {char}
        </span>
      );
    }
    continue;
  }

  // Visible — existing rendering (entity or tile)
  const entity = entityMap.get(key);
  const tileType = tiles[y][x];
  const theme = themes?.[y]?.[x];

  if (entity) {
    cells.push(
      <span key={x} className={entity.className} style={entity.style}>
        {entity.char}
      </span>
    );
  } else {
    const tileClass = theme
      ? `tile-${tileType} tile-theme-${theme}`
      : `tile-${tileType}`;

    if (tileType === 'water') {
      cells.push(
        <span key={x} className={tileClass}>
          <WaterChar theme={theme} />
        </span>
      );
    } else {
      const char = getTileChar(tiles as any, x, y);
      cells.push(
        <span key={x} className={tileClass}>
          {char}
        </span>
      );
    }
  }
}
```

This replaces the existing inner loop body. The `entity` lookup and `tileType`/`theme` declarations that currently exist at the top of the loop move into the "visible" branch.

- [ ] **Step 3: Add CSS for unseen and explored states**

Add to `client/src/styles/index.css` after the existing tile type colors section:

```css
/* === LoS Shadow States === */
.tile-unseen {
  color: transparent;
}

.tile-explored {
  opacity: 0.3;
}
```

- [ ] **Step 4: Add torch wall theme CSS**

Add to the biome theme overrides section in `client/src/styles/index.css`:

```css
/* Torch on wall — warm amber glow */
.tile-wall.tile-theme-torch {
  color: #ffaa33;
  text-shadow: 0 0 4px rgba(255, 170, 51, 0.5), 0 0 8px rgba(255, 100, 0, 0.3);
}
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TileGridView.tsx client/src/styles/index.css
git commit -m "feat: three-state LoS rendering in TileGridView"
```

---

### Task 4: Torch Wall Placement in Tile Grid Builder

**Files:**
- Modify: `server/src/tileGridBuilder.ts`

- [ ] **Step 1: Add torch placement post-processing**

Add a function after the existing `exitPosition` function in `tileGridBuilder.ts`:

```typescript
function placeTorches(
  tiles: string[][],
  themes: (string | null)[][] | undefined,
  width: number,
  height: number,
  roomType: string
): (string | null)[][] {
  // Ensure themes array exists
  const out = themes
    ? themes.map((row) => [...row])
    : tiles.map((row) => row.map(() => null));

  // Determine torch count by room type
  const maxTorches: Record<string, number> = {
    tunnel: 1,
    chamber: 2,
    cavern: 2,
    dead_end: 1,
    boss: 3,
  };
  const count = maxTorches[roomType] ?? 1;

  // 50% chance the room has no torches at all
  if (Math.random() < 0.5) return out;

  // Find eligible wall tiles: wall tiles orthogonally adjacent to at least one floor tile
  const eligible: { x: number; y: number }[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== 'wall') continue;
      const hasFloorNeighbor =
        tiles[y - 1]?.[x] === 'floor' ||
        tiles[y + 1]?.[x] === 'floor' ||
        tiles[y][x - 1] === 'floor' ||
        tiles[y][x + 1] === 'floor';
      if (hasFloorNeighbor) eligible.push({ x, y });
    }
  }

  if (eligible.length === 0) return out;

  // Shuffle and pick up to count
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  const placed = Math.min(count, eligible.length);
  for (let i = 0; i < placed; i++) {
    const { x, y } = eligible[i];
    out[y][x] = 'torch';
  }

  return out;
}
```

- [ ] **Step 2: Call placeTorches in buildTileGrid**

In the `buildTileGrid` function, after the existing themes logic, add torch placement. Replace the return statement:

```typescript
  const finalThemes = placeTorches(config.tiles as string[][], themes ?? undefined, width, height, room.type);

  return {
    width,
    height,
    tiles: config.tiles as string[][],
    themes: finalThemes,
  };
```

This replaces the existing return block:

```typescript
  return {
    width,
    height,
    tiles: config.tiles as string[][],
    ...(themes ? { themes } : {}),
  };
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p server/tsconfig.json`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add server/src/tileGridBuilder.ts
git commit -m "feat: place torch wall themes during tile grid generation"
```

---

### Task 5: Torch Pickup Detection on Server

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Add torch adjacency check method**

Add a private method to the `GameSession` class:

```typescript
private checkTorchPickup(playerId: string, roomId: string, pos: { x: number; y: number }): void {
  const room = this.rooms.get(roomId);
  if (!room?.tileGrid?.themes) return;

  const { themes, tiles } = room.tileGrid;
  // Check 4 orthogonal neighbors for torch-themed wall tiles
  const neighbors = [
    { x: pos.x, y: pos.y - 1 },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x + 1, y: pos.y },
  ];

  for (const n of neighbors) {
    if (n.y < 0 || n.y >= themes.length) continue;
    if (n.x < 0 || n.x >= (themes[0]?.length ?? 0)) continue;
    if (themes[n.y][n.x] === 'torch' && tiles[n.y][n.x] === 'wall') {
      // Remove torch from room data
      themes[n.y][n.x] = null;

      // Broadcast pickup
      this.broadcastToRoom(roomId, {
        type: 'torch_pickup',
        playerId,
        position: { x: n.x, y: n.y },
        fuel: 30,
      } as any);

      this.broadcastToRoom(roomId, {
        type: 'text_log',
        message: 'You grab a torch from the wall. The shadows retreat.',
        logType: 'narration',
      });

      return; // Only pick up one torch per move
    }
  }
}
```

- [ ] **Step 2: Call checkTorchPickup after grid movement**

In the `handleGridMove` method, after the position broadcast block (after `this.broadcastToRoom(player.roomId, { type: 'player_position', ... })`), add:

```typescript
this.checkTorchPickup(playerId, player.roomId, moveResult.newPosition);
```

Also call it after spawning in a new room (after the `newRoomGrid.addEntity(...)` line in the exit handling block):

```typescript
this.checkTorchPickup(playerId, targetRoomId, spawnPos);
```

- [ ] **Step 3: Add torch_pickup to the ServerMessage type assertion**

The `broadcastToRoom` call uses `as any` for the `torch_pickup` message. This is because we already added the type to `shared/src/messages.ts` in Task 1. Verify the type is there and remove the `as any` if the import is up to date. If there are build issues with the import, keep the `as any` temporarily.

- [ ] **Step 4: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p server/tsconfig.json`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add server/src/GameSession.ts
git commit -m "feat: detect torch wall adjacency and broadcast pickup"
```

---

### Task 6: Torch HUD Component

**Files:**
- Create: `client/src/components/TorchHUD.tsx`
- Modify: `client/src/components/RoomView.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Create TorchHUD component**

Create `client/src/components/TorchHUD.tsx`:

```typescript
import { useGameStore } from '../store/gameStore.js';

export function TorchHUD() {
  const fuel = useGameStore((s) => s.torchFuel);
  const maxFuel = useGameStore((s) => s.torchMaxFuel);

  if (fuel <= 0) return null;

  const pct = fuel / maxFuel;
  const barClass = pct < 0.2 ? 'torch-low' : pct < 0.5 ? 'torch-mid' : 'torch-full';

  return (
    <div className="torch-hud">
      <span className="torch-icon">†</span>
      <div className="torch-bar-bg">
        <div
          className={`torch-bar-fill ${barClass}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add TorchHUD to RoomView**

In `RoomView.tsx`, import and render the `TorchHUD` above the `TileGridView`:

```typescript
import { TorchHUD } from './TorchHUD.js';
```

In the JSX return, add `<TorchHUD />` before `<TileGridView>`:

```tsx
return (
  <div className="room-view">
    <div className="room-title">{room.name}</div>
    <TorchHUD />
    <TileGridView
      tileGrid={tileGrid}
      entities={entities}
      alert={...}
      visibleTiles={visibleTiles}
      exploredTiles={exploredTiles}
    />
  </div>
);
```

- [ ] **Step 3: Add torch HUD styles**

Add to `client/src/styles/index.css`:

```css
/* === Torch HUD === */
.torch-hud {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-family: inherit;
}

.torch-icon {
  color: #ffaa33;
  text-shadow: 0 0 4px rgba(255, 170, 51, 0.5);
  font-size: 1em;
}

.torch-bar-bg {
  width: 120px;
  height: 6px;
  background: #1a1a1a;
  border: 1px solid #333;
}

.torch-bar-fill {
  height: 100%;
  transition: width 0.2s ease;
}

.torch-full {
  background: #ffaa33;
  box-shadow: 0 0 4px rgba(255, 170, 51, 0.4);
}

.torch-mid {
  background: #ff7700;
  box-shadow: 0 0 4px rgba(255, 119, 0, 0.4);
}

.torch-low {
  background: #ff3300;
  box-shadow: 0 0 4px rgba(255, 51, 0, 0.4);
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TorchHUD.tsx client/src/components/RoomView.tsx client/src/styles/index.css
git commit -m "feat: add TorchHUD fuel bar component"
```

---

### Task 7: Torch Wall Rendering Character

**Files:**
- Modify: `roomgrid/src/rendering/tileChars.ts`
- Modify: `client/src/components/TileGridView.tsx`

- [ ] **Step 1: Handle torch-themed walls in TileGridView**

In `TileGridView.tsx`, when rendering a visible or explored wall tile with the `"torch"` theme, override the character to `†`. In both the explored and visible branches where wall tiles are rendered, add a check:

In the visible tile branch, after computing `char` via `getTileChar`, add:

```typescript
const displayChar = (tileType === 'wall' && theme === 'torch') ? '†' : char;
```

Use `displayChar` instead of `char` in the `<span>`. Apply the same logic in the explored branch.

This avoids modifying the `roomgrid` rendering module for a client-only concern.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TileGridView.tsx
git commit -m "feat: render torch-themed walls with † character"
```

---

### Task 8: Disable LoS During Combat

**Files:**
- Modify: `client/src/components/RoomView.tsx`

- [ ] **Step 1: Bypass LoS when combat is active**

In the `visibleTiles` memo in `RoomView.tsx`, add an early return when combat is active in the current room:

```typescript
const visibleTiles = useMemo<Set<string>>(() => {
  if (!tileGrid) return new Set();

  // During combat, all tiles are visible
  if (activeCombat && activeCombat.roomId === currentRoomId) {
    return new Set(); // empty set + the optional check in TileGridView means all visible
  }

  const myPos = playerPositions[playerId];
  if (!myPos) return new Set();
  // ...rest of existing LoS logic
}, [tileGrid, playerPositions, playerId, torchFuel, activeCombat, currentRoomId]);
```

Since Task 2 already types `visibleTiles` as `Set<string> | undefined`, and the entity filter already handles `undefined`, we just need to add the combat early-return. Add this after `if (!tileGrid) return undefined;` in the `visibleTiles` memo:

```typescript
// During combat, all tiles are visible — return undefined to skip LoS
if (activeCombat && activeCombat.roomId === currentRoomId) {
  return undefined;
}
```

Add `activeCombat` and `currentRoomId` to the memo's dependency array.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && node.exe node_modules/.bin/tsc --noEmit -p client/tsconfig.json`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RoomView.tsx
git commit -m "feat: disable LoS shadow during active combat"
```

---

### Task 9: Manual Testing

**Files:** None (testing only)

- [ ] **Step 1: Start dev servers**

Start the server and client in separate terminals:

```bash
# Terminal 1 (Windows/PowerShell)
npm run dev:server

# Terminal 2 (Windows/PowerShell)
npm run dev:client
```

- [ ] **Step 2: Test basic LoS rendering**

1. Join a game and start
2. Verify the room renders with shadow — tiles not in LoS should be black/hidden
3. Walk around the room with WASD — verify tiles become visible as you approach
4. Walk away from explored areas — verify they dim (30% opacity) but terrain remains visible
5. Verify mobs and interactables are hidden in shadow until you have LoS to them

- [ ] **Step 3: Test torch pickup**

1. Look for `†` characters on walls (amber colored)
2. Walk adjacent to a torch wall — verify it auto-collects
3. Verify the torch HUD appears with a fuel bar
4. Walk around — verify the bar decreases
5. Verify vision range is noticeably larger with torch active
6. Walk until fuel runs out — verify bar disappears and vision shrinks back

- [ ] **Step 4: Test torch persistence across rooms**

1. Pick up a torch
2. Move to another room via an exit
3. Verify the torch HUD is still showing with remaining fuel
4. Verify extended vision is active in the new room

- [ ] **Step 5: Test combat LoS disable**

1. Enter a room with a mob encounter
2. Trigger combat
3. Verify all tiles are fully visible during combat (no shadow)
4. End combat — verify shadow rendering resumes

- [ ] **Step 6: Test room re-entry**

1. Explore a room partially
2. Leave the room
3. Re-enter — verify explored tiles reset (room starts in shadow again)

- [ ] **Step 7: Commit any fixes from testing**

If any issues found during testing, fix and commit.
