import { useEffect, useState, type CSSProperties } from 'react';
import { CLOSE_UP_CONFIG } from '@caverns/shared';
import { useCloseUpStore } from '../combat/closeUpStore.js';
import { stageFor, type StageActor } from '../combat/closeUpStage.js';
import { audioEngine } from '../audio/audioEngine.js';
import { prefersReducedMotion } from '../ui/motion.js';

function Figure({ a, i }: { a: StageActor; i: number }) {
  const [idx, setIdx] = useState(0);
  const src = a.art[Math.min(idx, a.art.length - 1)];
  return (
    <div className={`closeup-fig closeup-fig--${a.side}${a.isActor ? ' closeup-fig--actor' : ''}${a.downed ? ' closeup-fig--downed' : ''}`} style={{ '--i': i } as CSSProperties}>
      {src && <img src={src} alt="" draggable={false} onError={() => setIdx((n) => n + 1)} />}
    </div>
  );
}

export function CloseUpOverlay() {
  const current = useCloseUpStore((s) => s.current);
  const skip = useCloseUpStore((s) => s.skip);

  useEffect(() => {
    if (!current) return;
    const stage = stageFor(current);
    const t = window.setTimeout(() => audioEngine.playUi(stage.sound), current.closeUp.durationMs * CLOSE_UP_CONFIG.impactAt);
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); skip(); };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, { capture: true }); };
  }, [current, skip]);

  if (!current) return null;
  const stage = stageFor(current);
  const reduced = prefersReducedMotion();
  const style = { '--closeup-dur': `${current.closeUp.durationMs}ms`, '--closeup-band': stage.band } as CSSProperties;

  return (
    <div key={current.id} className={`closeup closeup--${stage.layout} closeup--${stage.tone}${reduced ? ' closeup--still' : ''}`}
      style={style} onPointerDown={(e) => { e.preventDefault(); skip(); }} role="presentation">
      <div className="closeup__dim" />
      <div className="closeup__band">
        <div className="closeup__side closeup__side--left">{stage.left.map((a, i) => <Figure key={a.id} a={a} i={i} />)}</div>
        <div className="closeup__side closeup__side--right">
          {stage.right.map((a, i) => <Figure key={a.id} a={a} i={i} />)}
          {stage.extra > 0 && <div className="closeup__extra">+{stage.extra}</div>}
        </div>
      </div>
      <div className="closeup__flash" />
      <div className="closeup__title">{stage.title}</div>
      {(stage.number || stage.subtitle) && (
        <div className={`closeup__number${stage.number?.kind === 'heal' ? ' closeup__number--heal' : ''}`}>
          {stage.number && <span>{stage.number.kind === 'heal' ? '+' : ''}{stage.number.value}</span>}
          {stage.subtitle && <span className="closeup__subtitle">{stage.subtitle}</span>}
        </div>
      )}
    </div>
  );
}
