import { useGameStore } from '../store/gameStore.js';
import { TownView } from './TownView.js';
import { StashModal } from './StashModal.js';
import { ShopModal } from './ShopModal.js';

interface Props {
  onLeaveWorld: () => void;
  onPortalReady: () => void;
  onPortalUnready: () => void;
  onPortalEnter: () => void;
  onInteract: (interactableId: string) => void;
  onStashDeposit: (from: 'inventory' | 'consumables', fromIndex: number) => void;
  onStashWithdraw: (stashIndex: number, to: 'inventory' | 'consumables') => void;
  onStashClose: () => void;
  onShopBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) => void;
  onShopSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) => void;
  onShopReroll: (shopId: string) => void;
  onShopClose: () => void;
}

export function WorldView({
  onLeaveWorld,
  onPortalReady,
  onPortalUnready,
  onPortalEnter,
  onInteract,
  onStashDeposit,
  onStashWithdraw,
  onStashClose,
  onShopBuy,
  onShopSell,
  onShopReroll,
  onShopClose,
}: Props) {
  const currentWorld = useGameStore((s) => s.currentWorld);
  const members = useGameStore((s) => s.worldMembers);

  if (!currentWorld) return null;

  return (
    <div className="world-layout">
      <header className="world-header">
        <h2 className="world-title">{currentWorld.name}</h2>
        <button className="world-leave-btn" onClick={onLeaveWorld}>
          Leave World
        </button>
      </header>
      <div className="world-body">
        <main className="world-main">
          <TownView
            onPortalReady={onPortalReady}
            onPortalUnready={onPortalUnready}
            onPortalEnter={onPortalEnter}
            onInteract={onInteract}
          />
        </main>
        <aside className="world-side">
          <h3 className="world-side-title">Party</h3>
          <ul className="world-member-list">
            {members.map((m) => (
              <li key={m.connectionId} className="world-member">
                <span className={`world-member-name class-${m.className}`}>{m.characterName}</span>
                <span className="world-member-meta">Lv {m.level} {m.className}</span>
                <span className="world-member-meta">{m.displayName}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <StashModal
        onDeposit={onStashDeposit}
        onWithdraw={onStashWithdraw}
        onClose={onStashClose}
      />
      <ShopModal
        onBuy={onShopBuy}
        onSell={onShopSell}
        onReroll={onShopReroll}
        onClose={onShopClose}
      />
    </div>
  );
}
