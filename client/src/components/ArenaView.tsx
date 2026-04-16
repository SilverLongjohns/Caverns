import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { ArenaGrid } from './ArenaGrid.js';
import { TurnOrderBar } from './TurnOrderBar.js';
import { ArenaUnitPanel } from './ArenaUnitPanel.js';
import { ArenaActionBar } from './ArenaActionBar.js';

interface ArenaViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
  ) => void;
  onArenaMove: (targetX: number, targetY: number) => void;
  onArenaEndTurn: () => void;
}

type InteractionMode = 'none' | 'move' | 'attack';

const DIRS = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
const TILE_COSTS: Record<string, number> = { floor: 1, water: 2, hazard: 1, bridge: 1 };

/** BFS from start, returns map of "x,y" -> {remaining MP, parent key} */
function bfsMovement(
  grid: { width: number; height: number; tiles: string[][] },
  start: { x: number; y: number },
  mp: number,
  occupied: Set<string>,
): Map<string, { remaining: number; parent: string | null }> {
  const visited = new Map<string, { remaining: number; parent: string | null }>();
  const startKey = `${start.x},${start.y}`;
  visited.set(startKey, { remaining: mp, parent: null });
  const queue: { x: number; y: number; mp: number }[] = [{ x: start.x, y: start.y, mp }];

  while (queue.length > 0) {
    const { x, y, mp: curMp } = queue.shift()!;
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      const cost = TILE_COSTS[grid.tiles[ny][nx]] ?? Infinity;
      if (cost === Infinity) continue;
      const rem = curMp - cost;
      if (rem < 0) continue;
      const key = `${nx},${ny}`;
      if (occupied.has(key)) continue;
      const existing = visited.get(key);
      if (existing && existing.remaining >= rem) continue;
      visited.set(key, { remaining: rem, parent: `${x},${y}` });
      queue.push({ x: nx, y: ny, mp: rem });
    }
  }
  return visited;
}

/** Trace path from BFS result, returns array from start (exclusive) to target (inclusive) */
function tracePath(bfs: Map<string, { remaining: number; parent: string | null }>, targetKey: string): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  let key: string | null = targetKey;
  while (key) {
    const entry = bfs.get(key);
    if (!entry || entry.parent === null) break;
    const [px, py] = key.split(',').map(Number);
    path.unshift({ x: px, y: py });
    key = entry.parent;
  }
  return path;
}

export function ArenaView({ onCombatAction, onArenaMove, onArenaEndTurn }: ArenaViewProps) {
  const playerId = useGameStore((s) => s.playerId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const arenaGrid = useGameStore((s) => s.arenaGrid);
  const arenaPositions = useGameStore((s) => s.arenaPositions);
  const arenaMovementRemaining = useGameStore((s) => s.arenaMovementRemaining);
  const arenaActionTaken = useGameStore((s) => s.arenaActionTaken);
  const arenaMovePath = useGameStore((s) => s.arenaMovePath);
  const textLog = useGameStore((s) => s.textLog);
  const currentTurnId = useGameStore((s) => s.currentTurnId);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [combatLogStart] = useState(() => textLog.length);
  const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);

  // Animation state: which entity is animating and its path
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [animPath, setAnimPath] = useState<{ x: number; y: number }[] | null>(null);

  const isMyTurn = currentTurnId === playerId;

  const combatLogLines = useMemo(() => {
    return textLog
      .slice(combatLogStart)
      .filter((entry) => entry.logType === 'combat')
      .slice(-3);
  }, [textLog, combatLogStart]);

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const [id, pos] of Object.entries(arenaPositions)) {
      if (id !== playerId) set.add(`${pos.x},${pos.y}`);
    }
    return set;
  }, [arenaPositions, playerId]);

  // Client-side BFS for movement range — also used for path tracing
  const bfsResult = useMemo(() => {
    if (!isMyTurn || interactionMode !== 'move' || !arenaGrid) return null;
    const myPos = arenaPositions[playerId];
    if (!myPos) return null;
    return bfsMovement(arenaGrid, myPos, arenaMovementRemaining, occupied);
  }, [isMyTurn, interactionMode, arenaGrid, arenaPositions, arenaMovementRemaining, playerId, occupied]);

  const movementRange = useMemo(() => {
    if (!bfsResult) return null;
    return new Set(bfsResult.keys());
  }, [bfsResult]);

  // Compute path + ghost for hovered tile
  const { hoverPath, ghostPos } = useMemo(() => {
    if (!bfsResult || !hoverTile || !arenaGrid) return { hoverPath: null, ghostPos: null };
    const myPos = arenaPositions[playerId];
    if (!myPos) return { hoverPath: null, ghostPos: null };
    if (hoverTile.x === myPos.x && hoverTile.y === myPos.y) return { hoverPath: null, ghostPos: null };

    const targetKey = `${hoverTile.x},${hoverTile.y}`;

    if (bfsResult.has(targetKey)) {
      const path = tracePath(bfsResult, targetKey);
      return { hoverPath: path, ghostPos: hoverTile };
    }

    // Target out of range — find the reachable tile closest to the hover target
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (const [key, entry] of bfsResult) {
      if (entry.parent === null && key !== `${myPos.x},${myPos.y}`) continue;
      const [kx, ky] = key.split(',').map(Number);
      const dist = Math.abs(kx - hoverTile.x) + Math.abs(ky - hoverTile.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }

    if (bestKey && bestKey !== `${myPos.x},${myPos.y}`) {
      const path = tracePath(bfsResult, bestKey);
      const [gx, gy] = bestKey.split(',').map(Number);
      return { hoverPath: path, ghostPos: { x: gx, y: gy } };
    }

    return { hoverPath: null, ghostPos: null };
  }, [bfsResult, hoverTile, arenaGrid, arenaPositions, playerId]);

  // Build tile highlights: range tiles + path trace
  const tileHighlights = useMemo(() => {
    const highlights = new Map<string, string>();
    if (movementRange && interactionMode === 'move') {
      for (const key of movementRange) {
        highlights.set(key, 'arena-move-highlight');
      }
    }
    if (hoverPath) {
      for (const step of hoverPath) {
        highlights.set(`${step.x},${step.y}`, 'arena-path-trace');
      }
    }
    return highlights;
  }, [movementRange, interactionMode, hoverPath]);

  // When arenaMovePath arrives from server, set animation state.
  // ArenaGrid handles the DOM animation; we just track start/end for the entity exclusion.
  useEffect(() => {
    if (!arenaMovePath || !arenaMovePath.path || arenaMovePath.path.length === 0) {
      setAnimatingId(null);
      setAnimPath(null);
      return;
    }

    const { moverId, path } = arenaMovePath;
    setAnimatingId(moverId);
    setAnimPath(path);

    // Clear animation state after the path finishes playing
    const duration = path.length * 100 + 50; // match MOVE_ANIM_STEP_MS in ArenaGrid
    const timer = setTimeout(() => {
      setAnimatingId(null);
      setAnimPath(null);
    }, duration);

    return () => clearTimeout(timer);
  }, [arenaMovePath]);

  const adjacentEnemies = useMemo(() => {
    if (!activeCombat || !arenaPositions[playerId]) return new Set<string>();
    const myPos = arenaPositions[playerId];
    const adjacent = new Set<string>();
    for (const p of activeCombat.participants) {
      if (p.type !== 'mob') continue;
      const pos = arenaPositions[p.id];
      if (!pos) continue;
      if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) === 1) {
        adjacent.add(p.id);
      }
    }
    return adjacent;
  }, [activeCombat, arenaPositions, playerId]);

  const canFlee = useMemo(() => {
    if (!arenaGrid || !arenaPositions[playerId]) return false;
    const pos = arenaPositions[playerId];
    for (const d of DIRS) {
      const nx = pos.x + d.dx;
      const ny = pos.y + d.dy;
      if (nx < 0 || nx >= arenaGrid.width || ny < 0 || ny >= arenaGrid.height) return true;
      if ((nx === 0 || nx === arenaGrid.width - 1 || ny === 0 || ny === arenaGrid.height - 1)
        && arenaGrid.tiles[ny][nx] === 'wall') return true;
    }
    return false;
  }, [arenaGrid, arenaPositions, playerId]);

  const handleTileClick = useCallback((x: number, y: number) => {
    if (!isMyTurn) return;

    if (interactionMode === 'move') {
      if (ghostPos) {
        onArenaMove(ghostPos.x, ghostPos.y);
      }
      return;
    }

    if (interactionMode === 'attack') {
      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (pos.x === x && pos.y === y && adjacentEnemies.has(id)) {
          onCombatAction('attack', id);
          useGameStore.setState({ arenaActionTaken: true });
          setInteractionMode('none');
          return;
        }
      }
    }
  }, [isMyTurn, interactionMode, ghostPos, arenaPositions, adjacentEnemies, onArenaMove, onCombatAction]);

  const handleTileHover = useCallback((x: number, y: number) => {
    setHoverTile((prev) => (prev?.x === x && prev?.y === y) ? prev : { x, y });
  }, []);

  const handleTileHoverEnd = useCallback(() => {
    setHoverTile(null);
  }, []);

  if (!activeCombat || !arenaGrid) return null;

  return (
    <div className="arena-view">
      <TurnOrderBar
        participants={activeCombat.participants}
        turnOrder={activeCombat.turnOrder}
        currentTurnId={activeCombat.currentTurnId}
        roundNumber={activeCombat.roundNumber}
      />
      <div className="arena-main">
        <ArenaGrid
          grid={arenaGrid}
          positions={arenaPositions}
          participants={activeCombat.participants}
          playerId={playerId}
          movementRange={interactionMode === 'move' ? movementRange : null}
          isTargeting={interactionMode === 'attack'}
          onTileClick={handleTileClick}
          onTileHover={interactionMode === 'move' ? handleTileHover : undefined}
          onTileHoverEnd={interactionMode === 'move' ? handleTileHoverEnd : undefined}
          tileHighlights={tileHighlights}
          ghostEntity={interactionMode === 'move' ? ghostPos : null}
          animatingId={animatingId}
          animPath={animPath}
        />
        <ArenaUnitPanel participants={activeCombat.participants} />
      </div>
      <ArenaActionBar
        isMyTurn={isMyTurn}
        actionTaken={arenaActionTaken}
        movementRemaining={arenaMovementRemaining}
        canFlee={canFlee}
        onMoveMode={() => setInteractionMode('move')}
        onCancelMove={() => setInteractionMode('none')}
        onAttackMode={() => setInteractionMode('attack')}
        onCancelAttack={() => setInteractionMode('none')}
        onDefend={() => { onCombatAction('defend'); useGameStore.setState({ arenaActionTaken: true }); }}
        onFlee={() => onCombatAction('flee')}
        onEndTurn={onArenaEndTurn}
        onUseItem={(index, targetId) => {
          onCombatAction('use_item', targetId, index);
          useGameStore.setState({ arenaActionTaken: true });
        }}
      />
      <div className="arena-combat-log">
        {combatLogLines.map((entry) => (
          <div key={entry.id} className="combat-log-line">{entry.message}</div>
        ))}
      </div>
    </div>
  );
}
