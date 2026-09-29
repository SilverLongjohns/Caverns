import { describe, it, expect } from 'vitest';
import { ActiveSessionMap } from './ActiveSessionMap.js';

describe('ActiveSessionMap (per character)', () => {
  it('tracks two characters of one account in two runs', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    expect(m.getByCharacter('char-A')).toBe('sess-1');
    expect(m.getByCharacter('char-B')).toBe('sess-2');
    expect(m.listForAccount('acc-1')).toEqual([
      { characterId: 'char-A', sessionId: 'sess-1' },
      { characterId: 'char-B', sessionId: 'sess-2' },
    ]);
    expect(m.listForAccount('acc-2')).toEqual([]);
  });

  it('detachCharacter removes only that character', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    m.detachCharacter('char-A');
    expect(m.getByCharacter('char-A')).toBeUndefined();
    expect(m.getByCharacter('char-B')).toBe('sess-2');
  });

  it('detachSession removes every character in that run', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.attach('char-C', 'acc-2', 'sess-1');
    m.attach('char-B', 'acc-1', 'sess-2');
    m.detachSession('sess-1');
    expect(m.listForAccount('acc-2')).toEqual([]);
    expect(m.listForAccount('acc-1')).toEqual([{ characterId: 'char-B', sessionId: 'sess-2' }]);
  });

  it('clear empties everything', () => {
    const m = new ActiveSessionMap();
    m.attach('char-A', 'acc-1', 'sess-1');
    m.clear();
    expect(m.getByCharacter('char-A')).toBeUndefined();
  });
});
