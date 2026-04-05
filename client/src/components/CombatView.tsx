import { useState, useMemo, useCallback, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Direction, ItemStats, CritMultiplier, DamageReduction } from '@caverns/shared';
import { AttackQTE } from './AttackQTE.js';
import { DefenseQTE } from './DefenseQTE.js';

type ActionState =
  | { mode: 'idle' }
  | { mode: 'main' }
  | { mode: 'target'; afterSelect: 'attack' | 'use_item'; itemIndex?: number }
  | { mode: 'items' }
  | { mode: 'flee' };

interface CombatViewProps {
  onCombatAction: (
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string,
    itemIndex?: number,
    fleeDirection?: Direction,
    critMultiplier?: number
  ) => void;
  onRevive: (targetPlayerId: string) => void;
  onDefendResult: (damageReduction: number) => void;
}

function formatItemStat(stats: ItemStats): string {
  if (stats.healAmount) return `heals ${stats.healAmount}`;
  if (stats.damage) return `${stats.damage} dmg`;
  return '';
}

function CharHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const totalBlocks = 10;
  const filledBlocks = Math.round((hp / maxHp) * totalBlocks);
  const percent = (hp / maxHp) * 100;
  const colorClass = percent > 50 ? '' : percent > 25 ? 'hp-yellow' : 'hp-red';

  return (
    <span className="char-hp-bar">
      <span className={`hp-filled ${colorClass}`}>{'█'.repeat(filledBlocks)}</span>
      <span className="hp-empty">{'░'.repeat(totalBlocks - filledBlocks)}</span>
      {' '}{hp}/{maxHp}
    </span>
  );
}

export function CombatView({ onCombatAction, onRevive, onDefendResult }: CombatViewProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const currentTurnId = useGameStore((s) => s.currentTurnId);
  const textLog = useGameStore((s) => s.textLog);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const pendingDefendQte = useGameStore((s) => s.pendingDefendQte);
  const combatAnim = useGameStore((s) => s.combatAnim);
  const dyingMobIds = useGameStore((s) => s.dyingMobIds);

  const [actionState, setActionState] = useState<ActionState>({ mode: 'idle' });
  const [activeQte, setActiveQte] = useState<
    | { type: 'attack'; targetId: string }
    | { type: 'defense' }
    | null
  >(null);

  // Track text log length at mount time to filter stale messages
  const [combatLogStart] = useState(() => textLog.length);

  const player = players[playerId];
  const currentRoom = rooms[currentRoomId];

  // Determine if it's our turn — sync action state
  const isMyTurn = currentTurnId === playerId;
  const effectiveState: ActionState =
    !isMyTurn ? { mode: 'idle' } :
    actionState.mode === 'idle' ? { mode: 'main' } :
    actionState;

  // Party and enemy lists from combat participants
  const partyMembers = useMemo(() => {
    if (!activeCombat) return [];
    return activeCombat.participants
      .filter((p) => p.type === 'player')
      .map((p) => ({ ...p, status: players[p.id]?.status ?? 'exploring' }));
  }, [activeCombat, players]);

  const enemies = useMemo(() => {
    if (!activeCombat) return [];
    return activeCombat.participants.filter((p) => p.type === 'mob');
  }, [activeCombat]);

  // Combat log: last 3 combat messages since combat started
  const combatLogLines = useMemo(() => {
    return textLog
      .slice(combatLogStart)
      .filter((entry) => entry.logType === 'combat')
      .slice(-3);
  }, [textLog, combatLogStart]);

  // Downed allies for revive
  const downedAllies = useMemo(() => {
    return Object.values(players).filter(
      (p) => p.id !== playerId && p.status === 'downed' && p.roomId === currentRoomId
    );
  }, [players, playerId, currentRoomId]);

  const playerInitiative = useMemo(() => {
    const participant = activeCombat?.participants.find((p) => p.id === playerId);
    return participant?.initiative ?? 5;
  }, [activeCombat, playerId]);

  const prevDefendQte = useRef(pendingDefendQte);
  if (pendingDefendQte && pendingDefendQte !== prevDefendQte.current) {
    if (!activeQte) {
      setActiveQte({ type: 'defense' });
    }
  }
  prevDefendQte.current = pendingDefendQte;

  if (!activeCombat || !player || !currentRoom) return null;

  const handleTargetClick = (targetId: string) => {
    if (effectiveState.mode !== 'target') return;
    if (effectiveState.afterSelect === 'attack') {
      setActiveQte({ type: 'attack', targetId });
      setActionState({ mode: 'idle' });
    } else {
      onCombatAction('use_item', targetId, effectiveState.itemIndex);
      setActionState({ mode: 'idle' });
    }
  };

  const handleDefend = () => {
    onCombatAction('defend');
    setActionState({ mode: 'idle' });
  };

  const handleItemClick = (index: number) => {
    const item = player.consumables[index];
    if (!item) return;
    if (item.stats.damage) {
      // Damage item → need target
      setActionState({ mode: 'target', afterSelect: 'use_item', itemIndex: index });
    } else {
      // Healing item → immediate
      onCombatAction('use_item', undefined, index);
      setActionState({ mode: 'idle' });
    }
  };

  const handleFlee = (direction: Direction) => {
    onCombatAction('flee', undefined, undefined, direction);
    setActionState({ mode: 'idle' });
  };

  const handleAttackQteComplete = useCallback((multiplier: CritMultiplier) => {
    if (activeQte?.type === 'attack') {
      onCombatAction('attack', activeQte.targetId, undefined, undefined, multiplier);
    }
    setActiveQte(null);
  }, [activeQte, onCombatAction]);

  const handleDefenseQteComplete = useCallback((reduction: DamageReduction) => {
    onDefendResult(reduction);
    setActiveQte(null);
    useGameStore.setState({ pendingDefendQte: null });
  }, [onDefendResult]);

  const isTargeting = effectiveState.mode === 'target';

  return (
    <div className="combat-view">
      {/* Battlefield: party left, enemies right */}
      <div className="combat-battlefield">
        <div className="combat-party-zone">
          <div className="combat-zone-label">Party</div>
          {partyMembers.map((member) => {
            const isDowned = member.status === 'downed';
            const isActive = currentTurnId === member.id;
            const isAttacking = combatAnim?.attackerId === member.id;
            const isHit = combatAnim?.targetId === member.id;
            return (
              <div key={member.id} className={`combat-member${isAttacking ? ' anim-lunge' : ''}${isHit ? ' anim-shake' : ''}`}>
                <div className={`combat-member-name${isDowned ? ' downed' : ''}`}>
                  {isActive && <span className="turn-indicator">►</span>}
                  {member.name}
                </div>
                <CharHpBar hp={isDowned ? 0 : member.hp} maxHp={member.maxHp} />
              </div>
            );
          })}
        </div>

        <div className="combat-enemy-zone">
          <div className="combat-zone-label">Enemies</div>
          {enemies.map((enemy) => {
            const isAttacking = combatAnim?.attackerId === enemy.id;
            const isHit = combatAnim?.targetId === enemy.id;
            const isDying = dyingMobIds.has(enemy.id);
            return (
            <div
              key={enemy.id}
              className={`enemy-plate${isTargeting ? ' targetable' : ''}${isAttacking ? ' anim-lunge' : ''}${isHit && !isDying ? ' anim-shake' : ''}${isDying ? ' anim-disintegrate' : ''}`}
              onClick={() => isTargeting && !isDying && handleTargetClick(enemy.id)}
            >
              <div className="enemy-name">
                {enemy.name}
                <span className="skull-rating">
                  {'☠'.repeat(Math.ceil(enemy.maxHp / 30))}
                </span>
              </div>
              <CharHpBar hp={enemy.hp} maxHp={enemy.maxHp} />
            </div>
            );
          })}
        </div>

        {/* QTE Overlays */}
        {activeQte?.type === 'attack' && (
          <AttackQTE initiative={playerInitiative} onComplete={handleAttackQteComplete} />
        )}
        {activeQte?.type === 'defense' && (
          <DefenseQTE initiative={playerInitiative} onComplete={handleDefenseQteComplete} />
        )}
      </div>

      {/* Combat log strip — last 3 combat messages */}
      <div className="combat-log-strip">
        {combatLogLines.map((entry) => (
          <div key={entry.id} className="combat-log-line">{entry.message}</div>
        ))}
      </div>

      {/* Action bar — state machine driven */}
      <div className="combat-action-bar">
        {effectiveState.mode === 'idle' && (
          <span className="waiting-text">Waiting for turn...</span>
        )}

        {effectiveState.mode === 'main' && (
          <>
            <button onClick={() => setActionState({ mode: 'target', afterSelect: 'attack' })}>
              Attack
            </button>
            <button onClick={handleDefend}>Defend</button>
            <button onClick={() => setActionState({ mode: 'items' })}>Items</button>
            <button onClick={() => setActionState({ mode: 'flee' })}>Flee</button>
            {downedAllies.map((ally) => (
              <button key={ally.id} className="revive-btn" onClick={() => onRevive(ally.id)}>
                Revive {ally.name}
              </button>
            ))}
          </>
        )}

        {effectiveState.mode === 'target' && (
          <>
            <span className="waiting-text">Select a target...</span>
            <button className="back-btn" onClick={() => setActionState({ mode: 'main' })}>
              Back
            </button>
          </>
        )}

        {effectiveState.mode === 'items' && (
          <>
            <div className="combat-item-list">
              {player.consumables.map((item, i) =>
                item ? (
                  <button key={i} className="combat-item-btn" onClick={() => handleItemClick(i)}>
                    {item.name}
                    <span className="combat-item-stat">{formatItemStat(item.stats)}</span>
                  </button>
                ) : null
              )}
            </div>
            <button className="back-btn" onClick={() => setActionState({ mode: 'main' })}>
              Back
            </button>
          </>
        )}

        {effectiveState.mode === 'flee' && (
          <>
            <div className="combat-flee-directions">
              {(Object.keys(currentRoom.exits) as Direction[]).map((dir) => (
                <button key={dir} onClick={() => handleFlee(dir)}>
                  {dir.charAt(0).toUpperCase() + dir.slice(1)}
                </button>
              ))}
            </div>
            <button className="back-btn" onClick={() => setActionState({ mode: 'main' })}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
