import { useEffect, useState, type ReactNode } from 'react';
import { CaveBackground } from '../CaveBackground.js';

const TOWN_BG = '/backgrounds/townbg.png';

function useImageOk(src: string, enabled: boolean): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setOk(true); };
    img.onerror = () => { if (live) setOk(false); };
    img.src = src;
    return () => { live = false; };
  }, [src, enabled]);
  return ok;
}

interface Props {
  backdrop: 'cave' | 'town';
  children: ReactNode;
}

/** Persistent full-bleed backdrop for every pre-dungeon screen. Keeps the intro handoff markup (.lobby-logo, cave glyphs). */
export function MenuShell({ backdrop, children }: Props) {
  const townOk = useImageOk(TOWN_BG, backdrop === 'town');
  const effective = backdrop === 'town' && townOk ? 'town' : 'cave';
  return (
    <div className={`lobby menu-shell menu-shell--${effective}`}>
      {effective === 'cave' ? <CaveBackground /> : <div className="menu-shell__town" aria-hidden="true" />}
      {effective === 'cave' && <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />}
      <div className="menu-shell__content">{children}</div>
    </div>
  );
}
