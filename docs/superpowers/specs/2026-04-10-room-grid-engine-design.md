# Room Grid Engine Design

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Sub-project 1 of 6 — pure logic library for 2D tile grids

## Overview

A new `roomgrid/` workspace providing a dependency-free TypeScript library for 2D tile-based room grids. Handles tile storage, entity placement, 8-directional movement, Bresenham's line-of-sight, and A* pathfinding. No server/client coupling — consumed by the game server as a pure logic package.

## Workspace Structure

```
roomgrid/
  package.json          — name: @caverns/roomgrid, no external deps
  tsconfig.json         — extends root tsconfig
  src/
    types.ts            — TileType, Entity, GridPosition, RoomGridConfig, MoveResult
    RoomGrid.ts         — Core grid class: tile queries, entity management, movement
    lineOfSight.ts      — Bresenham's algorithm, visibility computation
    pathfinding.ts      — A* search on the tile grid
    index.ts            — Public re-exports
  __tests__/
    RoomGrid.test.ts
    lineOfSight.test.ts
    pathfinding.test.ts
```

The workspace is added to the root `package.json` workspaces array. Server imports via `@caverns/roomgrid`.

## Data Model

### Tile Types

```ts
type TileType = 'floor' | 'wall' | 'exit';

interface ExitData {
  direction: Direction;   // reuses shared Direction type
  targetRoomId: string;
}

interface Tile {
  type: TileType;
  exit?: ExitData;        // present only when type === 'exit'
}
```

### Grid Position

```ts
interface GridPosition {
  x: number;
  y: number;
}
```

### Entities

Entities are dynamic objects placed on floor tiles. The grid stores them separately from the static tile array.

```ts
type EntityType = 'player' | 'mob' | 'interactable';

interface Entity {
  id: string;
  type: EntityType;
  position: GridPosition;
}
```

### Room Grid Config

```ts
interface RoomGridConfig {
  width: number;
  height: number;
  tiles: TileType[][];       // row-major: tiles[y][x]
  exits?: { position: GridPosition; data: ExitData }[];
}
```

### Move Result

Movement returns a result describing what happened, including any events triggered.

```ts
type MoveEvent =
  | { type: 'combat'; entityId: string }
  | { type: 'exit'; exit: ExitData }
  | { type: 'interact'; entityId: string };

interface MoveResult {
  success: boolean;
  newPosition?: GridPosition;
  events: MoveEvent[];
}
```

- `combat` — the moving entity landed on or adjacent to a mob
- `exit` — the moving entity stepped onto an exit tile
- `interact` — the moving entity stepped onto an interactable's tile

## RoomGrid API

### Constructor

```ts
constructor(config: RoomGridConfig)
```

Builds the grid from config. Validates dimensions match tile array. Applies exit data to exit tiles.

### Tile Queries

```ts
getTile(pos: GridPosition): Tile | null           // null if out of bounds
isWalkable(pos: GridPosition): boolean             // true for floor and exit tiles
isInBounds(pos: GridPosition): boolean
```

### Entity Management

```ts
addEntity(entity: Entity): void                    // throws if tile not walkable
removeEntity(id: string): void
getEntity(id: string): Entity | null
getEntitiesAt(pos: GridPosition): Entity[]
getEntitiesByType(type: EntityType): Entity[]
```

### Movement

```ts
moveEntity(id: string, direction: GridDirection): MoveResult
```

`GridDirection` includes all 8 directions: `'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`.

Movement rules:
1. Target tile must be in bounds and walkable
2. If target tile is an exit, return `MoveResult` with an `exit` event
3. If target tile has a mob entity (and mover is a player), return `combat` event — mover does not move onto the tile (stays in place), combat is triggered at range
4. If target tile has an interactable, return `interact` event — mover moves onto the tile
5. Entity position is updated on success

Movement does not happen if the target tile is a wall or out of bounds (`success: false`, empty events).

### Visibility

```ts
getVisibleTiles(from: GridPosition, range: number): GridPosition[]
hasLineOfSight(from: GridPosition, to: GridPosition): boolean
```

Delegates to `lineOfSight.ts`. See Line of Sight section below.

### Pathfinding

```ts
findPath(from: GridPosition, to: GridPosition, opts?: PathfindingOpts): GridPosition[] | null
```

Delegates to `pathfinding.ts`. See Pathfinding section below.

## Line of Sight

**Algorithm:** Bresenham's line algorithm traces tiles from origin to target. If any tile along the line is a wall, LOS is blocked.

**Range:** Chebyshev distance (max of |dx|, |dy|). `getVisibleTiles` checks all tiles within the given range and returns those with unblocked LOS.

**Wall corners:** A wall tile blocks LOS through it. Diagonal movement past a wall corner (where two walls meet diagonally) also blocks LOS — both adjacent orthogonal tiles must be non-wall for diagonal LOS to pass.

**Implementation (`lineOfSight.ts`):**

```ts
function bresenhamLine(from: GridPosition, to: GridPosition): GridPosition[]
function hasLineOfSight(tiles: Tile[][], from: GridPosition, to: GridPosition): boolean
function getVisibleTiles(tiles: Tile[][], from: GridPosition, range: number): GridPosition[]
```

These are pure functions that take the tile array directly — no class dependency.

## Pathfinding

**Algorithm:** A* with Chebyshev distance heuristic.

**Cost model:** Uniform cost — cardinal and diagonal moves cost the same, consistent with Chebyshev distance and the movement system.

**Options:**

```ts
interface PathfindingOpts {
  blockedByEntities?: boolean;   // default: false
}
```

When `blockedByEntities` is true, tiles occupied by entities are treated as unwalkable (useful for mob AI avoiding other mobs).

**Implementation (`pathfinding.ts`):**

```ts
function findPath(
  tiles: Tile[][],
  entities: Entity[],
  from: GridPosition,
  to: GridPosition,
  opts?: PathfindingOpts
): GridPosition[] | null
```

Returns the full path from `from` to `to` (inclusive of both endpoints), or `null` if no path exists. Pure function — takes tile array and entity list directly.

## Dependencies

None. The library is self-contained with zero external dependencies. All algorithms (Bresenham's, A*) are implemented directly — they're small enough (~15 and ~70 lines respectively) that importing packages would add more complexity than it saves.

The `Direction` type is imported from `@caverns/shared` for exit data compatibility.

## Out of Scope

- Room generation / procedural layout (sub-project 2)
- Rendering / ASCII display (sub-project 3)
- Integration with GameSession (sub-project 4)
- Mob AI behavior (sub-project 5)
- Multi-room transitions (sub-project 6)
