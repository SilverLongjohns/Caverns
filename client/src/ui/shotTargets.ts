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
