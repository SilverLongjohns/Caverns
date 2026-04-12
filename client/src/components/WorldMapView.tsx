import { useMemo } from 'react';
import type { TileKind } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';

const OVERWORLD_CHARS: Record<TileKind, string> = {
  floor: '.',
  wall: '#',
  grass: ',',
  path: '·',
  water: '~',
  town_floor: '.',
  door: '+',
};

export function WorldMapView() {
  const worldMap = useGameStore((s) => s.worldMap);
  const worldMembers = useGameStore((s) => s.worldMembers);
  const myCharacterId = useGameStore((s) => s.selectedCharacterId);

  const tileGrid = useMemo(() => {
    if (!worldMap) return null;
    return {
      width: worldMap.width,
      height: worldMap.height,
      tiles: worldMap.tiles as unknown as string[][],
      themes: undefined,
    };
  }, [worldMap]);

  const entities: EntityOverlay[] = useMemo(() => {
    if (!worldMap) return [];
    const list: EntityOverlay[] = [];
    for (const it of worldMap.interactables) {
      list.push({
        x: it.x,
        y: it.y,
        char: it.kind === 'stash' ? '$' : '!',
        className: 'overworld-interactable',
      });
    }
    for (const p of worldMap.portals) {
      list.push({ x: p.x, y: p.y, char: '>', className: 'overworld-portal' });
    }
    for (const m of worldMembers) {
      const isSelf = m.characterId === myCharacterId;
      list.push({
        x: m.pos.x,
        y: m.pos.y,
        char: isSelf ? '@' : 'o',
        className: `overworld-member class-${m.className}${isSelf ? ' overworld-self' : ''}`,
      });
    }
    return list;
  }, [worldMap, worldMembers, myCharacterId]);

  if (!worldMap || !tileGrid) return null;

  const charLookup = (tileType: string) => OVERWORLD_CHARS[tileType as TileKind] ?? null;

  return (
    <div className="world-map-container">
      <TileGridView tileGrid={tileGrid} entities={entities} charLookup={charLookup} />
    </div>
  );
}
