import { describe, it, expect } from 'vitest';
import { CLASS_GLYPHS, MOB_GLYPHS } from '../glyphManifest.js';
import { buildExplorationEntities, type ExplorationInput } from './explorationEntities.js';

const cls = CLASS_GLYPHS[0];
const mobT = MOB_GLYPHS[0];
const base = (over: Partial<ExplorationInput> = {}): ExplorationInput => ({
  interactables: [], furnishings: [], mobs: [], players: [], localPlayerId: 'p1', roomId: 'room1', ...over,
});
const withGlyph = (id?: string) => (id === 'furn_a' ? '/sprites/glyphs/furnishings/furn_a.png' : null);

describe('buildExplorationEntities', () => {
  it('players and mobs are floating units with sprites; props are inline', () => {
    const out = buildExplorationEntities(base({
      players: [{ id: 'p1', className: cls, x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'Thing', templateId: mobT, x: 3, y: 1 }],
      furnishings: [{ x: 5, y: 1, char: '╥', interactable: false, id: 'furn_a' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.units.map((u) => u.id).sort()).toEqual(['m1', 'p1']);
    expect(out.units.find((u) => u.id === 'p1')).toMatchObject({ side: 'player', sprite: `/sprites/glyphs/classes/${cls}.png` });
    expect(out.units.find((u) => u.id === 'm1')).toMatchObject({ side: 'mob', sprite: `/sprites/glyphs/mobs/${mobT}.png` });
    expect(out.props).toEqual([expect.objectContaining({ x: 5, y: 1, sprite: '/sprites/glyphs/furnishings/furn_a.png', className: 'entity-furnishing' })]);
  });
  it('the local player is marked', () => {
    const out = buildExplorationEntities(base({ players: [{ id: 'p1', className: cls, x: 1, y: 1 }, { id: 'p2', className: cls, x: 2, y: 1 }] }));
    expect(out.units.find((u) => u.id === 'p1')!.className).toContain('entity-self');
    expect(out.units.find((u) => u.id === 'p2')!.className).not.toContain('entity-self');
  });
  it('fallbacks: unknown class → @, mob without templateId → first letter, furnishing without art → its char', () => {
    const out = buildExplorationEntities(base({
      players: [{ id: 'p1', className: '__none__', x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'goblin', x: 2, y: 1 }],
      furnishings: [{ x: 3, y: 1, char: '╥', interactable: false, id: '__none__' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.units.find((u) => u.id === 'p1')).toMatchObject({ sprite: null, char: '@' });
    expect(out.units.find((u) => u.id === 'm1')).toMatchObject({ sprite: null, char: 'G' });
    expect(out.props[0]).toMatchObject({ sprite: null, char: '╥' });
  });
  it('an interactable furnishing (same tile as its interactable) is ONE entity: furnishing sprite + interactable class', () => {
    const out = buildExplorationEntities(base({
      interactables: [{ x: 4, y: 2, char: '⊞', used: false }],
      furnishings: [{ x: 4, y: 2, char: '⊞', interactable: true, id: 'furn_a' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.props).toHaveLength(1);
    expect(out.props[0]).toMatchObject({ x: 4, y: 2, sprite: '/sprites/glyphs/furnishings/furn_a.png', className: 'entity-interactable' });
  });
  it('a used interactable furnishing keeps the furnishing sprite but the used class', () => {
    const out = buildExplorationEntities(base({
      interactables: [{ x: 6, y: 3, char: '⊞', used: true }],
      furnishings: [{ x: 6, y: 3, char: '⊞', interactable: true, id: 'furn_a' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.props).toHaveLength(1);
    expect(out.props[0]).toMatchObject({ x: 6, y: 3, sprite: '/sprites/glyphs/furnishings/furn_a.png', className: 'entity-interactable-used' });
  });
  it('plain interactables stay ASCII; used ones are dimmed', () => {
    const out = buildExplorationEntities(base({ interactables: [{ x: 1, y: 1, char: 'Ω', used: false }, { x: 2, y: 1, char: '¤', used: true }] }));
    expect(out.props).toEqual([
      expect.objectContaining({ x: 1, y: 1, char: 'Ω', sprite: null, className: 'entity-interactable' }),
      expect.objectContaining({ x: 2, y: 1, char: '¤', sprite: null, className: 'entity-interactable-used' }),
    ]);
  });
  it('fog hides props and units outside visibleTiles; undefined shows all', () => {
    const input = base({
      players: [{ id: 'p1', className: cls, x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'x', templateId: mobT, x: 8, y: 1 }],
      interactables: [{ x: 9, y: 1, char: 'Ω', used: false }],
    });
    const fogged = buildExplorationEntities({ ...input, visibleTiles: new Set(['1,1']) });
    expect(fogged.units.map((u) => u.id)).toEqual(['p1']);
    expect(fogged.props).toEqual([]);
    const open = buildExplorationEntities(input);
    expect(open.units).toHaveLength(2);
    expect(open.props).toHaveLength(1);
  });
  it('passes a seedKey of `${roomId}:${x},${y}` to the injected furnishingGlyph', () => {
    const calls: [string | undefined, string | undefined][] = [];
    const capturing = (id?: string, seedKey?: string) => {
      calls.push([id, seedKey]);
      return null;
    };
    buildExplorationEntities(base({
      roomId: 'dripping_halls_3',
      furnishings: [{ x: 5, y: 2, char: '╥', interactable: false, id: 'furn_a' }],
      furnishingGlyph: capturing,
    }));
    expect(calls).toEqual([['furn_a', 'dripping_halls_3:5,2']]);
  });
  it('two furnishings of the same id on different tiles can get different sprites via the injected fn', () => {
    const bySeed = (id?: string, seedKey?: string) => (id && seedKey ? `/sprites/glyphs/furnishings/${id}-${seedKey}.png` : null);
    const out = buildExplorationEntities(base({
      roomId: 'room1',
      furnishings: [
        { x: 1, y: 1, char: '╥', interactable: false, id: 'furn_a' },
        { x: 9, y: 9, char: '╥', interactable: false, id: 'furn_a' },
      ],
      furnishingGlyph: bySeed,
    }));
    const sprites = out.props.map((p) => p.sprite).sort();
    expect(sprites).toEqual(['/sprites/glyphs/furnishings/furn_a-room1:1,1.png', '/sprites/glyphs/furnishings/furn_a-room1:9,9.png']);
  });
});
