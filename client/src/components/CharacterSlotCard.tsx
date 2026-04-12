import type { CharacterSummary } from '@caverns/shared';

interface Props {
  slotIndex: number;
  character?: CharacterSummary;
  onCreate: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

function relative(date: string | null): string {
  if (!date) return 'never';
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function CharacterSlotCard({
  slotIndex,
  character,
  onCreate,
  onResume,
  onDelete,
}: Props) {
  if (!character) {
    return (
      <div className="char-slot char-slot-empty" onClick={onCreate}>
        <div className="char-slot-number">Slot {slotIndex + 1}</div>
        <div className="char-slot-empty-label">+ Create character</div>
      </div>
    );
  }
  return (
    <div className="char-slot char-slot-filled">
      <div className="char-slot-name">{character.name}</div>
      <div className="char-slot-meta">
        Lv {character.level} · {character.className}
      </div>
      <div className="char-slot-meta">
        {character.gold}g · last {relative(character.lastPlayedAt)}
      </div>
      <div className="char-slot-actions">
        <button onClick={() => onResume(character.id)} disabled={character.inUse}>
          {character.inUse ? 'In use' : 'Resume'}
        </button>
        <button
          className="char-slot-delete"
          onClick={() => {
            if (confirm(`Delete ${character.name}?`)) onDelete(character.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
