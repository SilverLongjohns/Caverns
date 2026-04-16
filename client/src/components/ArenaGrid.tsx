import { useMemo, memo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';
import type { TileGrid, CombatParticipant } from '@caverns/shared';

interface ArenaGridProps {
  grid: TileGrid;
  positions: Record<string, { x: number; y: number }>;
  participants: CombatParticipant[];
  playerId: string;
  movementRange: Set<string> | null;
  isTargeting: boolean;
  onTileClick: (x: number, y: number) => void;
  onTileHover?: (x: number, y: number) => void;
  onTileHoverEnd?: () => void;
  tileHighlights?: Map<string, string>;
  ghostEntity?: { x: number; y: number } | null;
}

function getEntityChar(participant: CombatParticipant): string {
  if (participant.type === 'player') return '@';
  return participant.name.charAt(0).toUpperCase();
}

function getEntityClass(participant: CombatParticipant, isCurrentTurn: boolean): string {
  const base = participant.type === 'player' ? 'entity-player' : 'entity-mob';
  return isCurrentTurn ? `${base} entity-active-turn` : base;
}

export const ArenaGrid = memo(function ArenaGrid({
  grid, positions, participants, playerId,
  movementRange, isTargeting, onTileClick,
  onTileHover, onTileHoverEnd, tileHighlights, ghostEntity,
}: ArenaGridProps) {
  const currentTurnId = useGameStore((s) => s.currentTurnId);

  const entities: EntityOverlay[] = useMemo(() => {
    const result: EntityOverlay[] = [];
    for (const p of participants) {
      const pos = positions[p.id];
      if (!pos) continue;
      result.push({
        x: pos.x,
        y: pos.y,
        char: getEntityChar(p),
        className: getEntityClass(p, p.id === currentTurnId),
      });
    }
    if (ghostEntity) {
      result.push({
        x: ghostEntity.x,
        y: ghostEntity.y,
        char: '@',
        className: 'entity-ghost',
      });
    }
    return result;
  }, [participants, positions, currentTurnId, ghostEntity]);

  return (
    <div className="arena-grid-container">
      <TileGridView
        tileGrid={grid}
        entities={entities}
        onTileClick={onTileClick}
        onTileHover={onTileHover}
        onTileHoverEnd={onTileHoverEnd}
        tileHighlights={tileHighlights}
      />
    </div>
  );
});
