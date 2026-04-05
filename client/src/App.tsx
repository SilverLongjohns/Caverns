import { useGameStore } from './store/gameStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGameActions } from './hooks/useGameActions.js';
import { Lobby } from './components/Lobby.js';
import { TextLog } from './components/TextLog.js';
import { MiniMap } from './components/MiniMap.js';
import { PlayerHUD } from './components/PlayerHUD.js';
import { PartyPanel } from './components/PartyPanel.js';
import { ActionBar } from './components/ActionBar.js';
import { CombatView } from './components/CombatView.js';

export function App() {
  const wsRef = useWebSocket();
  const actions = useGameActions(wsRef);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const gameOver = useGameStore((s) => s.gameOver);
  const generationStatus = useGameStore((s) => s.generationStatus);
  const generationError = useGameStore((s) => s.generationError);
  const activeCombat = useGameStore((s) => s.activeCombat);

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
  } else if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
    content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} />;
  } else if (gameOver) {
    content = (
      <div className="screen-center">
        <h1>{gameOver.result === 'victory' ? 'Victory!' : 'Wiped...'}</h1>
        <p>
          {gameOver.result === 'victory'
            ? 'The dungeon has been conquered!'
            : 'Your party has fallen in the darkness...'}
        </p>
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
            />
          ) : (
            <>
              <TextLog />
              <ActionBar
                onMove={actions.move}
                onLootChoice={actions.lootChoice}
                onRevive={actions.revive}
              />
            </>
          )}
        </div>
        <div className="side-column">
          <MiniMap />
          <PartyPanel />
          <PlayerHUD onEquipItem={actions.equipItem} onDropItem={actions.dropItem} onUseConsumable={actions.useConsumable} />
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      <div className="crt-overlay" />
    </>
  );
}
