import { useGameStore } from '../store/gameStore.js';
import { getClassPortrait } from '../classPortraits.js';
import { MenuConsole } from './menu/index.js';
import { RelicButton, IconSocket } from './relic/index.js';
import { audioEngine } from '../audio/audioEngine.js';

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

  const open = (fn: () => void) => () => { fn(); };
  const tick = () => audioEngine.playUi('tick');
  const portrait = mine ? getClassPortrait(mine.className) : null;
  return (
    <>
      <MenuConsole className="town-services" title="Services" width="280px">
        {stash && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(() => onInteract(stash.id))}>
            <IconSocket size={32}><span className="relic-socket__glyph">▣</span></IconSocket>
            <span className="town-service__text"><span className="town-service__name">Adventurer's Stash</span><span className="town-service__desc">Deposit and withdraw gear</span></span>
          </button>
        )}
        {shop && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(() => onInteract(shop.id))}>
            <IconSocket size={32}><img className="relic-socket__img town-service__portrait" src="/portraits/shopkeep.png" alt="" /></IconSocket>
            <span className="town-service__text"><span className="town-service__name">General Store</span><span className="town-service__desc">Buy and sell wares</span></span>
          </button>
        )}
        {mine && (
          <button className="town-service menu-hoverable" onMouseEnter={tick} onClick={open(onOpenCharacterPanel)}>
            <IconSocket size={32}>
              {portrait ? <img className="relic-socket__img town-service__portrait" src={portrait} alt="" /> : <span className="relic-socket__glyph">?</span>}
            </IconSocket>
            <span className="town-service__text"><span className="town-service__name">{mine.characterName}</span><span className="town-service__desc">Manage equipment and stats</span></span>
          </button>
        )}
        <div className="town-service town-service--disabled" aria-disabled="true">
          <IconSocket size={32}><span className="relic-socket__glyph">¶</span></IconSocket>
          <span className="town-service__text"><span className="town-service__name">Bulletin Board</span><span className="town-service__desc">No notices posted</span></span>
        </div>
      </MenuConsole>

      {portal && (
        <MenuConsole className="town-panel-portal" title="Portal" width="360px">
          <div className="town-portal__name">⌘ {portal.label ?? 'Portal'}</div>
          <div className="town-muster-count">
            {readyCount} / {members.length} ready
            {readyCount > 0
              ? ` · ${muster?.readyMembers.map((r) => r.characterName).join(', ')}`
              : ' · Nobody ready'}
          </div>
          <div className="town-muster-actions">
            {!isReady ? (
              <RelicButton className="town-btn" hot onClick={onPortalReady}>Ready</RelicButton>
            ) : (
              <RelicButton className="town-btn" onClick={onPortalUnready}>Unready</RelicButton>
            )}
            <RelicButton className="town-btn town-btn-enter" hot={isReady} onClick={onPortalEnter} disabled={!isReady}>
              Enter Dungeon
            </RelicButton>
          </div>
        </MenuConsole>
      )}
    </>
  );
}
