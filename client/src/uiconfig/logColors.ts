import type { LogColorsConfig } from './uiConfigTypes.js';
import config from './logColors.json' with { type: 'json' };
export const LOG_COLORS_CONFIG: LogColorsConfig = config;
