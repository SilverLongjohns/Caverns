import { describe, it, expect, vi } from 'vitest';
import { resolveSetup } from '@caverns/shared';
import { simulateFight } from './simulate.js';
import { GameSession } from '../GameSession.js';
import { decideTurn } from './autoPlayer.js';
import { SANDBOX_ROOM_ID } from './sandboxContent.js';

// Regression for the F1 bug: a bot's queued end_turn step (from decideTurn's trailing
// END in [attack, END] / [shoot, END] / [reload, END] / [move, attack, END]) fires
// botTurnDelayMs later regardless of whose turn it now is. GameSession.handleCombatAction
// / handleRangedAction already advance the turn after a successful attack/shoot/reload,
// so if the turn comes back around to the same bot before the stale END fires, it cuts
// off a turn the bot should have used to act.
//
// We spy on handleArenaEndTurn (the only entry point an end_turn step calls) and, for
// each invocation, ask decideTurn what the bot *would* do right now. If it would
// attack, shoot or reload, applying end_turn instead is a violation.

function setupFor(id: string, seed: number) {
  const r = resolveSetup(id, { seed });
  if (!r.ok) throw new Error(r.error);
  return r.setup;
}

const CASES: Array<[string, number]> = [
  ['duel', 1], ['duel', 2], ['duel', 3],
  ['crystal-pack', 1], ['crystal-pack', 2], ['crystal-pack', 3],
  ['boss-prismatic-colossus', 1], ['boss-prismatic-colossus', 2], ['boss-prismatic-colossus', 3],
];

describe('bot end_turn does not cut off a pending attack', () => {
  it.each(CASES)('%s seed %i has zero premature end_turns', async (id, seed) => {
    const violations: string[] = [];
    const original = GameSession.prototype.handleArenaEndTurn;
    const spy = vi.spyOn(GameSession.prototype, 'handleArenaEndTurn')
      .mockImplementation(function (this: GameSession, playerId: string) {
        if (playerId.startsWith('sandbox-bot-')) {
          const snap = this.getArenaSnapshot(SANDBOX_ROOM_ID);
          if (snap && snap.currentTurnId === playerId) {
            const actions = decideTurn(snap, playerId);
            const wouldAct = actions[0]?.type === 'attack' || actions[0]?.type === 'shoot' || actions[0]?.type === 'reload';
            if (wouldAct) {
              violations.push(`${id}/seed${seed}: end_turn applied for ${playerId} in round ${snap.roundNumber} while decideTurn would ${actions[0].type}`);
            }
          }
        }
        return original.call(this, playerId);
      });
    try {
      const res = await simulateFight(setupFor(id, seed), { maxRounds: 100 });
      expect(res.errors).toEqual([]);
      expect(violations).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});
