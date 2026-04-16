import { useGameStore } from '../store/gameStore.js';
import { getClassPortrait } from '../classPortraits.js';
import { PROGRESSION_CONFIG } from '@caverns/shared';
import type { Item, ItemStats, CharacterPanelView } from '@caverns/shared';

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

interface Props {
  onEquipItem: (inventoryIndex: number) => void;
  onDropItem: (inventoryIndex: number) => void;
  onAllocateStat: (statId: string) => void;
  onClose: () => void;
}

export function CharacterModal({ onEquipItem, onDropItem, onAllocateStat, onClose }: Props) {
  const panel = useGameStore((s) => s.openCharacterPanel);
  const error = useGameStore((s) => s.characterPanelError);

  if (!panel) return null;

  const portrait = getClassPortrait(panel.className);

  const thresholds = PROGRESSION_CONFIG.levelThresholds;
  const maxLevel = thresholds.length;
  const isMaxLevel = panel.level >= maxLevel;
  const currentThreshold = thresholds[panel.level - 1] ?? 0;
  const nextThreshold = isMaxLevel ? currentThreshold : thresholds[panel.level];
  const xpIntoLevel = panel.xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  const xpPercent = isMaxLevel ? 100 : (xpNeeded > 0 ? (xpIntoLevel / xpNeeded) * 100 : 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="char-modal" onClick={(e) => e.stopPropagation()}>
        <header className="char-modal-header">
          <h2>Character</h2>
          <button className="char-modal-close" onClick={onClose}>x</button>
        </header>

        {error && <div className="char-modal-error">{error}</div>}

        <div className="char-modal-body">
          <div className="char-modal-identity">
            <div className="town-portrait char-modal-portrait">
              {portrait ? (
                <img className="town-portrait-img" src={portrait} alt={panel.className} />
              ) : (
                <span className="town-portrait-placeholder">?</span>
              )}
            </div>
            <div className="char-modal-name-block">
              <div className="char-modal-name">{panel.name}</div>
              <div className="char-modal-class">{panel.className}</div>
              <div className="char-modal-level">Level {panel.level}</div>
              <div className="char-modal-gold">Gold: {panel.gold}</div>
            </div>
          </div>

          <div className="char-modal-xp">
            <div className="xp-bar-container">
              <div className="xp-bar" style={{ width: `${xpPercent}%` }} />
              <span className="xp-text">
                {isMaxLevel ? 'MAX' : `${panel.xp} / ${nextThreshold} XP`}
              </span>
            </div>
          </div>

          <div className="char-modal-stats">
            <div className="char-stat">HP: {panel.maxHp}</div>
            <div className="char-stat">{STAT_DISPLAY_NAMES['damage'] ?? 'Damage'}: {panel.damage}</div>
            <div className="char-stat">{STAT_DISPLAY_NAMES['defense'] ?? 'Defense'}: {panel.defense}</div>
            <div className="char-stat">{STAT_DISPLAY_NAMES['initiative'] ?? 'Initiative'}: {panel.initiative}</div>
            <div className="char-stat">{STAT_DISPLAY_NAMES['maxEnergy'] ?? 'Energy'}: {panel.maxEnergy}</div>
          </div>

          {panel.unspentStatPoints > 0 && (
            <div className="char-modal-alloc">
              <div className="stat-alloc-header">
                +{panel.unspentStatPoints} stat {panel.unspentStatPoints === 1 ? 'point' : 'points'}
              </div>
              {PROGRESSION_CONFIG.statDefinitions.map((def) => (
                <div key={def.id} className="stat-alloc-row">
                  <span className="stat-alloc-name">{def.displayName}</span>
                  <span className="stat-alloc-value">{panel.statAllocations[def.id] ?? 0}</span>
                  <button className="stat-alloc-btn" onClick={() => onAllocateStat(def.id)}>+</button>
                </div>
              ))}
            </div>
          )}

          <section className="char-modal-section">
            <h3>Equipment</h3>
            <div className="char-equip-grid">
              <EquipSlot item={panel.equipment.weapon} label="Weapon" />
              <EquipSlot item={panel.equipment.offhand} label="Off-hand" />
              <EquipSlot item={panel.equipment.armor} label="Armor" />
              <EquipSlot item={panel.equipment.accessory} label="Accessory" />
            </div>
          </section>

          <section className="char-modal-section">
            <h3>Consumables</h3>
            <div className="char-consumable-grid">
              {panel.consumables.map((item, i) => (
                <div key={i} className="char-consumable-slot">
                  {item ? (
                    <div className="char-item-row">
                      <span className={`rarity-${item.rarity}`} title={item.description}>
                        {item.name} <span className="item-stats">{formatStats(item.stats)}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="empty">-</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="char-modal-section">
            <h3>Inventory</h3>
            <div className="char-inventory-grid">
              {panel.inventory.map((item, i) => (
                <div key={i} className="char-inventory-slot">
                  {item ? (
                    <div className="char-item-row">
                      <span className={`rarity-${item.rarity}`} title={item.description}>
                        {item.name}
                      </span>
                      <span className="item-stats">{formatStats(item.stats)}</span>
                      <button className="equip-btn" onClick={() => onEquipItem(i)}>
                        {item.slot === 'consumable' ? 'Stow' : 'Equip'}
                      </button>
                      <button className="drop-btn" onClick={() => onDropItem(i)}>Drop</button>
                    </div>
                  ) : (
                    <span className="empty">-</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function EquipSlot({ item, label }: { item: Item | null; label: string }) {
  return (
    <div className="char-equip-slot">
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
