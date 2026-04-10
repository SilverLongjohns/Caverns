import type { EnergyConfig } from './configTypes.js';
import config from './energyConfig.json' with { type: 'json' };
export const ENERGY_CONFIG: EnergyConfig = config;
