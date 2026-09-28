import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveSetup, type ServerMessage } from '@caverns/shared';
import { GameSession } from '../GameSession.js';
import { createSandboxSession, type SandboxSession } from './sandboxSession.js';
import { installSeededRandom } from './seededRandom.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('createSandboxSession bot turn handling', () => {
  it("advances the turn even when the server refuses a bot's ranged action", async () => {
    // Simulate every shoot/reload being refused server-side (a real refusal sends an
    // `error` and does NOT advance the turn — see GameSession.handleRangedAction).
    // If sandboxSession still marks the step "consumed" regardless of outcome, the
    // bot's queued end_turn step is skipped and its turn never ends (no fresh
    // combat_turn ever arrives to retry).
    const spy = vi.spyOn(GameSession.prototype, 'handleRangedAction').mockImplementation(() => {});
    const restoreRandom = installSeededRandom(4242);
    let sandbox: SandboxSession | undefined;
    try {
      const r = resolveSetup('duel', {});
      if (!r.ok) throw new Error(r.error);

      const turns: string[] = [];
      await new Promise<void>((resolveTest, reject) => {
        const failTimer = setTimeout(
          () => reject(new Error(
            `bot turn stalled; turns seen: ${JSON.stringify(turns)}, shoot/reload attempts: ${spy.mock.calls.length}`,
          )),
          5000,
        );
        sandbox = createSandboxSession(r.setup, {
          sessionId: 'refusal-test',
          humanId: null,
          botTurnDelayMs: 0,
          timing: { mobTurnDelayMs: 0, victoryDelayMs: 0, postVictoryLootDelayMs: 0, defendTimeoutMs: 0, closeUpScale: 0 },
          onMessage: (_recipientId, msg: ServerMessage) => {
            if (msg.type === 'combat_turn') {
              turns.push(`${msg.currentTurnId}#${msg.roundNumber}`);
              // Only declare success once we've actually exercised the refused-shoot
              // path AND seen the bot's turn come back around (round advanced) — proof
              // the queued end_turn wasn't skipped.
              if (spy.mock.calls.length > 0 && new Set(turns).size >= 2) { clearTimeout(failTimer); resolveTest(); }
            }
          },
          onError: (err) => { clearTimeout(failTimer); reject(err instanceof Error ? err : new Error(String(err))); },
        });

        // The bot's very first decideTurn call is scheduled via a real (0ms) timer, so
        // there's a tick here before it runs. Use it to drag the mob into the bot's gun
        // range (but not adjacent), so decideTurn picks 'shoot' on the bot's first turn
        // instead of closing the distance.
        const snap = sandbox.session.getArenaSnapshot(sandbox.roomId)!;
        const botId = sandbox.memberIds[0];
        const mob = snap.participants.find((p) => p.type === 'mob')!;
        const gunRange = snap.participants.find((p) => p.id === botId)!.ranged!.range;
        const botPos = snap.positions[botId];
        const positions = (sandbox.session as unknown as {
          combats: Map<string, { positions: Map<string, { x: number; y: number }> }>;
        }).combats.get(sandbox.roomId)!.positions;
        positions.set(mob.id, { x: botPos.x + Math.max(2, gunRange - 1), y: botPos.y });
      });

      // The refusal path must actually have been exercised, or this test proves nothing.
      expect(spy).toHaveBeenCalled();
      expect(new Set(turns).size).toBeGreaterThanOrEqual(2);
    } finally {
      sandbox?.dispose();
      restoreRandom();
    }
  }, 10_000);
});
