import { describe, it, expect } from 'vitest';
import { closeUpKeyAction, type KeyInfo } from './closeUpKeys.js';

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, editable: false, ...extra });

describe('closeUpKeyAction', () => {
  it('skips on an ordinary key press', () => {
    expect(closeUpKeyAction(key('Enter'))).toBe('skip');
    expect(closeUpKeyAction(key(' '))).toBe('skip');
    expect(closeUpKeyAction(key('ArrowLeft'))).toBe('skip');
  });

  it('swallows auto-repeat from a held key without skipping', () => {
    expect(closeUpKeyAction(key('ArrowLeft', { repeat: true }))).toBe('swallow');
  });

  it('lets bare modifier keys through', () => {
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) expect(closeUpKeyAction(key(k))).toBe('pass');
  });

  it('lets browser shortcuts and function keys through', () => {
    expect(closeUpKeyAction(key('F5'))).toBe('pass');
    expect(closeUpKeyAction(key('r', { ctrlKey: true }))).toBe('pass');
    expect(closeUpKeyAction(key('Tab', { altKey: true }))).toBe('pass');
    expect(closeUpKeyAction(key('r', { metaKey: true }))).toBe('pass');
  });

  it('lets typing in a text field through (chat)', () => {
    expect(closeUpKeyAction(key('a', { editable: true }))).toBe('pass');
    expect(closeUpKeyAction(key('Enter', { editable: true }))).toBe('pass');
  });
});
