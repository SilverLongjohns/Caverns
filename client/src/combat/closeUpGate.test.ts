import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { initialGate, gateReceive, gateImpact, gateEnd, gateSkip, gateFlush } from './closeUpGate.js';

const cu = { kind: 'ability' as const, durationMs: 2000 };
const res = (id: string) => ({ type: 'combat_action_result', actorId: id, actorName: id, action: 'use_ability' }) as ServerMessage;
const log = (m: string) => ({ type: 'text_log', message: m, logType: 'combat' }) as ServerMessage;
const types = (ms: ServerMessage[]) => ms.map((m) => (m.type === 'text_log' ? `log:${(m as { message: string }).message}` : m.type === 'combat_action_result' ? `res:${(m as { actorId: string }).actorId}` : m.type));

describe('close-up gate', () => {
  it('passes messages straight through when idle', () => {
    const r = gateReceive(initialGate(), log('a'), null, []);
    expect(types(r.deliver)).toEqual(['log:a']);
    expect(r.state.current).toBeNull();
  });

  it('holds the qualifying result and what follows until impact, then flows', () => {
    let s = initialGate();
    let r = gateReceive(s, res('p1'), cu, []); s = r.state;
    expect(r.deliver).toEqual([]);
    expect(s.current?.result).toMatchObject({ actorId: 'p1' });
    r = gateReceive(s, log('p1 hits'), null, []); s = r.state;
    expect(r.deliver).toEqual([]);
    r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:p1', 'log:p1 hits']);
    r = gateReceive(s, log('after'), null, []); s = r.state;
    expect(types(r.deliver)).toEqual(['log:after']);
    r = gateEnd(s);
    expect(r.state.current).toBeNull();
  });

  it('queues a second close-up and keeps everything in order', () => {
    let s = initialGate();
    s = gateReceive(s, res('p1'), cu, []).state;
    s = gateReceive(s, log('one'), null, []).state;
    s = gateReceive(s, res('m1'), cu, []).state;
    s = gateReceive(s, log('two'), null, []).state;
    let r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:p1', 'log:one']);
    r = gateReceive(s, log('three'), null, []); s = r.state;
    expect(r.deliver).toEqual([]); // held behind the queued close-up
    r = gateEnd(s); s = r.state;
    expect(s.current?.result).toMatchObject({ actorId: 'm1' });
    r = gateImpact(s); s = r.state;
    expect(types(r.deliver)).toEqual(['res:m1', 'log:two', 'log:three']);
  });

  it('skip releases the held messages at once', () => {
    let s = gateReceive(initialGate(), res('p1'), cu, []).state;
    s = gateReceive(s, { type: 'combat_end', result: 'victory' } as ServerMessage, null, []).state;
    const r = gateSkip(s);
    expect(types(r.deliver)).toEqual(['res:p1', 'combat_end']);
    expect(r.state.current).toBeNull();
  });

  it('flush delivers everything and resets', () => {
    let s = gateReceive(initialGate(), res('p1'), cu, []).state;
    s = gateReceive(s, res('m1'), cu, []).state;
    s = gateReceive(s, log('x'), null, []).state;
    const r = gateFlush(s);
    expect(types(r.deliver)).toEqual(['res:p1', 'res:m1', 'log:x']);
    expect(r.state).toMatchObject({ current: null, queue: [], held: [], phase: 'idle' });
  });

  it('drops the oldest queued close-up past the cap but keeps its messages in order', () => {
    let s = gateReceive(initialGate(), res('a'), cu, []).state;
    for (const id of ['b', 'c', 'd', 'e']) s = gateReceive(s, res(id), cu, []).state; // 4 queued, cap 3
    expect(s.queue.map((q) => q.result.actorId)).toEqual(['c', 'd', 'e']);
    const r = gateImpact(s);
    expect(types(r.deliver)).toEqual(['res:a', 'res:b']); // b's close-up dropped; its result still arrives, in order
  });
});
