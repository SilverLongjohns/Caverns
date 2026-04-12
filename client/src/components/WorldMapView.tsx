import { useCallback, useEffect, useMemo } from 'react';
import type { TileKind } from '@caverns/shared';
import { findOverworldPath } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';

interface Props {
  onMove: (x: number, y: number) => void;
  onPortalReady: () => void;
  onPortalUnready: () => void;
  onPortalEnter: () => void;
  onInteract: (interactableId: string) => void;
}

const OVERWORLD_CHARS: Record<TileKind, string> = {
  floor: '.',
  wall: '#',
  grass: ',',
  path: '·',
  water: '~',
  town_floor: '.',
  door: '+',
};

export function WorldMapView({ onMove, onPortalReady, onPortalUnready, onPortalEnter, onInteract }: Props) {
  const worldMap = useGameStore((s) => s.worldMap);
  const worldMembers = useGameStore((s) => s.worldMembers);
  const myCharacterId = useGameStore((s) => s.selectedCharacterId);
  const pathPreview = useGameStore((s) => s.overworldPathPreview);
  const muster = useGameStore((s) => s.currentPortalMuster);

  const tileGrid = useMemo(() => {
    if (!worldMap) return null;
    return {
      width: worldMap.width,
      height: worldMap.height,
      tiles: worldMap.tiles as unknown as string[][],
      themes: undefined,
    };
  }, [worldMap]);

  const mine = useMemo(
    () => worldMembers.find((m) => m.characterId === myCharacterId),
    [worldMembers, myCharacterId],
  );

  const standingOnPortal = useMemo(() => {
    if (!worldMap || !mine) return null;
    return worldMap.portals.find((p) => p.x === mine.pos.x && p.y === mine.pos.y) ?? null;
  }, [worldMap, mine]);

  const standingOnInteractable = useMemo(() => {
    if (!worldMap || !mine) return null;
    return worldMap.interactables.find((i) => i.x === mine.pos.x && i.y === mine.pos.y) ?? null;
  }, [worldMap, mine]);

  useEffect(() => {
    if (!standingOnInteractable) return;
    const id = standingOnInteractable.id;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        onInteract(id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [standingOnInteractable, onInteract]);

  const isReady = !!(muster && mine && muster.readyMembers.some((m) => m.connectionId === mine.connectionId));

  const entities: EntityOverlay[] = useMemo(() => {
    if (!worldMap) return [];
    const list: EntityOverlay[] = [];
    for (const step of pathPreview) {
      list.push({ x: step.x, y: step.y, char: '·', className: 'overworld-path-preview' });
    }
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
  }, [worldMap, worldMembers, myCharacterId, pathPreview]);

  const handleTileClick = useCallback((x: number, y: number) => {
    if (!worldMap || !mine) return;
    const clickedInteractable = worldMap.interactables.find((i) => i.x === x && i.y === y);
    if (clickedInteractable && mine.pos.x === x && mine.pos.y === y) {
      onInteract(clickedInteractable.id);
      return;
    }
    const preview = findOverworldPath(worldMap, mine.pos, { x, y });
    if (preview) {
      useGameStore.setState({ overworldPathPreview: preview });
    }
    onMove(x, y);
  }, [worldMap, mine, onMove, onInteract]);

  if (!worldMap || !tileGrid) return null;

  const charLookup = (tileType: string) => OVERWORLD_CHARS[tileType as TileKind] ?? null;

  return (
    <div className="world-map-container">
      <TileGridView
        tileGrid={tileGrid}
        entities={entities}
        charLookup={charLookup}
        onTileClick={handleTileClick}
      />
      {standingOnInteractable && (
        <div className="overworld-interact-prompt">
          [E] {standingOnInteractable.label ?? `Use ${standingOnInteractable.kind}`}
        </div>
      )}
      {standingOnPortal && (
        <div className="portal-muster-panel">
          <h3 className="portal-muster-title">
            {standingOnPortal.label ?? 'Portal'} — Muster
          </h3>
          <ul className="portal-muster-list">
            {(muster?.readyMembers ?? []).map((m) => (
              <li key={m.connectionId} className={`portal-muster-member class-${m.className}`}>
                {m.characterName} <span className="portal-muster-meta">Lv {m.level}</span>
              </li>
            ))}
            {(muster?.readyMembers ?? []).length === 0 && (
              <li className="portal-muster-empty">— Nobody ready —</li>
            )}
          </ul>
          <div className="portal-muster-actions">
            {!isReady ? (
              <button className="portal-muster-btn" onClick={onPortalReady}>Ready</button>
            ) : (
              <button className="portal-muster-btn" onClick={onPortalUnready}>Unready</button>
            )}
            <button
              className="portal-muster-btn portal-muster-btn-enter"
              onClick={onPortalEnter}
              disabled={!isReady}
            >
              Enter Dungeon
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
