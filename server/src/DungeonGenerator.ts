import Anthropic from '@anthropic-ai/sdk';
import type { DungeonContent } from '@caverns/shared';
import { DRIPPING_HALLS } from '@caverns/shared';
import { validateDungeon } from './DungeonValidator.js';

export const DIFFICULTY_CONSTRAINTS = {
  easy: {
    minRooms: 6, maxRooms: 8,
    skull1Mobs: '2-3', skull2Mobs: '0-1',
    bossHp: '100-150', bossDmg: '15-20', bossDef: '4-6',
    consumableDrops: '4-6', equipmentDrops: '4-6',
    skull1Hp: '15-25', skull1Dmg: '6-10',
    skull2Hp: '40-60', skull2Dmg: '10-16',
  },
  medium: {
    minRooms: 9, maxRooms: 12,
    skull1Mobs: '3-4', skull2Mobs: '1-2',
    bossHp: '150-250', bossDmg: '20-30', bossDef: '6-10',
    consumableDrops: '3-5', equipmentDrops: '5-8',
    skull1Hp: '20-35', skull1Dmg: '8-12',
    skull2Hp: '50-80', skull2Dmg: '14-22',
  },
  hard: {
    minRooms: 12, maxRooms: 16,
    skull1Mobs: '3-5', skull2Mobs: '2-3',
    bossHp: '250-400', bossDmg: '28-40', bossDef: '9-14',
    consumableDrops: '2-4', equipmentDrops: '6-10',
    skull1Hp: '30-50', skull1Dmg: '10-16',
    skull2Hp: '70-110', skull2Dmg: '18-28',
  },
} as const;

export type Difficulty = keyof typeof DIFFICULTY_CONSTRAINTS;

export function buildSystemPrompt(difficulty: Difficulty): string {
  const c = DIFFICULTY_CONSTRAINTS[difficulty];
  return `You are a dungeon designer for a cooperative dungeon crawler called Caverns.

Return ONLY valid JSON matching this TypeScript interface (no markdown, no explanation):

interface DungeonContent {
  name: string;           // dungeon name
  theme: string;          // short theme description
  atmosphere: string;     // atmospheric description
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];
  bossId: string;         // must match a mob id
  entranceRoomId: string; // must match a room id
}

interface Room {
  id: string;             // unique snake_case
  type: 'tunnel' | 'chamber' | 'cavern' | 'dead_end' | 'boss';
  name: string;
  description: string;    // 2-3 evocative sentences
  exits: Partial<Record<'north' | 'south' | 'east' | 'west', string>>; // direction -> room id
  encounter?: { mobId: string; skullRating: 1 | 2 | 3 };
  loot?: { itemId: string; location: 'chest' | 'floor' | 'hidden' }[];
}

interface MobTemplate {
  id: string;             // unique snake_case
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;     // 1-10
  lootTable: string[];    // item ids
}

interface Item {
  id: string;             // unique snake_case
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  slot: 'weapon' | 'offhand' | 'armor' | 'accessory' | 'consumable';
  stats: {
    damage?: number;
    defense?: number;
    maxHp?: number;
    initiative?: number;
    healAmount?: number;  // only for consumables
  };
}

DIFFICULTY: ${difficulty.toUpperCase()}

CONSTRAINTS:
- Room count: ${c.minRooms}-${c.maxRooms}
- 1-skull mobs (encounters): ${c.skull1Mobs}
- 2-skull mobs (encounters): ${c.skull2Mobs}
- 1-skull mob stats: HP ${c.skull1Hp}, damage ${c.skull1Dmg}, defense 1-5, initiative 1-10
- 2-skull mob stats: HP ${c.skull2Hp}, damage ${c.skull2Dmg}, defense 3-8, initiative 1-10
- Boss (3-skull): HP ${c.bossHp}, damage ${c.bossDmg}, defense ${c.bossDef}, initiative 1-10
- Consumable items (healing potions, etc.): ${c.consumableDrops} total across room loot and mob loot tables
- Equipment items (weapons, armor, etc.): ${c.equipmentDrops} total across room loot and mob loot tables
- Loot should be generous — a good run should feel like a power fantasy

DESIGN RULES:
- Exactly one boss room with type 'boss'
- All rooms must be reachable from the entrance room (no orphans)
- Room exits MUST be bidirectional: if room A exits north to room B, room B MUST exit south to room A
- Each mobId in room encounters must exist in the mobs array
- Each itemId in room loot and mob lootTable must exist in the items array
- bossId must match the boss mob's id
- entranceRoomId must match the entrance room's id
- Entrance room must have no encounter
- All IDs must be unique snake_case strings within their category
- Be creative with the theme, names, and descriptions — make each dungeon unique and atmospheric`;
}

export function parseDungeonResponse(response: string): DungeonContent {
  let text = response.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return JSON.parse(text) as DungeonContent;
}

export interface GenerationResult {
  success: boolean;
  dungeon: DungeonContent;
  generated: boolean;
  error?: string;
}

export async function generateDungeon(
  apiKey: string,
  difficulty: Difficulty
): Promise<GenerationResult> {
  const constraints = DIFFICULTY_CONSTRAINTS[difficulty];
  const systemPrompt = buildSystemPrompt(difficulty);

  const client = new Anthropic({ apiKey });

  let lastErrors: string[] | undefined;
  let lastResponse: string | undefined;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: `Generate a ${difficulty} dungeon.` },
      ];

      if (attempt === 1 && lastErrors) {
        messages.push(
          { role: 'assistant', content: lastResponse! },
          { role: 'user', content: `Your previous response had these errors:\n${lastErrors.join('\n')}\n\nFix them and return the complete corrected JSON.` },
        );
      }

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      lastResponse = text;

      const dungeon = parseDungeonResponse(text);
      const errors = validateDungeon(dungeon, { minRooms: constraints.minRooms, maxRooms: constraints.maxRooms });

      if (errors.length === 0) {
        return { success: true, dungeon, generated: true };
      }

      lastErrors = errors;
      console.log(`Generation attempt ${attempt + 1} validation failed:`, errors);
    } catch (err) {
      console.error(`Generation attempt ${attempt + 1} error:`, err);
      lastErrors = [(err as Error).message];
      lastResponse = undefined;
    }
  }

  // Fallback
  return {
    success: false,
    dungeon: DRIPPING_HALLS,
    generated: false,
    error: lastErrors ? lastErrors.join('; ') : 'Unknown generation error',
  };
}
