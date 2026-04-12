import { useGameStore } from '../store/gameStore.js';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onLeaveWorld: () => void;
}

export function WorldView({ onLeaveWorld }: Props) {
  const currentWorld = useGameStore((s) => s.currentWorld);
  const members = useGameStore((s) => s.worldMembers);

  if (!currentWorld) return null;

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Welcome to {currentWorld.name}</p>
      <div className="char-slot-grid">
        {members.map((m) => (
          <div key={m.connectionId} className="char-slot-card">
            <div className="char-slot-name">{m.characterName}</div>
            <div className="char-slot-meta">
              Lv {m.level} {m.className}
            </div>
            <div className="char-slot-meta">{m.displayName}</div>
          </div>
        ))}
      </div>
      <p className="lobby-subtitle" style={{ opacity: 0.6, fontSize: '0.9em' }}>
        Phase 2 — map and movement coming soon
      </p>
      <button className="lobby-start" onClick={onLeaveWorld}>
        Leave World
      </button>
    </div>
  );
}
