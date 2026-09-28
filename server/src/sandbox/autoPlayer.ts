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

/**
 * Simple, deterministic turn, modelling a sensible player:
 * 1. melee an adjacent enemy; 2. else walk into melee if reachable this turn (a swing out-damages the
 * class gun: shots get no Ferocity, crits or weapon effects); 3. else close in as the gunless bot would and,
 * from that tile, shoot the likeliest hit — or reload if nothing is in sight and the magazine isn't full.
 */
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

  // No melee this turn: close in (so next turn can be melee), then use the gun from where we stop.
  const distTo = (p: Pos) => Math.min(...enemies.map((e) => manhattan(p, snap.positions[e.id])));
  const current = distTo(selfPos);
  let best: { pos: Pos; d: number; mp: number } | null = null;
  for (const t of tiles) {
    const d = distTo(t.pos);
    if (!best || d < best.d || (d === best.d && t.mp > best.mp)) best = { pos: t.pos, d, mp: t.mp };
  }
  const advance = best && best.d < current ? best.pos : null;
  const moves: BotAction[] = advance ? [{ type: 'move', ...advance }] : [];
  const from = advance ?? selfPos;

  const gun = self.ranged;
  if (gun && gun.ammo > 0) {
    const shot = enemies
      .map((e) => ({ e, pos: snap.positions[e.id] }))
      .filter(({ pos }) => hasLineOfSight(snap.grid, from, pos, gun.range))
      .map(({ e, pos }) => ({ id: e.id, chance: hitChance(chebyshev(from, pos), gun.marksmanship) }))
      .sort((a, b) => b.chance - a.chance || (a.id < b.id ? -1 : 1))[0];
    if (shot) return [...moves, { type: 'shoot', targetId: shot.id }, END];
  }
  if (gun && gun.ammo < gun.magazine) return [...moves, { type: 'reload' }, END];
  return [...moves, END];
}
