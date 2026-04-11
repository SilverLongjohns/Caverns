import { useGameStore } from '../store/gameStore.js';
import type { Item, ItemStats } from '@caverns/shared';
import { PROGRESSION_CONFIG, computePlayerStats } from '@caverns/shared';

const STAT_DISPLAY_NAMES: Record<string, string> = {};
for (const def of PROGRESSION_CONFIG.statDefinitions) {
  STAT_DISPLAY_NAMES[def.internalStat] = def.displayName;
}

function formatStats(stats: ItemStats): string {
  const parts: string[] = [];
  if (stats.damage) parts.push(`+${stats.damage} ${STAT_DISPLAY_NAMES['damage'] ?? 'dmg'}`);
  if (stats.defense) parts.push(`+${stats.defense} ${STAT_DISPLAY_NAMES['defense'] ?? 'def'}`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} ${STAT_DISPLAY_NAMES['maxHp'] ?? 'hp'}`);
  if (stats.initiative) parts.push(`+${stats.initiative} ${STAT_DISPLAY_NAMES['initiative'] ?? 'init'}`);
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
  onAllocateStat: (statId: string) => void;
}

export function PlayerHUD({ onEquipItem, onDropItem, onUseConsumable, onAllocateStat }: PlayerHUDProps) {
  const playerId = useGameStore((s) => s.playerId);
  const players = useGameStore((s) => s.players);
  const player = players[playerId];

  if (!player) return null;

  const hpPercent = (player.hp / player.maxHp) * 100;
  const hpColor = hpPercent > 50 ? '#8b2020' : hpPercent > 25 ? '#8b5a20' : '#cc3333';
  const inCombat = player.status === 'in_combat';

  const stats = computePlayerStats(player);
  const thresholds = PROGRESSION_CONFIG.levelThresholds;
  const maxLevel = thresholds.length;
  const isMaxLevel = player.level >= maxLevel;
  const currentThreshold = thresholds[player.level - 1] ?? 0;
  const nextThreshold = isMaxLevel ? currentThreshold : thresholds[player.level];
  const xpIntoLevel = player.xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  const xpPercent = isMaxLevel ? 100 : (xpNeeded > 0 ? (xpIntoLevel / xpNeeded) * 100 : 0);

  return (
    <div className="player-hud">
      <h3>{player.name}</h3>
      <div className="hud-class">{player.className}</div>
      <div className="hud-level">Lv {player.level}</div>

      <div className="hp-bar-container">
        <div className="hp-bar" style={{ width: `${hpPercent}%`, backgroundColor: hpColor }} />
        <span className="hp-text">{player.hp} / {player.maxHp}</span>
      </div>
      <div className="xp-bar-container">
        <div className="xp-bar" style={{ width: `${xpPercent}%` }} />
        <span className="xp-text">
          {isMaxLevel ? 'MAX' : `${player.xp} / ${nextThreshold} XP`}
        </span>
      </div>
      {player.unspentStatPoints > 0 && (
        <div className="stat-allocation">
          <div className="stat-alloc-header">
            +{player.unspentStatPoints} stat {player.unspentStatPoints === 1 ? 'point' : 'points'}
          </div>
          {PROGRESSION_CONFIG.statDefinitions.map((def) => (
            <div key={def.id} className="stat-alloc-row">
              <span className="stat-alloc-name">{def.displayName}</span>
              <span className="stat-alloc-value">{player.statAllocations[def.id] ?? 0}</span>
              <button className="stat-alloc-btn" onClick={() => onAllocateStat(def.id)}>+</button>
            </div>
          ))}
        </div>
      )}
      <div className="energy-bar-container">
        <div className="energy-bar" style={{ width: `${((player.energy ?? 0) / stats.maxEnergy) * 100}%` }} />
        <span className="energy-text">{player.energy ?? 0}/{stats.maxEnergy} {STAT_DISPLAY_NAMES['maxEnergy'] ?? 'Energy'}</span>
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
