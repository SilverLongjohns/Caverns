import { describe, it, expect, vi } from 'vitest';
import { playCues } from './playCues.js';
import { DUNGEON_PRELOAD } from './sfxManifest.js';

describe('playCues', () => {
  it('routes each cue kind to the engine', () => {
    const engine = { playSfx: vi.fn(), setBed: vi.fn(), setDuck: vi.fn(), preloadSfx: vi.fn() };
    playCues([
      { kind: 'sfx', id: 'step', volume: 0.4, limitKey: 'step:other' },
      { kind: 'bed', id: 'amb_bone' },
      { kind: 'duck', on: true },
      { kind: 'preload' },
    ], engine);
    expect(engine.playSfx).toHaveBeenCalledWith('step', { volume: 0.4, limitKey: 'step:other' });
    expect(engine.setBed).toHaveBeenCalledWith('amb_bone');
    expect(engine.setDuck).toHaveBeenCalledWith(true);
    expect(engine.preloadSfx).toHaveBeenCalledWith(DUNGEON_PRELOAD);
  });
});
