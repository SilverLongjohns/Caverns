import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { MOB_CLOSE_UPS } from './mobCloseUpManifest.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pool = JSON.parse(readFileSync(`${root}shared/src/data/mobPool.json`, 'utf8')) as { id: string }[];

describe('mob close-up manifest', () => {
  it('every entry is a real mob with a PNG on disk, and there are no duplicates', () => {
    const ids = new Set(pool.map((m) => m.id));
    expect(new Set(MOB_CLOSE_UPS).size).toBe(MOB_CLOSE_UPS.length);
    for (const id of MOB_CLOSE_UPS) {
      expect(ids.has(id), id).toBe(true);
      expect(existsSync(`${root}client/public/closeups/mobs/${id}.png`), id).toBe(true);
    }
  });
});
