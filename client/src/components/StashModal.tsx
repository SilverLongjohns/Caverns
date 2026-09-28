import type { Item } from '@caverns/shared';
import { audioEngine } from '../audio/audioEngine.js';
import { useGameStore } from '../store/gameStore.js';
import { ScreenTransition, MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';

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

  const filled = openStash ? openStash.items.filter((i) => i !== null).length : 0;

  return (
    <ScreenTransition screenKey={openStash ? 'stash' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {openStash && (
      <MenuConsole title="Adventurer's Stash" width="760px" className="stash-modal" footer={<RelicButton className="stash-close-btn" onClick={onClose}>Close</RelicButton>}>
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
                  onClick={() => { if (item) { audioEngine.playSfx('stash_move'); onDeposit('inventory', i); } }}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? <><ItemIcon item={item} /><span className="stash-slot__name">{slotLabel(item)}</span></> : '—'}
                </button>
              ))}
            </div>
            <h4 className="stash-section-title">Pouch</h4>
            <div className="stash-slot-grid">
              {openStash.consumables.map((item, i) => (
                <button
                  key={`con-${i}`}
                  className={`stash-slot ${item ? 'filled' : 'empty'}`}
                  onClick={() => { if (item) { audioEngine.playSfx('stash_move'); onDeposit('consumables', i); } }}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? <><ItemIcon item={item} /><span className="stash-slot__name">{slotLabel(item)}</span></> : '—'}
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
                  onClick={() => { if (item) { audioEngine.playSfx('stash_move'); onWithdraw(i, inferStashTarget(item)); } }}
                  disabled={!item}
                  title={item?.description ?? ''}
                >
                  {item ? <><ItemIcon item={item} /><span className="stash-slot__name">{slotLabel(item)}</span></> : '—'}
                </button>
              ))}
            </div>
          </section>
        </div>
      </MenuConsole>
      )}
    </ScreenTransition>
  );
}
