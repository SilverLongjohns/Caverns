import { useGameStore } from '../store/gameStore.js';
import type { Item, ItemSlot } from '@caverns/shared';
import { RelicPanel, RelicButton, Gauge, ItemIcon, EmptySocket } from './relic/index.js';
import { getClassPortrait } from '../classPortraits.js';
import { PROGRESSION_CONFIG, computePlayerStats } from '@caverns/shared';
import { formatItemStats } from '../ui/itemStatText.js';

const STAT_DISPLAY_NAMES: Record<string, string> = {};
for (const def of PROGRESSION_CONFIG.statDefinitions) {
  STAT_DISPLAY_NAMES[def.internalStat] = def.displayName;
}

function ItemDisplay({ item, label, slot }: { item: Item | null; label: string; slot: ItemSlot }) {
  return (
    <div className="equip-slot">
      {item ? <ItemIcon item={item} /> : <EmptySocket slot={slot} />}
      <div className="slot-body">
        <span className="slot-label">{label}</span>
        {item ? (
          <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
        ) : (
          <span className="empty">Empty</span>
        )}
        {item && (
          <span className="item-stats">
            {formatItemStats(item.stats)}
            {item.effect && <span className="item-effect"> [{item.effect.replace(/_/g, ' ')}]</span>}
          </span>
        )}
      </div>
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

  const inCombat = player.status === 'in_combat';

  const stats = computePlayerStats(player);
  const thresholds = PROGRESSION_CONFIG.levelThresholds;
  const maxLevel = thresholds.length;
  const isMaxLevel = player.level >= maxLevel;
  const currentThreshold = thresholds[player.level - 1] ?? 0;
  const nextThreshold = isMaxLevel ? currentThreshold : thresholds[player.level];
  const xpIntoLevel = player.xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;

  const portrait = getClassPortrait(player.className);
  return (
    <RelicPanel className="hud-screen">
      <div className="player-hud">
        <div className="hud-identity">
          {portrait && <img className="hud-portrait" src={portrait} alt="" />}
          <div className="hud-identity-text">
            <h3>{player.name}</h3>
            <div className="hud-class">{player.className}</div>
            <div className="hud-level">Lv {player.level}</div>
            <div className="hud-gold">Gold {player.gold ?? 0}</div>
          </div>
        </div>

        <Gauge kind="hp" value={player.hp} max={player.maxHp} />
        <Gauge
          kind="xp"
          size="sm"
          value={isMaxLevel ? 1 : xpIntoLevel}
          max={isMaxLevel ? 1 : xpNeeded}
          text={isMaxLevel ? 'MAX' : `${player.xp} / ${nextThreshold} XP`}
        />
        <Gauge
          kind="resource"
          size="sm"
          value={player.energy ?? 0}
          max={stats.maxEnergy}
          text={`${player.energy ?? 0}/${stats.maxEnergy} ${STAT_DISPLAY_NAMES['maxEnergy'] ?? 'Energy'}`}
        />

        {player.unspentStatPoints > 0 && (
          <div className="stat-allocation">
            <div className="stat-alloc-header">
              +{player.unspentStatPoints} stat {player.unspentStatPoints === 1 ? 'point' : 'points'}
            </div>
            {PROGRESSION_CONFIG.statDefinitions.map((def) => (
              <div key={def.id} className="stat-alloc-row">
                <span className="stat-alloc-name">{def.displayName}</span>
                <span className="stat-alloc-value">{player.statAllocations[def.id] ?? 0}</span>
                <RelicButton size="sm" onClick={() => onAllocateStat(def.id)}>+</RelicButton>
              </div>
            ))}
          </div>
        )}

        <div className="equipment-grid">
          <ItemDisplay item={player.equipment.weapon} label="Weapon" slot="weapon" />
          <ItemDisplay item={player.equipment.offhand} label="Off-hand" slot="offhand" />
          <ItemDisplay item={player.equipment.armor} label="Armor" slot="armor" />
          <ItemDisplay item={player.equipment.accessory} label="Accessory" slot="accessory" />
          <ItemDisplay item={player.equipment.ranged ?? null} label="Ranged" slot="ranged" />
        </div>

        <div className="consumables">
          <span className="slot-label">Consumables</span>
          <div className="consumable-grid">
            {player.consumables.map((item, i) => (
              <div key={i} className="consumable-slot">
                {item ? <ItemIcon item={item} /> : <EmptySocket slot="consumable" />}
                {item ? (
                  <div className="slot-body">
                    <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
                    <span className="item-stats">{formatItemStats(item.stats)}</span>
                  </div>
                ) : (
                  <span className="empty">-</span>
                )}
                {item && !inCombat && (
                  <RelicButton size="sm" onClick={() => onUseConsumable(i)}>Use</RelicButton>
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
                {item ? <ItemIcon item={item} /> : <EmptySocket slot="weapon" />}
                {item ? (
                  <div className="slot-body">
                    <span className={`slot-name rarity-${item.rarity}`} title={item.description}>{item.name}</span>
                    <span className="item-stats">{formatItemStats(item.stats)}</span>
                  </div>
                ) : (
                  <span className="empty">-</span>
                )}
                {item && !inCombat && (
                  <div className="slot-actions">
                    <RelicButton size="sm" onClick={() => onEquipItem(i)}>
                      {item.slot === 'consumable' ? 'Stow' : 'Equip'}
                    </RelicButton>
                    <RelicButton size="sm" tone="danger" onClick={() => onDropItem(i)}>Drop</RelicButton>
                  </div>
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
    </RelicPanel>
  );
}
