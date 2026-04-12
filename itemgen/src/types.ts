import type { EquipmentSlot, Rarity } from '@caverns/shared';

export type Quality = 'crude' | 'standard' | 'fine' | 'superior' | 'masterwork';

export interface MaterialDef {
  id: string;
  name: string;
  statBias: Partial<Record<'damage' | 'defense' | 'maxHp' | 'initiative', number>>;
  slots: EquipmentSlot[];
  tier: 1 | 2 | 3;
}

export interface NameFragments {
  adjectives: string[];
  prefixes: string[];
  suffixes: string[];
  baseTypes: Record<EquipmentSlot, string[]>;
}

export interface BiomePalette {
  biomeId: string;
  materials: MaterialDef[];
  nameFragments: NameFragments;
}

export interface ItemGenerationRequest {
  slot: EquipmentSlot;
  skullRating: 1 | 2 | 3;
  biomeId: string;
  rarity?: Rarity;
  seed?: number;
}
