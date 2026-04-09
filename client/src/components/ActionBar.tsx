import { useGameStore } from '../store/gameStore.js';
import type { ItemStats } from '@caverns/shared';

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
  onLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  onRevive: (targetPlayerId: string) => void;
  onPuzzleAnswer: (roomId: string, answerIndex: number) => void;
  onInteractAction: (interactableId: string, actionId: string) => void;
}

export function ActionBar({ onLootChoice, onRevive, onPuzzleAnswer, onInteractAction }: ActionBarProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const pendingLoot = useGameStore((s) => s.pendingLoot);
  const lootChoices = useGameStore((s) => s.lootChoices);
  const setLootChoice = useGameStore((s) => s.setLootChoice);
  const activePuzzle = useGameStore((s) => s.activePuzzle);
  const selectedInteractableId = useGameStore((s) => s.selectedInteractableId);
  const selectInteractable = useGameStore((s) => s.selectInteractable);
  const pendingInteractActions = useGameStore((s) => s.pendingInteractActions);

  const player = players[playerId];
  const currentRoom = rooms[currentRoomId];

  if (!player || !currentRoom) return null;

  // Puzzle prompt
  if (activePuzzle) {
    return (
      <div className="action-bar puzzle-bar">
        <div className="puzzle-description">{activePuzzle.description}</div>
        <div className="puzzle-options">
          {activePuzzle.options.map((option, i) => (
            <button
              key={i}
              className="puzzle-btn"
              onClick={() => onPuzzleAnswer(activePuzzle.roomId, i)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

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

  // Interact actions — server sent available actions for a clicked interactable
  if (pendingInteractActions) {
    return (
      <div className="action-bar interact-bar">
        <div className="interact-header">{pendingInteractActions.interactableName}</div>
        <div className="interact-actions">
          {pendingInteractActions.actions.map((action) => {
            const lockedClass = action.lockReason?.replace('Requires ', '') ?? '';
            return (
              <button
                key={action.id}
                className={`interact-btn${action.locked ? ' interact-locked' : ''}${action.used ? ' interact-used' : ''}`}
                disabled={action.locked || action.used}
                onClick={() => onInteractAction(pendingInteractActions.interactableId, action.id)}
                title={action.locked ? action.lockReason : action.used ? `Used by ${action.usedBy}` : undefined}
              >
                {action.label}
                {action.locked && (
                  <span className={`lock-reason class-color-${lockedClass}`}> {lockedClass}</span>
                )}
                {action.used && <span className="used-label"> (used)</span>}
              </button>
            );
          })}
          <button
            className="interact-btn interact-cancel"
            onClick={() => {
              selectInteractable(null);
              useGameStore.setState({ pendingInteractActions: null });
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Exploration — revive downed allies
  const downedInRoom = Object.values(players).filter(
    (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
  );

  if (downedInRoom.length === 0) return null;

  return (
    <div className="action-bar explore-bar">
      <div className="revive-actions">
        {downedInRoom.map((ally) => (
          <button key={ally.id} onClick={() => onRevive(ally.id)}>
            Revive {ally.name}
          </button>
        ))}
      </div>
    </div>
  );
}
