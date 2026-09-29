import { useState, useEffect, memo } from 'react';
import { getTileChar } from '@caverns/roomgrid';

export interface EntityOverlay {
  x: number;
  y: number;
  char: string;
  className: string;
  style?: React.CSSProperties;
  /** Glyph sprite URL; when set it's drawn instead of `char`. */
  sprite?: string | null;
}

interface TileGridViewProps {
  tileGrid: {
    width: number;
    height: number;
    tiles: string[][];
    themes?: (string | null)[][];
  };
  entities: EntityOverlay[];
  alert?: { x: number; y: number } | null;
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
  /** Optional per-tile char resolver. Return null to fall back to the dungeon renderer. */
  charLookup?: (tileType: string, x: number, y: number) => string | null;
  /** Optional click handler for tiles. */
  onTileClick?: (x: number, y: number) => void;
  /** Optional mouse-enter handler per tile (for hover tracking). */
  onTileHover?: (x: number, y: number) => void;
  /** Optional handler when mouse leaves the grid. */
  onTileHoverEnd?: () => void;
  /** Extra CSS classes to apply to specific tiles, keyed by "x,y". */
  tileHighlights?: Map<string, string>;
  /** When true, a terrain sheet is drawn under this view (GlyphViewport's TerrainCanvas): cells
   * suppress their ASCII character except where `asciiCells` says the terrain resolved to nothing. */
  terrainMode?: boolean;
  /** "x,y" keys (from the same autotile pass GlyphViewport feeds TerrainCanvas) whose quads are
   * all null, so this view must still draw their ASCII character. Ignored unless `terrainMode`. */
  asciiCells?: Set<string>;
}

const WATER_CHARS: Record<string, [string, string]> = {
  mineral_pool: ['-', '+'],
  spore_pool: ['~', '≈'],
  deep_water: ['~', '≈'],
};
const DEFAULT_WATER_CHARS: [string, string] = ['~', '≈'];

/** Animated water tile that randomly toggles between two chars */
const WaterChar = memo(function WaterChar({ theme }: { theme?: string | null }) {
  const chars = (theme && WATER_CHARS[theme]) || DEFAULT_WATER_CHARS;
  const [char, setChar] = useState(chars[0]);
  useEffect(() => {
    const id = setInterval(() => {
      setChar((c) => (c === chars[0] ? chars[1] : chars[0]));
    }, 800 + Math.random() * 700);
    return () => clearInterval(id);
  }, []);
  return <>{char}</>;
});

export const TileGridView = memo(function TileGridView({ tileGrid, entities, alert, visibleTiles, exploredTiles, charLookup, onTileClick, onTileHover, onTileHoverEnd, tileHighlights, terrainMode, asciiCells }: TileGridViewProps) {
  const { width, height, tiles, themes } = tileGrid;
  // In terrain mode, a cell keeps its ASCII character only where the terrain canvas drew nothing
  // for it (asciiCells); otherwise the char is suppressed so the pixel art shows through the span.
  const showChar = (x: number, y: number) => !terrainMode || (asciiCells?.has(`${x},${y}`) ?? true);

  // Build entity lookup: "x,y" -> EntityOverlay
  const entityMap = new Map<string, EntityOverlay>();
  for (const entity of entities) {
    entityMap.set(`${entity.x},${entity.y}`, entity);
  }

  const rows: React.ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      const isVisible = !visibleTiles || visibleTiles.has(key);
      const isExplored = exploredTiles?.has(key) ?? false;

      // Unseen — render empty space
      if (!isVisible && !isExplored) {
        cells.push(<span key={x} className="tile-unseen">{' '}</span>);
        continue;
      }

      // Explored but not currently visible — show terrain only, dimmed
      if (!isVisible && isExplored) {
        const tileType = tiles[y][x];
        const theme = themes?.[y]?.[x];
        const tileClass = theme
          ? `tile-${tileType} tile-theme-${theme} tile-explored`
          : `tile-${tileType} tile-explored`;

        if (!showChar(x, y)) {
          cells.push(<span key={x} className={tileClass} />);
        } else if (tileType === 'water') {
          cells.push(
            <span key={x} className={tileClass}>
              <WaterChar theme={theme} />
            </span>
          );
        } else {
          const override = charLookup?.(tileType, x, y) ?? null;
          const char = override ?? (tileType === 'pillar' ? '‖' : getTileChar(tiles as any, x, y));
          const displayChar = (tileType === 'wall' && theme === 'torch') ? '†' : char;
          cells.push(
            <span key={x} className={tileClass}>
              {displayChar}
            </span>
          );
        }
        continue;
      }

      // Visible — existing rendering (entity or tile)
      const entity = entityMap.get(key);
      const tileType = tiles[y][x];
      const theme = themes?.[y]?.[x];
      const highlightClass = tileHighlights?.get(key) ?? '';

      if (entity) {
        const cls = highlightClass ? `${entity.className} ${highlightClass}` : entity.className;
        cells.push(
          <span key={x} className={cls} style={entity.style}>
            {entity.sprite
              ? <span className="entity-glyph" style={{ backgroundImage: `url(${entity.sprite})` }} />
              : entity.char}
          </span>
        );
      } else {
        const tileClass = theme
          ? `tile-${tileType} tile-theme-${theme}`
          : `tile-${tileType}`;
        const cls = highlightClass ? `${tileClass} ${highlightClass}` : tileClass;

        if (!showChar(x, y)) {
          cells.push(<span key={x} className={cls} />);
        } else if (tileType === 'water') {
          cells.push(
            <span key={x} className={cls}>
              <WaterChar theme={theme} />
            </span>
          );
        } else {
          const override = charLookup?.(tileType, x, y) ?? null;
          const char = override ?? (tileType === 'pillar' ? '‖' : getTileChar(tiles as any, x, y));
          const displayChar = (tileType === 'wall' && theme === 'torch') ? '†' : char;
          cells.push(
            <span key={x} className={cls}>
              {displayChar}
            </span>
          );
        }
      }
    }
    const rowY = y;
    rows.push(
      <div
        key={y}
        className="room-row"
        onClick={onTileClick ? (e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const charWidth = rect.width / width;
          const x = Math.floor((e.clientX - rect.left) / charWidth);
          if (x >= 0 && x < width) onTileClick(x, rowY);
        } : undefined}
        onMouseMove={onTileHover ? (e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const charWidth = rect.width / width;
          const x = Math.floor((e.clientX - rect.left) / charWidth);
          if (x >= 0 && x < width) onTileHover(x, rowY);
        } : undefined}
        style={onTileClick ? { cursor: 'pointer' } : undefined}
      >
        {cells}
      </div>
    );
  }

  return (
    <pre className="room-grid" style={{ position: 'relative' }} onMouseLeave={onTileHoverEnd}>
      {rows}
      {alert && (
        <span
          className="mob-alert"
          style={{
            position: 'absolute',
            left: `${alert.x}ch`,
            top: `calc(${alert.y} * 1.3em)`,
          }}
        >
          !
        </span>
      )}
    </pre>
  );
});
