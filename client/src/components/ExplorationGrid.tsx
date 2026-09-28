import { memo, useMemo, useRef } from 'react';
import type { TileGrid } from '@caverns/shared';
import type { EntityOverlay } from './TileGridView.js';
import { GlyphViewport } from './grid/GlyphViewport.js';
import { CELL_W, CELL_H, cellOrigin, nextSlide } from './grid/viewportMath.js';
import type { FloatUnit } from '../exploration/explorationEntities.js';
import { prefersReducedMotion } from '../ui/motion.js';

/** Must stay below the server's 150ms grid-move rate so held keys walk smoothly. */
export const EXPLORE_TIMING = { stepMs: 120 } as const;

interface Props {
  roomId: string;
  grid: TileGrid;
  props: EntityOverlay[];
  units: FloatUnit[];
  localPlayerId: string;
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
  alert: { x: number; y: number } | null;
}

export function ExplorationGrid({ roomId, grid, props, units, localPlayerId, visibleTiles, exploredTiles, alert }: Props) {
  const reduced = prefersReducedMotion();
  const me = units.find((u) => u.id === localPlayerId) ?? null;
  const minimapUnits = useMemo(() => units.map((u) => ({ x: u.x, y: u.y, side: u.side })), [units]);
  return (
    // key: a room change remounts the viewport, so the camera and units snap instead of sliding across rooms
    <GlyphViewport key={roomId} grid={grid} entities={props} focus={me ? { x: me.x, y: me.y } : null}
      panKeys={false} minimapUnits={minimapUnits} visibleTiles={visibleTiles} exploredTiles={exploredTiles}
      cameraGlideMs={reduced ? 0 : EXPLORE_TIMING.stepMs} minimapTitle="Click to look around · moving re-centres">
      <div className="explore-units">
        {units.map((u) => <FloatingUnit key={u.id} unit={u} reduced={reduced} />)}
      </div>
      {alert && (
        <span className="mob-alert explore-alert"
          style={{ left: cellOrigin(alert.x, alert.y).left, top: cellOrigin(alert.x, alert.y).top, width: CELL_W }}>!</span>
      )}
    </GlyphViewport>
  );
}

const FloatingUnit = memo(function FloatingUnit({ unit, reduced }: { unit: FloatUnit; reduced: boolean }) {
  // last.current is updated DURING render (not in an effect), so `t` only changes when the
  // position actually changes. A re-render at the same position (e.g. another unit moving,
  // or exploredTiles updating right after a step) reuses the same transition string instead of
  // recomputing 'none', which would otherwise cancel the running CSS transition mid-slide.
  const last = useRef({ x: unit.x, y: unit.y, t: 'none' });
  last.current = nextSlide(last.current, unit, reduced, EXPLORE_TIMING.stepMs);
  const { left, top } = cellOrigin(unit.x, unit.y);
  return (
    <span className={`explore-unit ${unit.className}`}
      style={{
        width: CELL_W, height: CELL_H,
        transform: `translate(${left}px, ${top}px)`,
        transition: last.current.t,
      }}>
      {unit.sprite ? <span className="entity-glyph" style={{ backgroundImage: `url(${unit.sprite})` }} /> : unit.char}
    </span>
  );
}, (a, b) => a.reduced === b.reduced && a.unit.x === b.unit.x && a.unit.y === b.unit.y
  && a.unit.sprite === b.unit.sprite && a.unit.className === b.unit.className);
