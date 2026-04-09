import { describe, it, expect } from 'vitest';
import { generateRoomCode } from './roomCode.js';

describe('generateRoomCode', () => {
  it('generates a 4-character uppercase code', () => {
    const code = generateRoomCode(new Set());
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  it('does not collide with existing codes', () => {
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode(existing);
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
  });

  it('generates different codes on successive calls', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateRoomCode(new Set()));
    }
    expect(codes.size).toBe(20);
  });
});
