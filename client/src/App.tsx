import { useGameStore, selectCurrentView } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { useGridMovement } from './hooks/useGridMovement.js';
import { LoginScreen } from './components/LoginScreen.js';
import { CharacterSelect } from './components/CharacterSelect.js';
import { WorldView } from './components/WorldView.js';
import { clearSessionToken } from './auth/sessionStorage.js';
import { TextLog } from './components/TextLog.js';
import { MiniMap } from './components/MiniMap.js';
import { PlayerHUD } from './components/PlayerHUD.js';
import { PartyPanel } from './components/PartyPanel.js';
import { ActionBar } from './components/ActionBar.js';
import { CombatView } from './components/CombatView.js';
import { ArenaView } from './components/ArenaView.js';
import { RoomView } from './components/RoomView.js';
import { Compass } from './components/Compass.js';
import { ChatInput } from './components/ChatInput.js';
import { DebugPanel } from './components/DebugPanel.js';
import { CombatIntro } from './components/CombatIntro.js';
import { MusicPlayer } from './components/MusicPlayer.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const currentView = useGameStore(selectCurrentView);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const gameOver = useGameStore((s) => s.gameOver);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const arenaGrid = useGameStore((s) => s.arenaGrid);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const levelUpGlow = useGameStore((s) => s.levelUpGlow);
  const arenaIntro = useGameStore((s) => s.arenaIntro);

  const inExploration = connectionStatus === 'in_game' && !gameOver && !activeCombat;
  const currentRoom = rooms[currentRoomId];
  const availableExits = currentRoom?.exits ?? {};

  useGridMovement(actions.gridMove, inExploration);

  const handleLogout = () => {
    actions.logout();
    clearSessionToken();
    useGameStore.setState({
      authStatus: 'unauthenticated',
      account: null,
      characters: [],
      selectedCharacterId: null,
      worlds: [],
      selectedWorldId: null,
      worldError: null,
      currentWorld: null,
      worldMap: null,
      worldMembers: [],
      overworldPathPreview: [],
      authError: null,
    });
  };

  let content;
  switch (currentView) {
    case 'connecting':
      content = (
        <div className="screen-center">
          <h1>Caverns</h1>
          <p>Connecting to server...</p>
        </div>
      );
      break;
    case 'generating':
      content = (
        <div className="screen-center">
          <h1>Caverns</h1>
          <p className="generation-text">The caverns shift and groan...</p>
          <div className="generation-spinner" />
        </div>
      );
      break;
    case 'login':
      content = <LoginScreen onLogin={actions.login} />;
      break;
    case 'character_select':
      content = (
        <CharacterSelect
          onSelect={actions.selectCharacter}
          onCreate={actions.createCharacter}
          onDelete={actions.deleteCharacter}
          onLogout={handleLogout}
          onJoinWorld={actions.joinWorld}
        />
      );
      break;
    case 'in_world':
      content = (
        <WorldView
          onLeaveWorld={actions.leaveWorld}
          onPortalReady={actions.portalReady}
          onPortalUnready={actions.portalUnready}
          onPortalEnter={actions.portalEnter}
          onInteract={actions.interactOverworld}
          onStashDeposit={actions.stashDeposit}
          onStashWithdraw={actions.stashWithdraw}
          onStashClose={actions.closeStash}
          onShopBuy={actions.shopBuy}
          onShopSell={actions.shopSell}
          onShopReroll={actions.shopReroll}
          onShopClose={actions.closeShop}
          onOpenCharacterPanel={actions.openCharacterPanel}
          onCharacterEquip={actions.overworldEquipItem}
          onCharacterDrop={actions.overworldDropItem}
          onCharacterAllocateStat={(statId) => actions.overworldAllocateStat(statId, 1)}
          onCharacterClose={actions.closeCharacterPanel}
        />
      );
      break;
    case 'game_over':
      content = (
        <div className="screen-center">
          <h1>{gameOver?.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
          <p>
            {gameOver?.result === 'victory'
              ? 'The dungeon has been conquered!'
              : 'Your party has fallen in the darkness...'}
          </p>
          <button
            className="lobby-return-btn"
            onClick={() => useGameStore.setState({ gameOver: null })}
          >
            Return to Overworld
          </button>
        </div>
      );
      break;
    case 'in_dungeon':
    default:
      content = (
        <div className="game-layout">
          <div className="main-column">
            {activeCombat && arenaGrid ? (
              <ArenaView
                onCombatAction={actions.combatAction}
                onArenaMove={actions.arenaMove}
                onArenaEndTurn={actions.arenaEndTurn}
                onUseAbility={(abilityId, targetId, targetX, targetY) => actions.useAbility(abilityId, targetId, targetX, targetY)}
              />
            ) : activeCombat ? (
              <CombatView
                onCombatAction={actions.combatAction}
                onRevive={actions.revive}
                onDefendResult={actions.defendResult}
                onUseAbility={actions.useAbility}
                onUseItemEffect={actions.useItemEffect}
              />
            ) : (
              <>
                <div className="room-area">
                  <Compass exits={availableExits} />
                  <RoomView />
                </div>
                <TextLog />
                <ChatInput onSend={actions.chat} />
                <ActionBar
                  onLootChoice={actions.lootChoice}
                  onRevive={actions.revive}
                  onPuzzleAnswer={actions.puzzleAnswer}
                  onInteractAction={actions.interactAction}
                />
              </>
            )}
          </div>
          <div className="side-column">
            <MiniMap />
            <PartyPanel />
            <PlayerHUD
              onEquipItem={actions.equipItem}
              onDropItem={actions.dropItem}
              onUseConsumable={actions.useConsumable}
              onAllocateStat={(statId) => actions.allocateStat(statId, 1)}
            />
          </div>
        </div>
      );
      break;
  }

  return (
    <>
      {content}
      {import.meta.env.DEV && connectionStatus === 'in_game' && !gameOver && (
        <DebugPanel
          onTeleport={actions.debugTeleport}
          onRevealAll={actions.debugRevealAll}
          onGiveItem={actions.debugGiveItem}
        />
      )}
      {arenaIntro && <CombatIntro enemyNames={arenaIntro.enemyNames} />}
      <MusicPlayer />
      <div className="crt-overlay" />
      {levelUpGlow && <div className="level-up-glow" />}
    </>
  );
}
