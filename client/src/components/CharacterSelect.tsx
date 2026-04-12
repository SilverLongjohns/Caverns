import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CharacterSlotCard } from './CharacterSlotCard.js';
import { CharacterCreatePanel } from './CharacterCreatePanel.js';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onSelect: (id: string) => void;
  onCreate: (name: string, className: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}

const SLOT_CAP = 3;

export function CharacterSelect({ onSelect, onCreate, onDelete, onLogout }: Props) {
  const characters = useGameStore((s) => s.characters);
  const account = useGameStore((s) => s.account);
  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);

  if (creatingSlot !== null) {
    return (
      <CharacterCreatePanel
        onCreate={(name, cls) => {
          onCreate(name, cls);
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
      <button className="char-select-logout" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}
