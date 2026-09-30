import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { ArenaGrid } from './ArenaGrid.js';
import { TurnOrderBar } from './TurnOrderBar.js';
import { ArenaUnitPanel } from './ArenaUnitPanel.js';
import { ArenaActionBar } from './ArenaActionBar.js';
import { hasLineOfSight, rangedProfile, teleportEffectOf, teleportDestinations, type AbilityDefinition } from '@caverns/shared';
import { TILE_PROPERTIES, type TileType } from '@caverns/roomgrid';
import { shotTargets, shotRangeTiles } from '../ui/shotTargets.js';

interface ArenaViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee' | 'shoot' | 'reload',
    targetId?: string,
    itemIndex?: number,
  ) => void;
  onArenaMove: (targetX: number, targetY: number) => void;
  onArenaEndTurn: () => void;
  onUseAbility: (abilityId: string, targetId?: string, targetX?: number, targetY?: number) => void;
}

type InteractionMode = 'none' | 'move' | 'attack' | 'target_ability_single' | 'target_ability_area' | 'target_ability_tile' | 'shoot';

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

export function ArenaView({ onCombatAction, onArenaMove, onArenaEndTurn, onUseAbility }: ArenaViewProps) {
  const playerId = useGameStore((s) => s.playerId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const arenaGrid = useGameStore((s) => s.arenaGrid);
  const arenaPositions = useGameStore((s) => s.arenaPositions);
  const arenaMovementRemaining = useGameStore((s) => s.arenaMovementRemaining);
  const arenaActionTaken = useGameStore((s) => s.arenaActionTaken);
  const arenaFreeActionsUsed = useGameStore((s) => s.arenaFreeActionsUsed);
  const arenaMovePath = useGameStore((s) => s.arenaMovePath);
  const textLog = useGameStore((s) => s.textLog);
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const me = useGameStore((s) => s.players[s.playerId]);
  const gun = useMemo(() => (me ? rangedProfile(me) : null), [me]);
  const myPart = activeCombat?.participants.find((p) => p.id === playerId);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [combatLogStart] = useState(() => textLog.length);
  const [hoverTile, setHoverTile] = useState<{ x: number; y: number } | null>(null);
  const [targetingAbility, setTargetingAbility] = useState<AbilityDefinition | null>(null);

  // Animation state: which entity is animating and its path
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [animPath, setAnimPath] = useState<{ x: number; y: number }[] | null>(null);

  const isMyTurn = currentTurnId === playerId;

  const shootable = useMemo(() => {
    const myPos = arenaPositions[playerId];
    if (interactionMode !== 'shoot' || !gun || !arenaGrid || !myPos || !activeCombat) return new Map<string, number>();
    const enemies = activeCombat.participants.filter((p) => p.type === 'mob' && p.hp > 0 && arenaPositions[p.id]).map((p) => ({ id: p.id, pos: arenaPositions[p.id] }));
    return shotTargets(arenaGrid, myPos, gun.range, gun.marksmanship, enemies);
  }, [interactionMode, gun, arenaGrid, arenaPositions, playerId, activeCombat]);

  const shootRange = useMemo(() => {
    const myPos = arenaPositions[playerId];
    if (interactionMode !== 'shoot' || !gun || !arenaGrid || !myPos) return new Set<string>();
    return shotRangeTiles(arenaGrid, myPos, gun.range);
  }, [interactionMode, gun, arenaGrid, arenaPositions, playerId]);

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

  const teleportTiles = useMemo(() => {
    if (interactionMode !== 'target_ability_tile' || !targetingAbility || !arenaGrid || !myPart) return new Set<string>();
    const effect = teleportEffectOf(targetingAbility);
    const from = arenaPositions[playerId];
    if (!effect || !from) return new Set<string>();
    const tiles = teleportDestinations({
      grid: arenaGrid, from, effect, initiative: myPart.initiative, occupied,
      isWalkable: (t) => TILE_PROPERTIES[t as TileType]?.walkable ?? false,
    });
    return new Set(tiles.map((t) => `${t.x},${t.y}`));
  }, [interactionMode, targetingAbility, arenaGrid, myPart, arenaPositions, playerId, occupied]);

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

  // Build tile highlights: range tiles + path trace + ability targeting
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

    // Single-target ability: highlight valid targets in range + LoS
    if (interactionMode === 'target_ability_single' && targetingAbility && arenaGrid) {
      const myPos = arenaPositions[playerId];
      if (myPos) {
        const range = targetingAbility.range ?? 1;
        for (const p of activeCombat!.participants) {
          if (p.hp <= 0) continue;
          const isEnemy = p.type !== 'player';
          const isAlly = p.type === 'player' && p.id !== playerId;
          const wantEnemy = targetingAbility.targetType === 'enemy';
          const wantAlly = targetingAbility.targetType === 'ally';
          if ((wantEnemy && !isEnemy) || (wantAlly && !isAlly)) continue;

          const pos = arenaPositions[p.id];
          if (!pos) continue;

          if (targetingAbility.range) {
            if (hasLineOfSight(arenaGrid, myPos, pos, range)) {
              highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight');
            }
          } else {
            if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) === 1) {
              highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight');
            }
          }
        }
      }
    }

    // Area ability: highlight AoE radius around hovered tile
    if (interactionMode === 'target_ability_area' && targetingAbility && arenaGrid && hoverTile) {
      const myPos = arenaPositions[playerId];
      if (myPos && targetingAbility.range) {
        if (hasLineOfSight(arenaGrid, myPos, hoverTile, targetingAbility.range)) {
          const radius = targetingAbility.areaRadius ?? 0;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.abs(dx) + Math.abs(dy) > radius) continue;
              const ax = hoverTile.x + dx;
              const ay = hoverTile.y + dy;
              if (ax >= 0 && ax < arenaGrid.width && ay >= 0 && ay < arenaGrid.height) {
                highlights.set(`${ax},${ay}`, 'arena-area-highlight');
              }
            }
          }
        }
      }
    }

    if (interactionMode === 'shoot') {
      for (const key of shootRange) {
        highlights.set(key, 'arena-shoot-range');
      }
      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (shootable.has(id)) highlights.set(`${pos.x},${pos.y}`, 'arena-range-highlight');
      }
    }

    for (const key of teleportTiles) highlights.set(key, 'arena-range-highlight');

    return highlights;
  }, [movementRange, interactionMode, hoverPath, targetingAbility, arenaGrid, arenaPositions, playerId, activeCombat, hoverTile, shootable, shootRange, teleportTiles]);

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
        setInteractionMode('none');
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

    if (interactionMode === 'shoot') {
      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (pos.x === x && pos.y === y && shootable.has(id)) {
          onCombatAction('shoot', id);
          useGameStore.setState({ arenaActionTaken: true });
          setInteractionMode('none');
          return;
        }
      }
    }

    if (interactionMode === 'target_ability_single' && targetingAbility && arenaGrid) {
      const myPos = arenaPositions[playerId];
      if (!myPos) return;

      for (const [id, pos] of Object.entries(arenaPositions)) {
        if (pos.x !== x || pos.y !== y) continue;
        const participant = activeCombat?.participants.find(p => p.id === id);
        if (!participant || participant.hp <= 0) continue;

        const isEnemy = participant.type !== 'player';
        const isAlly = participant.type === 'player' && participant.id !== playerId;
        const wantEnemy = targetingAbility.targetType === 'enemy';
        const wantAlly = targetingAbility.targetType === 'ally';
        if ((wantEnemy && !isEnemy) || (wantAlly && !isAlly)) continue;

        if (targetingAbility.range) {
          if (!hasLineOfSight(arenaGrid, myPos, pos, targetingAbility.range)) continue;
        } else {
          if (Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y) !== 1) continue;
        }

        onUseAbility(targetingAbility.id, id);
        useGameStore.setState({ arenaActionTaken: true });
        setInteractionMode('none');
        setTargetingAbility(null);
        return;
      }
    }

    if (interactionMode === 'target_ability_tile' && targetingAbility) {
      if (!teleportTiles.has(`${x},${y}`)) return;
      onUseAbility(targetingAbility.id, undefined, x, y);
      if (targetingAbility.freeAction) {
        useGameStore.setState((s) => ({ arenaFreeActionsUsed: [...s.arenaFreeActionsUsed, targetingAbility.id] }));
      } else {
        useGameStore.setState({ arenaActionTaken: true });
      }
      setInteractionMode('none');
      setTargetingAbility(null);
      return;
    }

    if (interactionMode === 'target_ability_area' && targetingAbility && arenaGrid) {
      const myPos = arenaPositions[playerId];
      if (!myPos || !targetingAbility.range) return;

      if (hasLineOfSight(arenaGrid, myPos, { x, y }, targetingAbility.range)) {
        onUseAbility(targetingAbility.id, undefined, x, y);
        useGameStore.setState({ arenaActionTaken: true });
        setInteractionMode('none');
        setTargetingAbility(null);
      }
    }
  }, [isMyTurn, interactionMode, ghostPos, arenaPositions, adjacentEnemies, onArenaMove, onCombatAction, targetingAbility, arenaGrid, playerId, activeCombat, onUseAbility, shootable, teleportTiles]);

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
          onTileClick={handleTileClick}
          onTileHover={interactionMode === 'move' || interactionMode === 'target_ability_area' ? handleTileHover : undefined}
          onTileHoverEnd={interactionMode === 'move' || interactionMode === 'target_ability_area' ? handleTileHoverEnd : undefined}
          tileHighlights={tileHighlights}
          ghostEntity={interactionMode === 'move' ? ghostPos : null}
          animatingId={animatingId}
          animPath={animPath}
          hitLabels={interactionMode === 'shoot' ? shootable : undefined}
        />
        <ArenaUnitPanel participants={activeCombat.participants} />
      </div>
      <ArenaActionBar
        isMyTurn={isMyTurn}
        actionTaken={arenaActionTaken}
        freeActionsUsed={arenaFreeActionsUsed}
        movementRemaining={arenaMovementRemaining}
        canFlee={canFlee}
        mapTargeting={interactionMode !== 'none'}
        ammo={myPart?.ammo ?? (gun ? gun.magazine : null)}
        magazine={gun?.magazine ?? 0}
        gunRange={gun?.range ?? null}
        onMoveMode={() => setInteractionMode('move')}
        onCancelMove={() => setInteractionMode('none')}
        onAttackMode={() => setInteractionMode('attack')}
        onCancelAttack={() => setInteractionMode('none')}
        onShootMode={() => setInteractionMode('shoot')}
        onCancelShoot={() => setInteractionMode('none')}
        onReload={() => { onCombatAction('reload'); useGameStore.setState({ arenaActionTaken: true }); }}
        onDefend={() => { onCombatAction('defend'); useGameStore.setState({ arenaActionTaken: true }); }}
        onFlee={() => onCombatAction('flee')}
        onEndTurn={onArenaEndTurn}
        onUseItem={(index, targetId) => {
          onCombatAction('use_item', targetId, index);
          useGameStore.setState({ arenaActionTaken: true });
        }}
        onAbilityMode={(ability) => {
          if (ability.targetType === 'tile') setInteractionMode('target_ability_tile');
          else if (ability.targetType === 'area_enemy' || ability.targetType === 'area_ally') setInteractionMode('target_ability_area');
          else setInteractionMode('target_ability_single');
          setTargetingAbility(ability);
        }}
        onCancelAbility={() => {
          setInteractionMode('none');
          setTargetingAbility(null);
        }}
        onUseAbility={onUseAbility}
      />
      <div className="arena-combat-log">
        {combatLogLines.map((entry) => (
          <div key={entry.id} className="combat-log-line">{entry.message}</div>
        ))}
      </div>
    </div>
  );
}
