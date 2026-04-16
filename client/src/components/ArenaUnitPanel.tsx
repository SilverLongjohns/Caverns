import type { CombatParticipant } from '@caverns/shared';

interface ArenaUnitPanelProps {
  participants: CombatParticipant[];
}

function UnitHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const blocks = 10;
  const filled = Math.round((hp / maxHp) * blocks);
  const percent = hp / maxHp;
  const colorClass = percent > 0.5 ? 'hp-green' : percent > 0.25 ? 'hp-yellow' : 'hp-red';
  return (
    <span className="arena-hp-bar">
      <span className={`arena-hp-filled ${colorClass}`}>{'\u2588'.repeat(filled)}</span>
      <span className="arena-hp-empty">{'\u2591'.repeat(blocks - filled)}</span>
      {' '}<span className="arena-hp-text">{hp}/{maxHp}</span>
    </span>
  );
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
