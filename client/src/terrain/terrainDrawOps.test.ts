import { describe, it, expect } from 'vitest';
import { terrainDrawOps } from './terrainDrawOps.js';
import type { TerrainCell } from './autotile.js';

const TILE_SIZE = 24;
const CELL = 48;

function fullCell(): TerrainCell {
  return {
    quads: [
      { tile: [1, 2], qx: 0, qy: 0 },
      { tile: [3, 4], qx: 1, qy: 0 },
      { tile: [5, 6], qx: 0, qy: 1 },
      { tile: [7, 8], qx: 1, qy: 1 },
    ],
    variant: [9, 10],
    stamp: [11, 12],
    missingStamp: null,
  };
}

describe('terrainDrawOps', () => {
  it('produces exactly six ops for a cell with four quads, a variant and a stamp', () => {
    const cells: TerrainCell[][] = [[fullCell()]];
    const ops = terrainDrawOps(cells, TILE_SIZE, CELL);

    expect(ops).toEqual([
      // NW quad: tile [1,2], qx=0 qy=0 -> dest quadrant (0,0)
      { sx: 24, sy: 48, sw: 12, sh: 12, dx: 0, dy: 0, dw: 24, dh: 24 },
      // NE quad: tile [3,4], qx=1 qy=0 -> dest quadrant (1,0)
      { sx: 84, sy: 96, sw: 12, sh: 12, dx: 24, dy: 0, dw: 24, dh: 24 },
      // SW quad: tile [5,6], qx=0 qy=1 -> dest quadrant (0,1)
      { sx: 120, sy: 156, sw: 12, sh: 12, dx: 0, dy: 24, dw: 24, dh: 24 },
      // SE quad: tile [7,8], qx=1 qy=1 -> dest quadrant (1,1)
      { sx: 180, sy: 204, sw: 12, sh: 12, dx: 24, dy: 24, dw: 24, dh: 24 },
      // variant: tile [9,10], full tile -> full cell
      { sx: 216, sy: 240, sw: 24, sh: 24, dx: 0, dy: 0, dw: 48, dh: 48 },
      // stamp: tile [11,12], full tile -> full cell
      { sx: 264, sy: 288, sw: 24, sh: 24, dx: 0, dy: 0, dw: 48, dh: 48 },
    ]);
  });

  it('skips null layers, emitting no ops for an empty cell', () => {
    const emptyCell: TerrainCell = { quads: [null, null, null, null], variant: null, stamp: null, missingStamp: null };
    const cells: TerrainCell[][] = [[emptyCell]];
    expect(terrainDrawOps(cells, TILE_SIZE, CELL)).toEqual([]);
  });

  it('skips only the null quads within a partially-filled cell', () => {
    const cell: TerrainCell = {
      quads: [{ tile: [1, 2], qx: 0, qy: 0 }, null, null, null],
      variant: null,
      stamp: null,
      missingStamp: null,
    };
    const cells: TerrainCell[][] = [[cell]];
    expect(terrainDrawOps(cells, TILE_SIZE, CELL)).toEqual([
      { sx: 24, sy: 48, sw: 12, sh: 12, dx: 0, dy: 0, dw: 24, dh: 24 },
    ]);
  });

  it('offsets destination rects by cell position for a multi-cell grid', () => {
    const empty: TerrainCell = { quads: [null, null, null, null], variant: null, stamp: null, missingStamp: null };
    const withVariant: TerrainCell = { quads: [null, null, null, null], variant: [0, 0], stamp: null, missingStamp: null };
    const cells: TerrainCell[][] = [
      [empty, empty],
      [empty, withVariant],
    ];
    expect(terrainDrawOps(cells, TILE_SIZE, CELL)).toEqual([
      { sx: 0, sy: 0, sw: 24, sh: 24, dx: 48, dy: 48, dw: 48, dh: 48 },
    ]);
  });
});
