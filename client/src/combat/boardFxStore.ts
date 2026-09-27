import { create } from 'zustand';
import type { ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { fxExpire, fxReceive, initialBoardFx, type BoardFx, type BoardFxState } from './boardFx.js';

export const useBoardFxStore = create<{ fx: BoardFx[] }>(() => ({ fx: [] }));

let state: BoardFxState = initialBoardFx();
let timer = 0;

function publish(prev: BoardFx[]): void {
  if (state.fx === prev) return;
  useBoardFxStore.setState({ fx: state.fx });
  window.clearTimeout(timer);
  if (!state.fx.length) return;
  const next = Math.min(...state.fx.map((f) => f.until));
  timer = window.setTimeout(() => { const p = state.fx; state = fxExpire(state, performance.now()); publish(p); }, Math.max(0, next - performance.now()) + 16);
}

/** Called for every message the close-up gate delivers, after the game store has applied it. Decoration only: never throws. */
export function boardFxReceive(msg: ServerMessage): void {
  try {
    const prev = state.fx;
    if (msg.type === 'combat_end' || msg.type === 'combat_start') state = initialBoardFx();
    const g = useGameStore.getState();
    state = fxReceive(state, msg, { now: performance.now(), positions: g.arenaPositions, participants: g.activeCombat?.participants ?? [] });
    publish(prev);
  } catch { /* juice must never break message delivery */ }
}
