import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SFX, SFX_FILES, SFX_IDS, isSfxId } from './sfxManifest.js';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
/** Flip to true in Task 10 once every sound has been curated and promoted. */
const SFX_PASS_COMPLETE = true;

describe('sfx manifest', () => {
  it('has 59 ids, all tuned', () => {
    expect(SFX_IDS).toHaveLength(59);
    for (const id of SFX_IDS) expect(SFX[id].volume).toBeGreaterThan(0);
  });
  it('only lists files for known ids', () => {
    for (const id of Object.keys(SFX_FILES)) expect(isSfxId(id), id).toBe(true);
  });
  it('every listed file exists under client/public', () => {
    for (const urls of Object.values(SFX_FILES)) {
      for (const url of urls ?? []) expect(existsSync(PUBLIC + url), url).toBe(true);
    }
  });
  it.skipIf(!SFX_PASS_COMPLETE)('every id has its target number of takes', () => {
    for (const id of SFX_IDS) expect(SFX_FILES[id]?.length ?? 0, id).toBeGreaterThanOrEqual(SFX[id].takes);
  });
});
