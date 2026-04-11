import type { EncounterConfig } from './configTypes.js';
import config from './encounterConfig.json' with { type: 'json' };

export const ENCOUNTER_CONFIG: EncounterConfig = config;
