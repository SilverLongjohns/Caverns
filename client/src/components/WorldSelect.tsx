import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CaveBackground } from './CaveBackground.js';
import { WorldCreatePanel } from './WorldCreatePanel.js';
import { WorldJoinPanel } from './WorldJoinPanel.js';

interface Props {
  onList: () => void;
  onSelect: (worldId: string) => void;
  onCreate: (name: string) => void;
  onJoin: (inviteCode: string) => void;
  onLogout: () => void;
}

type SubView = 'list' | 'create' | 'join';

export function WorldSelect({ onList, onSelect, onCreate, onJoin, onLogout }: Props) {
  const worlds = useGameStore((s) => s.worlds);
  const account = useGameStore((s) => s.account);
  const error = useGameStore((s) => s.worldError);
  const [view, setView] = useState<SubView>('list');

  useEffect(() => {
    onList();
  }, [onList]);

  if (view === 'create') {
    return (
      <WorldCreatePanel
        onCreate={(name) => {
          onCreate(name);
          setView('list');
        }}
        onCancel={() => setView('list')}
      />
    );
  }

  if (view === 'join') {
    return (
      <WorldJoinPanel
        onJoin={(code) => {
          onJoin(code);
          setView('list');
        }}
        onCancel={() => setView('list')}
      />
    );
  }

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Choose your world</p>
      {account && <p className="char-select-greeting">Welcome, {account.displayName}</p>}
      <div className="char-slot-grid">
        {worlds.map((w) => (
          <button
            key={w.id}
            className="char-slot-card"
            onClick={() => onSelect(w.id)}
          >
            <div className="char-slot-name">{w.name}</div>
            <div className="char-slot-meta">
              {w.isOwner ? 'Owner' : 'Member'} · {w.memberCount} member{w.memberCount === 1 ? '' : 's'}
            </div>
            <div className="char-slot-meta">Invite: {w.inviteCode}</div>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button className="lobby-start" onClick={() => setView('create')}>
          Create World
        </button>
        <button className="lobby-start" onClick={() => setView('join')}>
          Join World
        </button>
      </div>
      <button className="char-select-logout" onClick={onLogout}>
        Logout
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
