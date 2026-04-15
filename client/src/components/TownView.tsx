import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';

interface Props {
  onPortalReady: () => void;
  onPortalUnready: () => void;
  onPortalEnter: () => void;
  onInteract: (interactableId: string) => void;
}

export function TownView({ onPortalReady, onPortalUnready, onPortalEnter, onInteract }: Props) {
  const worldMap = useGameStore((s) => s.worldMap);
  const muster = useGameStore((s) => s.currentPortalMuster);
  const members = useGameStore((s) => s.worldMembers);
  const selectedCharacterId = useGameStore((s) => s.selectedCharacterId);
  const [bulletinOpen, setBulletinOpen] = useState(false);

  if (!worldMap) return null;

  const shop = worldMap.interactables.find((i) => i.kind === 'shop');
  const stash = worldMap.interactables.find((i) => i.kind === 'stash');
  const portal = worldMap.portals[0];

  const mine = members.find((m) => m.characterId === selectedCharacterId);
  const isReady = !!(
    muster && mine && muster.readyMembers.some((r) => r.connectionId === mine.connectionId)
  );
  const readyCount = muster?.readyMembers.length ?? 0;

  return (
    <div className="town-view">
      <div className="town-panels">
        {stash && (
          <button className="town-panel town-panel-npc" onClick={() => onInteract(stash.id)}>
            <div className="town-portrait" aria-hidden="true">
              <span className="town-portrait-placeholder">▣</span>
            </div>
            <div className="town-panel-body">
              <div className="town-panel-title">Adventurer's Stash</div>
              <div className="town-panel-desc">Deposit and withdraw gear</div>
            </div>
          </button>
        )}
        {shop && (
          <button className="town-panel town-panel-npc" onClick={() => onInteract(shop.id)}>
            <div className="town-portrait">
              <img
                className="town-portrait-img"
                src="/portraits/shopkeep.png"
                alt="Shopkeeper"
              />
            </div>
            <div className="town-panel-body">
              <div className="town-panel-title">General Store</div>
              <div className="town-panel-desc">Buy and sell wares</div>
            </div>
          </button>
        )}
        <button className="town-panel" onClick={() => setBulletinOpen(true)}>
          <div className="town-panel-icon">¶</div>
          <div className="town-panel-title">Bulletin Board</div>
          <div className="town-panel-desc">Village notices and quests</div>
        </button>
        {portal && (
          <div className="town-panel town-panel-portal">
            <div className="town-panel-icon">⌘</div>
            <div className="town-panel-title">{portal.label ?? 'Portal'}</div>
            <div className="town-panel-desc">Ready up to enter the dungeon</div>
            <div className="town-muster">
              <div className="town-muster-count">
                {readyCount} / {members.length} ready
              </div>
              <ul className="town-muster-list">
                {muster?.readyMembers.map((r) => (
                  <li
                    key={r.connectionId}
                    className={`town-muster-member class-${r.className}`}
                  >
                    {r.characterName}
                  </li>
                ))}
                {readyCount === 0 && <li className="town-muster-empty">— Nobody ready —</li>}
              </ul>
              <div className="town-muster-actions">
                {!isReady ? (
                  <button className="town-btn" onClick={onPortalReady}>
                    Ready
                  </button>
                ) : (
                  <button className="town-btn" onClick={onPortalUnready}>
                    Unready
                  </button>
                )}
                <button
                  className="town-btn town-btn-enter"
                  onClick={onPortalEnter}
                  disabled={!isReady}
                >
                  Enter Dungeon
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {bulletinOpen && (
        <div className="modal-backdrop" onClick={() => setBulletinOpen(false)}>
          <div className="bulletin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bulletin-header">
              <h2>Bulletin Board</h2>
              <button className="bulletin-close" onClick={() => setBulletinOpen(false)}>
                ×
              </button>
            </div>
            <div className="bulletin-body">
              <p className="bulletin-empty">
                The board is bare. A few rusty nails hold nothing but weathered scraps of
                parchment — no quests have been posted yet.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
