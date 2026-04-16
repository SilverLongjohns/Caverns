import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { ItemStats } from '@caverns/shared';

type ArenaActionMode =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'move' }
  | { mode: 'target_attack' }
  | { mode: 'items' }
  | { mode: 'target_item'; itemIndex: number };

interface ArenaActionBarProps {
  isMyTurn: boolean;
  actionTaken: boolean;
  movementRemaining: number;
  canFlee: boolean;
  onMoveMode: () => void;
  onCancelMove: () => void;
  onAttackMode: () => void;
  onCancelAttack: () => void;
  onDefend: () => void;
  onFlee: () => void;
  onEndTurn: () => void;
  onUseItem: (index: number, targetId?: string) => void;
}

function formatItemStat(stats: ItemStats): string {
  if (stats.healAmount) return `heals ${stats.healAmount}`;
  if (stats.damage) return `${stats.damage} dmg`;
  return '';
}

export function ArenaActionBar({
  isMyTurn, actionTaken, movementRemaining, canFlee,
  onMoveMode, onCancelMove, onAttackMode, onCancelAttack,
  onDefend, onFlee, onEndTurn, onUseItem,
}: ArenaActionBarProps) {
  const player = useGameStore((s) => s.players[s.playerId]);
  const [mode, setMode] = useState<ArenaActionMode>({ mode: 'idle' });

  const effectiveMode: ArenaActionMode =
    !isMyTurn ? { mode: 'idle' } :
    mode.mode === 'idle' ? { mode: 'main' } :
    mode;

  const handleMoveClick = () => {
    setMode({ mode: 'move' });
    onMoveMode();
  };

  const handleAttackClick = () => {
    setMode({ mode: 'target_attack' });
    onAttackMode();
  };

  const handleBackToMain = () => {
    setMode({ mode: 'main' });
    onCancelMove();
    onCancelAttack();
  };

  const handleDefend = () => {
    onDefend();
    setMode({ mode: 'idle' });
  };

  const handleFlee = () => {
    onFlee();
    setMode({ mode: 'idle' });
  };

  const handleEndTurn = () => {
    onEndTurn();
    setMode({ mode: 'idle' });
  };

  const handleItemClick = (index: number) => {
    const item = player?.consumables[index];
    if (!item) return;
    if (item.stats.healAmount) {
      onUseItem(index);
      setMode({ mode: 'idle' });
    } else {
      setMode({ mode: 'target_item', itemIndex: index });
    }
  };

  // Reset mode when turn changes
  if (!isMyTurn && mode.mode !== 'idle') {
    setMode({ mode: 'idle' });
  }

  return (
    <div className="arena-action-bar">
      {effectiveMode.mode === 'idle' && (
        <span className="waiting-text">Waiting for turn...</span>
      )}

      {effectiveMode.mode === 'main' && (
        <>
          <button className="arena-btn arena-btn-move" onClick={handleMoveClick}
            disabled={movementRemaining <= 0}>
            Move
          </button>
          <button className="arena-btn arena-btn-attack" onClick={handleAttackClick}
            disabled={actionTaken}>
            Attack
          </button>
          <button className="arena-btn arena-btn-defend" onClick={handleDefend}
            disabled={actionTaken}>
            Defend
          </button>
          <button className="arena-btn" onClick={() => setMode({ mode: 'items' })}
            disabled={actionTaken}>
            Items
          </button>
          <button className="arena-btn" onClick={handleFlee}
            disabled={!canFlee || actionTaken}>
            Flee
          </button>
          <button className="arena-btn arena-btn-end" onClick={handleEndTurn}>
            End Turn
          </button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'move' && (
        <>
          <span className="waiting-text">Click a highlighted tile to move...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
          <span className="arena-mp-counter">Move: {movementRemaining}</span>
        </>
      )}

      {effectiveMode.mode === 'target_attack' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to attack...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'items' && (
        <>
          <div className="combat-item-list">
            {player?.consumables.map((item, i) =>
              item ? (
                <button key={i} className="combat-item-btn" onClick={() => handleItemClick(i)}>
                  {item.name}
                  <span className="combat-item-stat">{formatItemStat(item.stats)}</span>
                </button>
              ) : null
            )}
          </div>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'target_item' && (
        <>
          <span className="waiting-text">Click an adjacent enemy to use item...</span>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}
    </div>
  );
}
