import { describe, it, expect } from 'vitest';
import { typedSlice } from './typed.js';

describe('typedSlice', () => {
  it('shows nothing before typing starts', () => {
    expect(typedSlice('Hello', 0, 40)).toBe('');
    expect(typedSlice('Hello', -50, 40)).toBe('');
  });
  it('reveals cps characters per second', () => {
    expect(typedSlice('Hello world', 100, 40)).toBe('Hell');
  });
  it('caps at the full text', () => {
    expect(typedSlice('Hello', 10_000, 40)).toBe('Hello');
  });
  it('handles the empty string and bad rates', () => {
    expect(typedSlice('', 500, 40)).toBe('');
    expect(typedSlice('Hi', 500, 0)).toBe('');
    expect(typedSlice('Hi', Number.NaN, 40)).toBe('');
  });
  it('never splits a code point', () => {
    // '⌘' and '…' are single code points; '🗝' is a surrogate pair
    expect(typedSlice('⌘ Go', 25, 40)).toBe('⌘');
    expect(typedSlice('🗝x', 25, 40)).toBe('🗝');
    expect(typedSlice('ab…', 75, 40)).toBe('ab…');
  });
});
