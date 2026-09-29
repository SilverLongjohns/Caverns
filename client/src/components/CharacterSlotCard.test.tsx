import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CharacterSummary } from '@caverns/shared';
import { CharacterSlotCard } from './CharacterSlotCard.js';

const base: CharacterSummary = {
  id: 'c1', name: 'Ada', className: 'vanguard', level: 3, gold: 40, lastPlayedAt: null, inUse: false,
};

function render(character: CharacterSummary): string {
  return renderToStaticMarkup(
    <CharacterSlotCard slotIndex={0} character={character} onCreate={() => {}} onResume={() => {}} onDelete={() => {}} />,
  );
}

describe('CharacterSlotCard delete', () => {
  it('offers Delete for a character that is not in a run', () => {
    expect(render(base)).toContain('char-slot-delete');
  });

  it('offers no Delete for a character parked in a run', () => {
    const html = render({ ...base, inUse: true, parkedRun: { roomName: 'Dripping Hall' } });
    expect(html).toContain('In run: Resume');
    expect(html).not.toContain('char-slot-delete');
  });
});
