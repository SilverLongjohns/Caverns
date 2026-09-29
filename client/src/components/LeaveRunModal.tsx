import { LOOT_CONFIG, type Item, type LeaveRunToll, type Player } from '@caverns/shared';
import { ScreenTransition, MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';

interface Props {
  player: Player;
  open: boolean;
  onPay: (toll: LeaveRunToll) => void;
  onClose: () => void;
}

/** The toll for escaping a run: gold, one carried item, or free when neither is possible. */
export function LeaveRunModal({ player, open, onPay, onClose }: Props) {
  const tollGold = LOOT_CONFIG.leaveRunTollGold;
  const canPayGold = player.gold >= tollGold;
  const carried: { source: 'inventory' | 'consumables'; index: number; item: Item }[] = [
    ...player.inventory.flatMap((item, index) => (item ? [{ source: 'inventory' as const, index, item }] : [])),
    ...player.consumables.flatMap((item, index) => (item ? [{ source: 'consumables' as const, index, item }] : [])),
  ];
  const free = !canPayGold && carried.length === 0;
  return (
    <ScreenTransition screenKey={open ? 'leave-run' : 'closed'} className="modal-layer" onBackdropClick={onClose}>
      {open && (
        <MenuConsole title="Leave run" width="520px" className="leave-run-modal" footer={<RelicButton onClick={onClose}>Stay</RelicButton>}>
          <p className="leave-run-copy">The portal takes a toll. You keep everything else you found.</p>
          {free ? (
            <RelicButton hot onClick={() => onPay({ kind: 'free' })}>Leave (you have nothing to pay)</RelicButton>
          ) : (
            <>
              <RelicButton hot disabled={!canPayGold} onClick={() => onPay({ kind: 'gold' })}
                title={canPayGold ? undefined : `You need ${tollGold} gold.`}>
                Pay {tollGold} gold
              </RelicButton>
              {carried.length > 0 && <div className="leave-run-label">…or leave an item:</div>}
              <div className="leave-run-items">
                {carried.map(({ source, index, item }) => (
                  <RelicButton key={`${source}-${index}`} size="sm" onClick={() => onPay({ kind: 'item', source, index })}>
                    <ItemIcon item={item} /> {item.name}
                  </RelicButton>
                ))}
              </div>
            </>
          )}
        </MenuConsole>
      )}
    </ScreenTransition>
  );
}
