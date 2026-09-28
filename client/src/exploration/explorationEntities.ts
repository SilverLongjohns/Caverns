import type { EntityOverlay } from '../components/TileGridView.js';
import { getParticipantGlyph, getFurnishingGlyph } from '../glyphs.js';

export interface FloatUnit {
  id: string;
  x: number;
  y: number;
  side: 'player' | 'mob';
  sprite: string | null;
  char: string;
  className: string;
}

export interface ExplorationInput {
  interactables: { x: number; y: number; char: string; used: boolean }[];
  furnishings: { x: number; y: number; char: string; interactable: boolean; id?: string }[];
  /** Already [] when this room has a combat running. */
  mobs: { mobId: string; mobName: string; templateId?: string; x: number; y: number }[];
  players: { id: string; className: string; x: number; y: number }[];
  localPlayerId: string;
  /** undefined = no fog (show everything). */
  visibleTiles?: Set<string>;
  /** Injected so tests don't depend on shipped art. Default: getFurnishingGlyph. */
  furnishingGlyph?: (id?: string) => string | null;
}

/** Exploration entities: props (furnishings, interactables) sit in tile cells; players and mobs float (they slide). */
export function buildExplorationEntities(input: ExplorationInput): { props: EntityOverlay[]; units: FloatUnit[] } {
  const glyphFor = input.furnishingGlyph ?? getFurnishingGlyph;
  const seen = (x: number, y: number) => !input.visibleTiles || input.visibleTiles.has(`${x},${y}`);

  // Props: one entity per tile. A furnishing provides the sprite; an interactable on the same tile provides the class.
  const byTile = new Map<string, EntityOverlay>();
  for (const f of input.furnishings) {
    byTile.set(`${f.x},${f.y}`, {
      x: f.x, y: f.y, char: f.char, sprite: glyphFor(f.id),
      className: f.interactable ? 'entity-interactable' : 'entity-furnishing',
    });
  }
  for (const it of input.interactables) {
    const key = `${it.x},${it.y}`;
    const cls = it.used ? 'entity-interactable-used' : 'entity-interactable';
    const existing = byTile.get(key);
    byTile.set(key, existing ? { ...existing, className: cls } : { x: it.x, y: it.y, char: it.char, sprite: null, className: cls });
  }
  const props = [...byTile.values()].filter((e) => seen(e.x, e.y));

  const units: FloatUnit[] = [];
  for (const p of input.players) {
    if (!seen(p.x, p.y)) continue;
    units.push({
      id: p.id, x: p.x, y: p.y, side: 'player', char: '@',
      sprite: getParticipantGlyph({ type: 'player', className: p.className }),
      className: p.id === input.localPlayerId ? 'entity-player entity-self' : 'entity-player',
    });
  }
  for (const m of input.mobs) {
    if (!seen(m.x, m.y)) continue;
    units.push({
      id: m.mobId, x: m.x, y: m.y, side: 'mob', char: (m.mobName[0] ?? '?').toUpperCase(),
      sprite: getParticipantGlyph({ type: 'mob', templateId: m.templateId }),
      className: 'entity-mob',
    });
  }
  return { props, units };
}
