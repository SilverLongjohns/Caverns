import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';

interface LobbyProps {
  onJoin: (name: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}

export function Lobby({ onJoin, onStart, onSetDifficulty }: LobbyProps) {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers);
  const isHost = useGameStore((s) => s.isHost);
  const difficulty = useGameStore((s) => s.lobbyDifficulty);
  const inputRef = useRef<HTMLDivElement>(null);

  const handleJoin = useCallback(() => {
    if (name.trim()) {
      onJoin(name.trim());
      setJoined(true);
    }
  }, [name, onJoin]);

  useEffect(() => {
    if (joined) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleJoin();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 20 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [joined, handleJoin]);

  if (!joined) {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label">&gt; ENTER YOUR NAME_</p>
        <div className="dos-input" ref={inputRef}>
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        <button onClick={handleJoin} disabled={!name.trim()}>
          Join
        </button>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1>Caverns</h1>
      <p className="lobby-subtitle">Waiting for players...</p>
      <div className="lobby-players">
        {lobbyPlayers.map((p) => (
          <div key={p.id} className="lobby-player">
            {p.name}
          </div>
        ))}
      </div>

      <div className="lobby-difficulty">
        <span className="lobby-label">Difficulty:</span>
        <div className="difficulty-buttons">
          {(['easy', 'medium', 'hard'] as const).map((d) => (
            <button
              key={d}
              className={`difficulty-btn ${d === difficulty ? 'active' : ''}`}
              onClick={() => onSetDifficulty(d)}
              disabled={!isHost}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isHost && (
        <div className="lobby-apikey">
          <label className="lobby-label" htmlFor="apikey-input">
            API Key (optional):
          </label>
          <input
            id="apikey-input"
            type="password"
            className="apikey-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
          />
          <p className="apikey-hint">Leave empty to play the static dungeon</p>
        </div>
      )}

      {isHost && (
        <button
          className="lobby-start"
          onClick={() => onStart(apiKey || undefined, difficulty)}
          disabled={lobbyPlayers.length === 0}
        >
          Enter the Caverns
        </button>
      )}
      {!isHost && <p className="lobby-waiting">Waiting for host to start...</p>}
    </div>
  );
}
