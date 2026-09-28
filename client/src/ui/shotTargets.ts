import { chebyshev, hasLineOfSight, hitChance } from '@caverns/shared';

type Tile = { x: number; y: number };
/** Enemies a shot can reach from `myPos`, with the shared hit chance for each. */
export function shotTargets(grid: { tiles: string[][] }, myPos: Tile, range: number, marksmanship: number, enemies: { id: string; pos: Tile }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of enemies) {
    if (hasLineOfSight(grid, myPos, e.pos, range)) out.set(e.id, hitChance(chebyshev(myPos, e.pos), marksmanship));
  }
  return out;
}

/** Every non-wall/chasm tile within the gun's range and line of sight from `myPos` (excludes `myPos` itself). "x,y" keys. */
export function shotRangeTiles(grid: { tiles: string[][] }, myPos: Tile, range: number): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < grid.tiles.length; y++) {
    const row = grid.tiles[y];
    for (let x = 0; x < row.length; x++) {
      if (x === myPos.x && y === myPos.y) continue;
      const tile = row[x];
      if (tile === 'wall' || tile === 'chasm') continue;
      if (hasLineOfSight(grid, myPos, { x, y }, range)) out.add(`${x},${y}`);
    }
  }
  return out;
}
