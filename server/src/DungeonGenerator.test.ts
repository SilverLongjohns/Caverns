import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseDungeonResponse, DIFFICULTY_CONSTRAINTS } from './DungeonGenerator.js';

describe('buildSystemPrompt', () => {
  it('includes the DungeonContent schema', () => {
    const prompt = buildSystemPrompt('medium');
    expect(prompt).toContain('DungeonContent');
    expect(prompt).toContain('Room');
    expect(prompt).toContain('MobTemplate');
    expect(prompt).toContain('Item');
  });

  it('includes difficulty constraints for the selected tier', () => {
    const prompt = buildSystemPrompt('hard');
    const constraints = DIFFICULTY_CONSTRAINTS['hard'];
    expect(prompt).toContain(String(constraints.minRooms));
    expect(prompt).toContain(String(constraints.maxRooms));
  });

  it('includes design rules', () => {
    const prompt = buildSystemPrompt('easy');
    expect(prompt).toContain('bidirectional');
    expect(prompt).toContain('boss');
    expect(prompt).toContain('entranceRoomId');
  });
});

describe('parseDungeonResponse', () => {
  it('parses valid JSON from a clean response', () => {
    const json = JSON.stringify({ name: 'Test', theme: 'test', atmosphere: 'test', rooms: [], mobs: [], items: [], bossId: 'b', entranceRoomId: 'e' });
    const result = parseDungeonResponse(json);
    expect(result.name).toBe('Test');
  });

  it('extracts JSON from markdown code fences', () => {
    const response = '```json\n{"name":"Test","theme":"t","atmosphere":"a","rooms":[],"mobs":[],"items":[],"bossId":"b","entranceRoomId":"e"}\n```';
    const result = parseDungeonResponse(response);
    expect(result.name).toBe('Test');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDungeonResponse('not json at all')).toThrow();
  });
});
