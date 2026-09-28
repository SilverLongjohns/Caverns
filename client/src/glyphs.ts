import type { CombatParticipant } from '@caverns/shared';
import { MOB_GLYPHS, CLASS_GLYPHS, FURNISHING_GLYPHS } from './glyphManifest.js';

// 24x24 glyph sprites drawn in arena grid cells. Anything without a glyph falls back to its ASCII char.
const mobGlyphs = new Set<string>(MOB_GLYPHS);
const classGlyphs = new Set<string>(CLASS_GLYPHS);

export function getParticipantGlyph(p: Pick<CombatParticipant, 'type' | 'className' | 'templateId'>): string | null {
  if (p.type === 'player') {
    return p.className && classGlyphs.has(p.className) ? `/sprites/glyphs/classes/${p.className}.png` : null;
  }
  return p.templateId && mobGlyphs.has(p.templateId) ? `/sprites/glyphs/mobs/${p.templateId}.png` : null;
}

/** Small stable string hash (FNV-1a, 32-bit) — deterministic across clients, used to pick a furnishing's sprite variant. */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A furnishing's sprite path, or null if it has no installed art. `seedKey` picks a stable variant
 * (e.g. `${roomId}:${x},${y}`) so the same placed piece always renders the same sprite for every player.
 */
export function getFurnishingGlyph(id?: string, seedKey?: string): string | null {
  if (!id) return null;
  const count = FURNISHING_GLYPHS[id];
  if (!count) return null;
  const n = fnv1a32(seedKey ?? '') % count;
  return `/sprites/glyphs/furnishings/${id}-${n}.png`;
}
