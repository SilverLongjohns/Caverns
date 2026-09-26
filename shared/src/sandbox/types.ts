import type { EquipmentSlot, RoomType } from '../types.js';

export const SANDBOX_ROOM_TYPES: readonly RoomType[] = ['tunnel', 'chamber', 'cavern', 'dead_end', 'boss'];
export const SANDBOX_MAX_MOBS = 8;
export const SANDBOX_MAX_PARTY = 4;

export interface SandboxPartyMember {
  className: string;
  level?: number;
  name?: string;
  equipment?: Partial<Record<EquipmentSlot, string>>;
}

export interface SandboxPreset {
  id: string;
  label: string;
  /** Member 0 is the connected player; the rest are bots. */
  party: SandboxPartyMember[];
  /** Mob template ids from mobPool.json; mobs[0] is the leader. Spawned exactly, no random adds. */
  mobs: string[];
  roomType: RoomType;
  biome: string;
  seed?: number;
}

export interface SandboxOverrides {
  room?: string;
  biome?: string;
  mobs?: string[];
  party?: string[];
  level?: number;
  seed?: number;
}

export interface SandboxMember {
  className: string;
  level: number;
  name: string;
  equipment: Partial<Record<EquipmentSlot, string>>;
}

export interface SandboxSetup {
  presetId: string;
  label: string;
  party: SandboxMember[];
  mobs: string[];
  roomType: RoomType;
  biome: string;
  seed: number | null;
}

export type ResolveSetupResult = { ok: true; setup: SandboxSetup } | { ok: false; error: string };
