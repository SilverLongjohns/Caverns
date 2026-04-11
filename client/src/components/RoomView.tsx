import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getInteractableDefinition } from '@caverns/shared';
import type { InteractableInstance } from '@caverns/shared';
import { TileGridView } from './TileGridView.js';
import type { EntityOverlay } from './TileGridView.js';

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

  const room = rooms[currentRoomId];

  const tileGrid = useMemo(() => {
    if (!room) return null;
    return room.tileGrid ?? null;
  }, [room]);

  const entities = useMemo<EntityOverlay[]>(() => {
    if (!room || !tileGrid) return [];
    const overlays: EntityOverlay[] = [];

    // Interactables
    if (room.interactables) {
      for (const inst of room.interactables) {
        const def = getInteractableDefinition(inst.definitionId);
        if (!def) continue;
        const used = isFullyUsed(inst);
        overlays.push({
          x: inst.position.x,
          y: inst.position.y,
          char: def.asciiChar,
          className: used ? 'entity-interactable-used' : 'entity-interactable',
        });
      }
    }

    // Mob (pre-combat wandering) — from mobPositions store
    if (!activeCombat || activeCombat.roomId !== currentRoomId) {
      const mobDataList = mobPositions[currentRoomId];
      if (mobDataList) {
        for (const mobData of mobDataList) {
          overlays.push({
            x: mobData.x,
            y: mobData.y,
            char: mobData.mobName[0] ?? '?',
            className: 'entity-mob',
          });
        }
      }
    }

    // Players at their real grid positions — from playerPositions store
    const playersInRoom = Object.values(players).filter((p) => p.roomId === currentRoomId);
    for (const player of playersInRoom) {
      const pos = playerPositions[player.id];
      if (!pos) continue;
      overlays.push({
        x: pos.x,
        y: pos.y,
        char: '@',
        className: 'entity-player',
        style: { color: player.id === playerId ? '#44ff44' : '#88cc88' },
      });
    }

    return overlays;
  }, [room, tileGrid, activeCombat, players, currentRoomId, playerId, mobPositions, playerPositions]);

  if (!room || !tileGrid) return null;

  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <TileGridView
        tileGrid={tileGrid}
        entities={entities}
        alert={mobAlert && mobAlert.roomId === currentRoomId ? { x: mobAlert.x, y: mobAlert.y } : null}
      />
    </div>
  );
}
