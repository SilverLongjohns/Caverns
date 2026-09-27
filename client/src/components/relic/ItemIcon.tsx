import { useEffect, useState } from 'react';
import type { Item } from '@caverns/shared';
import { itemIconSrc, slotGlyph } from '../../ui/iconPaths.js';
import { IconSocket } from './IconSocket.js';

export function ItemIcon({ item }: { item: Item }) {
  const src = itemIconSrc(item);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <IconSocket size={32} rarity={item.rarity} title={item.name}>
      {failed ? (
        <span className="relic-socket__glyph" aria-hidden="true">{slotGlyph(item.slot)}</span>
      ) : (
        <img className="relic-socket__img" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </IconSocket>
  );
}
