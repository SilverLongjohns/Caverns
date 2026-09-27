import { describe, it, expect } from 'vitest';
import { pickTrack } from './musicTrack.js';

describe('pickTrack', () => {
  it('holds all music while the intro owns the soundstage', () => {
    expect(pickTrack('login', true)).toBeNull();
    expect(pickTrack('in_world', true)).toBeNull();
  });
  it('plays the cavern ambience on pre-game screens', () => {
    for (const v of ['connecting', 'login', 'character_select'] as const) expect(pickTrack(v, false)).toBe('ambience');
  });
  it('plays the world track once in the game', () => {
    for (const v of ['in_world', 'in_dungeon', 'game_over', 'generating'] as const) expect(pickTrack(v, false)).toBe('world');
  });
});
