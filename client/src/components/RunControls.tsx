import { useState } from 'react';
import type { LeaveRunToll, Player } from '@caverns/shared';
import { RelicButton } from './relic/index.js';
import { LeaveRunModal } from './LeaveRunModal.js';

interface Props {
  player: Player;
  onPark: () => void;
  onLeave: (toll: LeaveRunToll) => void;
}

/** Park the character or escape the run. Exploring only; the server re-checks every rule. */
export function RunControls({ player, onPark, onLeave }: Props) {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="run-controls">
      <RelicButton size="sm"
        onClick={() => { if (confirm(`Park ${player.name} here? You can resume from character select.`)) onPark(); }}>
        Park
      </RelicButton>
      <RelicButton size="sm" tone="danger" onClick={() => setLeaving(true)}>
        Leave run
      </RelicButton>
      <LeaveRunModal player={player} open={leaving} onClose={() => setLeaving(false)}
        onPay={(toll) => { setLeaving(false); onLeave(toll); }} />
    </div>
  );
}
