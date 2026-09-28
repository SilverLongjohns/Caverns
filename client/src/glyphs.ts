import type { CombatParticipant } from '@caverns/shared';
import { MOB_GLYPHS, CLASS_GLYPHS, FURNISHING_GLYPHS } from './glyphManifest.js';

// 24x24 glyph sprites drawn in arena grid cells. Anything without a glyph falls back to its ASCII char.
const mobGlyphs = new Set<string>(MOB_GLYPHS);
const classGlyphs = new Set<string>(CLASS_GLYPHS);
const furnishingGlyphs = new Set<string>(FURNISHING_GLYPHS);

export function getParticipantGlyph(p: Pick<CombatParticipant, 'type' | 'className' | 'templateId'>): string | null {
  if (p.type === 'player') {
    return p.className && classGlyphs.has(p.className) ? `/sprites/glyphs/classes/${p.className}.png` : null;
  }
  return p.templateId && mobGlyphs.has(p.templateId) ? `/sprites/glyphs/mobs/${p.templateId}.png` : null;
}

export function getFurnishingGlyph(id?: string): string | null {
  return id && furnishingGlyphs.has(id) ? `/sprites/glyphs/furnishings/${id}.png` : null;
}
