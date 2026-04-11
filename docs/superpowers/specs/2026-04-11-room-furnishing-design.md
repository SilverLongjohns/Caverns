# Room Furnishing System — Design Spec

## Goal

Populate dungeon rooms with themed furniture and decorations so they feel lived-in and distinct, rather than empty tile grids with a few interactables. Furniture is constraint-placed based on room type (what) and biome (how it looks), rendered as ASCII overlays, and some pieces double as interactables.

## Decisions

- **Constraint-based placement** — each piece has a placement rule (wall, center, corner, near-water, anywhere)
- **Room type + biome drives selection** — room type determines what furniture appears; biome flavors how it looks
- **Walkable** — all furniture is non-blocking, players walk through it
- **Mixed decorative + interactable** — some pieces are purely visual, others hook into the existing interactable system
- **Density scaled by room size** — larger rooms get more furniture, clamped per room type

## Furniture Definition

Each piece is defined in a JSON data file (`server/src/data/furnishingData.json`):

```json
{
  "id": "rotting_shelf",
  "name": "Rotting Shelf",
  "asciiChar": "▐",
  "placement": "wall",
  "roomTypes": ["chamber", "dead_end"],
  "biomes": ["dripping_halls"],
  "interactable": true,
  "weight": 10
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `asciiChar` | string | Single character rendered on tile grid |
| `placement` | enum | Placement constraint: `wall`, `center`, `corner`, `near-water`, `anywhere` |
| `roomTypes` | string[] | Which room types this piece can appear in |
| `biomes` | string[] | Which biomes this piece belongs to |
| `interactable` | boolean | If true, generates an InteractableDefinition with examine action |
| `weight` | number | Relative spawn weight within its candidate pool |

### Placement Constraints

| Constraint | Rule |
|-----------|------|
| `wall` | Floor tile with 1+ orthogonal wall neighbor |
| `center` | Floor tile with 0 orthogonal wall neighbors |
| `corner` | Floor tile with 2+ orthogonal wall neighbors that share a diagonal (i.e. walls to the north and east, not north and south) |
| `near-water` | Floor tile with 1+ orthogonal water neighbor |
| `anywhere` | Any walkable floor tile |

## Starter Content — Dripping Halls Biome

### Tunnel

| Piece | Char | Placement | Interactable |
|-------|------|-----------|-------------|
| Rubble | `░` | anywhere | no |
| Bones | `%` | anywhere | no |
| Collapsed Cart | `⊞` | wall | yes |

### Chamber

| Piece | Char | Placement | Interactable |
|-------|------|-----------|-------------|
| Table | `╥` | center | no |
| Chair | `╤` | center | no |
| Barrel | `○` | wall | no |
| Rotting Shelf | `▐` | wall | yes |
| Locked Chest | `■` | wall | yes |

### Cavern

| Piece | Char | Placement | Interactable |
|-------|------|-----------|-------------|
| Stalagmite | `▲` | anywhere | no |
| Mushroom Cluster | `♣` | anywhere | no |
| Puddle | `~` | anywhere | no |
| Glowing Fungus | `✦` | wall | yes |
| Strange Fossil | `&` | wall | yes |

### Dead End

| Piece | Char | Placement | Interactable |
|-------|------|-----------|-------------|
| Crate | `□` | corner | no |
| Cobwebs | `≈` | corner | no |
| Shrine | `†` | wall | yes |
| Old Skeleton | `%` | anywhere | yes |

### Boss

| Piece | Char | Placement | Interactable |
|-------|------|-----------|-------------|
| Pillar | `║` | center | no |
| Throne | `▣` | wall | no |
| Brazier | `*` | center | no |
| Altar | `┬` | wall | yes |
| Weapon Rack | `╫` | wall | yes |

## Placement Algorithm

Runs in `tileGridBuilder.ts` after `placeTorches()`, before returning the TileGrid.

### Step 1 — Calculate Count

```
count = floor(width * height * 0.015)
```

Clamped per room type:

| Room Type | Min | Max |
|-----------|-----|-----|
| tunnel | 1 | 3 |
| chamber | 4 | 7 |
| cavern | 6 | 12 |
| dead_end | 2 | 4 |
| boss | 8 | 15 |

### Step 2 — Build Candidate Pool

Filter furniture definitions to those matching the current `roomType` AND `biome`. Select `count` pieces via weighted random:
- Decorative pieces: replacement allowed (can have multiple barrels)
- Interactable pieces: no replacement (at most one locked chest per room)

### Step 3 — Pre-compute Position Buckets

Scan the tile grid once. For each floor tile, classify into buckets:
- Count orthogonal wall neighbors
- Count orthogonal water neighbors
- Assign to `wall` (1+ wall neighbor), `corner` (2+ wall neighbors), `center` (0 wall neighbors), `near-water` (1+ water neighbor), `anywhere` (all floor)

Exclude from all buckets:
- Exit tiles
- Tiles already occupied by interactables
- Player spawn positions (exit tiles cover this since players spawn at exits)
- Tiles occupied by previously placed furniture this pass

### Step 4 — Place Each Piece

For each selected furniture piece:
1. Look up the matching position bucket
2. Pick a random tile from that bucket
3. If bucket is empty, skip this piece
4. Remove the chosen tile from all buckets

### Step 5 — Output

Return a `Furnishing[]` array. Interactable pieces also generate entries for the room's `interactables` array.

## Data Structures

### Furnishing (on TileGrid)

```typescript
interface Furnishing {
  x: number;
  y: number;
  char: string;
  name: string;
  interactable: boolean;
}
```

Added to TileGrid:

```typescript
interface TileGrid {
  width: number;
  height: number;
  tiles: string[][];
  themes?: (string | null)[][];
  furnishings?: Furnishing[];  // new
}
```

### Interactable Integration

Furniture pieces with `interactable: true` get a corresponding `InteractableDefinition` registered in shared interactable data. These definitions use a single `examine` action with the standard outcome table (loot/hazard/intel/flavor weighted rolls). The furniture's `id` maps to the `definitionId` on the `InteractableInstance`.

## Client Rendering

### Entity Overlays in RoomView.tsx

Furnishings are added to the `entities` array in the `RoomView` component, alongside mobs, interactables, and players:

- **Decorative furniture**: CSS class `entity-furnishing`, rendered in a muted color (`#665544`)
- **Interactable furniture**: CSS class `entity-interactable` (same as existing interactables — brighter, stands out)
- **LoS**: furnishings respect visibility. Unseen tiles hide furniture. Explored tiles show furniture at 30% opacity. Visible tiles show full.
- **Entity filter**: furnishings pass through the same `visibleTiles` filter as all other entities

### No New Message Types

The `TileGrid` is already sent in `room_reveal`. Adding `furnishings` to TileGrid is sufficient. No new WebSocket message types needed.

### CSS

```css
.entity-furnishing {
  color: #665544;
}
```

## File Changes

| File | Change |
|------|--------|
| `server/src/data/furnishingData.json` | New — furniture definitions |
| `server/src/furnishingPlacer.ts` | New — placement algorithm |
| `server/src/tileGridBuilder.ts` | Modify — call `placeFurnishings()` after torches |
| `shared/src/types.ts` | Modify — add `Furnishing` interface, add `furnishings?` to `TileGrid` |
| `shared/src/interactableData.ts` | Modify — add InteractableDefinitions for interactable furniture |
| `client/src/components/RoomView.tsx` | Modify — add furnishings to entity overlays |
| `client/src/styles/index.css` | Modify — add `.entity-furnishing` style |
