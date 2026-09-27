import type { CombatParticipant } from '@caverns/shared';
import { IconSocket } from './relic/index.js';
import { getParticipantGlyph } from '../glyphs.js';

interface TurnOrderBarProps {
  participants: CombatParticipant[];
  turnOrder: string[];
  currentTurnId: string;
  roundNumber: number;
}

export function TurnOrderBar({ participants, turnOrder, currentTurnId, roundNumber }: TurnOrderBarProps) {
  const participantMap = new Map(participants.map(p => [p.id, p]));

  return (
    <div className="arena-turn-order">
      <span className="turn-round">Round {roundNumber}</span>
      {turnOrder.map((id) => {
        const p = participantMap.get(id);
        if (!p) return null;
        const isCurrent = id === currentTurnId;
        const glyph = getParticipantGlyph(p);
        return (
          <span key={id} className={`turn-unit ${p.type === 'player' ? 'turn-player' : 'turn-mob'}${isCurrent ? ' turn-active' : ''}`}>
            <IconSocket size={24} hot={isCurrent} title={p.name}>
              {glyph
                ? <img className="relic-socket__img" src={glyph} alt="" />
                : <span className="relic-socket__glyph">{p.name.charAt(0)}</span>}
            </IconSocket>
            <span className="turn-name">{p.name}</span>
          </span>
        );
      })}
    </div>
  );
}
