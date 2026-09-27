import { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';
import { getParticipantGlyph } from '../glyphs.js';
import type { TileGrid, CombatParticipant } from '@caverns/shared';
import type { CSSProperties, RefObject } from 'react';
import { useBoardFxStore } from '../combat/boardFxStore.js';
import type { BoardFx } from '../combat/boardFx.js';

const MOVE_ANIM_STEP_MS = 100;

// Fixed cell box: 16x24 at 2x (32x48) plus a 1px border on each side. Glyph art is 24x24 at 2x,
// so wider sprites overflow the cell sideways (see .entity-glyph in index.css).
const CELL_W = 34;
const CELL_H = 50;
const GRID_BORDER = 2;
const PAN_STEP = 2;
const MINIMAP_PX = 4;
const MINIMAP_GAP = 8;

const MINIMAP_COLORS: Record<string, string> = {
  wall: '#4a4a40', floor: '#12301a', water: '#2a5a9a', chasm: '#050505',
  hazard: '#6a1a1a', bridge: '#5a4428', exit: '#2a6a2a', pillar: '#6a6458',
};

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
  const worldRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState({ x: 0, y: 0 });

  // Find the participant being animated (for char + class)
  const animParticipant = animatingId
    ? participants.find((p) => p.id === animatingId) ?? null
    : null;

  const fx = useBoardFxStore((s) => s.fx);
  const unitFx = useMemo(() => {
    const m = new Map<string, { cls: string; style: Record<string, string> }>();
    for (const f of fx) {
      if (f.kind === 'number') continue;
      const cur = m.get(f.unitId) ?? { cls: '', style: {} };
      if (f.kind === 'lunge') { cur.cls += ` fx-lunge fx-lunge-${f.dir}`; cur.style['--fx-lunge-delay'] = `${f.delayMs}ms`; }
      else { cur.cls += ' fx-tear'; cur.style['--fx-tear-delay'] = `${f.delayMs}ms`; }
      m.set(f.unitId, cur);
    }
    return m;
  }, [fx]);
  const numbers = useMemo(() => fx.filter((f): f is Extract<BoardFx, { kind: 'number' }> => f.kind === 'number'), [fx]);

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

  // --- Camera: fixed-size cells, the viewport shows as much of the arena as fits ---
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setAvail({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitCols = Math.floor((avail.w - GRID_BORDER) / CELL_W);
  const fitRows = Math.floor((avail.h - GRID_BORDER) / CELL_H);
  const needsCamera = fitCols < grid.width || fitRows < grid.height;
  const minimapH = grid.height * MINIMAP_PX + MINIMAP_GAP;
  const cols = Math.max(1, Math.min(grid.width, fitCols));
  const rows = Math.max(1, Math.min(grid.height,
    needsCamera ? Math.floor((avail.h - GRID_BORDER - minimapH) / CELL_H) : fitRows));

  const clampCam = useCallback((c: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(grid.width - cols, c.x)),
    y: Math.max(0, Math.min(grid.height - rows, c.y)),
  }), [grid.width, grid.height, cols, rows]);
  const view = clampCam(cam);

  // Follow whoever is moving, else whoever's turn it is
  const focusId = animatingId ?? currentTurnId;
  const focusPos = focusId ? positions[focusId] : undefined;
  useEffect(() => {
    if (!focusPos) return;
    setCam(clampCam({ x: focusPos.x - Math.floor(cols / 2), y: focusPos.y - Math.floor(rows / 2) }));
  }, [focusId, focusPos?.x, focusPos?.y, clampCam, cols, rows]);

  // Manual pan with the arrow keys (arrows are only bound to grid movement outside combat)
  useEffect(() => {
    if (!needsCamera) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
      if (!d) return;
      e.preventDefault();
      setCam((c) => clampCam({ x: clampCam(c).x + d[0] * PAN_STEP, y: clampCam(c).y + d[1] * PAN_STEP }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [needsCamera, clampCam]);

  // Minimap: terrain, units and the visible window
  useEffect(() => {
    const cv = minimapRef.current;
    if (!cv || !needsCamera) return;
    cv.width = grid.width * MINIMAP_PX;
    cv.height = grid.height * MINIMAP_PX;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#070605';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        ctx.fillStyle = MINIMAP_COLORS[grid.tiles[y][x]] ?? MINIMAP_COLORS.floor;
        ctx.fillRect(x * MINIMAP_PX, y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
      }
    }
    for (const p of participants) {
      const pos = positions[p.id];
      if (!pos) continue;
      ctx.fillStyle = p.type === 'player' ? '#4488ff' : '#ff4444';
      ctx.fillRect(pos.x * MINIMAP_PX, pos.y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
    }
    ctx.strokeStyle = '#d4a857';
    ctx.strokeRect(view.x * MINIMAP_PX + 0.5, view.y * MINIMAP_PX + 0.5, cols * MINIMAP_PX - 1, rows * MINIMAP_PX - 1);
  }, [needsCamera, grid, participants, positions, view.x, view.y, cols, rows]);

  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * grid.width;
    const y = ((e.clientY - r.top) / r.height) * grid.height;
    setCam(clampCam({ x: Math.round(x - cols / 2), y: Math.round(y - rows / 2) }));
  };

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

  return (
    <div className="arena-grid-container glyph-grid" ref={containerRef}>
      <div
        className="arena-viewport"
        style={{ width: cols * CELL_W + GRID_BORDER, height: rows * CELL_H + GRID_BORDER }}
      >
        <div
          className="arena-world"
          ref={worldRef}
          style={{ transform: `translate(${-view.x * CELL_W}px, ${-view.y * CELL_H}px)` }}
        >
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
            style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }}
          />
          <FxNumbers numbers={numbers} worldRef={worldRef} />
        </div>
        {view.x > 0 && <div className="arena-edge arena-edge-l" />}
        {view.x + cols < grid.width && <div className="arena-edge arena-edge-r" />}
        {view.y > 0 && <div className="arena-edge arena-edge-t" />}
        {view.y + rows < grid.height && <div className="arena-edge arena-edge-b" />}
      </div>
      {needsCamera && (
        <canvas
          ref={minimapRef}
          className="arena-minimap"
          onClick={onMinimapClick}
          title="Click to move the view · arrow keys pan"
        />
      )}
    </div>
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
