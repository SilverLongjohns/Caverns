import { useGameStore } from '../store/gameStore.js';
import { getClassPortrait } from '../classPortraits.js';

interface Props {
  onPortalReady: () => void;
  onPortalUnready: () => void;
  onPortalEnter: () => void;
  onInteract: (interactableId: string) => void;
  onOpenCharacterPanel: () => void;
}

export function TownView({ onPortalReady, onPortalUnready, onPortalEnter, onInteract, onOpenCharacterPanel }: Props) {
  const worldMap = useGameStore((s) => s.worldMap);
  const muster = useGameStore((s) => s.currentPortalMuster);
  const members = useGameStore((s) => s.worldMembers);
  const selectedCharacterId = useGameStore((s) => s.selectedCharacterId);
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
          <button className="town-panel town-panel-npc" onClick={() => { new Audio('/audio/open_audio.mp3').play(); onInteract(stash.id); }}>
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
          <button className="town-panel town-panel-npc" onClick={() => { new Audio('/audio/open_audio.mp3').play(); onInteract(shop.id); }}>
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
        {mine && (() => {
          const portrait = getClassPortrait(mine.className);
          return (
            <button className="town-panel town-panel-npc" onClick={() => { new Audio('/audio/open_audio.mp3').play(); onOpenCharacterPanel(); }}>
              <div className="town-portrait" aria-hidden="true">
                {portrait ? (
                  <img className="town-portrait-img" src={portrait} alt={mine.className} />
                ) : (
                  <span className="town-portrait-placeholder">?</span>
                )}
              </div>
              <div className="town-panel-body">
                <div className="town-panel-title">{mine.characterName}</div>
                <div className="town-panel-desc">Manage equipment and stats</div>
              </div>
            </button>
          );
        })()}
        <div className="town-panel town-panel-disabled">
          <div className="town-panel-icon">¶</div>
          <div className="town-panel-title">Bulletin Board</div>
          <div className="town-panel-desc">No notices posted</div>
        </div>
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

    </div>
  );
}
