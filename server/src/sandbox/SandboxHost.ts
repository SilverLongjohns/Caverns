import { resolveSetup, type SandboxStartMessage, type ServerMessage } from '@caverns/shared';
import type { GameSession } from '../GameSession.js';
import { createSandboxSession, type SandboxSession } from './sandboxSession.js';
import { isSandboxEnabled } from './gate.js';

export interface SandboxHostDeps {
  sendTo(connId: string, msg: ServerMessage): void;
  register(sessionId: string, session: GameSession, connId: string): void;
  unregister(sessionId: string, connId: string): void;
  isEnabled?: () => boolean;
  botTurnDelayMs?: number;
}

export class SandboxHost {
  private sessions = new Map<string, { sandbox: SandboxSession; sessionId: string }>();
  private nextId = 1;

  constructor(private deps: SandboxHostDeps) {}

  has(connId: string): boolean {
    return this.sessions.has(connId);
  }

  handleStart(connId: string, msg: SandboxStartMessage): void {
    const enabled = (this.deps.isEnabled ?? isSandboxEnabled)();
    if (!enabled) {
      console.warn(`[sandbox] refused sandbox_start from ${connId}: sandbox mode is off`);
      this.error(connId, 'Sandbox mode is off. Start the server with npm run dev:sandbox.');
      return;
    }
    const resolved = resolveSetup(msg.preset, msg.overrides ?? {});
    if (!resolved.ok) {
      this.error(connId, resolved.error);
      return;
    }
    this.stop(connId);
    // Another connection's sandbox session is still live: with a seeded setup, an
    // overlapping seededRandom install means Math.random no longer follows a single
    // seed's sequence for the duration of the overlap, so replay isn't guaranteed.
    const overlapping = resolved.setup.seed !== null && this.sessions.size > 0;
    const sessionId = `sandbox-${this.nextId++}`;
    try {
      const sandbox = createSandboxSession(resolved.setup, {
        sessionId,
        humanId: connId,
        sendToHuman: (m) => this.deps.sendTo(connId, m),
        botTurnDelayMs: this.deps.botTurnDelayMs ?? 600,
        onError: (err) => console.error(`[sandbox] ${sessionId} bot error`, err),
      });
      this.sessions.set(connId, { sandbox, sessionId });
      this.deps.register(sessionId, sandbox.session, connId);
      console.log(`[sandbox] ${sessionId} started for ${connId}: ${resolved.setup.presetId} seed=${resolved.setup.seed ?? 'random'}`);
      if (overlapping) {
        this.error(connId, 'Another sandbox session is running on this server; seeded replay is not guaranteed while sessions overlap.');
      }
    } catch (err) {
      console.error('[sandbox] failed to start', err);
      this.error(connId, `Sandbox failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop(connId: string): void {
    const entry = this.sessions.get(connId);
    if (!entry) return;
    entry.sandbox.dispose();
    this.deps.unregister(entry.sessionId, connId);
    this.sessions.delete(connId);
  }

  private error(connId: string, message: string): void {
    this.deps.sendTo(connId, { type: 'sandbox_error', message });
  }
}
