import { useEffect, useState } from 'react';
import type { Item } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

function pickLine(): string {
  return SHOPKEEP_LINES[Math.floor(Math.random() * SHOPKEEP_LINES.length)];
}

const SHOPKEEP_LINES = [
  '"... Enough questions. Are you buying something?"',
  '"Coin on the counter or hands off the wares, sump."',
  '"I\u2019ve seen sharper blades in a sewing kit. Upgrade?"',
  '"Everything has a price."',
  '"Down from the Halls, are you? Be a dear and die somewhere obvious."',
  '"Buy low, sell cheap, loot it off your corpse."',
  '"Don\u2019t touch what you can\u2019t afford."',
  '"Fresh stock, honest weights. Standard arrangement."',
  '"You break it, you bleed for it."',
  '"I don\u2019t haggle."',
];

interface Props {
  onBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) => void;
  onSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) => void;
  onReroll: (shopId: string) => void;
  onClose: () => void;
}

export function ShopModal({ onBuy, onSell, onReroll, onClose }: Props) {
  const shop = useGameStore((s) => s.openShop);
  const error = useGameStore((s) => s.shopError);
  const [greeting, setGreeting] = useState(pickLine);
  const isOpen = shop !== null;
  useEffect(() => {
    if (isOpen) setGreeting(pickLine());
  }, [isOpen]);
  if (!shop) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="shop-modal" onClick={stop}>
        <header className="shop-modal-header">
          <h2>{shop.name}</h2>
          <div className="shop-gold">{shop.gold}g</div>
          <button className="shop-close-btn" onClick={onClose}>×</button>
        </header>

        <div className="shop-body">
          <aside className="shop-keeper-col">
            <div className="town-portrait shop-keeper-portrait">
              <img
                className="town-portrait-img shop-keeper-portrait-img"
                src="/portraits/shopkeep.png"
                alt="Shopkeeper"
              />
            </div>
            <div className="shop-keeper-name">The Proprietor</div>
            <div className="shop-keeper-line">{greeting}</div>
          </aside>

          <div className="shop-main">
        {error && <div className="shop-error">{error}</div>}

        <section className="shop-section">
          <h3>Staples</h3>
          <div className="shop-row">
            {shop.fixed.map((slot, i) => (
              <button
                key={`fixed-${i}`}
                className="shop-slot"
                onClick={() => onBuy(shop.shopId, 'fixed', i)}
                disabled={shop.gold < slot.price}
                title={slot.item.description}
              >
                <div className="shop-slot-name">{slot.item.name}</div>
                <div className="shop-price">{slot.price}g</div>
              </button>
            ))}
          </div>
        </section>

        <section className="shop-section">
          <div className="shop-section-header">
            <h3>Wares</h3>
            <button
              className="shop-reroll-btn"
              onClick={() => onReroll(shop.shopId)}
              disabled={shop.gold < shop.rerollCost}
            >
              Reroll ({shop.rerollCost}g)
            </button>
          </div>
          <div className="shop-row">
            {shop.rotating.map((slot, i) => (
              <button
                key={`rot-${i}`}
                className="shop-slot"
                onClick={() => slot.item && onBuy(shop.shopId, 'rotating', i)}
                disabled={!slot.item || (slot.price != null && shop.gold < slot.price)}
                title={slot.item?.description ?? 'Bought'}
              >
                {slot.item ? (
                  <>
                    <div className={`shop-slot-name rarity-${slot.item.rarity}`}>{slot.item.name}</div>
                    <div className="shop-price">{slot.price}g</div>
                  </>
                ) : (
                  <div className="shop-slot-empty">—</div>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="shop-section">
          <h3>Your Inventory (click to sell at {Math.round(shop.sellBackPct * 100)}%)</h3>
          <div className="shop-row">
            {shop.character.inventory.map((item, i) => (
              <SellSlot key={`inv-${i}`} item={item} onClick={() => item && onSell(shop.shopId, 'inventory', i)} />
            ))}
          </div>
          <div className="shop-row">
            {shop.character.consumables.map((item, i) => (
              <SellSlot key={`con-${i}`} item={item} onClick={() => item && onSell(shop.shopId, 'consumables', i)} />
            ))}
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SellSlot({ item, onClick }: { item: Item | null; onClick: () => void }) {
  return (
    <button className="shop-slot" onClick={onClick} disabled={!item} title={item?.description ?? ''}>
      {item ? <div className={`shop-slot-name rarity-${item.rarity}`}>{item.name}</div> : <div className="shop-slot-empty">—</div>}
    </button>
  );
}
