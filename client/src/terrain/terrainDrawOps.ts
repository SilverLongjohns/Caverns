import type { TerrainCell } from './autotile.js';

export interface DrawOp {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Destination quadrant position for quads[0..3] in NW, NE, SW, SE order. */
const QUAD_DEST: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/**
 * Flattens precomputed terrain cells into an ordered list of canvas drawImage rectangles.
 * tileSize = art px (source sheet), cell = screen px (destination). Per cell: quads
 * (NW, NE, SW, SE, skipping null), then the variant, then the stamp.
 */
export function terrainDrawOps(cells: TerrainCell[][], tileSize: number, cell: number): DrawOp[] {
  const half = tileSize / 2;
  const halfCell = cell / 2;
  const ops: DrawOp[] = [];

  for (let y = 0; y < cells.length; y++) {
    const row = cells[y];
    for (let x = 0; x < row.length; x++) {
      const { quads, variant, stamp } = row[x];

      for (let i = 0; i < 4; i++) {
        const quad = quads[i];
        if (!quad) continue;
        const [qxDest, qyDest] = QUAD_DEST[i];
        ops.push({
          sx: quad.tile[0] * tileSize + quad.qx * half,
          sy: quad.tile[1] * tileSize + quad.qy * half,
          sw: half,
          sh: half,
          dx: x * cell + qxDest * halfCell,
          dy: y * cell + qyDest * halfCell,
          dw: halfCell,
          dh: halfCell,
        });
      }

      if (variant) {
        ops.push({
          sx: variant[0] * tileSize,
          sy: variant[1] * tileSize,
          sw: tileSize,
          sh: tileSize,
          dx: x * cell,
          dy: y * cell,
          dw: cell,
          dh: cell,
        });
      }

      if (stamp) {
        ops.push({
          sx: stamp[0] * tileSize,
          sy: stamp[1] * tileSize,
          sw: tileSize,
          sh: tileSize,
          dx: x * cell,
          dy: y * cell,
          dw: cell,
          dh: cell,
        });
      }
    }
  }

  return ops;
}
