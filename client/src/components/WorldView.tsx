import { useGameStore } from '../store/gameStore.js';
import { TownView } from './TownView.js';
import { StashModal } from './StashModal.js';
import { ShopModal } from './ShopModal.js';
import { CharacterModal } from './CharacterModal.js';
import { MenuConsole, TypedText } from './menu/index.js';
import { RelicButton, IconSocket } from './relic/index.js';
import { getParticipantGlyph } from '../glyphs.js';

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
  onOpenCharacterPanel: () => void;
  onCharacterEquip: (inventoryIndex: number) => void;
  onCharacterDrop: (inventoryIndex: number) => void;
  onCharacterAllocateStat: (statId: string) => void;
  onCharacterClose: () => void;
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
  onOpenCharacterPanel,
  onCharacterEquip,
  onCharacterDrop,
  onCharacterAllocateStat,
  onCharacterClose,
}: Props) {
  const currentWorld = useGameStore((s) => s.currentWorld);
  const members = useGameStore((s) => s.worldMembers);

  if (!currentWorld) return null;

  return (
    <div className="town-hub">
      <h2 className="town-hub__title"><TypedText text={currentWorld.name} /></h2>
      <TownView
        onPortalReady={onPortalReady}
        onPortalUnready={onPortalUnready}
        onPortalEnter={onPortalEnter}
        onInteract={onInteract}
        onOpenCharacterPanel={onOpenCharacterPanel}
      />
      <MenuConsole
        className="town-party"
        title="Party"
        width="220px"
        footer={<RelicButton size="sm" className="world-leave-btn" onClick={onLeaveWorld}>Leave World</RelicButton>}
      >
        <ul className="world-member-list">
          {members.map((m) => {
            const glyph = getParticipantGlyph({ type: 'player', className: m.className });
            return (
              <li key={m.connectionId} className="world-member">
                <IconSocket size={24} title={m.className}>
                  {glyph ? <img className="relic-socket__img" src={glyph} alt="" /> : <span className="relic-socket__glyph">{m.characterName.charAt(0)}</span>}
                </IconSocket>
                <div className="world-member-info">
                  <span className={`world-member-name class-${m.className}`}>{m.characterName}</span>
                  <span className="world-member-meta">Lv {m.level} · {m.className}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </MenuConsole>
      <StashModal onDeposit={onStashDeposit} onWithdraw={onStashWithdraw} onClose={onStashClose} />
      <ShopModal onBuy={onShopBuy} onSell={onShopSell} onReroll={onShopReroll} onClose={onShopClose} />
      <CharacterModal onEquipItem={onCharacterEquip} onDropItem={onCharacterDrop} onAllocateStat={onCharacterAllocateStat} onClose={onCharacterClose} />
    </div>
  );
}
