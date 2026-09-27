import type { SandboxSetup, ServerMessage } from '@caverns/shared';
import { createSandboxSession, type SandboxSession } from './sandboxSession.js';

export interface SimResult {
  result: 'victory' | 'wipe' | 'flee' | 'timeout' | 'error';
  rounds: number;
  actions: number;
  names: Record<string, string>;
  damageDealt: Record<string, number>;
  damageTaken: Record<string, number>;
  log: ServerMessage[];
  errors: string[];
}

// Member 0 in an all-bot run; every room broadcast reaches it, so its copy is the canonical log.
const OBSERVER = 'sandbox-bot-0';

export function simulateFight(setup: SandboxSetup, opts: { maxRounds?: number } = {}): Promise<SimResult> {
  const maxRounds = opts.maxRounds ?? 100;
  return new Promise((resolvePromise) => {
    const res: SimResult = { result: 'timeout', rounds: 0, actions: 0, names: {}, damageDealt: {}, damageTaken: {}, log: [], errors: [] };
    let sandbox: SandboxSession | undefined;
    let done = false;

    const finish = (result: SimResult['result']) => {
      if (done) return;
      done = true;
      res.result = result;
      sandbox?.dispose();
      resolvePromise(res);
    };

    const onMessage = (recipientId: string | null, msg: ServerMessage) => {
      if (recipientId !== null && recipientId !== OBSERVER) return;
      res.log.push(msg);
      if (msg.type === 'arena_combat_start') {
        for (const p of msg.combat.participants) res.names[p.id] = p.name;
      } else if (msg.type === 'combat_turn') {
        res.rounds = Math.max(res.rounds, msg.roundNumber);
        if (res.rounds > maxRounds) finish('timeout');
      } else if (msg.type === 'combat_action_result') {
        res.actions++;
        const r = msg;
        if (r.actorId && r.targetId && r.damage) {
          res.damageDealt[r.actorId] = (res.damageDealt[r.actorId] ?? 0) + r.damage;
          res.damageTaken[r.targetId] = (res.damageTaken[r.targetId] ?? 0) + r.damage;
        }
      } else if (msg.type === 'combat_end') {
        finish(msg.result);
      }
    };

    try {
      sandbox = createSandboxSession(setup, {
        sessionId: 'sim',
        humanId: null,
        botTurnDelayMs: 0,
        timing: { mobTurnDelayMs: 0, victoryDelayMs: 0, postVictoryLootDelayMs: 0, defendTimeoutMs: 0, closeUpScale: 0 },
        onMessage,
        onError: (err) => {
          res.errors.push(err instanceof Error ? err.stack ?? err.message : String(err));
          finish('error');
        },
      });
    } catch (err) {
      res.errors.push(err instanceof Error ? err.stack ?? err.message : String(err));
      finish('error');
      return;
    }
    if (done) sandbox.dispose();
  });
}
