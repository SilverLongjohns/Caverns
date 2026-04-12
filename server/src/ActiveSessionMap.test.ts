import { describe, it, expect } from 'vitest';
import { ActiveSessionMap } from './ActiveSessionMap.js';

describe('ActiveSessionMap', () => {
  it('attaches and looks up an account', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'session-A');
    expect(m.get('acc-1')).toBe('session-A');
  });

  it('detach by accountId removes the entry', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'session-A');
    m.detach('acc-1');
    expect(m.get('acc-1')).toBeUndefined();
  });

  it('detachSession removes all accounts on that session', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'sess-A');
    m.attach('acc-2', 'sess-A');
    m.attach('acc-3', 'sess-B');
    m.detachSession('sess-A');
    expect(m.get('acc-1')).toBeUndefined();
    expect(m.get('acc-2')).toBeUndefined();
    expect(m.get('acc-3')).toBe('sess-B');
  });

  it('clear empties everything', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'sess-A');
    m.clear();
    expect(m.get('acc-1')).toBeUndefined();
  });
});
