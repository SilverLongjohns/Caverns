import type { PlayerConfig } from './configTypes.js';
import config from './playerConfig.json' with { type: 'json' };
export const PLAYER_CONFIG: PlayerConfig = config;
