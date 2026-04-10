# GameSession Integration Design

## Goal

Wire `@caverns/roomgrid` tile generation into ProceduralGenerator so procedurally generated dungeons have real tile grids instead of relying on the client-side fallback.

## Architecture

A new `buildTileGrid(room, biomeId)` helper in `server/src/tileGridBuilder.ts` converts a Room's exits and type into a `TileGrid` by calling roomgrid's `generateRoom()`. ProceduralGenerator calls it after assembling each room. GameSession calls it for dynamically created secret rooms. Static dungeons (DRIPPING_HALLS) are unaffected and continue using the client fallback grid.

## Scope

- New: `server/src/tileGridBuilder.ts`
- Modified: `server/src/ProceduralGenerator.ts` (one call per room), `server/src/GameSession.ts` (one call in `createSecretRoom`)
- Unchanged: shared types, client code, static content, RoomGrid class

---

## 1. Room Dimensions

Room dimensions are determined by `RoomType`:

| RoomType | Width | Height |
|----------|-------|--------|
| tunnel   | 30    | 8      |
| chamber  | 30    | 15     |
| cavern   | 40    | 18     |
| dead_end | 20    | 12     |
| boss     | 45    | 20     |

Stored as a `ROOM_DIMENSIONS` lookup table in `tileGridBuilder.ts`.

---

## 2. Exit-to-Position Mapping

The Room's `exits: Partial<Record<Direction, string>>` maps directions to target room IDs. Each direction maps to a tile coordinate on the room border:

- `north` -> `(Math.floor(width / 2), 0)`
- `south` -> `(Math.floor(width / 2), height - 1)`
- `west` -> `(0, Math.floor(height / 2))`
- `east` -> `(width - 1, Math.floor(height / 2))`

These become the `exits` array in `RoomGenerationRequest`.

---

## 3. buildTileGrid Helper

File: `server/src/tileGridBuilder.ts`

```ts
function buildTileGrid(room: Room, biomeId: string): TileGrid
```

**Steps:**
1. Look up `{ width, height }` from `ROOM_DIMENSIONS[room.type]`
2. Load `BiomeGenerationConfig` from `biomeGeneration.json` by matching `biomeId`. Fallback: the `starter` config.
3. Convert `room.exits` to exit entries: `{ position: { x, y }, data: { direction, targetRoomId } }`
4. Call `generateRoom({ width, height, exits, biomeConfig, roomType: room.type })` from `@caverns/roomgrid`
5. Convert `RoomGridConfig.tiles` (`TileType[][]`) to `string[][]` (they're already strings at runtime, just a type cast)
6. Build theme grid from `biomeConfig.tileThemes` if present
7. Return `{ width, height, tiles, themes? }` as `TileGrid`

---

## 4. Integration Call Sites

### ProceduralGenerator

After each room is fully assembled (exits, encounters, loot, puzzles, interactables all set), at the end of zone construction:

```ts
room.tileGrid = buildTileGrid(room, biome.id);
```

ProceduralGenerator already has the biome context for each zone, so the biome ID is readily available.

### GameSession — createSecretRoom

After the secret room object is built:

```ts
secretRoom.tileGrid = buildTileGrid(secretRoom, 'starter');
```

Secret rooms default to the `starter` biome config. The parent room's biome is not tracked on the Room object, and adding it is out of scope for this sub-project.

---

## 5. Theme Grid Construction

The `TileGrid.themes` field is a `(string | null)[][]` grid that maps each tile to an optional theme name for CSS styling. It's built from the biome's `tileThemes` config:

```ts
// biomeConfig.tileThemes example: { floor: "moss", wall: "fungal_rock", water: "spore_pool" }
```

For each tile, look up `tileThemes[tileType]`. If present, that's the theme string. If not, `null` (default styling).

If the biome has no `tileThemes` (empty object), `themes` is omitted from the TileGrid entirely.

---

## 6. What Doesn't Change

- **Message protocol** — `room_reveal` and `game_start` already send Room objects with `tileGrid?`. No changes needed.
- **Client rendering** — Already built in sub-project 3. Procedural rooms will now have real grids instead of hitting the fallback.
- **Static content (DRIPPING_HALLS)** — No tile grids added. Continues using client fallback.
- **RoomGrid class, pathfinding, entity management** — Reserved for sub-projects 5-6.
