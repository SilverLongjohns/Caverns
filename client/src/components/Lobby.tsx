import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CLASS_DEFINITIONS } from '@caverns/shared';

interface LobbyProps {
  onJoin: (name: string, roomCode?: string, className?: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}

type LobbyScreen = 'name' | 'choose' | 'join_code' | 'waiting';

export function Lobby({ onJoin, onStart, onSetDifficulty }: LobbyProps) {
  const [name, setName] = useState('');
  const [screen, setScreen] = useState<LobbyScreen>('name');
  const [codeInput, setCodeInput] = useState('');
  const [selectedClass, setSelectedClass] = useState('vanguard');
  const [apiKey, setApiKey] = useState('');
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers);
  const isHost = useGameStore((s) => s.isHost);
  const difficulty = useGameStore((s) => s.lobbyDifficulty);
  const roomCode = useGameStore((s) => s.roomCode);

  useEffect(() => {
    if (roomCode) setScreen('waiting');
  }, [roomCode]);

  const handleNameSubmit = useCallback(() => {
    if (name.trim()) setScreen('choose');
  }, [name]);

  useEffect(() => {
    if (screen !== 'name') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNameSubmit();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 20 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, handleNameSubmit]);

  useEffect(() => {
    if (screen !== 'join_code') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && codeInput.length === 4) {
        onJoin(name.trim(), codeInput.toUpperCase(), selectedClass);
      } else if (e.key === 'Backspace') {
        setCodeInput((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setScreen('choose');
        setCodeInput('');
      } else if (/^[a-zA-Z]$/.test(e.key) && codeInput.length < 4) {
        setCodeInput((prev) => prev + e.key.toUpperCase());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, codeInput, name, onJoin]);

  if (screen === 'name') {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label">&gt; ENTER YOUR NAME_</p>
        <div className="dos-input">
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        <button onClick={handleNameSubmit} disabled={!name.trim()}>
          Continue
        </button>
      </div>
    );
  }

  if (screen === 'choose') {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">Welcome, {name.trim()}</p>

        <div className="class-selector">
          <p className="lobby-label">Choose your class:</p>
          <div className="class-options">
            {CLASS_DEFINITIONS.map((cls) => (
              <button
                key={cls.id}
                className={`class-btn ${selectedClass === cls.id ? 'class-selected' : ''}`}
                onClick={() => setSelectedClass(cls.id)}
              >
                <span className="class-name">{cls.displayName}</span>
                <span className="class-desc">{cls.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-choose">
          <button className="lobby-start" onClick={() => onJoin(name.trim(), undefined, selectedClass)}>
            Create Lobby
          </button>
          <button className="lobby-start" onClick={() => setScreen('join_code')}>
            Join Lobby
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'join_code') {
    return (
      <div className="lobby">
        <h1>Caverns</h1>
        <p className="lobby-subtitle">Enter room code</p>
        <div className="room-code-input">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`code-char ${codeInput[i] ? 'filled' : ''}`}>
              {codeInput[i] || '_'}
            </span>
          ))}
        </div>
        <div className="lobby-choose">
          <button onClick={() => onJoin(name.trim(), codeInput.toUpperCase(), selectedClass)} disabled={codeInput.length !== 4}>
            Join
          </button>
          <button className="back-btn" onClick={() => { setScreen('choose'); setCodeInput(''); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1>Caverns</h1>
      <p className="lobby-subtitle">Waiting for players...</p>
      {roomCode && (
        <div className="room-code-display">
          <span className="lobby-label">Room Code:</span>
          <span className="room-code">{roomCode}</span>
        </div>
      )}
      <div className="lobby-players">
        {lobbyPlayers.map((p) => (
          <div key={p.id} className="lobby-player">
            <span>{p.name}</span>
            <span className="lobby-player-class">{p.className}</span>
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
