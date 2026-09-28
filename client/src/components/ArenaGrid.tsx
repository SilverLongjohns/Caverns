import { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { GlyphViewport } from './grid/GlyphViewport.js';
import type { EntityOverlay } from './TileGridView.js';
import { getParticipantGlyph } from '../glyphs.js';
import { chebyshev, type TileGrid, type CombatParticipant } from '@caverns/shared';
import type { CSSProperties, RefObject } from 'react';
import { useBoardFxStore } from '../combat/boardFxStore.js';
import type { BoardFx } from '../combat/boardFx.js';

const MOVE_ANIM_STEP_MS = 100;

interface ArenaGridProps {
  grid: TileGrid;
  positions: Record<string, { x: number; y: number }>;
  participants: CombatParticipant[];
  playerId: string;
  onTileClick: (x: number, y: number) => void;
  onTileHover?: (x: number, y: number) => void;
  onTileHoverEnd?: () => void;
  tileHighlights?: Map<string, string>;
  ghostEntity?: { x: number; y: number } | null;
  animatingId?: string | null;
  animPath?: { x: number; y: number }[] | null;
  /** Hit % to show above each targetable enemy while shoot-targeting; always visible (not hover-only). */
  hitLabels?: Map<string, number>;
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
  onTileClick, onTileHover, onTileHoverEnd, tileHighlights, ghostEntity,
  animatingId, animPath, hitLabels,
}: ArenaGridProps) {
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const worldRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  // Find the participant being animated (for char + class)
  const animParticipant = animatingId
    ? participants.find((p) => p.id === animatingId) ?? null
    : null;

  const fx = useBoardFxStore((s) => s.fx);
  const unitFx = useMemo(() => {
    const m = new Map<string, { cls: string; style: Record<string, string> }>();
    for (const f of fx) {
      if (f.kind === 'number' || f.kind === 'projectile' || f.kind === 'tag') continue;
      const cur = m.get(f.unitId) ?? { cls: '', style: {} };
      if (f.kind === 'lunge') { cur.cls += ` fx-lunge fx-lunge-${f.dir}`; cur.style['--fx-lunge-delay'] = `${f.delayMs}ms`; }
      else if (f.kind === 'recoil') { cur.cls += ` fx-recoil fx-recoil-${f.dir}`; cur.style['--fx-recoil-delay'] = `${f.delayMs}ms`; }
      else { cur.cls += ' fx-tear'; cur.style['--fx-tear-delay'] = `${f.delayMs}ms`; }
      m.set(f.unitId, cur);
    }
    return m;
  }, [fx]);
  const numbers = useMemo(() => fx.filter((f): f is Extract<BoardFx, { kind: 'number' }> => f.kind === 'number'), [fx]);
  const overlayFx = useMemo(() => fx.filter((f): f is Extract<BoardFx, { kind: 'projectile' | 'tag' }> => f.kind === 'projectile' || f.kind === 'tag'), [fx]);

  // Entities for inline rendering — exclude the currently-animating entity
  const entities: EntityOverlay[] = useMemo(() => {
    const result: EntityOverlay[] = [];
    for (const p of participants) {
      if (animatingId && p.id === animatingId) continue; // hidden during animation
      const pos = positions[p.id];
      if (!pos) continue;
      const uf = unitFx.get(p.id);
      result.push({
        x: pos.x,
        y: pos.y,
        char: getEntityChar(p),
        className: getEntityClass(p, p.id === currentTurnId) + (uf?.cls ?? ''),
        sprite: getParticipantGlyph(p),
        style: uf ? (uf.style as CSSProperties) : undefined,
      });
    }
    if (ghostEntity) {
      const me = participants.find((p) => p.id === playerId);
      result.push({
        x: ghostEntity.x,
        y: ghostEntity.y,
        char: '@',
        className: 'entity-ghost',
        sprite: me ? getParticipantGlyph(me) : null,
      });
    }
    return result;
  }, [participants, positions, currentTurnId, ghostEntity, animatingId, playerId, unitFx]);

  // DOM-based animation: move the overlay span tile-by-tile without React re-renders
  useEffect(() => {
    if (!animPath || animPath.length === 0 || !animParticipant) return;

    const world = worldRef.current;
    const gridEl = world?.querySelector('.room-grid') as HTMLElement | null;
    const overlay = overlayRef.current;
    if (!world || !gridEl || !overlay) return;

    // Set overlay content and class
    const sprite = getParticipantGlyph(animParticipant);
    overlay.replaceChildren();
    if (sprite) {
      const glyph = document.createElement('span');
      glyph.className = 'entity-glyph';
      glyph.style.backgroundImage = `url(${sprite})`;
      overlay.appendChild(glyph);
    } else {
      overlay.textContent = getEntityChar(animParticipant);
    }
    overlay.className = `arena-anim-entity ${getEntityClass(animParticipant, animParticipant.id === currentTurnId)}`;
    overlay.style.display = 'flex';

    // Position relative to the world layer (it moves with the camera, so the overlay does too)
    const positionAt = (pos: { x: number; y: number }) => {
      const parentRect = world.getBoundingClientRect();
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

  const focusId = animatingId ?? currentTurnId;
  const focus = focusId ? positions[focusId] ?? null : null;
  const minimapUnits = useMemo(() => participants.flatMap((p) => {
    const pos = positions[p.id];
    return pos ? [{ x: pos.x, y: pos.y, side: p.type }] : [];
  }), [participants, positions]);

  return (
    <GlyphViewport grid={grid} entities={entities} focus={focus} panKeys minimapUnits={minimapUnits}
      onTileClick={onTileClick} onTileHover={onTileHover} onTileHoverEnd={onTileHoverEnd}
      tileHighlights={tileHighlights} worldRef={worldRef}
      minimapTitle="Click to move the view · arrow keys pan">
      <span ref={overlayRef} className="arena-anim-entity" style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }} />
      <FxNumbers numbers={numbers} worldRef={worldRef} />
      <FxOverlay fx={overlayFx} hitLabels={hitLabels} positions={positions} worldRef={worldRef} />
    </GlyphViewport>
  );
}

function FxNumbers({ numbers, worldRef }: { numbers: Extract<BoardFx, { kind: 'number' }>[]; worldRef: RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<Record<number, { left: number; top: number; width: number }>>({});
  useLayoutEffect(() => {
    const world = worldRef.current;
    const gridEl = world?.querySelector('.room-grid') as HTMLElement | null;
    if (!world || !gridEl) return;
    const pr = world.getBoundingClientRect();
    const next: Record<number, { left: number; top: number; width: number }> = {};
    for (const n of numbers) {
      const r = getCellRect(gridEl, n.tile.x, n.tile.y);
      if (r) next[n.id] = { left: r.left - pr.left, top: r.top - pr.top, width: r.width };
    }
    setPos(next);
  }, [numbers, worldRef]);
  return (
    <>
      {numbers.map((n) => pos[n.id] && (
        <span key={n.id} className={`fx-number fx-number--${n.tone}`}
          style={{ left: pos[n.id].left, top: pos[n.id].top - 8 - n.offset * 14, width: pos[n.id].width, animationDelay: `${n.delayMs}ms` }}>
          {n.value}
        </span>
      ))}
    </>
  );
}

type CellRect = { left: number; top: number; width: number; height: number };

function FxOverlay({ fx, hitLabels, positions, worldRef }: {
  fx: Extract<BoardFx, { kind: 'projectile' | 'tag' }>[];
  hitLabels?: Map<string, number>;
  positions: Record<string, { x: number; y: number }>;
  worldRef: RefObject<HTMLDivElement | null>;
}) {
  const [rects, setRects] = useState<Record<string, CellRect>>({});

  useLayoutEffect(() => {
    const world = worldRef.current;
    const gridEl = world?.querySelector('.room-grid') as HTMLElement | null;
    if (!world || !gridEl) return;
    const pr = world.getBoundingClientRect();
    const tiles = new Map<string, { x: number; y: number }>();
    for (const f of fx) {
      if (f.kind === 'projectile') {
        tiles.set(`from:${f.id}`, f.from);
        tiles.set(`to:${f.id}`, f.to);
      } else {
        tiles.set(`tag:${f.id}`, f.tile);
      }
    }
    if (hitLabels) {
      for (const id of hitLabels.keys()) {
        const p = positions[id];
        if (p) tiles.set(`hit:${id}`, p);
      }
    }
    const next: Record<string, CellRect> = {};
    for (const [key, tile] of tiles) {
      const r = getCellRect(gridEl, tile.x, tile.y);
      if (r) next[key] = { left: r.left - pr.left, top: r.top - pr.top, width: r.width, height: r.height };
    }
    setRects(next);
  }, [fx, hitLabels, positions, worldRef]);

  return (
    <>
      {fx.map((f) => {
        if (f.kind === 'tag') {
          const r = rects[`tag:${f.id}`];
          if (!r) return null;
          return (
            <span key={f.id} className={`fx-tag fx-tag--${f.text === 'MISS' ? 'miss' : 'reload'}`}
              style={{ left: r.left, top: r.top - 14, width: r.width, animationDelay: `${f.delayMs}ms` }}>
              {f.text}
            </span>
          );
        }
        const fromR = rects[`from:${f.id}`];
        const toR = rects[`to:${f.id}`];
        if (!fromR || !toR) return null;
        const tileDist = Math.max(1, chebyshev(f.from, f.to));
        const fromCx = fromR.left + fromR.width / 2;
        const fromCy = fromR.top + fromR.height / 2;
        let dx = (toR.left + toR.width / 2) - fromCx;
        let dy = (toR.top + toR.height / 2) - fromCy;
        if (!f.hit) {
          dx = dx * (1 + 1.5 / tileDist);
          dy = dy * (1 + 1.5 / tileDist);
        }
        const style: Record<string, string> = {
          left: `${fromCx}px`, top: `${fromCy}px`,
          '--fx-dx': `${dx}px`, '--fx-dy': `${dy}px`,
          '--fx-travel': `${f.travelMs}ms`, '--fx-delay': `${f.delayMs}ms`,
        };
        return (
          <span key={f.id} className={`fx-bolt${f.hit ? '' : ' fx-bolt--miss'}`} style={style as CSSProperties} />
        );
      })}
      {hitLabels && [...hitLabels.entries()].map(([id, chance]) => {
        const r = rects[`hit:${id}`];
        if (!r) return null;
        return (
          <span key={`hit-${id}`} className="fx-hit" style={{ left: r.left, top: r.top - 12, width: r.width }}>
            {Math.round(chance * 100)}%
          </span>
        );
      })}
    </>
  );
}
