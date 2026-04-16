import { useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';
import type { TileGrid, CombatParticipant } from '@caverns/shared';

const MOVE_ANIM_STEP_MS = 100;

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
  animatingId?: string | null;
  animPath?: { x: number; y: number }[] | null;
}

function getEntityChar(participant: CombatParticipant): string {
  if (participant.type === 'player') return '@';
  return participant.name.charAt(0).toUpperCase();
}

function getEntityClass(participant: CombatParticipant, isCurrentTurn: boolean): string {
  const base = participant.type === 'player' ? 'entity-player' : 'entity-mob';
  return isCurrentTurn ? `${base} entity-active-turn` : base;
}

/**
 * Measure the pixel position of grid cell (x, y) by finding the span element.
 * The grid is: pre.room-grid > div.room-row[y] > span[x]
 */
function getCellRect(gridEl: HTMLElement, x: number, y: number): DOMRect | null {
  const row = gridEl.children[y] as HTMLElement | undefined;
  if (!row) return null;
  const cell = row.children[x] as HTMLElement | undefined;
  return cell?.getBoundingClientRect() ?? null;
}

export function ArenaGrid({
  grid, positions, participants, playerId,
  movementRange, isTargeting, onTileClick,
  onTileHover, onTileHoverEnd, tileHighlights, ghostEntity,
  animatingId, animPath,
}: ArenaGridProps) {
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  // Find the participant being animated (for char + class)
  const animParticipant = animatingId
    ? participants.find((p) => p.id === animatingId) ?? null
    : null;

  // Entities for inline rendering — exclude the currently-animating entity
  const entities: EntityOverlay[] = useMemo(() => {
    const result: EntityOverlay[] = [];
    for (const p of participants) {
      if (animatingId && p.id === animatingId) continue; // hidden during animation
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
  }, [participants, positions, currentTurnId, ghostEntity, animatingId]);

  // DOM-based animation: move the overlay span tile-by-tile without React re-renders
  useEffect(() => {
    if (!animPath || animPath.length === 0 || !animParticipant) return;

    const container = containerRef.current;
    const gridEl = container?.querySelector('.room-grid') as HTMLElement | null;
    const overlay = overlayRef.current;
    if (!container || !gridEl || !overlay) return;

    // Set overlay content and class
    overlay.textContent = getEntityChar(animParticipant);
    overlay.className = `arena-anim-entity ${getEntityClass(animParticipant, animParticipant.id === currentTurnId)}`;
    overlay.style.display = 'block';

    // Position relative to the container (the positioning parent)
    const positionAt = (pos: { x: number; y: number }) => {
      const parentRect = container.getBoundingClientRect();
      const cellRect = getCellRect(gridEl, pos.x, pos.y);
      if (!cellRect) return;
      overlay.style.left = `${cellRect.left - parentRect.left}px`;
      overlay.style.top = `${cellRect.top - parentRect.top}px`;
      overlay.style.width = `${cellRect.width}px`;
      overlay.style.height = `${cellRect.height}px`;
    };

    positionAt(animPath[0]);
    let stepIndex = 1;
    let lastTime = 0;

    const tick = (timestamp: number) => {
      if (!lastTime) lastTime = timestamp;
      if (timestamp - lastTime >= MOVE_ANIM_STEP_MS) {
        if (stepIndex >= animPath.length) {
          overlay.style.display = 'none';
          return;
        }
        positionAt(animPath[stepIndex]);
        stepIndex++;
        lastTime = timestamp;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      overlay.style.display = 'none';
    };
  }, [animPath, animParticipant, currentTurnId]);

  return (
    <div className="arena-grid-container" ref={containerRef}>
      <TileGridView
        tileGrid={grid}
        entities={entities}
        onTileClick={onTileClick}
        onTileHover={onTileHover}
        onTileHoverEnd={onTileHoverEnd}
        tileHighlights={tileHighlights}
      />
      {/* Absolutely-positioned overlay for animation — lives outside React render cycle */}
      <span
        ref={overlayRef}
        className="arena-anim-entity"
        style={{ display: 'none', position: 'absolute', textAlign: 'center', lineHeight: 'inherit', pointerEvents: 'none' }}
      />
    </div>
  );
}
