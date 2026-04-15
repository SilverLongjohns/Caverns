import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverworldMap, TileKind } from '@caverns/shared';
import { findOverworldPath } from '@caverns/shared';
import { getVisibleTiles } from '@caverns/roomgrid';
import type { Tile } from '@caverns/roomgrid';
import { useGameStore } from '../store/gameStore.js';
import { TileGridView, type EntityOverlay } from './TileGridView.js';
import { SignTooltip } from './SignTooltip.js';

function toLosTiles(map: OverworldMap): Tile[][] {
  return map.tiles.map((row) =>
    row.map((kind) => ({
      type: (kind === 'wall' || kind === 'pillar' ? 'wall' : 'floor') as Tile['type'],
    })),
  );
}

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
  pillar: '‖',
};

export function WorldMapView({ onMove, onPortalReady, onPortalUnready, onPortalEnter, onInteract }: Props) {
  const worldMap = useGameStore((s) => s.worldMap);
  const worldMembers = useGameStore((s) => s.worldMembers);
  const myCharacterId = useGameStore((s) => s.selectedCharacterId);
  const pathPreview = useGameStore((s) => s.overworldPathPreview);
  const muster = useGameStore((s) => s.currentPortalMuster);
  const currentWorldId = useGameStore((s) => s.currentWorld?.id ?? null);
  const visitedTilesByWorld = useGameStore((s) => s.visitedTiles);
  const markVisited = useGameStore((s) => s.markVisited);

  const losTiles = useMemo(() => (worldMap ? toLosTiles(worldMap) : null), [worldMap]);

  const tileGrid = useMemo(() => {
    if (!worldMap) return null;
    return {
      width: worldMap.width,
      height: worldMap.height,
      tiles: worldMap.tiles as unknown as string[][],
      themes: worldMap.themes,
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
    const found = worldMap.interactables.find((i) => i.x === mine.pos.x && i.y === mine.pos.y) ?? null;
    if (found && found.kind === 'sign') return null;
    return found;
  }, [worldMap, mine]);

  const signTooltipMap = useMemo(() => {
    const m = new Map<string, string>();
    if (!worldMap) return m;
    for (const it of worldMap.interactables) {
      if (it.kind === 'sign' && it.tooltip) {
        m.set(`${it.x},${it.y}`, it.tooltip);
      }
    }
    return m;
  }, [worldMap]);

  const [hoveredSign, setHoveredSign] = useState<string | null>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);

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
      let char = '!';
      let className = 'overworld-interactable';
      if (it.kind === 'stash') char = '$';
      else if (it.kind === 'shop') char = '!';
      else if (it.kind === 'sign') {
        char = '\u00B6';
        className = 'overworld-interactable tile-sign';
      }
      list.push({ x: it.x, y: it.y, char, className });
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

  const visibleTiles = useMemo(() => {
    const set = new Set<string>();
    if (!worldMap || !losTiles) return set;
    const observers: { x: number; y: number }[] = [];
    for (const m of worldMembers) {
      observers.push({ x: m.pos.x, y: m.pos.y });
    }
    for (const obs of observers) {
      for (const p of getVisibleTiles(losTiles, obs, 200)) {
        set.add(`${p.x},${p.y}`);
      }
    }
    for (const i of worldMap.interactables) set.add(`${i.x},${i.y}`);
    for (const p of worldMap.portals) set.add(`${p.x},${p.y}`);
    return set;
  }, [losTiles, worldMap, worldMembers]);

  useEffect(() => {
    if (!currentWorldId || visibleTiles.size === 0) return;
    markVisited(currentWorldId, visibleTiles);
  }, [currentWorldId, visibleTiles, markVisited]);

  const exploredTiles = useMemo(() => {
    if (!currentWorldId) return new Set<string>();
    return visitedTilesByWorld[currentWorldId] ?? new Set<string>();
  }, [currentWorldId, visitedTilesByWorld]);

  const handleTileClick = useCallback((x: number, y: number) => {
    if (!worldMap || !mine) return;
    const clickedInteractable = worldMap.interactables.find((i) => i.x === x && i.y === y);
    if (clickedInteractable && clickedInteractable.kind !== 'sign' && mine.pos.x === x && mine.pos.y === y) {
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

  const handleGridMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (signTooltipMap.size === 0) {
      if (hoveredSign !== null) setHoveredSign(null);
      return;
    }
    const wrap = gridWrapRef.current;
    if (!wrap) return;
    const rows = wrap.querySelectorAll('.room-row');
    if (rows.length === 0) return;
    let foundTip: string | null = null;
    for (let yi = 0; yi < rows.length; yi++) {
      const row = rows[yi] as HTMLElement;
      const rect = row.getBoundingClientRect();
      if (
        e.clientY >= rect.top &&
        e.clientY < rect.bottom &&
        e.clientX >= rect.left &&
        e.clientX < rect.right
      ) {
        const charWidth = rect.width / tileGrid.width;
        const xi = Math.floor((e.clientX - rect.left) / charWidth);
        const tip = signTooltipMap.get(`${xi},${yi}`);
        if (tip) foundTip = tip;
        break;
      }
    }
    if (foundTip !== hoveredSign) setHoveredSign(foundTip);
  };

  const handleGridMouseLeave = () => {
    if (hoveredSign !== null) setHoveredSign(null);
  };

  return (
    <div className="world-map-container">
      <div
        ref={gridWrapRef}
        onMouseMove={handleGridMouseMove}
        onMouseLeave={handleGridMouseLeave}
      >
        <TileGridView
          tileGrid={tileGrid}
          entities={entities}
          charLookup={charLookup}
          onTileClick={handleTileClick}
          visibleTiles={visibleTiles}
          exploredTiles={exploredTiles}
        />
      </div>
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
      <SignTooltip text={hoveredSign} />
    </div>
  );
}
