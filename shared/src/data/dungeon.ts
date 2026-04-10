import type { DungeonConfig } from './configTypes.js';
import config from './dungeonConfig.json' with { type: 'json' };
export const DUNGEON_CONFIG: DungeonConfig = config;
