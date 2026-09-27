import type { ReactNode } from 'react';
import type { ItemSlot, Rarity } from '@caverns/shared';
import { slotGlyph } from '../../ui/iconPaths.js';

interface IconSocketProps {
  size?: 24 | 32;
  rarity?: Rarity;
  hot?: boolean;
  title?: string;
  children?: ReactNode;
}

export function IconSocket({ size = 32, rarity, hot = false, title, children }: IconSocketProps) {
  const cls = `relic-socket relic-socket--${size}${rarity ? ` relic-socket--${rarity}` : ''}${hot ? ' relic-socket--hot' : ''}`;
  return <span className={cls} title={title}>{children}</span>;
}

export function EmptySocket({ slot }: { slot: ItemSlot }) {
  return (
    <IconSocket size={32}>
      <span className="relic-socket__glyph" aria-hidden="true">{slotGlyph(slot)}</span>
    </IconSocket>
  );
}
