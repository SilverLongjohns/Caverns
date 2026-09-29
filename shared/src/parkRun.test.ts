import { describe, it, expect } from 'vitest';
import { LOOT_CONFIG } from './index.js';
import type { ClientMessage, ServerMessage, CharacterSummary, Player } from './index.js';

describe('park run protocol', () => {
  it('prices the leave-run toll from config', () => {
    expect(LOOT_CONFIG.leaveRunTollGold).toBe(25);
  });

  it('types the new messages', () => {
    const out: ClientMessage[] = [
      { type: 'park_run' },
      { type: 'leave_run', toll: { kind: 'gold' } },
      { type: 'leave_run', toll: { kind: 'item', source: 'consumables', index: 2 } },
      { type: 'leave_run', toll: { kind: 'free' } },
    ];
    const inc: ServerMessage[] = [
      { type: 'run_parked' },
      { type: 'party_member_left', playerId: 'p1' },
      { type: 'seat_rekeyed', oldId: 'p1', newId: 'parked:c1' },
    ];
    const summary: Pick<CharacterSummary, 'parkedRun'> = { parkedRun: { roomName: 'Torchlit Passage' } };
    const away: Pick<Player, 'away'> = { away: true };
    expect(out).toHaveLength(4);
    expect(inc).toHaveLength(3);
    expect(summary.parkedRun?.roomName).toBe('Torchlit Passage');
    expect(away.away).toBe(true);
  });
});
