import { describe, it, expect } from 'vitest';
import { transition, initialTransition, displayKey, targetKey } from './screenTransition.js';

const change = (key: string, reduced = false) => ({ type: 'change', key, reduced }) as const;

describe('screen transition reducer', () => {
  it('starts idle on the first key (no power-on at first mount)', () => {
    expect(initialTransition('login')).toEqual({ phase: 'idle', key: 'login' });
  });
  it('powers off the old screen, then on the new one, then idles', () => {
    let s = transition(initialTransition('login'), change('select'));
    expect(s).toEqual({ phase: 'off', from: 'login', to: 'select' });
    expect(displayKey(s)).toBe('login');
    expect(targetKey(s)).toBe('select');
    s = transition(s, { type: 'offDone' });
    expect(s).toEqual({ phase: 'on', key: 'select' });
    s = transition(s, { type: 'onDone' });
    expect(s).toEqual({ phase: 'idle', key: 'select' });
  });
  it('ignores a change to the key already showing', () => {
    const s = initialTransition('login');
    expect(transition(s, change('login'))).toBe(s);
  });
  it('jumps straight to powering on the latest key when changed mid-transition', () => {
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, change('c'))).toEqual({ phase: 'on', key: 'c' });
    const on = { phase: 'on', key: 'b' } as const;
    expect(transition(on, change('c'))).toEqual({ phase: 'on', key: 'c' });
  });
  it('swaps instantly under reduced motion', () => {
    expect(transition(initialTransition('a'), change('b', true))).toEqual({ phase: 'idle', key: 'b' });
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, change('c', true))).toEqual({ phase: 'idle', key: 'c' });
  });
  it('the watchdog finishes whatever phase is running', () => {
    const off = transition(initialTransition('a'), change('b'));
    expect(transition(off, { type: 'timeout' })).toEqual({ phase: 'on', key: 'b' });
    expect(transition({ phase: 'on', key: 'b' }, { type: 'timeout' })).toEqual({ phase: 'idle', key: 'b' });
    const idle = initialTransition('a');
    expect(transition(idle, { type: 'timeout' })).toBe(idle);
  });
  it('ignores completion events from the wrong phase', () => {
    const idle = initialTransition('a');
    expect(transition(idle, { type: 'offDone' })).toBe(idle);
    expect(transition(idle, { type: 'onDone' })).toBe(idle);
    const off = transition(idle, change('b'));
    expect(transition(off, { type: 'onDone' })).toBe(off);
  });

  it('skips the power-off when the outgoing screen is empty (panel opening)', () => {
    const s = transition(initialTransition('closed'), { type: 'change', key: 'stash', reduced: false, fromEmpty: true });
    expect(s).toEqual({ phase: 'on', key: 'stash' });
  });

  it('ends at power-off when the incoming screen is empty (panel closing)', () => {
    let s = transition(initialTransition('stash'), { type: 'change', key: 'closed', reduced: false, toEmpty: true });
    expect(s).toEqual({ phase: 'off', from: 'stash', to: 'closed', toEmpty: true });
    s = transition(s, { type: 'offDone' });
    expect(s).toEqual({ phase: 'idle', key: 'closed' });
  });

  it('goes straight to idle when changed mid-transition to an empty screen', () => {
    const on = { phase: 'on', key: 'stash' } as const;
    expect(transition(on, { type: 'change', key: 'closed', reduced: false, toEmpty: true })).toEqual({ phase: 'idle', key: 'closed' });
  });
});
