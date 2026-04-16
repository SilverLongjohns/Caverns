import type { CombatParticipant } from '@caverns/shared';

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
      <span className="turn-label">Turn:</span>
      {turnOrder.map((id, i) => {
        const p = participantMap.get(id);
        if (!p) return null;
        const isCurrent = id === currentTurnId;
        const colorClass = p.type === 'player' ? 'turn-player' : 'turn-mob';
        return (
          <span key={id}>
            <span className={`turn-name ${colorClass} ${isCurrent ? 'turn-active' : ''}`}>
              {isCurrent && '\u25BA '}{p.name}
            </span>
            {i < turnOrder.length - 1 && <span className="turn-separator">{'\u2192'}</span>}
          </span>
        );
      })}
    </div>
  );
}
