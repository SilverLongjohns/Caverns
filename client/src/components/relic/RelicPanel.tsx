import { useEffect, useState, type ReactNode } from 'react';
import { RELIC_FRAME_SRC } from '../../ui/iconPaths.js';

// Probe the bezel once per page load; if it can't load, panels fall back to a CSS double border.
let frameProbe: Promise<boolean> | null = null;
function probeFrame(): Promise<boolean> {
  frameProbe ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = RELIC_FRAME_SRC;
  });
  return frameProbe;
}

interface RelicPanelProps {
  title?: string;
  glow?: boolean;
  className?: string;
  children: ReactNode;
}

export function RelicPanel({ title, glow = true, className = '', children }: RelicPanelProps) {
  const [frameOk, setFrameOk] = useState(true);
  useEffect(() => {
    let live = true;
    void probeFrame().then((ok) => { if (live) setFrameOk(ok); });
    return () => { live = false; };
  }, []);

  return (
    <section className={`relic-panel${frameOk ? '' : ' relic-panel--fallback'} ${className}`}>
      {title && <div className="relic-panel__title">{title}</div>}
      <div className="relic-panel__screen">{children}</div>
      {glow && <div className="relic-panel__glow" aria-hidden="true" />}
    </section>
  );
}
