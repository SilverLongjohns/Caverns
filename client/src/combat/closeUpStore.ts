import { create } from 'zustand';
import { closeUpForParticipants, CLOSE_UP_CONFIG, type ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { initialGate, gateReceive, gateImpact, gateEnd, gateSkip, gateFlush, type ActiveCloseUp, type GateState } from './closeUpGate.js';

interface CloseUpUi { current: ActiveCloseUp | null; skip: () => void }
export const useCloseUpStore = create<CloseUpUi>(() => ({ current: null, skip: () => skipCloseUp() }));

let gate: GateState = initialGate();
let timers: number[] = [];
const deliver = (msgs: ServerMessage[]) => { for (const m of msgs) useGameStore.getState().handleServerMessage(m); };
const clearTimers = () => { timers.forEach((t) => window.clearTimeout(t)); timers = []; };

function publish(): void {
  useCloseUpStore.setState({ current: gate.current });
}

function schedule(): void {
  clearTimers();
  const cur = gate.current;
  if (!cur) return;
  const d = cur.closeUp.durationMs;
  if (gate.phase === 'pre') timers.push(window.setTimeout(() => apply(gateImpact(gate)), d * CLOSE_UP_CONFIG.impactAt));
  timers.push(window.setTimeout(() => { apply(gateEnd(gate)); schedule(); }, d));
}

function apply(out: { state: GateState; deliver: ServerMessage[] }): void {
  const prevId = gate.current?.id;
  gate = out.state;
  deliver(out.deliver);
  if (gate.current?.id !== prevId) publish();
}

/** Every server message goes through here (see useWebSocket). */
export function routeServerMessage(msg: ServerMessage): void {
  const wasIdle = gate.phase === 'idle';
  const participants = useGameStore.getState().activeCombat?.participants ?? [];
  const cu = msg.type === 'combat_action_result' ? closeUpForParticipants(msg, participants) : null;
  apply(gateReceive(gate, msg, cu, participants.map((p) => ({ ...p }))));
  if (wasIdle && gate.phase === 'pre') schedule();
}

export function skipCloseUp(): void {
  if (!gate.current) return;
  apply(gateSkip(gate));
  schedule();
}

export function flushCloseUps(): void {
  clearTimers();
  apply(gateFlush(gate));
  publish();
}
