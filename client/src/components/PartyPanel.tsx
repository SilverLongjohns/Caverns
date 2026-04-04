import { useGameStore } from '../store/gameStore.js';

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
    <div className="party-panel">
      <h3>Party</h3>
      {otherPlayers.map((player) => {
        const hpPercent = (player.hp / player.maxHp) * 100;
        const hpColor = hpPercent > 50 ? '#4ecdc4' : hpPercent > 25 ? '#ffd93d' : '#ff6b6b';
        const room = rooms[player.roomId];
        return (
          <div key={player.id} className="party-member">
            <div className="party-member-header">
              <span>{STATUS_ICONS[player.status] ?? ''} {player.name}</span>
              <span className="party-room">{room?.name ?? '???'}</span>
            </div>
            <div className="hp-bar-container small">
              <div className="hp-bar" style={{ width: `${hpPercent}%`, backgroundColor: hpColor }} />
              <span className="hp-text">{player.hp}/{player.maxHp}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
