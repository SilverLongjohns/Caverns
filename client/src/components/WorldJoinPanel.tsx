import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onJoin: (inviteCode: string) => void;
  onCancel: () => void;
}

const CODE_LENGTH = 6;

export function WorldJoinPanel({ onJoin, onCancel }: Props) {
  const [code, setCode] = useState('');
  const error = useGameStore((s) => s.worldError);

  const submit = useCallback(() => {
    if (code.length === CODE_LENGTH) onJoin(code);
  }, [code, onJoin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        submit();
      } else if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Backspace') {
        setCode((prev) => prev.slice(0, -1));
      } else if (/^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        setCode((prev) => (prev.length < CODE_LENGTH ? prev + e.key.toUpperCase() : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submit, onCancel]);

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Join an existing world</p>
      <p className="dos-prompt-label">&gt; ENTER INVITE CODE_</p>
      <div className="dos-input">
        <span className="dos-input-text">{code}</span>
        <span className="dos-cursor" />
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button className="lobby-start" onClick={submit} disabled={code.length !== CODE_LENGTH}>
          Join
        </button>
        <button className="lobby-start" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
