// Shared glyph-grid geometry and camera maths (arena + exploration). Pure; see GlyphViewport.
export type Pt = { x: number; y: number };

// Fixed cell box: 16x24 at 2x (32x48) plus a 1px border on each side. Glyph art is 24x24 at 2x,
// so wider sprites overflow the cell sideways (see .entity-glyph in index.css).
export const CELL_W = 34;
export const CELL_H = 50;
export const GRID_BORDER = 2;
export const PAN_STEP = 2;
export const MINIMAP_PX = 4;
export const MINIMAP_GAP = 8;

export const MINIMAP_COLORS: Record<string, string> = {
  wall: '#4a4a40', floor: '#12301a', water: '#2a5a9a', chasm: '#050505',
  hazard: '#6a1a1a', bridge: '#5a4428', exit: '#2a6a2a', pillar: '#6a6458',
};

export function fitViewport(availW: number, availH: number, gridW: number, gridH: number) {
  const fitCols = Math.floor((availW - GRID_BORDER) / CELL_W);
  const fitRows = Math.floor((availH - GRID_BORDER) / CELL_H);
  const needsCamera = fitCols < gridW || fitRows < gridH;
  const minimapH = gridH * MINIMAP_PX + MINIMAP_GAP;
  const cols = Math.max(1, Math.min(gridW, fitCols));
  const rows = Math.max(1, Math.min(gridH,
    needsCamera ? Math.floor((availH - GRID_BORDER - minimapH) / CELL_H) : fitRows));
  return { cols, rows, needsCamera };
}

export function clampCam(c: Pt, gridW: number, gridH: number, cols: number, rows: number): Pt {
  return {
    x: Math.max(0, Math.min(gridW - cols, c.x)),
    y: Math.max(0, Math.min(gridH - rows, c.y)),
  };
}

export function centreOn(pos: Pt, cols: number, rows: number): Pt {
  return { x: pos.x - Math.floor(cols / 2), y: pos.y - Math.floor(rows / 2) };
}

/** Top-left of cell (x, y) in world-layer pixels. */
export function cellOrigin(x: number, y: number): { left: number; top: number } {
  return { left: GRID_BORDER / 2 + x * CELL_W, top: GRID_BORDER / 2 + y * CELL_H };
}

/** A single-tile move (orthogonal or diagonal): slide it. Anything else snaps. */
export function isStep(a: Pt, b: Pt): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}

/** Tiles the minimap draws: all of them, or only explored ones when fog is on. */
export function minimapTiles(grid: { width: number; height: number; tiles: string[][] }, explored?: Set<string>) {
  const out: { x: number; y: number; type: string }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (explored && !explored.has(`${x},${y}`)) continue;
      out.push({ x, y, type: grid.tiles[y][x] });
    }
  }
  return out;
}
