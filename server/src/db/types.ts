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

export interface CharacterStashTable {
  character_id: string;
  items: (Item | null)[];
  gold: number;
  capacity: number;
}

export interface CharacterShopStateTable {
  character_id: string;
  shop_id: string;
  rotating_items: (Item | null)[];
  created_at: Date;
  updated_at: Date;
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
  character_stash: CharacterStashTable;
  character_shop_state: CharacterShopStateTable;
  sessions: SessionsTable;
  worlds: WorldsTable;
  world_members: WorldMembersTable;
}
