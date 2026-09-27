import { useEffect, useState, type ReactNode } from 'react';
import { RelicPanel } from '../relic/index.js';
import { nextGlitchDelay, GLITCH_MS } from '../../ui/ambient.js';
import { prefersReducedMotion } from '../../ui/motion.js';

interface Props {
  title?: string;
  footer?: ReactNode;
  ambient?: boolean;
  className?: string;
  /** CSS width of the console, e.g. '640px'. Defaults to content width. */
  width?: string;
  children: ReactNode;
}

function useGlitch(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    let t = 0;
    const schedule = () => {
      t = window.setTimeout(() => {
        setOn(true);
        t = window.setTimeout(() => { setOn(false); schedule(); }, GLITCH_MS);
      }, nextGlitchDelay());
    };
    schedule();
    return () => window.clearTimeout(t);
  }, [enabled]);
  return on;
}

export function MenuConsole({ title, footer, ambient = true, className = '', width, children }: Props) {
  const glitch = useGlitch(ambient);
  return (
    <div className={`menu-console${ambient ? ' menu-console--ambient' : ''} ${className}`} style={width ? { width } : undefined}>
      <RelicPanel title={title}>
        <div className="menu-console__body">{children}</div>
        {footer && <div className="menu-console__footer">{footer}</div>}
        {ambient && (
          <>
            <span className="menu-console__lamp menu-console__lamp--l" aria-hidden="true" />
            <span className="menu-console__lamp menu-console__lamp--r" aria-hidden="true" />
            <span className="menu-console__fx" aria-hidden="true">
              <span className="menu-console__scanroll" />
              {glitch && <span className="menu-console__glitch" />}
            </span>
          </>
        )}
      </RelicPanel>
    </div>
  );
}
