import type { CombatConfig } from './configTypes.js';
import config from './combatConfig.json' with { type: 'json' };
export const COMBAT_CONFIG: CombatConfig = config;
