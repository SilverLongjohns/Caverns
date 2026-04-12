import type { Item } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

interface Props {
  onDeposit: (from: 'inventory' | 'consumables', fromIndex: number) => void;
  onWithdraw: (stashIndex: number, to: 'inventory' | 'consumables') => void;
  onClose: () => void;
}

function inferStashTarget(item: Item): 'inventory' | 'consumables' {
  return item.slot === 'consumable' ? 'consumables' : 'inventory';
}

function slotLabel(item: Item): string {
  return item.name;
}

export function StashModal({ onDeposit, onWithdraw, onClose }: Props) {
  const openStash = useGameStore((s) => s.openStash);
  const stashError = useGameStore((s) => s.stashError);

  if (!openStash) return null;

  const filled = openStash.items.filter((i) => i !== null).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="stash-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="stash-title">Adventurer's Stash</h2>
        {stashError && <p className="stash-error">{stashError}</p>}
        <div className="stash-panels">
          <section className="stash-panel">
            <h3 className="stash-panel-title">Character</h3>
            <h4 className="stash-section-title">Inventory</h4>
            <div className="stash-slot-grid">
              {openStash.inventory.map((item, i) => (
                <button
                  key={`inv-${i}`}
                  className={`stash-slot ${item ? 'filled' : 'empty'}`}
                  onClick={() => item && onDeposit('inventory', i)}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? slotLabel(item) : '—'}
                </button>
              ))}
            </div>
            <h4 className="stash-section-title">Pouch</h4>
            <div className="stash-slot-grid">
              {openStash.consumables.map((item, i) => (
                <button
                  key={`con-${i}`}
                  className={`stash-slot ${item ? 'filled' : 'empty'}`}
                  onClick={() => item && onDeposit('consumables', i)}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? slotLabel(item) : '—'}
                </button>
              ))}
            </div>
          </section>
          <section className="stash-panel">
            <h3 className="stash-panel-title">
              Stash <span className="stash-count">({filled} / {openStash.capacity})</span>
            </h3>
            <div className="stash-slot-grid stash-slot-grid-wide">
              {openStash.items.map((item, i) => (
                <button
                  key={`stash-${i}`}
                  className={`stash-slot ${item ? 'filled' : 'empty'}`}
                  onClick={() => item && onWithdraw(i, inferStashTarget(item))}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? slotLabel(item) : '—'}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="stash-actions">
          <button className="stash-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
