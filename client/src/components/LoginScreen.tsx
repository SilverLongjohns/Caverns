import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { MenuConsole, TypedText } from './menu/index.js';
import { RelicButton } from './relic/index.js';
import { useIntroStore } from '../intro/introStore.js';

interface Props {
  onLogin: (name: string) => void;
}

export function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState('');
  const error = useGameStore((s) => s.authError);
  const replayIntro = useIntroStore((s) => s.replay);

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
    <>
      <MenuConsole className="login-console" width="420px">
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label"><TypedText text="> ENTER YOUR USERNAME TO LOG IN_" /></p>
        <div className="dos-input">
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="login-actions">
          <RelicButton className="lobby-start" hot onClick={submit} disabled={!name.trim()}>
            Continue
          </RelicButton>
        </div>
      </MenuConsole>
      <button
        className="intro-replay"
        onClick={(e) => { e.currentTarget.blur(); replayIntro(); }}
        title="Replay intro"
      >
        ↺ intro
      </button>
    </>
  );
}
