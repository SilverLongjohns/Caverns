import { describe, it, expect } from 'vitest';
import { toggleKeep, setReroll, loadPicks, pendingIds } from './picks.js';

describe('audition picks', () => {
  it('toggles kept takes, sorted and unique', () => {
    let p = toggleKeep({}, 'step', 2);
    p = toggleKeep(p, 'step', 0);
    expect(p.step.keep).toEqual([0, 2]);
    p = toggleKeep(p, 'step', 2);
    expect(p.step.keep).toEqual([0]);
  });
  it('keeps spaces while a note is being typed', () => {
    let p = setReroll({}, 'x', 'too ');
    p = setReroll(p, 'x', 'too long');
    expect(p.x.reroll).toBe('too long');
    expect(setReroll({}, 'x', 'too ').x.reroll).toBe('too ');
  });
  it('sets and clears a reroll note', () => {
    let p = setReroll({}, 'gun_shot', 'too clean');
    expect(p.gun_shot.reroll).toBe('too clean');
    p = setReroll(p, 'gun_shot', '');
    expect(p.gun_shot.reroll).toBeUndefined();
  });
  it('loads safely from bad storage', () => {
    expect(loadPicks(null)).toEqual({});
    expect(loadPicks('not json')).toEqual({});
    expect(loadPicks('{"a":{"keep":[1]}}')).toEqual({ a: { keep: [1] } });
  });

  it('lists only sounds still to curate: not promoted and not deliberately unsampled', () => {
    const ids = ['step', 'defend', 'crack', 'mystery'];
    const files = { step: ['/audio/sfx/step_1.mp3'] };
    const targets = { step: 4, defend: 1, crack: 0 };
    expect(pendingIds(ids, files, targets)).toEqual(['defend', 'mystery']);
  });
});
