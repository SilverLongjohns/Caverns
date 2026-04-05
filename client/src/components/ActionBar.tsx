import { useGameStore } from '../store/gameStore.js';
import type { Direction, ItemStats } from '@caverns/shared';

function formatStats(stats: ItemStats): string {
  const parts: string[] = [];
  if (stats.damage) parts.push(`+${stats.damage} dmg`);
  if (stats.defense) parts.push(`+${stats.defense} def`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} hp`);
  if (stats.initiative) parts.push(`+${stats.initiative} init`);
  if (stats.healAmount) parts.push(`heals ${stats.healAmount}`);
  return parts.join(', ');
}

interface ActionBarProps {
  onMove: (direction: Direction) => void;
  onLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  onRevive: (targetPlayerId: string) => void;
}

export function ActionBar({ onMove, onLootChoice, onRevive }: ActionBarProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const pendingLoot = useGameStore((s) => s.pendingLoot);
  const lootChoices = useGameStore((s) => s.lootChoices);
  const setLootChoice = useGameStore((s) => s.setLootChoice);

  const player = players[playerId];
  const currentRoom = rooms[currentRoomId];

  if (!player || !currentRoom) return null;

  // Loot prompt
  if (pendingLoot && pendingLoot.items.length > 0) {
    return (
      <div className="action-bar loot-bar">
        <h3>Loot Dropped!</h3>
        {pendingLoot.items.map((item) => (
          <div key={item.id} className="loot-item">
            <span className={`item-name rarity-${item.rarity}`}>{item.name}</span>
            <span className="item-slot">[{item.slot}]</span>
            <span className="item-stats">{formatStats(item.stats)}</span>
            <div className="loot-buttons">
              {(['need', 'greed', 'pass'] as const).map((choice) => {
                const chosen = lootChoices[item.id];
                const isSelected = chosen === choice;
                return (
                  <button
                    key={choice}
                    className={isSelected ? `loot-btn-selected loot-${choice}` : ''}
                    disabled={!!chosen}
                    onClick={() => { setLootChoice(item.id, choice); onLootChoice(item.id, choice); }}
                  >
                    {choice.charAt(0).toUpperCase() + choice.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Downed
  if (player.status === 'downed') {
    return (
      <div className="action-bar">
        <p className="downed-text">You are downed. Waiting for revival...</p>
      </div>
    );
  }

  // Exploration
  const directions: Direction[] = ['north', 'south', 'east', 'west'];
  const downedInRoom = Object.values(players).filter(
    (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
  );

  return (
    <div className="action-bar explore-bar">
      <div className="move-buttons">
        {directions.map((dir) => (
          <button
            key={dir}
            onClick={() => onMove(dir)}
            disabled={!currentRoom.exits[dir]}
            className={`move-btn move-${dir}`}
          >
            {dir.charAt(0).toUpperCase() + dir.slice(1)}
          </button>
        ))}
      </div>
      {downedInRoom.length > 0 && (
        <div className="revive-actions">
          {downedInRoom.map((ally) => (
            <button key={ally.id} onClick={() => onRevive(ally.id)}>
              Revive {ally.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
