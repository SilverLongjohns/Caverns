import { useState, useEffect, memo } from 'react';
import { getTileChar } from '@caverns/roomgrid';

export interface EntityOverlay {
  x: number;
  y: number;
  char: string;
  className: string;
  style?: React.CSSProperties;
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

export function TileGridView({ tileGrid, entities, alert, visibleTiles, exploredTiles, charLookup }: TileGridViewProps) {
  const { width, height, tiles, themes } = tileGrid;

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

        if (tileType === 'water') {
          cells.push(
            <span key={x} className={tileClass}>
              <WaterChar theme={theme} />
            </span>
          );
        } else {
          const override = charLookup?.(tileType, x, y) ?? null;
          const char = override ?? getTileChar(tiles as any, x, y);
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

      if (entity) {
        cells.push(
          <span key={x} className={entity.className} style={entity.style}>
            {entity.char}
          </span>
        );
      } else {
        const tileClass = theme
          ? `tile-${tileType} tile-theme-${theme}`
          : `tile-${tileType}`;

        if (tileType === 'water') {
          cells.push(
            <span key={x} className={tileClass}>
              <WaterChar theme={theme} />
            </span>
          );
        } else {
          const override = charLookup?.(tileType, x, y) ?? null;
          const char = override ?? getTileChar(tiles as any, x, y);
          const displayChar = (tileType === 'wall' && theme === 'torch') ? '†' : char;
          cells.push(
            <span key={x} className={tileClass}>
              {displayChar}
            </span>
          );
        }
      }
    }
    rows.push(
      <div key={y} className="room-row">
        {cells}
      </div>
    );
  }

  return (
    <pre className="room-grid" style={{ position: 'relative' }}>
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
}
