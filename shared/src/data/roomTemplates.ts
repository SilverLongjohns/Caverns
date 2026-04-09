import type { RoomType, Direction } from '../types.js';

export interface RoomTemplate {
  type: RoomType;
  width: number;
  height: number;
  lines: string[];
  exitPositions: Partial<Record<Direction, { x: number; y: number; length: number }>>;
}

// Pad all lines to consistent width
function padLines(lines: string[]): string[] {
  const maxLen = Math.max(...lines.map(l => l.length));
  return lines.map(l => l.padEnd(maxLen));
}

const DEAD_END: RoomTemplate = {
  type: 'dead_end',
  width: 30,
  height: 8,
  lines: padLines([
    '╔════════════════════════════╗',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' .     . ` . , . \' . ║',
    '║ . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , ║',
    '╚═══════════   ══════════════╝',
  ]),
  exitPositions: {
    south: { x: 12, y: 7, length: 3 },
  },
};

const TUNNEL: RoomTemplate = {
  type: 'tunnel',
  width: 40,
  height: 6,
  lines: padLines([
    '╔══════════════════════════════════════╗',
    '║ . , . ` . , . \' . , . ` . , . \' . ,║',
    '  , . \' . , . ` . , . \' . , . ` . , . ',
    '  . , . ` . , . \' . , . ` . , . \' . ,║',
    '║ , . \' . , . ` . , . \' . , . ` . , . ',
    '╚══════════════════════════════════════╝',
  ]),
  exitPositions: {
    west: { x: 0, y: 2, length: 2 },
    east: { x: 38, y: 2, length: 2 },
  },
};

const CHAMBER: RoomTemplate = {
  type: 'chamber',
  width: 45,
  height: 12,
  lines: padLines([
    '╔══════════════════   ═══════════════════════╗',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '  . , . ` . , . \' . , . ` . , . \' . , . ` .  ',
    '  , . \' . , . ` . , . \' . , . ` . , . \' . ,  ',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '╚══════════════════   ═══════════════════════╝',
  ]),
  exitPositions: {
    north: { x: 19, y: 0, length: 3 },
    south: { x: 19, y: 11, length: 3 },
    west: { x: 0, y: 5, length: 2 },
  },
};

const CAVERN: RoomTemplate = {
  type: 'cavern',
  width: 55,
  height: 13,
  lines: padLines([
    '  ╔═════════════════════   ════════════════════════════╗',
    ' ║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \'  . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . .║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , . ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . . ║',
    '  . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' .  ',
    '  , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , . `  ',
    '║ . , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , .  ║',
    '║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , . . ║',
    '║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , .  ║',
    ' ║ , . \' . , . ` . , . \' . , . ` . , . \' . , . ` . , .  ║',
    '  ║ . , . ` . , . \' . , . ` . , . \' . , . ` . , . \' . , ║',
    '   ╚══════════════════   ════════════════════════════╝  ',
  ]),
  exitPositions: {
    north: { x: 22, y: 0, length: 3 },
    south: { x: 19, y: 12, length: 3 },
    west: { x: 0, y: 5, length: 2 },
    east: { x: 53, y: 5, length: 2 },
  },
};

export const ROOM_TEMPLATES: Record<string, RoomTemplate> = {
  dead_end: DEAD_END,
  tunnel: TUNNEL,
  chamber: CHAMBER,
  cavern: CAVERN,
  boss: CAVERN,
};

export function getTemplateForRoom(roomType: RoomType): RoomTemplate {
  return ROOM_TEMPLATES[roomType] ?? ROOM_TEMPLATES['chamber'];
}
