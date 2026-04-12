import { useGameStore } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { useGridMovement } from './hooks/useGridMovement.js';
import { Lobby } from './components/Lobby.js';
import { LoginScreen } from './components/LoginScreen.js';
import { CharacterSelect } from './components/CharacterSelect.js';
import { WorldSelect } from './components/WorldSelect.js';
import { clearSessionToken } from './auth/sessionStorage.js';
import { TextLog } from './components/TextLog.js';
import { MiniMap } from './components/MiniMap.js';
import { PlayerHUD } from './components/PlayerHUD.js';
import { PartyPanel } from './components/PartyPanel.js';
import { ActionBar } from './components/ActionBar.js';
import { CombatView } from './components/CombatView.js';
import { RoomView } from './components/RoomView.js';
import { Compass } from './components/Compass.js';
import { ChatInput } from './components/ChatInput.js';
import { DebugPanel } from './components/DebugPanel.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const authStatus = useGameStore((s) => s.authStatus);
  const gameOver = useGameStore((s) => s.gameOver);
  const generationStatus = useGameStore((s) => s.generationStatus);
  const generationError = useGameStore((s) => s.generationError);
  const activeCombat = useGameStore((s) => s.activeCombat);
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const levelUpGlow = useGameStore((s) => s.levelUpGlow);
  const selectedCharacterId = useGameStore((s) => s.selectedCharacterId);
  const selectedWorldId = useGameStore((s) => s.selectedWorldId);

  const inExploration = connectionStatus === 'in_game' && !gameOver && !activeCombat;
  const currentRoom = rooms[currentRoomId];
  const availableExits = currentRoom?.exits ?? {};

  useGridMovement(actions.gridMove, inExploration);

  let content;

  if (connectionStatus === 'disconnected') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p>Connecting to server...</p>
      </div>
    );
  } else if (generationStatus === 'generating') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p className="generation-text">The caverns shift and groan...</p>
        <div className="generation-spinner" />
      </div>
    );
  } else if (generationStatus === 'failed') {
    content = (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p className="generation-text generation-failed">
          The darkness resists... falling back to The Dripping Halls
        </p>
      </div>
    );
  } else if (authStatus === 'unauthenticated') {
    content = <LoginScreen onLogin={actions.login} />;
  } else if (authStatus === 'authenticated' && !selectedWorldId) {
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
        authError: null,
      });
    };
    content = (
      <WorldSelect
        onList={actions.listWorlds}
        onSelect={actions.selectWorld}
        onCreate={actions.createWorld}
        onJoin={actions.joinWorld}
        onLogout={handleLogout}
      />
    );
  } else if (authStatus === 'authenticated' && !selectedCharacterId) {
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
        authError: null,
      });
    };
    content = (
      <CharacterSelect
        onSelect={actions.selectCharacter}
        onCreate={actions.createCharacter}
        onDelete={actions.deleteCharacter}
        onLogout={handleLogout}
      />
    );
  } else if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} onSetReady={actions.setReady} />;
  } else if (gameOver) {
    content = (
      <div className="screen-center">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The dungeon has been conquered!'
            : 'Your party has fallen in the darkness...'}
        </p>
        <button
          className="lobby-return-btn"
          onClick={() => useGameStore.setState({ gameOver: null, connectionStatus: 'in_lobby' })}
        >
          Return to Lobby
        </button>
      </div>
    );
  } else {
    content = (
      <div className="game-layout">
        <div className="main-column">
          {activeCombat ? (
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
          <PlayerHUD onEquipItem={actions.equipItem} onDropItem={actions.dropItem} onUseConsumable={actions.useConsumable} onAllocateStat={(statId) => actions.allocateStat(statId, 1)} />
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      {import.meta.env.DEV && connectionStatus === 'in_game' && !gameOver && <DebugPanel onTeleport={actions.debugTeleport} onRevealAll={actions.debugRevealAll} onGiveItem={actions.debugGiveItem} />}
      <div className="crt-overlay" />
      {levelUpGlow && <div className="level-up-glow" />}
    </>
  );
}
