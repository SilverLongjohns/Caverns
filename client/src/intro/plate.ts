// AI video plates, pre-pixelated offline (scripts/intro-bake.sh) into palette PNG atlases.
import { LR_W, LR_H } from './timeline.js';

export interface PlateManifest { fps: number; frames: number; cols: number; rows: number; w: number; h: number; files: string[] }
export interface PlateAtlas { manifest: PlateManifest; images: HTMLImageElement[] }

export function plateFrameIndex(m: PlateManifest, localT: number): number {
  return Math.min(m.frames - 1, Math.max(0, Math.floor(localT * m.fps + 1e-6)));
}

export function plateFrameSource(m: PlateManifest, index: number): { file: number; sx: number; sy: number } {
  const per = m.cols * m.rows;
  const file = Math.floor(index / per), cell = index % per;
  return { file, sx: (cell % m.cols) * m.w, sy: Math.floor(cell / m.cols) * m.h };
}

export function drawPlate(c: CanvasRenderingContext2D, atlas: PlateAtlas | undefined, localT: number): void {
  if (!atlas) return;
  const m = atlas.manifest;
  const { file, sx, sy } = plateFrameSource(m, plateFrameIndex(m, localT));
  const img = atlas.images[file];
  if (img) c.drawImage(img, sx, sy, m.w, m.h, 0, 0, LR_W, LR_H);
}
