import { useEffect, useLayoutEffect, useReducer, useRef, type AnimationEvent, type MouseEvent, type ReactNode } from 'react';
import { transition, initialTransition, displayKey, targetKey, TRANSITION_WATCHDOG_MS } from '../../ui/screenTransition.js';
import { prefersReducedMotion } from '../../ui/motion.js';
import { audioEngine } from '../../audio/audioEngine.js';

interface Props {
  screenKey: string;
  children: ReactNode;
  className?: string;
  /** Called when the wrapper itself (not the console) is clicked, e.g. to close a panel. */
  onBackdropClick?: () => void;
  /** Reports the key whose content is on screen (it lags `screenKey` while the old screen powers off). */
  onDisplayKeyChange?: (key: string) => void;
}

/**
 * Powers the outgoing console off and the incoming one on when `screenKey` changes.
 * The outgoing content is the last committed render for its key (a ref written only in a layout
 * effect and read during the off phase), because its source state is usually gone by then.
 */
export function ScreenTransition({ screenKey, children, className = '', onBackdropClick, onDisplayKeyChange }: Props) {
  const [state, dispatch] = useReducer(transition, screenKey, initialTransition);
  const committed = useRef<{ key: string; node: ReactNode }>({ key: screenKey, node: children });

  useLayoutEffect(() => {
    if (screenKey === targetKey(state)) return;
    const reduced = prefersReducedMotion();
    if (!reduced) audioEngine.playUi('power');
    const isEmpty = (n: ReactNode) => n == null || n === false;
    dispatch({ type: 'change', key: screenKey, reduced, fromEmpty: isEmpty(committed.current.node), toEmpty: isEmpty(children) });
  }, [screenKey, state]);

  useLayoutEffect(() => {
    if (displayKey(state) === screenKey) committed.current = { key: screenKey, node: children };
  });

  const shownKey = displayKey(state);
  useLayoutEffect(() => {
    onDisplayKeyChange?.(shownKey);
  }, [shownKey, onDisplayKeyChange]);

  useEffect(() => {
    if (state.phase === 'idle') return;
    const t = window.setTimeout(() => dispatch({ type: 'timeout' }), TRANSITION_WATCHDOG_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore glitch/lamp/cursor animations bubbling up
    dispatch({ type: state.phase === 'off' ? 'offDone' : 'onDone' });
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (onBackdropClick && e.target === e.currentTarget) onBackdropClick();
  };

  const showing = displayKey(state) === screenKey ? children : committed.current.node;
  const empty = showing == null || showing === false;
  // Powering off towards nothing (a panel closing): let clicks fall through to what's underneath.
  const closing = state.phase === 'off' && (children == null || children === false);
  return (
    <div className={`screen-transition ${className}`} data-empty={empty} data-closing={closing} onClick={onClick}>
      {!empty && (
        <div className={`screen-transition__body screen-transition__body--${state.phase}`} onAnimationEnd={onAnimationEnd}>
          {showing}
        </div>
      )}
    </div>
  );
}
