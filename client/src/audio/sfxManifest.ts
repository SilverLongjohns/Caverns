// Hand-tuned per-sound settings. Which files each sound plays lives in sfxFiles.json,
// which scripts/sfx_promote.py regenerates after an audition pass.
import files from './sfxFiles.json';

export type SfxBus = 'sfx' | 'bed';

export interface SfxTuning {
  /** Linear gain applied on top of the bus. */
  volume: number;
  /** Takes the curated set should hold (round-robin pool size); 0 = deliberately unsampled (synth fallback or unused). */
  takes: number;
  bus: SfxBus;
  /** ± fraction of playback rate randomised per play (0.05 = ±5%). */
  pitchJitter?: number;
  minGapMs?: number;
  maxVoices?: number;
}

const one = (volume = 0.8, extra: Partial<SfxTuning> = {}): SfxTuning => ({ volume, takes: 1, bus: 'sfx', ...extra });
const many = (takes: number, volume = 0.8, extra: Partial<SfxTuning> = {}): SfxTuning =>
  ({ volume, takes, bus: 'sfx', pitchJitter: 0.04, ...extra });
const bed = (): SfxTuning => ({ volume: 0.7, takes: 1, bus: 'bed' });

export const SFX = {
  // Exploration
  step: many(4, 0.45, { minGapMs: 100 }),
  step_wet: many(3, 0.5, { minGapMs: 100 }),
  room_enter: one(0.6),
  exit_blocked: one(0.8, { minGapMs: 400 }),
  unlock: one(0.9),
  key_pickup: one(0.9),
  torch_pickup: one(0.8),
  torch_out: one(0.8),
  mob_alert: one(0.9, { minGapMs: 500 }),
  hazard_tick: one(0.8, { minGapMs: 250 }),
  interact_start: one(0.6),
  interact_loot: one(0.8),
  interact_hazard: one(0.8),
  interact_secret: one(0.9),
  interact_flavor: one(0.6),
  puzzle_ping: one(0.8, { takes: 0 }), // puzzles are not wired up yet
  gold: one(0.7, { minGapMs: 120 }),
  level_up: one(0.9),
  // Biome ambience beds
  amb_starter: bed(),
  amb_fungal: bed(),
  amb_crystal: bed(),
  amb_flooded: bed(),
  amb_volcanic: bed(),
  amb_bone: bed(),
  // Combat
  combat_start: one(0.9),
  melee_hit: many(1, 0.85),
  melee_crit: one(0.95),
  melee_miss: one(0.7),
  gun_shot: many(3, 0.9),
  gun_miss: one(0.7),
  reload: one(0.8),
  dry_click: one(0.8),
  defend: one(0.8, { takes: 0 }), // deferred: no take chosen yet
  mob_hit: many(2, 0.85),
  player_down: one(0.95),
  mob_death: many(1, 0.9),
  heal: one(0.8),
  ability_generic: one(0.85, { takes: 0 }), // deferred: no take chosen yet
  flee: one(0.8),
  qte_prompt: one(0.7, { takes: 0 }), // QTEs only render in legacy CombatView
  qte_success: one(0.8, { takes: 0 }), // QTEs only render in legacy CombatView
  qte_fail: one(0.7, { takes: 0 }), // QTEs only render in legacy CombatView
  victory: one(0.9),
  wipe: one(0.9),
  crack: one(0.9, { takes: 0 }), // synth close-up sound kept
  boom: one(0.9, { takes: 0 }), // synth close-up sound kept
  shimmer: one(0.8, { takes: 0 }), // synth close-up sound kept
  // UI / town
  ui_click: one(0.9, { minGapMs: 30 }),
  ui_tick: one(0.6, { minGapMs: 80 }),
  ui_power: one(0.9),
  ui_open: one(0.6),
  ui_close: one(0.5),
  shop_buy: one(0.8),
  shop_sell: one(0.8),
  shop_reroll: one(0.8),
  stash_move: one(0.8),
  equip: one(0.8),
  portal_ready: one(0.8),
  portal_enter: one(0.9),
} satisfies Record<string, SfxTuning>;

export type SfxId = keyof typeof SFX;
export type SfxFiles = Partial<Record<SfxId, string[]>>;

export const SFX_IDS = Object.keys(SFX) as SfxId[];
export const SFX_FILES = files as SfxFiles;

export function isSfxId(s: string): s is SfxId {
  return Object.prototype.hasOwnProperty.call(SFX, s);
}

/** Every one-shot, warmed on dungeon entry so the first step/hit doesn't wait on a fetch. */
export const DUNGEON_PRELOAD: SfxId[] = SFX_IDS.filter((id) => SFX[id].bus === 'sfx');
