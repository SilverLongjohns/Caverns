import { useGameStore } from '../store/gameStore.js';
import { RelicPanel, Gauge, IconSocket } from './relic/index.js';
import { getParticipantGlyph } from '../glyphs.js';

const STATUS_ICONS: Record<string, string> = {
  exploring: '\uD83E\uDDED',
  in_combat: '\u2694\uFE0F',
  downed: '\uD83D\uDC80',
};

export function PartyPanel() {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);

  const otherPlayers = Object.values(players).filter((p) => p.id !== playerId);
  if (otherPlayers.length === 0) return null;

  return (
    <RelicPanel className="party-screen" title="Party">
      <div className="party-panel">
        {otherPlayers.map((player) => {
          const room = rooms[player.roomId];
          const glyph = getParticipantGlyph({ type: 'player', className: player.className });
          return (
            <div key={player.id} className={`party-member${player.away ? ' party-member--away' : ''}`}>
              <IconSocket size={24} title={player.className}>
                {glyph
                  ? <img className="relic-socket__img" src={glyph} alt="" />
                  : <span className="relic-socket__glyph">{player.name.charAt(0)}</span>}
              </IconSocket>
              <div className="party-member-body">
                <div className="party-member-header">
                  <span>{STATUS_ICONS[player.status] ?? ''} {player.name}</span>
                  {player.away && <span className="party-away">away</span>}
                  <span className="party-room">{room?.name ?? '???'}</span>
                </div>
                <Gauge kind="hp" size="sm" value={player.hp} max={player.maxHp} text={`${player.hp}/${player.maxHp}`} />
              </div>
            </div>
          );
        })}
      </div>
    </RelicPanel>
  );
}
