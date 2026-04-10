import type { Tile, Entity, GridPosition, PathfindingOpts } from './types.js';
import { chebyshevDistance, DIRECTION_OFFSETS } from './types.js';

function posKey(p: GridPosition): string {
  return `${p.x},${p.y}`;
}

export function findPath(
  tiles: Tile[][],
  entities: Entity[],
  from: GridPosition,
  to: GridPosition,
  opts?: PathfindingOpts,
): GridPosition[] | null {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const blockedByEntities = opts?.blockedByEntities ?? false;

  const entityPositions = new Set<string>();
  if (blockedByEntities) {
    for (const e of entities) {
      entityPositions.add(posKey(e.position));
    }
  }

  function isWalkable(p: GridPosition): boolean {
    if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
    const tile = tiles[p.y][p.x];
    if (tile.type === 'wall') return false;
    if (blockedByEntities && entityPositions.has(posKey(p))) {
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) return true;
      return false;
    }
    return true;
  }

  const startKey = posKey(from);
  const endKey = posKey(to);

  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  const fScore = new Map<string, number>();
  fScore.set(startKey, chebyshevDistance(from, to));

  const cameFrom = new Map<string, GridPosition>();

  const open: GridPosition[] = [from];
  const closedSet = new Set<string>();

  while (open.length > 0) {
    let bestIdx = 0;
    let bestF = fScore.get(posKey(open[0])) ?? Infinity;
    for (let i = 1; i < open.length; i++) {
      const f = fScore.get(posKey(open[i])) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }

    const current = open[bestIdx];
    const currentKey = posKey(current);

    if (currentKey === endKey) {
      const path: GridPosition[] = [current];
      let key = currentKey;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key)!;
        path.push(prev);
        key = posKey(prev);
      }
      path.reverse();
      return path;
    }

    open.splice(bestIdx, 1);
    closedSet.add(currentKey);

    for (const offset of Object.values(DIRECTION_OFFSETS)) {
      const neighbor: GridPosition = { x: current.x + offset.dx, y: current.y + offset.dy };
      const neighborKey = posKey(neighbor);

      if (closedSet.has(neighborKey)) continue;
      if (!isWalkable(neighbor)) continue;

      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;

      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + chebyshevDistance(neighbor, to));

        if (!open.some(p => posKey(p) === neighborKey)) {
          open.push(neighbor);
        }
      }
    }
  }

  return null;
}
