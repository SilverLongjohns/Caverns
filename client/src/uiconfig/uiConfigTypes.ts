export interface LogColorsConfig {
  narration: string;
  combat: string;
  loot: string;
  system: string;
  chat: string;
}

export interface CombatUIConfig {
  hpThresholdYellow: number;
  hpThresholdRed: number;
  hpBlockCount: number;
}

export interface MapUIConfig {
  viewportRadius: number;
  playerColors: string[];
}
