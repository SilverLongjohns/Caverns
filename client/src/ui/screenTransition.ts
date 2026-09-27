// CRT power transition between menu screens. Pure: the component renders what this says.
export const POWER_OFF_MS = 220;
export const POWER_ON_MS = 280;
export const TRANSITION_WATCHDOG_MS = 600;

export type TransitionState =
  | { phase: 'idle'; key: string }
  | { phase: 'off'; from: string; to: string }
  | { phase: 'on'; key: string };

export type TransitionEvent =
  | { type: 'change'; key: string; reduced: boolean }
  | { type: 'offDone' }
  | { type: 'onDone' }
  | { type: 'timeout' };

export function initialTransition(key: string): TransitionState {
  return { phase: 'idle', key };
}

/** The key whose content is on screen right now. */
export function displayKey(s: TransitionState): string {
  return s.phase === 'off' ? s.from : s.key;
}

/** The key the transition is heading to. */
export function targetKey(s: TransitionState): string {
  return s.phase === 'off' ? s.to : s.key;
}

export function transition(s: TransitionState, e: TransitionEvent): TransitionState {
  switch (e.type) {
    case 'change':
      if (e.key === targetKey(s)) return s;
      if (e.reduced) return { phase: 'idle', key: e.key };
      if (s.phase === 'idle') return { phase: 'off', from: s.key, to: e.key };
      return { phase: 'on', key: e.key }; // mid-transition: jump to the latest screen
    case 'offDone':
      return s.phase === 'off' ? { phase: 'on', key: s.to } : s;
    case 'onDone':
      return s.phase === 'on' ? { phase: 'idle', key: s.key } : s;
    case 'timeout':
      if (s.phase === 'off') return { phase: 'on', key: s.to };
      if (s.phase === 'on') return { phase: 'idle', key: s.key };
      return s;
  }
}
