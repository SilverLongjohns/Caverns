import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Item, ItemStats } from '@caverns/shared';
import { CLASS_DEFINITIONS } from '@caverns/shared';

function formatStats(stats: ItemStats): string {
  const parts: string[] = [];
  if (stats.damage) parts.push(`+${stats.damage} dmg`);
  if (stats.defense) parts.push(`+${stats.defense} def`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} hp`);
  if (stats.initiative) parts.push(`+${stats.initiative} init`);
  if (stats.healAmount) parts.push(`heals ${stats.healAmount}`);
  return parts.join(', ');
}

function ItemDisplay({ item, label }: { item: Item | null; label: string }) {
  return (
    <div className="equip-slot">
      <span className="slot-label">{label}</span>
      {item ? (
        <span className={`rarity-${item.rarity}`} title={item.description}>
          {item.name} <span className="item-stats">{formatStats(item.stats)}</span>
          {item.effect && (
            <span className="item-effect"> [{item.effect.replace(/_/g, ' ')}]</span>
          )}
        </span>
      ) : (
        <span className="empty">Empty</span>
      )}
    </div>
  );
}

interface PlayerHUDProps {
  onEquipItem: (inventoryIndex: number) => void;
  onDropItem: (inventoryIndex: number) => void;
  onUseConsumable: (consumableIndex: number) => void;
}

export function PlayerHUD({ onEquipItem, onDropItem, onUseConsumable }: PlayerHUDProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const player = players[playerId];

  const playerAbilities = useMemo(() => {
    const classDef = CLASS_DEFINITIONS.find(c => c.id === player?.className);
    if (!classDef) return [];
    return classDef.abilities.filter(a => !a.passive);
  }, [player?.className]);

  if (!player) return null;

  const hpPercent = (player.hp / player.maxHp) * 100;
  const hpColor = hpPercent > 50 ? '#8b2020' : hpPercent > 25 ? '#8b5a20' : '#cc3333';
  const inCombat = player.status === 'in_combat';

  return (
    <div className="player-hud">
      <h3>{player.name}</h3>
      <div className="hud-class">{player.className}</div>

      {playerAbilities.length > 0 && (
        <div className="hud-cooldowns">
          {playerAbilities.map((ability) => {
            const cd = player.cooldowns?.find(c => c.abilityId === ability.id);
            const ready = !cd || cd.turnsRemaining === 0;
            return (
              <div key={ability.id} className={`hud-ability ${ready ? 'ability-ready' : 'ability-cooldown'}`}>
                <span className="ability-label">{ability.name}</span>
                {!ready && <span className="ability-cd">{cd!.turnsRemaining}</span>}
                {ready && <span className="ability-cd ready">{'\u2713'}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="hp-bar-container">
        <div className="hp-bar" style={{ width: `${hpPercent}%`, backgroundColor: hpColor }} />
        <span className="hp-text">{player.hp} / {player.maxHp}</span>
      </div>
      <div className="equipment-grid">
        <ItemDisplay item={player.equipment.weapon} label="Weapon" />
        <ItemDisplay item={player.equipment.offhand} label="Off-hand" />
        <ItemDisplay item={player.equipment.armor} label="Armor" />
        <ItemDisplay item={player.equipment.accessory} label="Accessory" />
      </div>
      <div className="consumables">
        <span className="slot-label">Consumables</span>
        <div className="consumable-grid">
          {player.consumables.map((item, i) => (
            <div key={i} className="consumable-slot">
              {item ? (
                <div className="consumable-item">
                  <span className={`rarity-${item.rarity}`} title={item.description}>
                    {item.name} <span className="item-stats">{formatStats(item.stats)}</span>
                  </span>
                  {!inCombat && (
                    <button className="equip-btn" onClick={() => onUseConsumable(i)}>Use</button>
                  )}
                </div>
              ) : (
                <span className="empty">-</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="inventory">
        <span className="slot-label">Inventory</span>
        <div className="inventory-grid">
          {player.inventory.map((item, i) => (
            <div key={i} className="inventory-slot">
              {item ? (
                <div className="inventory-item">
                  <span className={`rarity-${item.rarity}`} title={item.description}>
                    {item.name}
                  </span>
                  <span className="item-stats">{formatStats(item.stats)}</span>
                  {!inCombat && (
                    <>
                      <button className="equip-btn" onClick={() => onEquipItem(i)}>
                        {item.slot === 'consumable' ? 'Stow' : 'Equip'}
                      </button>
                      <button className="drop-btn" onClick={() => onDropItem(i)}>Drop</button>
                    </>
                  )}
                </div>
              ) : (
                <span className="empty">-</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {player.keychain.length > 0 && (
        <div className="keychain-section">
          <div className="section-label">Keychain</div>
          <div className="keychain-items">
            {player.keychain.map((keyId) => (
              <span key={keyId} className="key-item" title={keyId}>
                🗝 {keyId.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
