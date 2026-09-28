import { useEffect, useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getInteractableDefinition } from '@caverns/shared';
import type { InteractableInstance } from '@caverns/shared';
import { ExplorationGrid } from './ExplorationGrid.js';
import { TorchHUD } from './TorchHUD.js';
import { buildExplorationEntities } from '../exploration/explorationEntities.js';
import { getVisibleTiles } from '@caverns/roomgrid';
import type { Tile } from '@caverns/roomgrid';

function isFullyUsed(instance: InteractableInstance): boolean {
  const def = getInteractableDefinition(instance.definitionId);
  if (!def) return false;
  const nonRepeatable = def.actions.filter((a) => !a.repeatable);
  if (nonRepeatable.length === 0) return false;
  return nonRepeatable.every((a) => a.id in instance.usedActions);
}

export function RoomView() {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const players = useGameStore((s) => s.players);
  const playerId = useGameStore((s) => s.playerId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const mobPositions = useGameStore((s) => s.mobPositions);
  const mobAlert = useGameStore((s) => s.mobAlert);
  const playerPositions = useGameStore((s) => s.playerPositions);
  const torchFuel = useGameStore((s) => s.torchFuel);
  const exploredTiles = useGameStore((s) => s.exploredTiles);

  const room = rooms[currentRoomId];

  const tileGrid = useMemo(() => {
    if (!room) return null;
    return room.tileGrid ?? null;
  }, [room]);

  const visibleTiles = useMemo<Set<string> | undefined>(() => {
    if (!tileGrid) return undefined;

    // During combat, all tiles are visible — return undefined to skip LoS
    if (activeCombat && activeCombat.roomId === currentRoomId) {
      return undefined;
    }

    const myPos = playerPositions[playerId];
    if (!myPos) return undefined;

    const BASE_VISION = 4;
    const TORCH_VISION = 7;
    const range = torchFuel > 0 ? TORCH_VISION : BASE_VISION;

    // Convert string[][] tiles to Tile[][] for getVisibleTiles
    const tileObjects: Tile[][] = tileGrid.tiles.map((row: string[]) =>
      row.map((t: string) => ({ type: t as any }))
    );

    const visible = getVisibleTiles(tileObjects, myPos, range);
    const set = new Set(visible.map((p) => `${p.x},${p.y}`));

    // Torch walls emit a 1-tile glow — add their neighbors to visible set
    if (tileGrid.themes) {
      const { width, height, themes } = tileGrid;
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          if (themes[ty]?.[tx] !== 'torch') continue;
          // Add the torch tile itself and all orthogonal+diagonal neighbors
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = tx + dx;
              const ny = ty + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                set.add(`${nx},${ny}`);
              }
            }
          }
        }
      }
    }

    return set;
  }, [tileGrid, playerPositions, playerId, torchFuel, activeCombat, currentRoomId]);

  // Merge newly seen tiles into the explored set. A store write, so it runs after render, not in the memo.
  useEffect(() => {
    if (!visibleTiles) return;
    const store = useGameStore.getState();
    const newExplored = new Set(store.exploredTiles);
    let changed = false;
    for (const key of visibleTiles) {
      if (!newExplored.has(key)) {
        newExplored.add(key);
        changed = true;
      }
    }
    if (changed) {
      useGameStore.setState({ exploredTiles: newExplored });
    }
  }, [visibleTiles]);

  const { props, units } = useMemo(() => {
    if (!room || !tileGrid) return { props: [], units: [] };
    const inCombatHere = !!activeCombat && activeCombat.roomId === currentRoomId;
    return buildExplorationEntities({
      interactables: (room.interactables ?? []).flatMap((inst) => {
        const def = getInteractableDefinition(inst.definitionId);
        return def ? [{ x: inst.position.x, y: inst.position.y, char: def.asciiChar, used: isFullyUsed(inst) }] : [];
      }),
      furnishings: tileGrid.furnishings ?? [],
      mobs: inCombatHere ? [] : (mobPositions[currentRoomId] ?? []),
      players: Object.values(players).flatMap((p) => {
        const pos = p.roomId === currentRoomId ? playerPositions[p.id] : undefined;
        return pos ? [{ id: p.id, className: p.className, x: pos.x, y: pos.y }] : [];
      }),
      localPlayerId: playerId,
      roomId: currentRoomId,
      visibleTiles,
    });
  }, [room, tileGrid, activeCombat, players, currentRoomId, playerId, mobPositions, playerPositions, visibleTiles]);

  if (!room || !tileGrid) return null;

  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <TorchHUD />
      <ExplorationGrid roomId={currentRoomId} grid={tileGrid} props={props} units={units} localPlayerId={playerId}
        visibleTiles={visibleTiles} exploredTiles={exploredTiles}
        alert={mobAlert && mobAlert.roomId === currentRoomId && visibleTiles?.has(`${mobAlert.x},${mobAlert.y}`) ? { x: mobAlert.x, y: mobAlert.y } : null} />
    </div>
  );
}
