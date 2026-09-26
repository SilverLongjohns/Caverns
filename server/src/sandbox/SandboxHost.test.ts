import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { SandboxHost } from './SandboxHost.js';
import { isSandboxEnabled } from './gate.js';

function makeHost(enabled: boolean) {
  const sent: { to: string; msg: ServerMessage }[] = [];
  const register = vi.fn();
  const unregister = vi.fn();
  const host = new SandboxHost({
    sendTo: (to, msg) => sent.push({ to, msg }),
    register, unregister,
    isEnabled: () => enabled,
    botTurnDelayMs: 0,
  });
  return { host, sent, register, unregister };
}

afterEach(() => { vi.useRealTimers(); });

describe('SandboxHost', () => {
  it('refuses sandbox_start when the gate is off', () => {
    const { host, sent, register } = makeHost(false);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel' });
    expect(register).not.toHaveBeenCalled();
    expect(sent).toEqual([{ to: 'c1', msg: expect.objectContaining({ type: 'sandbox_error' }) }]);
  });

  it('reports invalid setups', () => {
    const { host, sent } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { mobs: ['dragon'] } });
    expect(sent[0].msg).toMatchObject({ type: 'sandbox_error', message: expect.stringContaining('dragon') });
  });

  it('starts a fight and registers it', () => {
    const { host, sent, register } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    expect(register).toHaveBeenCalledWith('sandbox-1', expect.anything(), 'c1');
    const types = sent.filter((s) => s.to === 'c1').map((s) => s.msg.type);
    expect(types).toContain('game_start');
    expect(types).toContain('arena_combat_start');
    expect(host.has('c1')).toBe(true);
    host.stop('c1');
  });

  it('restart disposes the old fight so it sends nothing more', () => {
    vi.useFakeTimers();
    const { host, sent, unregister } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 4 } });
    expect(unregister).toHaveBeenCalledWith('sandbox-1', 'c1');
    host.stop('c1');
    const before = sent.length;
    vi.advanceTimersByTime(60_000);
    expect(sent.length).toBe(before);
  });

  it('sends an overlap notice when starting a seeded session while another connection has a live one', () => {
    const { host, sent } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    host.handleStart('c2', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 4 } });

    const c2Msgs = sent.filter((s) => s.to === 'c2');
    const notice = c2Msgs.find((s) => s.msg.type === 'sandbox_error');
    expect(notice?.msg).toMatchObject({ type: 'sandbox_error', message: expect.stringContaining('Another sandbox session') });
    // The session still starts despite the notice.
    expect(host.has('c2')).toBe(true);

    host.stop('c1');
    host.stop('c2');
  });

  it('does not send an overlap notice when no other connection has a live session', () => {
    const { host, sent } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    const notice = sent.find((s) => s.to === 'c1' && s.msg.type === 'sandbox_error');
    expect(notice).toBeUndefined();
    host.stop('c1');
  });

  it('does not send an overlap notice for an unseeded (random) setup even with another live session', () => {
    const { host, sent } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 3 } });
    // 'starter-pack' has no default seed, and no seed override here, so it resolves unseeded.
    host.handleStart('c2', { type: 'sandbox_start', preset: 'starter-pack' });
    const notice = sent.find((s) => s.to === 'c2' && s.msg.type === 'sandbox_error');
    expect(notice).toBeUndefined();
    host.stop('c1');
    host.stop('c2');
  });

  it('stop unregisters and restores Math.random', () => {
    const original = Math.random;
    const { host, unregister } = makeHost(true);
    host.handleStart('c1', { type: 'sandbox_start', preset: 'duel', overrides: { seed: 9 } });
    expect(Math.random).not.toBe(original);
    host.stop('c1');
    expect(unregister).toHaveBeenCalledWith('sandbox-1', 'c1');
    expect(Math.random).toBe(original);
    expect(host.has('c1')).toBe(false);
  });
});

describe('isSandboxEnabled', () => {
  it('reads CAVERNS_SANDBOX', () => {
    const prev = process.env.CAVERNS_SANDBOX;
    process.env.CAVERNS_SANDBOX = '1';
    expect(isSandboxEnabled()).toBe(true);
    delete process.env.CAVERNS_SANDBOX;
    expect(isSandboxEnabled()).toBe(process.argv.includes('--sandbox'));
    if (prev !== undefined) process.env.CAVERNS_SANDBOX = prev;
  });
});
