import { describe, it, expect } from 'vitest';
import { plateFrameIndex, plateFrameSource, type PlateManifest } from './plate.js';

const m: PlateManifest = { fps: 24, frames: 40, cols: 4, rows: 4, w: 320, h: 180, files: ['a.png', 'b.png', 'c.png'] };

describe('plate atlas math', () => {
  it('maps time to a clamped frame index', () => {
    expect(plateFrameIndex(m, -1)).toBe(0);
    expect(plateFrameIndex(m, 0)).toBe(0);
    expect(plateFrameIndex(m, 1 / 24 + 1e-9)).toBe(1);
    expect(plateFrameIndex(m, 100)).toBe(39);
  });
  it('locates a frame inside the right atlas cell', () => {
    expect(plateFrameSource(m, 0)).toEqual({ file: 0, sx: 0, sy: 0 });
    expect(plateFrameSource(m, 5)).toEqual({ file: 0, sx: 320, sy: 180 });
    expect(plateFrameSource(m, 16)).toEqual({ file: 1, sx: 0, sy: 0 });
    expect(plateFrameSource(m, 39)).toEqual({ file: 2, sx: 3 * 320, sy: 180 });
  });
});
