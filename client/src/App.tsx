import { useGameStore } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { Lobby } from './components/Lobby.js';
import { TextLog } from './components/TextLog.js';
import { MiniMap } from './components/MiniMap.js';
import { PlayerHUD } from './components/PlayerHUD.js';
import { PartyPanel } from './components/PartyPanel.js';
import { ActionBar } from './components/ActionBar.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const gameOver = useGameStore((s) => s.gameOver);

  if (connectionStatus === 'disconnected') {
    return (
      <div className="screen-center">
        <h1>Caverns</h1>
        <p>Connecting to server...</p>
      </div>
    );
  }

  if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    return <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} />;
  }

  if (gameOver) {
    return (
      <div className="screen-center">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The Mycelium King has been defeated!'
            : 'Your party has fallen in the darkness...'}
        </p>
      </div>
    );
  }

  return (
    <div className="game-layout">
      <div className="main-column">
        <TextLog />
        <ActionBar
          onMove={actions.move}
          onCombatAction={actions.combatAction}
          onLootChoice={actions.lootChoice}
          onRevive={actions.revive}
        />
      </div>
      <div className="side-column">
        <MiniMap />
        <PartyPanel />
        <PlayerHUD onEquipItem={actions.equipItem} onDropItem={actions.dropItem} />
      </div>
    </div>
  );
}
