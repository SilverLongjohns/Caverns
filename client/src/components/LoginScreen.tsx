import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onLogin: (name: string) => void;
}

export function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState('');
  const error = useGameStore((s) => s.authError);

  const submit = useCallback(() => {
    if (name.trim()) onLogin(name.trim());
  }, [name, onLogin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        submit();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 32 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submit]);

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">A cooperative dungeon crawler</p>
      <p className="dos-prompt-label">&gt; ENTER YOUR USERNAME TO LOG IN_</p>
      <div className="dos-input">
        <span className="dos-input-text">{name}</span>
        <span className="dos-cursor" />
      </div>
      <button className="lobby-start" onClick={submit} disabled={!name.trim()}>
        Continue
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
