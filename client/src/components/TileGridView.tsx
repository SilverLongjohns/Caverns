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

export function TileGridView({ tileGrid, entities }: TileGridViewProps) {
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
      const entity = entityMap.get(`${x},${y}`);
      const tileType = tiles[y][x];
      const theme = themes?.[y]?.[x];

      if (entity) {
        cells.push(
          <span key={x} className={entity.className} style={entity.style}>
            {entity.char}
          </span>
        );
      } else {
        // Render tile
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
          const char = getTileChar(tiles as any, x, y);
          cells.push(
            <span key={x} className={tileClass}>
              {char}
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
    <pre className="room-grid">
      {rows}
    </pre>
  );
}
