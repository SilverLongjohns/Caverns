import { useLayoutEffect, useRef } from 'react';
import type { TerrainCell } from '../../terrain/autotile.js';
import type { TerrainSet } from '../../terrain/terrainManifest.js';
import { terrainDrawOps } from '../../terrain/terrainDrawOps.js';

export interface TerrainCanvasProps {
  cells: TerrainCell[][];
  width: number;
  height: number;
  set: TerrainSet;
  cell: number;
}

/**
 * Paints precomputed terrain cells (the caller runs autotile) onto a canvas laid under the
 * ASCII tile spans in the world layer. Cells whose quads are all null are left transparent;
 * TileGridView draws their ASCII character on top.
 */
export function TerrainCanvas({ cells, width, height, set, cell }: TerrainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ops = terrainDrawOps(cells, set.manifest.tileSize, cell);
    for (const op of ops) {
      ctx.drawImage(set.sheet, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
    }
  }, [cells, set]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      width={width * cell}
      height={height * cell}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
