import { audioEngine, type AudioEngine } from './audioEngine.js';
import { DUNGEON_PRELOAD } from './sfxManifest.js';
import type { SfxCue } from './sfxDirector.js';

type CueSink = Pick<AudioEngine, 'playSfx' | 'setBed' | 'setDuck' | 'preloadSfx'>;

export function playCues(cues: SfxCue[], engine: CueSink = audioEngine): void {
  for (const c of cues) {
    if (c.kind === 'sfx') {
      const { id, volume, limitKey } = c;
      engine.playSfx(id, { ...(volume === undefined ? {} : { volume }), ...(limitKey === undefined ? {} : { limitKey }) });
    }
    else if (c.kind === 'bed') engine.setBed(c.id);
    else if (c.kind === 'duck') engine.setDuck(c.on);
    else engine.preloadSfx(DUNGEON_PRELOAD);
  }
}
