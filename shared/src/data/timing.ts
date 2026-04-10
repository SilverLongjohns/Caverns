import type { TimingConfig } from './configTypes.js';
import config from './timingConfig.json' with { type: 'json' };
export const TIMING_CONFIG: TimingConfig = config;
