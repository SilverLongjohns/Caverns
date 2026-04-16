import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CharacterSlotCard } from './CharacterSlotCard.js';
import { CharacterCreateModal } from './CharacterCreateModal.js';
import { CaveBackground } from './CaveBackground.js';
import type { StatPoints } from '@caverns/shared';

interface Props {
  onSelect: (id: string) => void;
  onCreate: (name: string, className: string, statPoints: StatPoints) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  onJoinWorld: (inviteCode: string) => void;
}

const SLOT_CAP = 3;

export function CharacterSelect({ onSelect, onCreate, onDelete, onLogout, onJoinWorld }: Props) {
  const characters = useGameStore((s) => s.characters);
  const account = useGameStore((s) => s.account);
  const inviteCode = useGameStore((s) => s.selectedWorldInviteCode);
  const worldError = useGameStore((s) => s.worldError);
  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignored
    }
  };

  const submitJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length === 0) return;
    onJoinWorld(code);
    setJoinCode('');
  };

  if (creatingSlot !== null) {
    return (
      <CharacterCreateModal
        onCreate={(name, cls, pts) => {
          onCreate(name, cls, pts);
          setCreatingSlot(null);
        }}
        onCancel={() => setCreatingSlot(null)}
      />
    );
  }

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Choose your character</p>
      {account && <p className="char-select-greeting">Welcome, {account.displayName}</p>}
      <div className="char-slot-grid">
        {Array.from({ length: SLOT_CAP }).map((_, i) => (
          <CharacterSlotCard
            key={i}
            slotIndex={i}
            character={characters[i]}
            onCreate={() => setCreatingSlot(i)}
            onResume={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div className="world-code-bar">
        {inviteCode && (
          <div className="world-code-block">
            <span className="world-code-label">Your world code:</span>
            <code className="world-code-value">{inviteCode}</code>
            <button className="world-code-copy" onClick={copyCode}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        <div className="world-code-join">
          <input
            className="world-code-input"
            placeholder="Join code"
            maxLength={6}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') submitJoin(); }}
          />
          <button className="world-code-join-btn" onClick={submitJoin} disabled={joinCode.trim().length === 0}>
            Join
          </button>
        </div>
        {worldError && <div className="world-code-error">{worldError}</div>}
      </div>
      <button className="char-select-logout" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}
