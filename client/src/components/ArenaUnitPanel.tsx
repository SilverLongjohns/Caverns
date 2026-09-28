import type { CombatParticipant } from '@caverns/shared';
import { Gauge } from './relic/index.js';

interface ArenaUnitPanelProps {
  participants: CombatParticipant[];
}

function UnitHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  return <Gauge kind="hp" size="sm" value={hp} max={maxHp} text={`${hp}/${maxHp}`} />;
}

export function ArenaUnitPanel({ participants }: ArenaUnitPanelProps) {
  const players = participants.filter(p => p.type === 'player');
  const mobs = participants.filter(p => p.type === 'mob');

  return (
    <div className="arena-unit-panel">
      <div className="arena-unit-section">
        <div className="arena-unit-header">Party</div>
        {players.map(p => (
          <div key={p.id} className="arena-unit-entry">
            <span className="arena-unit-name turn-player">{p.name}</span>
            {p.className && <span className="arena-unit-class">{p.className}</span>}
            {p.magazine !== undefined && <span className="arena-unit-ammo">{p.ammo}/{p.magazine} rds</span>}
            <UnitHpBar hp={p.hp} maxHp={p.maxHp} />
          </div>
        ))}
      </div>
      <div className="arena-unit-section">
        <div className="arena-unit-header">Enemies</div>
        {mobs.map(p => (
          <div key={p.id} className="arena-unit-entry">
            <span className="arena-unit-name turn-mob">{p.name}</span>
            <span className="arena-skull-rating">{'\u2620'.repeat(Math.ceil(p.maxHp / 30))}</span>
            <UnitHpBar hp={p.hp} maxHp={p.maxHp} />
          </div>
        ))}
      </div>
    </div>
  );
}
