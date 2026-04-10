# Client-Side Tile Rendering Design

## Goal

Replace the hand-authored ASCII template system with a data-driven tile grid renderer that displays `TileType[][]` grids from the room generation system, with box-drawing wall characters, theme-based coloring, animated water, and entity overlays.

## Architecture

The server sends a `tileGrid` payload (raw `TileType[][]` + optional per-tile themes) in `room_reveal`. A new `TileGridView` React component renders the grid as a `<pre>` block of `<span>` elements, with entity overlays (players, mobs, interactables) composited on top. The old template system is removed entirely.

## Scope

- New: `TileGridView` component, tile ASCII/color data, protocol changes, store changes
- Changed: `RoomView.tsx` (uses new component), `gameStore.ts` (stores tileGrid), CSS
- Removed: `getTemplateForRoom`, template data, old `.char-*` CSS classes
- Unchanged: `MiniMap.tsx`, entity data structures, CRT effects

---

## 1. Tile Rendering Data

### ASCII Characters

| TileType | Character | Notes |
|----------|-----------|-------|
| floor    | `.`       | Period |
| wall     | Box-drawing | See wall lookup below |
| exit     | `▓`       | Dense shade block |
| water    | `~` / `≈` | Animated, toggles randomly |
| chasm    | ` ` (space) | Empty void |
| hazard   | `^`       | Spikes/danger |
| bridge   | `=`       | Planks |

### Box-Drawing Wall Lookup

Each wall tile checks its 4 cardinal neighbors (N/S/E/W). If a neighbor is also a wall (or out of bounds), that direction is "connected". The 4-bit mask (N=1, S=2, E=4, W=8) indexes into a lookup table:

| Mask | Neighbors | Character |
|------|-----------|-----------|
| 0    | isolated  | `□` |
| 1    | N         | `║` |
| 2    | S         | `║` |
| 3    | N+S       | `║` |
| 4    | E         | `═` |
| 5    | N+E       | `╚` |
| 6    | S+E       | `╔` |
| 7    | N+S+E     | `╠` |
| 8    | W         | `═` |
| 9    | N+W       | `╝` |
| 10   | S+W       | `╗` |
| 11   | N+S+W     | `╣` |
| 12   | E+W       | `═` |
| 13   | N+E+W     | `╩` |
| 14   | S+E+W     | `╦` |
| 15   | N+S+E+W   | `╬` |

Out-of-bounds neighbors count as "connected" (walls at grid edges look correct).

### Default Tile Colors

| TileType | Color     |
|----------|-----------|
| floor    | `#223322` |
| wall     | `#336633` |
| exit     | `#44ff44` |
| water    | `#3355aa` |
| chasm    | `#111111` |
| hazard   | `#aa3333` |
| bridge   | `#665533` |

### Theme Color Overrides

Themes are strings set per-tile by the biome config. Each theme maps to a CSS class `.tile-theme-<name>` that overrides the base color. Examples:

- `moss_stone` → `#2a5a2a`
- `carved_stone` → `#556677`
- `obsidian` → `#332211`
- `lava` → `#ff4400` + text-shadow glow + pulse animation
- `deep_water` → `#2244aa`

New themes only require a new CSS rule. The data table in `@caverns/roomgrid` defines which themes exist; the client CSS maps them to visual styles.

---

## 2. Protocol Changes

### `room_reveal` Message

Add a `tileGrid` field to the `room_reveal` server message:

```ts
tileGrid: {
  width: number;
  height: number;
  tiles: TileType[][];
  themes?: (string | null)[][];
}
```

- `tiles`: raw `TileType[][]` from `RoomGridConfig`
- `themes`: optional per-tile theme string, only sent if biome uses tile themes. `null` entries use default styling.
- Entities (players, mobs, interactables) continue using their existing message fields.

### Removals

- Remove `template` field from room data (if present)
- Remove `getTemplateForRoom` and all template data from shared/

---

## 3. TileGridView Component

New file: `client/src/components/TileGridView.tsx`

### Props

```ts
interface TileGridViewProps {
  tileGrid: {
    width: number;
    height: number;
    tiles: TileType[][];
    themes?: (string | null)[][];
  };
  entities: EntityOverlay[];
  onInteractableClick?: (entityId: string) => void;
}

interface EntityOverlay {
  x: number;
  y: number;
  char: string;
  className: string;
  entityId?: string;  // for interactable click handling
}
```

### Rendering

- Renders as `<pre className="room-grid">` containing rows of `<span>` elements
- Each cell is a `<span>` with CSS class based on tile type and optional theme

### Cell Priority (highest wins)

1. **Entity overlay** — if an entity occupies this cell, render the entity character with entity CSS class
2. **Tile character** — from the ASCII lookup table

### Special Tile Rendering

- **Wall tiles**: compute box-drawing character from cardinal neighbor mask
- **Water tiles**: use an animated React component that toggles `~` and `≈` at random intervals (800-1500ms per tile, randomized so tiles don't sync)

```tsx
function WaterChar() {
  const [char, setChar] = useState('~');
  useEffect(() => {
    const id = setInterval(() => {
      setChar(c => c === '~' ? '≈' : '~');
    }, 800 + Math.random() * 700);
    return () => clearInterval(id);
  }, []);
  return <span>{char}</span>;
}
```

### Entity Overlay Assembly

`RoomView.tsx` assembles the `EntityOverlay[]` array from store state:

- **Players** in current room: `{ char: '@', className: 'entity-player', style with player color }`
- **Mobs** in current room: `{ char: mob.name[0], className: 'entity-mob' }`
- **Interactables** in current room: `{ char: interactable.asciiChar, className: 'entity-interactable', entityId }`

### RoomView.tsx Changes

- Remove `getTemplateForRoom` import and all template rendering logic
- Render `<TileGridView>` passing `tileGrid` from store and assembled entity list
- Interactable click handler passed as prop

---

## 4. CSS & Visual Effects

### Base Tile Classes

```css
.tile-floor    { color: #223322; }
.tile-wall     { color: #336633; }
.tile-exit     { color: #44ff44; }
.tile-water    { color: #3355aa; }
.tile-chasm    { color: #111111; }
.tile-hazard   { color: #aa3333; }
.tile-bridge   { color: #665533; }
```

### Theme Override Classes

```css
.tile-theme-moss_stone   { color: #2a5a2a; }
.tile-theme-carved_stone { color: #556677; }
.tile-theme-obsidian     { color: #332211; }
.tile-theme-deep_water   { color: #2244aa; }

.tile-theme-lava {
  color: #ff4400;
  text-shadow: 0 0 4px #ff2200, 0 0 8px #aa0000;
  animation: lava-pulse 2s ease-in-out infinite;
}

@keyframes lava-pulse {
  0%, 100% { text-shadow: 0 0 4px #ff2200, 0 0 8px #aa0000; }
  50% { text-shadow: 0 0 8px #ff4400, 0 0 16px #cc2200; }
}
```

### Entity Classes

```css
.entity-mob          { color: #ff3333; font-weight: 800; }
.entity-interactable { color: #ffaa33; cursor: pointer; }
.entity-player       { /* color set inline per player */ }
```

### Removals

Remove old template CSS classes: `.char-wall`, `.char-floor`, `.char-exit`, `.char-interactable`

### Preserved

All CRT effects (scanlines, vignette, phosphor glow, flicker) remain unchanged — they layer on top.

---

## 5. Store & Data Flow

### Store Changes

Add to `gameStore.ts`:

```ts
tileGrid: {
  width: number;
  height: number;
  tiles: TileType[][];
  themes?: (string | null)[][];
} | null;
```

### Data Flow

1. Server generates room → sends `room_reveal` with `tileGrid`
2. `handleServerMessage` stores `tileGrid` in Zustand state
3. `RoomView` reads `tileGrid` + player/mob/interactable state → assembles entity overlays
4. `TileGridView` renders grid with overlays

### Room Transitions

On `room_reveal` for a new room, store replaces `tileGrid` with new data. Simple swap, no transition animation.

### Cleanup

- Remove `shared/src/data/roomTemplates.ts` (template data and `getTemplateForRoom`)
- Remove template-related imports from `RoomView.tsx` and any other consumers
- Remove old `.char-wall`, `.char-floor`, `.char-exit`, `.char-interactable` CSS classes
