import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getClassDefinition } from '@caverns/shared';
import type { AbilityDefinition, ItemStats } from '@caverns/shared';

type ArenaActionMode =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'move' }
  | { mode: 'target_attack' }
  | { mode: 'items' }
  | { mode: 'target_item'; itemIndex: number }
  | { mode: 'abilities' }
  | { mode: 'target_ability'; ability: AbilityDefinition };

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
  onAbilityMode: (ability: AbilityDefinition) => void;
  onCancelAbility: () => void;
  onUseAbility: (abilityId: string, targetId?: string, targetX?: number, targetY?: number) => void;
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
  onAbilityMode, onCancelAbility, onUseAbility,
}: ArenaActionBarProps) {
  const player = useGameStore((s) => s.players[s.playerId]);
  const [mode, setMode] = useState<ArenaActionMode>({ mode: 'idle' });

  const effectiveMode: ArenaActionMode =
    !isMyTurn ? { mode: 'idle' } :
    mode.mode === 'idle' ? { mode: 'main' } :
    mode;

  const classDef = player ? getClassDefinition(player.className) : null;
  const activeAbilities = classDef?.abilities.filter(a => !a.passive) ?? [];

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
    onCancelAbility();
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

  const handleAbilityClick = (ability: AbilityDefinition) => {
    if (ability.targetType === 'none') {
      onUseAbility(ability.id);
      setMode({ mode: 'idle' });
      return;
    }
    setMode({ mode: 'target_ability', ability });
    onAbilityMode(ability);
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
          <button className="arena-btn" onClick={() => setMode({ mode: 'abilities' })}
            disabled={actionTaken || activeAbilities.length === 0}>
            Abilities
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

      {effectiveMode.mode === 'abilities' && (
        <>
          <div className="combat-item-list">
            {activeAbilities.map((ability) => {
              const notEnoughEnergy = !player || player.energy < ability.energyCost;
              return (
                <button
                  key={ability.id}
                  className={`ability-btn ${notEnoughEnergy ? 'no-energy' : ''}`}
                  disabled={notEnoughEnergy}
                  onClick={() => handleAbilityClick(ability)}
                >
                  {ability.name} <span className="energy-cost">{ability.energyCost}</span>
                  <span className="ability-tooltip">{ability.description}</span>
                </button>
              );
            })}
          </div>
          <button className="arena-btn" onClick={handleBackToMain}>Back</button>
        </>
      )}

      {effectiveMode.mode === 'target_ability' && (
        <>
          <span className="waiting-text">
            {effectiveMode.ability.targetType === 'area_enemy' || effectiveMode.ability.targetType === 'area_ally'
              ? `Click a tile to target ${effectiveMode.ability.name}...`
              : `Click a target for ${effectiveMode.ability.name}...`
            }
          </span>
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
