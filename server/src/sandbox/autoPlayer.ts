import type { ArenaSnapshot } from '../GameSession.js';
import { getMovementRange, isAdjacent, findPath, hasLineOfSight } from '../arenaMovement.js';
import { hitChance, chebyshev } from '@caverns/shared';

export type BotAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: string }
  | { type: 'shoot'; targetId: string }
  | { type: 'reload' }
  | { type: 'end_turn' };

type Pos = { x: number; y: number };
const keyOf = (p: Pos) => `${p.x},${p.y}`;
const parseKey = (k: string): Pos => { const [x, y] = k.split(',').map(Number); return { x, y }; };
const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Simple, deterministic turn: melee if adjacent, else shoot the likeliest hit, else reload, else close in. */
export function decideTurn(snap: ArenaSnapshot, selfId: string): BotAction[] {
  const END: BotAction = { type: 'end_turn' };
  const self = snap.participants.find((p) => p.id === selfId);
  const selfPos = snap.positions[selfId];
  if (!self || !selfPos) return [END];

  const enemies = snap.participants
    .filter((p) => p.type !== self.type && snap.positions[p.id])
    .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
  if (enemies.length === 0) return [END];

  const adjacent = enemies.find((e) => isAdjacent(selfPos, snap.positions[e.id]));
  if (adjacent) return [{ type: 'attack', targetId: adjacent.id }, END];

  const gun = self.ranged;
  if (gun && gun.ammo > 0) {
    const shots = enemies
      .map((e) => ({ e, pos: snap.positions[e.id] }))
      .filter(({ pos }) => hasLineOfSight(snap.grid, selfPos, pos, gun.range))
      .map(({ e, pos }) => ({ id: e.id, chance: hitChance(chebyshev(selfPos, pos), gun.marksmanship) }))
      .sort((a, b) => b.chance - a.chance || (a.id < b.id ? -1 : 1));
    if (shots.length > 0) return [{ type: 'shoot', targetId: shots[0].id }, END];
  }
  if (gun && gun.ammo < gun.magazine) return [{ type: 'reload' }, END];

  const occupied = new Set(
    snap.participants
      .filter((p) => p.id !== selfId && snap.positions[p.id])
      .map((p) => keyOf(snap.positions[p.id])),
  );
  const reachable = getMovementRange(snap.grid, selfPos, snap.movementRemaining, occupied);
  reachable.delete(keyOf(selfPos));
  let tiles = [...reachable.entries()]
    .map(([k, mp]) => ({ pos: parseKey(k), mp, key: k }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  // Filter to only tiles reachable via path (not just traverse-through)
  tiles = tiles.filter((t) => findPath(snap.grid, selfPos, t.pos, snap.movementRemaining, occupied) !== null);

  // Enemies are sorted weakest-first, so the first enemy with a reachable neighbour tile wins.
  for (const enemy of enemies) {
    const ePos = snap.positions[enemy.id];
    const spots = tiles.filter((t) => isAdjacent(t.pos, ePos)).sort((a, b) => b.mp - a.mp);
    if (spots.length > 0) {
      return [{ type: 'move', ...spots[0].pos }, { type: 'attack', targetId: enemy.id }, END];
    }
  }

  // No melee-reachable tile this turn. If we're carrying a loaded gun, check whether
  // closing some of the distance would put us in shooting range too — otherwise we'd
  // spend the whole turn just moving and never fire a shot we could already reach.
  if (gun && gun.ammo > 0) {
    for (const enemy of enemies) {
      const ePos = snap.positions[enemy.id];
      const spots = tiles
        .filter((t) => hasLineOfSight(snap.grid, t.pos, ePos, gun.range))
        .sort((a, b) => b.mp - a.mp);
      if (spots.length > 0) {
        return [{ type: 'move', ...spots[0].pos }, { type: 'shoot', targetId: enemy.id }, END];
      }
    }
  }

  const distTo = (p: Pos) => Math.min(...enemies.map((e) => manhattan(p, snap.positions[e.id])));
  const current = distTo(selfPos);
  let best: { pos: Pos; d: number; mp: number } | null = null;
  for (const t of tiles) {
    const d = distTo(t.pos);
    if (!best || d < best.d || (d === best.d && t.mp > best.mp)) best = { pos: t.pos, d, mp: t.mp };
  }
  if (best && best.d < current) return [{ type: 'move', ...best.pos }, END];
  return [END];
}
