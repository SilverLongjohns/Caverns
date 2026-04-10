import { useEffect, useRef } from 'react';
import type { GridDirection } from '@caverns/shared';

const KEY_MAP: Record<string, GridDirection> = {
  w: 'n',
  a: 'w',
  s: 's',
  d: 'e',
  W: 'n',
  A: 'w',
  S: 's',
  D: 'e',
  ArrowUp: 'n',
  ArrowLeft: 'w',
  ArrowDown: 's',
  ArrowRight: 'e',
};

const COOLDOWN_MS = 150;

export function useGridMovement(
  onMove: (direction: GridDirection) => void,
  enabled: boolean
) {
  const lastMoveRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const direction = KEY_MAP[e.key];
      if (direction) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastMoveRef.current < COOLDOWN_MS) return;
        lastMoveRef.current = now;
        onMove(direction);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onMove, enabled]);
}
