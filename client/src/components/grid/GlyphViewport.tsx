import { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react';
import type { TileGrid } from '@caverns/shared';
import { TileGridView, type EntityOverlay } from '../TileGridView.js';
import { CELL_W, CELL_H, GRID_BORDER, PAN_STEP, MINIMAP_PX, MINIMAP_COLORS, fitViewport, clampCam as clamp, centreOn, minimapTiles } from './viewportMath.js';

export interface GlyphViewportProps {
  grid: TileGrid;
  /** Drawn inside the tile cells (TileGridView). */
  entities: EntityOverlay[];
  /** Camera target; null leaves the camera where it is. */
  focus: { x: number; y: number } | null;
  /** Arrow keys pan the camera (arena). Off in exploration, where arrows move the player. */
  panKeys: boolean;
  /** Dots on the minimap (already fog-filtered by the caller). */
  minimapUnits: { x: number; y: number; side: 'player' | 'mob' }[];
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
  onTileClick?: (x: number, y: number) => void;
  onTileHover?: (x: number, y: number) => void;
  onTileHoverEnd?: () => void;
  tileHighlights?: Map<string, string>;
  /** Camera glide: undefined = the CSS default (arena, 0.28s ease-out); a number = linear ms; 0 = snap. */
  cameraGlideMs?: number;
  minimapTitle?: string;
  /** World-layer ref, for callers that position overlays inside it (arena animation, fx). */
  worldRef?: RefObject<HTMLDivElement | null>;
  /** Rendered inside the world layer (moves with the camera). */
  children?: ReactNode;
}

export function GlyphViewport({
  grid, entities, focus, panKeys, minimapUnits, visibleTiles, exploredTiles,
  onTileClick, onTileHover, onTileHoverEnd, tileHighlights, cameraGlideMs,
  minimapTitle = 'Click to move the view', worldRef: worldRefProp, children,
}: GlyphViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ownWorldRef = useRef<HTMLDivElement>(null);
  const worldRef = worldRefProp ?? ownWorldRef;
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState({ x: 0, y: 0 });
  // With an explicit glide, don't animate the very first placement (e.g. entering a room).
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvail({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, rows, needsCamera } = fitViewport(avail.w, avail.h, grid.width, grid.height);
  const clampCam = useCallback((c: { x: number; y: number }) => clamp(c, grid.width, grid.height, cols, rows),
    [grid.width, grid.height, cols, rows]);
  const view = clampCam(cam);

  // Layout effect: the camera recentres in the same commit/frame as the unit's own step (which
  // renders synchronously via a ref, not a state update — see ExplorationGrid's FloatingUnit),
  // instead of one frame later, so the camera glide starts exactly with the sprite's slide.
  useLayoutEffect(() => {
    if (!focus) return;
    setCam(clampCam(centreOn(focus, cols, rows)));
    if (avail.w > 0 && !settled) requestAnimationFrame(() => setSettled(true));
  }, [focus?.x, focus?.y, clampCam, cols, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!panKeys || !needsCamera) return;
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
  }, [panKeys, needsCamera, clampCam]);

  useEffect(() => {
    const cv = minimapRef.current;
    if (!cv || !needsCamera) return;
    cv.width = grid.width * MINIMAP_PX;
    cv.height = grid.height * MINIMAP_PX;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#070605';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const t of minimapTiles(grid, exploredTiles)) {
      ctx.fillStyle = MINIMAP_COLORS[t.type] ?? MINIMAP_COLORS.floor;
      ctx.fillRect(t.x * MINIMAP_PX, t.y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
    }
    for (const u of minimapUnits) {
      ctx.fillStyle = u.side === 'player' ? '#4488ff' : '#ff4444';
      ctx.fillRect(u.x * MINIMAP_PX, u.y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
    }
    ctx.strokeStyle = '#d4a857';
    ctx.strokeRect(view.x * MINIMAP_PX + 0.5, view.y * MINIMAP_PX + 0.5, cols * MINIMAP_PX - 1, rows * MINIMAP_PX - 1);
  }, [needsCamera, grid, exploredTiles, minimapUnits, view.x, view.y, cols, rows]);

  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * grid.width;
    const y = ((e.clientY - r.top) / r.height) * grid.height;
    setCam(clampCam({ x: Math.round(x - cols / 2), y: Math.round(y - rows / 2) }));
  };

  const transition = cameraGlideMs === undefined ? undefined
    : (!settled || cameraGlideMs === 0) ? 'none' : `transform ${cameraGlideMs}ms linear`;

  return (
    <div className="arena-grid-container glyph-grid" ref={containerRef}>
      <div className="arena-viewport" style={{ width: cols * CELL_W + GRID_BORDER, height: rows * CELL_H + GRID_BORDER }}>
        <div className="arena-world" ref={worldRef}
          style={{ transform: `translate(${-view.x * CELL_W}px, ${-view.y * CELL_H}px)`, transition }}>
          <TileGridView tileGrid={grid} entities={entities} visibleTiles={visibleTiles} exploredTiles={exploredTiles}
            onTileClick={onTileClick} onTileHover={onTileHover} onTileHoverEnd={onTileHoverEnd} tileHighlights={tileHighlights} />
          {children}
        </div>
        {view.x > 0 && <div className="arena-edge arena-edge-l" />}
        {view.x + cols < grid.width && <div className="arena-edge arena-edge-r" />}
        {view.y > 0 && <div className="arena-edge arena-edge-t" />}
        {view.y + rows < grid.height && <div className="arena-edge arena-edge-b" />}
      </div>
      {needsCamera && <canvas ref={minimapRef} className="arena-minimap" onClick={onMinimapClick} title={minimapTitle} />}
    </div>
  );
}
