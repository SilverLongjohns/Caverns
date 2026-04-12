import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onCreate: (name: string) => void;
  onCancel: () => void;
}

export function WorldCreatePanel({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const error = useGameStore((s) => s.worldError);

  const submit = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length >= 1 && trimmed.length <= 32) onCreate(trimmed);
  }, [name, onCreate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        submit();
      } else if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 32 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submit, onCancel]);

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Forge a new world</p>
      <p className="dos-prompt-label">&gt; NAME YOUR WORLD_</p>
      <div className="dos-input">
        <span className="dos-input-text">{name}</span>
        <span className="dos-cursor" />
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button className="lobby-start" onClick={submit} disabled={!name.trim()}>
          Create
        </button>
        <button className="lobby-start" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
