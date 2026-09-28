import type { ServerMessage } from '@caverns/shared';

/** On-board juice for damaging hits: attacker lunge, target RGB tear, slam-in number. Pure; see boardFxStore. */
export const FX_TIMING = {
  lungeMs: 300, hitDelayMs: 100, tearMs: 360, numberMs: 950, walkStepMs: 100, walkTailMs: 50,
  projectileMsPerTile: 70, projectileMaxMs: 350, recoilMs: 180, tagMs: 900,
} as const;

export type FxDir = 'up' | 'down' | 'left' | 'right';
export type FxTone = 'mob' | 'player' | 'chip';
type Tile = { x: number; y: number };
export type BoardFx =
  | { id: number; kind: 'lunge'; unitId: string; dir: FxDir; delayMs: number; until: number }
  | { id: number; kind: 'tear'; unitId: string; delayMs: number; until: number }
  | { id: number; kind: 'number'; tile: Tile; value: number; tone: FxTone; offset: number; delayMs: number; until: number }
  | { id: number; kind: 'projectile'; from: Tile; to: Tile; hit: boolean; delayMs: number; travelMs: number; until: number }
  | { id: number; kind: 'recoil'; unitId: string; dir: FxDir; delayMs: number; until: number }
  | { id: number; kind: 'tag'; tile: Tile; text: 'MISS' | 'RELOAD'; delayMs: number; until: number };
export interface BoardFxState { fx: BoardFx[]; walkUntil: Record<string, number>; lastTile: Record<string, Tile>; nextId: number }
export interface FxCtx { now: number; positions: Record<string, Tile>; participants: { id: string; type: 'player' | 'mob' }[] }

const OPPOSITE: Record<FxDir, FxDir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

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
  const res = msg as { action?: string; actorId: string; targetId?: string; hit?: boolean; damage?: number };
  const wait0 = Math.max(0, (s.walkUntil[res.actorId] ?? 0) - ctx.now);
  if (res.action === 'reload') {
    const at = ctx.positions[res.actorId] ?? s.lastTile[res.actorId];
    if (!at) return { ...s, lastTile };
    return { ...s, lastTile, fx: [...s.fx, { id: s.nextId, kind: 'tag', tile: at, text: 'RELOAD', delayMs: wait0, until: ctx.now + wait0 + FX_TIMING.tagMs }], nextId: s.nextId + 1 };
  }
  if (res.action === 'shoot') {
    const from = ctx.positions[res.actorId];
    const to = res.targetId ? (ctx.positions[res.targetId] ?? s.lastTile[res.targetId]) : undefined;
    if (!from || !to) return { ...s, lastTile };
    const travelMs = Math.min(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * FX_TIMING.projectileMsPerTile, FX_TIMING.projectileMaxMs);
    const landAt = wait0 + travelMs;
    const fx = [...s.fx];
    let id = s.nextId;
    const dir = lungeDir(from, to);
    if (dir) fx.push({ id: id++, kind: 'recoil', unitId: res.actorId, dir: OPPOSITE[dir], delayMs: 0, until: ctx.now + wait0 + FX_TIMING.recoilMs });
    fx.push({ id: id++, kind: 'projectile', from, to, hit: !!res.hit, delayMs: wait0, travelMs, until: ctx.now + landAt + FX_TIMING.hitDelayMs + 120 });
    if (!res.hit) {
      fx.push({ id: id++, kind: 'tag', tile: to, text: 'MISS', delayMs: landAt, until: ctx.now + landAt + FX_TIMING.tagMs });
      return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
    }
    if (res.targetId && ctx.positions[res.targetId]) fx.push({ id: id++, kind: 'tear', unitId: res.targetId, delayMs: landAt, until: ctx.now + landAt + FX_TIMING.tearMs });
    const value = res.damage ?? 0;
    if (value > 0) {
      const offset = s.fx.filter((f) => f.kind === 'number' && f.until > ctx.now && f.tile.x === to.x && f.tile.y === to.y).length;
      fx.push({ id: id++, kind: 'number', tile: to, value, tone: value === 1 ? 'chip' : 'mob', offset, delayMs: landAt, until: ctx.now + landAt + FX_TIMING.numberMs });
    }
    return { fx, walkUntil: s.walkUntil, lastTile, nextId: id };
  }
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
  // A walking mover's cell only mounts when its walk animation ends, so the CSS animation already starts then:
  // no extra delay, but keep the class alive until the walk has finished plus the lunge.
  if (dir) fx.push({ id: id++, kind: 'lunge', unitId: r.actorId, dir, delayMs: 0, until: ctx.now + wait + FX_TIMING.lungeMs });
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
