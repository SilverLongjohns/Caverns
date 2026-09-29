import { describe, it, expect } from 'vitest';
import { CELL_W, CELL_H, GRID_BORDER, MINIMAP_PX, MINIMAP_GAP, fitViewport, clampCam, centreOn, cellOrigin, isStep, minimapTiles, nextSlide } from './viewportMath.js';

describe('fitViewport', () => {
  it('no camera when the whole grid fits', () => {
    const f = fitViewport(10 * CELL_W + GRID_BORDER, 6 * CELL_H + GRID_BORDER, 10, 6);
    expect(f).toEqual({ cols: 10, rows: 6, needsCamera: false });
  });
  it('camera when the grid is wider than the space; rows leave room for the minimap', () => {
    const availH = 12 * CELL_H + GRID_BORDER;
    const f = fitViewport(20 * CELL_W + GRID_BORDER, availH, 45, 10);
    expect(f.needsCamera).toBe(true);
    expect(f.cols).toBe(20);
    expect(f.rows).toBe(Math.min(10, Math.floor((availH - GRID_BORDER - (10 * MINIMAP_PX + MINIMAP_GAP)) / CELL_H)));
  });
  it('never returns less than 1x1', () => {
    expect(fitViewport(0, 0, 30, 8)).toMatchObject({ cols: 1, rows: 1 });
  });
});

describe('camera', () => {
  it('clamps into the grid', () => {
    expect(clampCam({ x: -5, y: -5 }, 40, 18, 20, 8)).toEqual({ x: 0, y: 0 });
    expect(clampCam({ x: 99, y: 99 }, 40, 18, 20, 8)).toEqual({ x: 20, y: 10 });
  });
  it('a grid smaller than the view always clamps to 0,0', () => {
    expect(clampCam(centreOn({ x: 9, y: 5 }, 30, 15), 10, 6, 10, 6)).toEqual({ x: 0, y: 0 });
  });
  it('centreOn puts the focus in the middle', () => {
    expect(centreOn({ x: 15, y: 9 }, 11, 7)).toEqual({ x: 10, y: 6 });
  });
});

describe('cellOrigin / isStep', () => {
  it('cell origin includes the 1px grid border', () => {
    expect(cellOrigin(0, 0)).toEqual({ left: GRID_BORDER / 2, top: GRID_BORDER / 2 });
    expect(cellOrigin(3, 2)).toEqual({ left: GRID_BORDER / 2 + 3 * CELL_W, top: GRID_BORDER / 2 + 2 * CELL_H });
  });
  it('isStep is true only for a one-tile move (incl. diagonal)', () => {
    expect(isStep({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    expect(isStep({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(isStep({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(isStep({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });
});

describe('nextSlide', () => {
  const STEP_MS = 120;

  it('a one-tile step sets a sliding transition', () => {
    const last = { x: 1, y: 1, t: 'none' };
    const next = nextSlide(last, { x: 2, y: 1 }, false, STEP_MS);
    expect(next).toEqual({ x: 2, y: 1, t: `transform ${STEP_MS}ms linear` });
  });

  it('a subsequent render at the same position keeps the same transition string (does not snap to none)', () => {
    const last = { x: 2, y: 1, t: `transform ${STEP_MS}ms linear` };
    const next = nextSlide(last, { x: 2, y: 1 }, false, STEP_MS);
    expect(next).toEqual(last);
    expect(next.t).toBe(`transform ${STEP_MS}ms linear`);
  });

  it('a multi-tile jump snaps (no transition)', () => {
    const last = { x: 1, y: 1, t: 'none' };
    const next = nextSlide(last, { x: 5, y: 1 }, false, STEP_MS);
    expect(next).toEqual({ x: 5, y: 1, t: 'none' });
  });

  it('reduced motion never slides', () => {
    const last = { x: 1, y: 1, t: 'none' };
    const next = nextSlide(last, { x: 2, y: 1 }, true, STEP_MS);
    expect(next).toEqual({ x: 2, y: 1, t: 'none' });
  });
});

describe('minimapTiles', () => {
  const grid = { width: 3, height: 2, tiles: [['wall', 'floor', 'floor'], ['wall', 'water', 'floor']] };
  it('all tiles without fog', () => {
    expect(minimapTiles(grid)).toHaveLength(6);
  });
  it('only explored tiles with fog', () => {
    expect(minimapTiles(grid, new Set(['1,0', '1,1']))).toEqual([
      { x: 1, y: 0, type: 'floor' }, { x: 1, y: 1, type: 'water' },
    ]);
  });
});
