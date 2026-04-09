import { useEffect } from 'react';
import type { Direction } from '@caverns/shared';

const KEY_MAP: Record<string, Direction> = {
  w: 'north',
  a: 'west',
  s: 'south',
  d: 'east',
  W: 'north',
  A: 'west',
  S: 'south',
  D: 'east',
  ArrowUp: 'north',
  ArrowLeft: 'west',
  ArrowDown: 'south',
  ArrowRight: 'east',
};

export function useKeyboardMovement(
  onMove: (direction: Direction) => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const direction = KEY_MAP[e.key];
      if (direction) {
        e.preventDefault();
        onMove(direction);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onMove, enabled]);
}
