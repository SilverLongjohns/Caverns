import type { CharacterSummary } from '@caverns/shared';
import { RelicButton, IconSocket } from './relic/index.js';
import { getClassPortrait } from '../classPortraits.js';
import { audioEngine } from '../audio/audioEngine.js';

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

export function CharacterSlotCard({ slotIndex, character, onCreate, onResume, onDelete }: Props) {
  const tick = () => audioEngine.playUi('tick');
  if (!character) {
    return (
      <div className="char-slot char-slot-empty menu-hoverable" onClick={onCreate} onMouseEnter={tick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCreate(); }}>
        <IconSocket size={32}><span className="relic-socket__glyph">+</span></IconSocket>
        <div className="char-slot-number">Slot {slotIndex + 1} · empty</div>
        <RelicButton size="sm" onClick={(e) => { e.stopPropagation(); onCreate(); }}>Create</RelicButton>
      </div>
    );
  }
  const portrait = getClassPortrait(character.className);
  return (
    <div className="char-slot char-slot-filled menu-hoverable" onMouseEnter={tick}>
      <div className="char-slot-portrait">
        {portrait ? <img src={portrait} alt="" /> : <span className="relic-socket__glyph">☉</span>}
      </div>
      <div className="char-slot-name">{character.name}</div>
      <div className="char-slot-meta">Lv {character.level} · {character.className}</div>
      <div className="char-slot-meta">{character.gold}g · last {relative(character.lastPlayedAt)}</div>
      {character.parkedRun && <div className="char-slot-meta char-slot-parked">Parked in {character.parkedRun.roomName}</div>}
      <div className="char-slot-actions">
        {character.parkedRun ? (
          <RelicButton hot onClick={() => onResume(character.id)}>In run: Resume</RelicButton>
        ) : (
          <RelicButton hot={!character.inUse} onClick={() => onResume(character.id)} disabled={character.inUse}>
            {character.inUse ? 'In use' : 'Resume'}
          </RelicButton>
        )}
        {/* A character seated in a run can't be deleted (the server refuses too). */}
        {!character.parkedRun && (
          <RelicButton
            size="sm"
            tone="danger"
            className="char-slot-delete"
            onClick={() => { if (confirm(`Delete ${character.name}?`)) onDelete(character.id); }}
          >
            Delete
          </RelicButton>
        )}
      </div>
    </div>
  );
}
