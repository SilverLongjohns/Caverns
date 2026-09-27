import type { ServerMessage } from '@caverns/shared';

/** On-board juice for damaging hits: attacker lunge, target RGB tear, slam-in number. Pure; see boardFxStore. */
export const FX_TIMING = { lungeMs: 300, hitDelayMs: 100, tearMs: 360, numberMs: 950, walkStepMs: 100, walkTailMs: 50 } as const;

export type FxDir = 'up' | 'down' | 'left' | 'right';
export type FxTone = 'mob' | 'player' | 'chip';
type Tile = { x: number; y: number };
export type BoardFx =
  | { id: number; kind: 'lunge'; unitId: string; dir: FxDir; delayMs: number; until: number }
  | { id: number; kind: 'tear'; unitId: string; delayMs: number; until: number }
  | { id: number; kind: 'number'; tile: Tile; value: number; tone: FxTone; offset: number; delayMs: number; until: number };
export interface BoardFxState { fx: BoardFx[]; walkUntil: Record<string, number>; lastTile: Record<string, Tile>; nextId: number }
export interface FxCtx { now: number; positions: Record<string, Tile>; participants: { id: string; type: 'player' | 'mob' }[] }

export const initialBoardFx = (): BoardFxState => ({ fx: [], walkUntil: {}, lastTile: {}, nextId: 1 });

export function lungeDir(from: Tile, to: Tile): FxDir | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function fxReceive(s: BoardFxState, msg: ServerMessage, ctx: FxCtx): BoardFxState {
  const lastTile = { ...s.lastTile, ...ctx.positions };
  if (msg.type === 'arena_positions_update') {
    const m = msg as { moverId?: string; path?: Tile[] };
    if (!m.moverId || !m.path?.length) return { ...s, lastTile };
    const until = ctx.now + m.path.length * FX_TIMING.walkStepMs + FX_TIMING.walkTailMs;
    return { ...s, lastTile, walkUntil: { ...s.walkUntil, [m.moverId]: until } };
  }
  if (msg.type !== 'combat_action_result') return { ...s, lastTile };
  const r = msg as { actorId: string; targetId?: string; targetIds?: string[]; damage?: number; defendQte?: boolean };
  const targets = r.targetIds ?? (r.targetId ? [r.targetId] : []);
  if (r.defendQte || !r.damage || r.damage <= 0 || targets.length === 0) return { ...s, lastTile };

  const wait = Math.max(0, (s.walkUntil[r.actorId] ?? 0) - ctx.now);
  const hitAt = wait + FX_TIMING.hitDelayMs;
  const fx = [...s.fx];
  let id = s.nextId;

  const from = ctx.positions[r.actorId];
  const firstTile = ctx.positions[targets[0]] ?? s.lastTile[targets[0]];
  const dir = from && firstTile ? lungeDir(from, firstTile) : null;
  if (dir) fx.push({ id: id++, kind: 'lunge', unitId: r.actorId, dir, delayMs: wait, until: ctx.now + wait + FX_TIMING.lungeMs });
  for (const t of targets) {
    if (ctx.positions[t]) fx.push({ id: id++, kind: 'tear', unitId: t, delayMs: hitAt, until: ctx.now + hitAt + FX_TIMING.tearMs });
  }
  if (firstTile) {
    const actorType = ctx.participants.find((p) => p.id === r.actorId)?.type;
    const targetType = ctx.participants.find((p) => p.id === targets[0])?.type ?? (actorType === 'player' ? 'mob' : 'player');
    const tone: FxTone = r.damage === 1 ? 'chip' : targetType === 'player' ? 'player' : 'mob';
    const offset = s.fx.filter((f) => f.kind === 'number' && f.until > ctx.now && f.tile.x === firstTile.x && f.tile.y === firstTile.y).length;
    fx.push({ id: id++, kind: 'number', tile: firstTile, value: r.damage, tone, offset, delayMs: hitAt, until: ctx.now + hitAt + FX_TIMING.numberMs });
  }
  return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
}

export function fxExpire(s: BoardFxState, now: number): BoardFxState {
  const fx = s.fx.filter((f) => f.until > now);
  return fx.length === s.fx.length ? s : { ...s, fx };
}
