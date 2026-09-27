import { CLOSE_UP_CONFIG, type CloseUp, type CombatActionResultMessage, type CombatParticipant, type ServerMessage } from '@caverns/shared';

export interface ActiveCloseUp { id: number; closeUp: CloseUp; result: CombatActionResultMessage; participants: CombatParticipant[] }
export interface GateState { held: ServerMessage[]; current: ActiveCloseUp | null; queue: ActiveCloseUp[]; phase: 'idle' | 'pre' | 'post'; nextId: number }
type Out = { state: GateState; deliver: ServerMessage[] };

export function initialGate(): GateState {
  return { held: [], current: null, queue: [], phase: 'idle', nextId: 1 };
}

/** Index in `held` of a queued close-up's own result (everything from there on waits for it). */
function barrier(s: GateState): number {
  if (!s.queue.length) return s.held.length;
  const i = s.held.indexOf(s.queue[0].result as ServerMessage);
  return i < 0 ? s.held.length : i;
}

export function gateReceive(s: GateState, msg: ServerMessage, closeUp: CloseUp | null, participants: CombatParticipant[]): Out {
  if (closeUp && msg.type === 'combat_action_result') {
    const cu: ActiveCloseUp = { id: s.nextId, closeUp, result: msg as CombatActionResultMessage, participants };
    if (s.phase === 'idle') {
      return { state: { ...s, current: cu, phase: 'pre', held: [msg], nextId: s.nextId + 1 }, deliver: [] };
    }
    let queue = [...s.queue, cu];
    if (queue.length > CLOSE_UP_CONFIG.maxQueued) queue = queue.slice(queue.length - CLOSE_UP_CONFIG.maxQueued);
    return { state: { ...s, queue, held: [...s.held, msg], nextId: s.nextId + 1 }, deliver: [] };
  }
  if (s.phase === 'idle') return { state: s, deliver: [msg] };
  if (s.phase === 'post' && !s.queue.length) return { state: s, deliver: [msg] };
  return { state: { ...s, held: [...s.held, msg] }, deliver: [] };
}

export function gateImpact(s: GateState): Out {
  if (s.phase !== 'pre') return { state: s, deliver: [] };
  const cut = barrier(s);
  return { state: { ...s, phase: 'post', held: s.held.slice(cut) }, deliver: s.held.slice(0, cut) };
}

export function gateEnd(s: GateState): Out {
  if (!s.current) return { state: s, deliver: [] };
  const [next, ...rest] = s.queue;
  if (next) return { state: { ...s, current: next, queue: rest, phase: 'pre' }, deliver: [] };
  // Nothing queued: anything still held (only possible after a flush race) goes out now.
  return { state: { ...s, current: null, phase: 'idle', held: [] }, deliver: s.held };
}

export function gateSkip(s: GateState): Out {
  const a = gateImpact(s);
  const b = gateEnd(a.state);
  return { state: b.state, deliver: [...a.deliver, ...b.deliver] };
}

export function gateFlush(s: GateState): Out {
  return { state: initialGate(), deliver: s.held };
}
