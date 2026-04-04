import { useState } from 'react';
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
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
    fleeDirection?: Direction
  ) => void;
  onLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  onRevive: (targetPlayerId: string) => void;
}

export function ActionBar({ onMove, onCombatAction, onLootChoice, onRevive }: ActionBarProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const pendingLoot = useGameStore((s) => s.pendingLoot);
  const lootChoices = useGameStore((s) => s.lootChoices);
  const setLootChoice = useGameStore((s) => s.setLootChoice);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);

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

  // Combat
  if (player.status === 'in_combat' && activeCombat) {
    const isMyTurn = currentTurnId === playerId;
    const enemies = activeCombat.participants.filter((p) => p.type === 'mob');
    const downedAllies = Object.values(players).filter(
      (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
    );

    return (
      <div className="action-bar combat-bar">
        {!isMyTurn ? (
          <p className="waiting-text">Waiting for turn...</p>
        ) : (
          <>
            <div className="combat-targets">
              <label>Target:</label>
              <select
                value={selectedTarget ?? ''}
                onChange={(e) => setSelectedTarget(e.target.value || null)}
              >
                <option value="">Select target...</option>
                {enemies.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.hp}/{e.maxHp} HP)
                  </option>
                ))}
              </select>
            </div>
            <div className="combat-actions">
              <button
                onClick={() => selectedTarget && onCombatAction('attack', selectedTarget)}
                disabled={!selectedTarget}
              >
                Attack
              </button>
              <button onClick={() => onCombatAction('defend')}>Defend</button>
              <div className="item-select">
                <select
                  value={selectedItem ?? ''}
                  onChange={(e) => setSelectedItem(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Use item...</option>
                  {player.consumables.map((item, i) =>
                    item ? (
                      <option key={i} value={i}>
                        {item.name}
                      </option>
                    ) : null
                  )}
                </select>
                <button
                  onClick={() => {
                    if (selectedItem !== null) {
                      const item = player.consumables[selectedItem];
                      if (item?.stats.damage && selectedTarget) {
                        onCombatAction('use_item', selectedTarget, selectedItem);
                      } else if (item?.stats.healAmount) {
                        onCombatAction('use_item', undefined, selectedItem);
                      }
                    }
                  }}
                  disabled={selectedItem === null}
                >
                  Use
                </button>
              </div>
              <div className="flee-select">
                {Object.keys(currentRoom.exits).map((dir) => (
                  <button
                    key={dir}
                    onClick={() => onCombatAction('flee', undefined, undefined, dir as Direction)}
                    className="flee-btn"
                  >
                    Flee {dir}
                  </button>
                ))}
              </div>
              {downedAllies.length > 0 && (
                <div className="revive-actions">
                  {downedAllies.map((ally) => (
                    <button key={ally.id} onClick={() => onRevive(ally.id)}>
                      Revive {ally.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
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
