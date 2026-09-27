// CRT power transition between menu screens. Pure: the component renders what this says.
export const POWER_OFF_MS = 220;
export const POWER_ON_MS = 280;
export const TRANSITION_WATCHDOG_MS = 600;

export type TransitionState =
  | { phase: 'idle'; key: string }
  | { phase: 'off'; from: string; to: string; toEmpty?: boolean }
  | { phase: 'on'; key: string };

export type TransitionEvent =
  /** fromEmpty/toEmpty: the outgoing/incoming screen renders nothing, so there is nothing to animate. */
  | { type: 'change'; key: string; reduced: boolean; fromEmpty?: boolean; toEmpty?: boolean }
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
      if (s.phase !== 'idle') return e.toEmpty ? { phase: 'idle', key: e.key } : { phase: 'on', key: e.key }; // mid-transition: jump to the latest
      if (e.fromEmpty) return { phase: 'on', key: e.key };
      return e.toEmpty ? { phase: 'off', from: s.key, to: e.key, toEmpty: true } : { phase: 'off', from: s.key, to: e.key };
    case 'offDone':
      if (s.phase !== 'off') return s;
      return s.toEmpty ? { phase: 'idle', key: s.to } : { phase: 'on', key: s.to };
    case 'onDone':
      return s.phase === 'on' ? { phase: 'idle', key: s.key } : s;
    case 'timeout':
      if (s.phase === 'off') return s.toEmpty ? { phase: 'idle', key: s.to } : { phase: 'on', key: s.to };
      if (s.phase === 'on') return { phase: 'idle', key: s.key };
      return s;
  }
}
