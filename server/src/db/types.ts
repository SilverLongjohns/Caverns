import type { Equipment, Item } from '@caverns/shared';

export interface AccountsTable {
  id: string;
  auth_provider: string;
  provider_id: string;
  display_name: string;
  created_at: Date;
}

export interface CharactersTable {
  id: string;
  account_id: string;
  world_id: string;
  name: string;
  class: string;
  level: number;
  xp: number;
  stat_allocations: Record<string, number>;
  equipment: Equipment;
  inventory: (Item | null)[];
  consumables: (Item | null)[];
  gold: number;
  keychain: string[];
  in_use: boolean;
  last_played_at: Date | null;
  created_at: Date;
  overworld_pos: { x: number; y: number } | null;
}

export interface WorldsTable {
  id: string;
  name: string;
  seed: number | string;
  owner_account_id: string;
  invite_code: string;
  state: Record<string, unknown>;
  created_at: Date;
}

export interface WorldMembersTable {
  world_id: string;
  account_id: string;
  joined_at: Date;
}

export interface AccountStashTable {
  account_id: string;
  items: Item[];
  gold: number;
}

export interface SessionsTable {
  token: string;
  account_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
  account_stash: AccountStashTable;
  sessions: SessionsTable;
  worlds: WorldsTable;
  world_members: WorldMembersTable;
}
