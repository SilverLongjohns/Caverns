import { useGameStore } from '../store/gameStore.js';
import { WorldMapView } from './WorldMapView.js';

interface Props {
  onLeaveWorld: () => void;
}

export function WorldView({ onLeaveWorld }: Props) {
  const currentWorld = useGameStore((s) => s.currentWorld);
  const members = useGameStore((s) => s.worldMembers);

  if (!currentWorld) return null;

  return (
    <div className="world-layout">
      <header className="world-header">
        <h2 className="world-title">{currentWorld.name}</h2>
        <button className="world-leave-btn" onClick={onLeaveWorld}>
          Leave World
        </button>
      </header>
      <div className="world-body">
        <main className="world-main">
          <WorldMapView />
        </main>
        <aside className="world-side">
          <h3 className="world-side-title">Party</h3>
          <ul className="world-member-list">
            {members.map((m) => (
              <li key={m.connectionId} className="world-member">
                <span className={`world-member-name class-${m.className}`}>{m.characterName}</span>
                <span className="world-member-meta">Lv {m.level} {m.className}</span>
                <span className="world-member-meta">{m.displayName}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
