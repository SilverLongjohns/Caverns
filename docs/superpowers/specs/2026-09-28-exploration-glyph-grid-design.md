# Exploration on the Glyph Grid

**Date:** 2026-09-28
**Branch:** `feature/exploration-glyph-grid`, from `main` at `cec03de`.
**Status:** Design approved section by section; pending spec review.
**Context:** This is the first step in bringing exploration up to combat's level of polish. `docs/superpowers/ideas/2026-09-28-exploration-fun.md` holds the wider ideas list and the decision to keep exploration and combat as separate modes.

## Intent

The arena looks finished:
- 34×50 cells;
- multi-colour 24px glyph sprites;
- a camera that follows the active unit;
- a canvas minimap;
- edge fades;
- smooth path animation.

Exploration looks like the old prototype:
- small Courier cells;
- `@` and a mob's first letter for units;
- no camera;
- units that snap from tile to tile.

Both already render terrain through the same `TileGridView`. All of the polish lives in a combat-only wrapper, `ArenaGrid`.

This spec puts exploration on the same visual system. It adds sprites for players, mobs and furnishings, a camera that follows the player, a minimap that respects fog, and tweened movement.

### User decisions (2026-09-28)

- **Scope:** port the grid, plus **furnishing** sprites (22). **Interactables stay ASCII**, restyled so they stand out as things you can use. No terrain art: walls, water and floors stay ASCII, in keeping with the CRT identity.
- **Camera:** always follows the player, with no manual pan in exploration. Arrow keys and WASD keep moving the player. Steps are tweened for players and mobs. The minimap shows only explored tiles and can be clicked to peek.
- **Combat seam:** unchanged. Encounters still cut to a separately generated arena. Fighting in the explored room is a possible future project.
- **Architecture:** extract a shared `GlyphViewport` from `ArenaGrid`. Rejected alternatives:
  - feeding exploration into `ArenaGrid` disguised as combat participants;
  - duplicating `ArenaGrid`.

### Hard rules carried over

- **Data-driven:** no code, CSS or test names a specific furnishing, mob or class. Sprite lists live in manifests.
- **Missing art never breaks rendering:** any unit or prop without a sprite falls back to its ASCII character.
- **No visible change to the arena:** the refactor must leave combat looking exactly as it does now.
- **Reduced motion:** no step tweens and no camera glides; everything snaps.

## 1. Components

### 1.1 `GlyphViewport` (new: `client/src/components/grid/GlyphViewport.tsx`)

This takes everything reusable out of `ArenaGrid.tsx` (roughly lines 14-24, 132-210 and 280-302 today):

- **Cell geometry:** `CELL_W = 34`, `CELL_H = 50`, `GRID_BORDER`, plus the `glyph-grid` classes and CSS that currently sit under `.arena-grid-container.glyph-grid`. That CSS gets a shared class, e.g. `.glyph-viewport`, which both views use.
- **Sizing:** a ResizeObserver works out how many columns and rows fit.
- **Camera:**
  - `clampCam`;
  - follow the unit named by `focusId`;
  - the world layer is moved with a `translate`.
  - A prop `panKeys` (`true` in the arena, `false` in exploration) turns manual arrow-key panning on or off.
- **Minimap:**
  - Draws terrain, units and the view rectangle; clicking it jumps the view there.
  - When fog props are given, it draws only explored tiles, and draws units only on currently visible tiles.
  - In exploration, a click lets you peek; the camera re-centres on the player the next time they move.
- **Edge fades.**
- **Unit layer**, in one of two modes:
  - `inline`: units are drawn inside the tile cells, as the arena does today. The arena's path animation (a requestAnimationFrame overlay) is unchanged.
  - `floating`: units are drawn on an absolutely positioned layer above the terrain. Each unit is placed at `x·CELL_W`, `y·CELL_H` (+ border) with a CSS transform, and a transition slides it between cells. Exploration uses this.
- **Fog:** optional `visibleTiles` and `exploredTiles` are passed through to `TileGridView`.
- **Pass-through props:** `tileHighlights`, `onTileClick`, `onTileHover`, `onTileHoverEnd`.
- **Overlay slot:** a `children` slot rendered inside the world layer. The arena mounts `FxNumbers` and `FxOverlay` here.

The pure parts go in `client/src/components/grid/viewportMath.ts` and are unit-tested:
- camera clamp and follow;
- cell to pixel;
- which tiles and units the minimap draws.

### 1.2 `ArenaGrid` (refactor)

`ArenaGrid` becomes a thin combat layer on `GlyphViewport` in `inline` mode:
- builds entities from `CombatParticipant`s (via `getParticipantGlyph`);
- adds the active-turn pulse and faction underline;
- maps board effects (`useBoardFxStore`);
- keeps the path animation, the ghost entity, hit labels, `FxNumbers` and `FxOverlay`.

It keeps its public props. Unused props (`movementRange`, `isTargeting`) may be dropped along with their call sites. The behaviour and the look stay identical.

### 1.3 `ExplorationGrid` (new; replaces `RoomView`'s rendering)

`RoomView` keeps its data logic:
- line of sight via `getVisibleTiles`;
- vision radius 4, or 7 while carrying a torch;
- the 3×3 glow from torch walls;
- merging explored tiles into the store.

It renders `ExplorationGrid`, which uses `GlyphViewport` in `floating` mode with `focusId` = the local player and `panKeys={false}`.

Entities:
- **Players**, including party members in the same room: the class glyph from `getParticipantGlyph({ type: 'player', className })`, falling back to `@`.
  - Faction underline as in the arena.
  - The local player gets the active pulse or a subtle highlight, so you can always find yourself.
- **Mobs:** the mob glyph from `templateId` (§2), falling back to the first letter. Drawn only on visible tiles, as today, and not while that room has a combat running.
- **Furnishings:** the furnishing sprite (§3), falling back to `char`.
- **Interactables:** their ASCII `asciiChar`, enlarged to fill the cell (arena terrain size), with a soft phosphor glow so they read as usable. Used interactables are dimmed, as today.
  - **Bug fix:** an interactable furnishing is currently pushed twice at the same x,y, and the furnishing entry wins. Build one entity per position: interactable styling combined with the furnishing's sprite if it has one.
- **Mob alert "!":** positioned from the mob's cell in pixels, not the current `ch`/`em` offsets.

The entity-building logic lives in a pure `buildExplorationEntities(...)` (in `client/src/exploration/explorationEntities.ts`), with unit tests covering:
- sprite choice versus ASCII fallback;
- fog filtering;
- the de-duplication fix;
- the combat-room exclusion.

### 1.4 Layout

`App.tsx` keeps `<Compass/>` and `<RoomView/>` inside `.room-area`. The room area grows to fill the main panel, the way the arena view does, so the viewport has room. The side-column room-graph `MiniMap` is unchanged. The tile minimap is the one inside the viewport.

## 2. Protocol and data

- **`MobSpawnMessage` gains `templateId: string`.** `server/src/MobAIManager.ts` `registerRoom` and `reactivateMob` send it from `MobInstance.templateId`. The client store's `mobPositions` entries gain `templateId`. `mob_position` stays position-only; the client keeps the templateId it got at spawn.
- **`Furnishing` gains `id: string`,** the furnishing definition id from `server/src/data/furnishingData.json`, set by `furnishingPlacer.ts`. It's optional on the client type, so rooms saved or serialised without it still render (with ASCII).
- **Sprite manifest:** `client/src/glyphManifest.ts` gains `FURNISHING_GLYPHS` (a list of ids). `client/src/glyphs.ts` gains `getFurnishingGlyph(id?: string): string | null`, which returns `/sprites/glyphs/furnishings/<id>.png` only for ids in the manifest.

## 3. Movement and camera

- **Step tween:** when a unit's position changes by one tile (from `player_position` or `mob_position`), its floating element slides with a CSS transition of `stepMs`.
  - `stepMs` is 120, below the server's 150ms move rate, so holding a key produces continuous movement rather than queued lag.
  - `stepMs` lives in one exported constant, e.g. `EXPLORE_TIMING.stepMs`.
- **Mobs** use the same slide. Pursuit steps come every 600ms and wander steps every 1500ms.
- **Camera follow:** the camera re-centres on the local player with a transition matched to `stepMs` (linear), so walking doesn't jitter.
- **Room change** (`player_moved` to a new room): no tween. Units snap, the camera jumps with no transition, and the explored-tile reset works as today.
- **Multi-tile jumps** (a teleport or re-sync of more than one tile): snap, no slide.
- **Reduced motion:** transitions off; units and camera snap.
- **No facing flips:** sprites keep their default orientation, as in the arena.
- **Input is unchanged:** `useGridMovement` (WASD and arrows, 4 directions, 150ms cooldown). Exploration disables manual panning, so there's no conflict.

## 4. Furnishing art (22 sprites)

- **Recipe:** follow the arena glyph pipeline. See memory and commit `e7d9de1`, and `art/candidates/glyphs/chosen.json`.
  - PixelLab `create_1_direction_object` at 24px.
  - Multi-colour, Caves-of-Qud relic-tech style, matching the existing mob and class glyphs.
  - Normalised bottom-aligned and drawn at 48×48 like the other glyphs.
- **Prompts are built from data:** each furnishing's `name` and biome in `furnishingData.json`, via a small script.
- **Budget:** the subscription is used up until 2026-10-23, so this runs on credits. Check the balance and confirm the estimate with the user before generating.
- **User approval gate:** a labelled contact sheet of candidates (`art/candidates/furnishings/_sheet.png`). Nothing is installed before the user picks.
- **Install:** `client/public/sprites/glyphs/furnishings/<id>.png`, the manifest updated, and the picks recorded in `art/candidates/furnishings/chosen.json`.

## 5. Out of scope

- Terrain art (walls, water, floors stay ASCII).
- Interactable sprites.
- Other biomes' furnishings (only starter-biome furnishings exist today).
- Fighting in the explored room.
- Facing flips.
- 8-direction keyboard input.
- Click-to-move in exploration.
- Loot shown on the grid.
- The ideas-doc juice (dash, sight cones, loot beams, scanner).
- `WorldMapView` (dead code).

## 6. Testing

- **Unit tests:**
  - `viewportMath` (clamp, follow, cell to pixel, fogged minimap selection);
  - `buildExplorationEntities` (sprite and fallback, fog, de-dup, combat exclusion);
  - `getFurnishingGlyph`.
- **Server tests:**
  - `mob_spawn` includes `templateId` (in `MobAIManager.test.ts`);
  - placed furnishings carry a definition `id` (in `furnishingPlacer.test.ts` / `tileGridBuilder.test.ts`).
- **Arena refactor check:** before-and-after sandbox screenshots (`scripts/sandbox-drive.mjs`, e.g. duel and showcase) must match visually. The existing client tests (boardFx, closeUpStage, arenaBarMode, shotTargets) stay green.
- **Exploration check:** headless screenshots (`.sandbox/explore-shot.mjs`, or an equivalent committed script if that one is missing) of:
  - a room with fog;
  - walking several steps (mid-slide);
  - a mob visible and alerted;
  - furnishings with and without sprites;
  - a room change.

  Then a manual pass by the user in the dev build.
- **Full suites:** shared, server, client (vitest + `tsc`) green.
