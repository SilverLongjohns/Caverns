import { describe, it, expect, vi } from 'vitest';

vi.mock('../audio/sfxDirector.js', () => ({ soundsFor: () => { throw new Error('boom'); } }));

import { routeServerMessage } from './closeUpStore.js';
import { useGameStore } from '../store/gameStore.js';

describe('closeUpStore delivery', () => {
  it('a throwing audio layer never stops the message reaching the store', () => {
    const before = useGameStore.getState().textLog.length;
    expect(() => routeServerMessage({ type: 'text_log', message: 'hello', logType: 'system' })).not.toThrow();
    expect(useGameStore.getState().textLog.length).toBe(before + 1);
  });
});
