import type { SandboxSetup, ServerMessage } from '@caverns/shared';
import { GameSession, type SessionTiming } from '../GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandboxContent.js';
import { decideTurn, type BotAction } from './autoPlayer.js';
import { installSeededRandom } from './seededRandom.js';

export interface SandboxSessionOptions {
  sessionId: string;
  /** Connection id of the human playing member 0, or null for all-bot (simulator) runs. */
  humanId: string | null;
  sendToHuman?: (msg: ServerMessage) => void;
  botTurnDelayMs: number;
  timing?: Partial<SessionTiming>;
  /** Tap for every outgoing message; recipientId is null for broadcasts. */
  onMessage?: (recipientId: string | null, msg: ServerMessage) => void;
  onError?: (err: unknown) => void;
}

export interface SandboxSession {
  session: GameSession;
  roomId: string;
  memberIds: string[];
  dispose(): void;
}

export function createSandboxSession(setup: SandboxSetup, opts: SandboxSessionOptions): SandboxSession {
  const restoreRandom = setup.seed !== null ? installSeededRandom(setup.seed) : null;
  const memberIds = setup.party.map((_, i) => (i === 0 && opts.humanId ? opts.humanId : `sandbox-bot-${i}`));
  const botIds = new Set(memberIds.filter((id) => id !== opts.humanId));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
  };

  const deliver = (recipientId: string | null, msg: ServerMessage) => {
    if (disposed) return;
    if (opts.humanId && (recipientId === null || recipientId === opts.humanId)) opts.sendToHuman?.(msg);
    opts.onMessage?.(recipientId, msg);
    // Each player in the room gets its own copy of combat_turn; a bot acts on its own copy only.
    if (msg.type === 'combat_turn' && recipientId && botIds.has(recipientId) && msg.currentTurnId === recipientId) {
      later(() => runBotTurn(recipientId), opts.botTurnDelayMs);
    }
  };

  let session: GameSession;
  try {
    session = new GameSession(
      (msg) => deliver(null, msg),
      (to, msg) => deliver(to, msg),
      buildSandboxContent(setup),
      undefined,
      null,
      null,
      opts.sessionId,
    );
    if (opts.timing) session.setTiming(opts.timing);
    setup.party.forEach((member, i) => session.addPrebuiltPlayer(buildSandboxPlayer(memberIds[i], member, SANDBOX_ROOM_ID)));
    session.startGame();
    session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
  } catch (err) {
    restoreRandom?.();
    throw err;
  }

  function apply(botId: string, action: BotAction): void {
    if (action.type === 'move') session.handleArenaMove(botId, action.x, action.y);
    else if (action.type === 'attack') session.handleCombatAction(botId, 'attack', action.targetId);
    else session.handleArenaEndTurn(botId);
  }

  function runBotTurn(botId: string): void {
    const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID);
    if (!snap || snap.currentTurnId !== botId) return;
    const actions = decideTurn(snap, botId);
    const step = (i: number) => {
      try {
        apply(botId, actions[i]);
      } catch (err) {
        opts.onError?.(err);
        return;
      }
      if (i + 1 < actions.length) later(() => step(i + 1), opts.botTurnDelayMs);
    };
    step(0);
  }

  return {
    session,
    roomId: SANDBOX_ROOM_ID,
    memberIds,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      session.dispose();
      restoreRandom?.();
    },
  };
}
