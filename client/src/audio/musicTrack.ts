import type { ClientView } from '../store/gameStore.js';

export type MusicTrack = 'ambience' | 'world';

const PRE_GAME: ReadonlySet<ClientView> = new Set(['connecting', 'login', 'character_select']);

export function pickTrack(view: ClientView, hold: boolean): MusicTrack | null {
  if (hold) return null;
  return PRE_GAME.has(view) ? 'ambience' : 'world';
}
