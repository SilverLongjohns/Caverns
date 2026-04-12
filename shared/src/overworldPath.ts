import type { OverworldMap } from './overworld.js';
import { getTile, isWalkable } from './overworld.js';

export function findOverworldPath(
  map: OverworldMap,
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number }[] | null {
  if (start.x === end.x && start.y === end.y) return [];
  const endTile = getTile(map, end.x, end.y);
  if (endTile === null || !isWalkable(endTile)) return null;

  const key = (x: number, y: number) => `${x},${y}`;
  const startKey = key(start.x, start.y);
  const visited = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const queue: { x: number; y: number }[] = [start];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curKey = key(cur.x, cur.y);

    if (cur.x === end.x && cur.y === end.y) {
      const path: { x: number; y: number }[] = [];
      let k = curKey;
      while (k !== startKey) {
        const [xs, ys] = k.split(',').map(Number);
        path.push({ x: xs, y: ys });
        k = cameFrom.get(k)!;
      }
      return path.reverse();
    }

    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      const tile = getTile(map, nx, ny);
      if (tile === null || !isWalkable(tile)) continue;
      visited.add(nk);
      cameFrom.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}
