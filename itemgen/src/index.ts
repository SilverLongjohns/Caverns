export type {
  ItemGenerationRequest,
  MaterialDef,
  NameFragments,
  BiomePalette,
  Quality,
} from './types.js';
export { registerPalette, getPalette } from './materials.js';
export { generateItem } from './generate.js';
export { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
export { STARTER_PALETTE } from './palettes/starter.js';
export { CRYSTAL_PALETTE } from './palettes/crystal.js';
export { FLOODED_PALETTE } from './palettes/flooded.js';
export { BONE_PALETTE } from './palettes/bone.js';
export { VOLCANIC_PALETTE } from './palettes/volcanic.js';

// Auto-register built-in palettes
import { registerPalette } from './materials.js';
import { DRIPPING_HALLS_PALETTE } from './palettes/dripping-halls.js';
import { STARTER_PALETTE } from './palettes/starter.js';
import { CRYSTAL_PALETTE } from './palettes/crystal.js';
import { FLOODED_PALETTE } from './palettes/flooded.js';
import { BONE_PALETTE } from './palettes/bone.js';
import { VOLCANIC_PALETTE } from './palettes/volcanic.js';

registerPalette(DRIPPING_HALLS_PALETTE);
registerPalette(STARTER_PALETTE);
registerPalette(CRYSTAL_PALETTE);
registerPalette(FLOODED_PALETTE);
registerPalette(BONE_PALETTE);
registerPalette(VOLCANIC_PALETTE);
