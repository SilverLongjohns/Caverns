import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { QTE_CONFIG, type CritMultiplier } from '@caverns/shared';

interface AttackQTEProps {
  initiative: number;
  onComplete: (multiplier: CritMultiplier) => void;
}

function getZoneForPosition(position: number): { name: string; multiplier: CritMultiplier } {
  for (const zone of QTE_CONFIG.attack.zones) {
    if (position >= zone.start && position < zone.end) {
      return { name: zone.name, multiplier: zone.multiplier as CritMultiplier };
    }
  }
  return { name: 'red', multiplier: 0.75 };
}

function getZoneLabel(name: string): string {
  if (name === 'perfect') return 'PERFECT 2x';
  if (name === 'green') return 'CRIT 1.5x';
  if (name === 'red') return 'MISS 0.75x';
  return '';
}

// Ease-in-out: accelerates into the perfect zone, decelerates after
// Uses a smoothstep curve so the cursor is fastest around the sweet spot
function easePosition(t: number): number {
  return t * t * (3 - 2 * t);
}

export const AttackQTE = memo(function AttackQTE({ initiative, onComplete }: AttackQTEProps) {
  const [result, setResult] = useState<{ name: string; multiplier: CritMultiplier } | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const positionRef = useRef(0);
  const cursorRef = useRef<HTMLDivElement>(null);
  const durationMs = QTE_CONFIG.attack.baseDurationMs + initiative * QTE_CONFIG.attack.initBonusMs;
  const completedRef = useRef(false);

  const handleStop = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    cancelAnimationFrame(animRef.current);
    const zone = getZoneForPosition(positionRef.current);
    setResult(zone);
    setTimeout(() => onComplete(zone.multiplier), 500);
  }, [onComplete]);

  useEffect(() => {
    startTimeRef.current = performance.now();
    // Cache bar width once — avoids forced layout read every frame
    const barWidth = cursorRef.current?.parentElement?.clientWidth ?? 280;
    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / durationMs, 1);
      const position = easePosition(t);
      positionRef.current = position;

      // Single DOM update: move cursor via GPU-composited transform (no layout trigger)
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translateX(${position * barWidth}px)`;
      }

      if (t >= 1) {
        if (!completedRef.current) {
          completedRef.current = true;
          const zone = getZoneForPosition(1);
          setResult(zone);
          setTimeout(() => onComplete(zone.multiplier), 500);
        }
        return;
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [durationMs, onComplete]);

  return (
    <div className="qte-overlay" onClick={handleStop}>
      <div className="qte-content">
        <div className="qte-label">Aim your strike...</div>
        <div className="qte-attack-bar">
          <div className="qte-zone qte-zone-normal" style={{ left: '0%', width: '45%' }} />
          <div className="qte-zone qte-zone-green" style={{ left: '45%', width: '20%' }} />
          <div className="qte-zone qte-zone-perfect" style={{ left: '65%', width: '7%' }} />
          <div className="qte-zone qte-zone-green" style={{ left: '72%', width: '10%' }} />
          <div className="qte-zone qte-zone-red" style={{ left: '82%', width: '18%' }} />
          <div ref={cursorRef} className="qte-cursor-line" style={{ left: 0 }} />
        </div>
        {result && (
          <div className={`qte-result qte-result-${result.name}`}>
            {getZoneLabel(result.name)}
          </div>
        )}
      </div>
    </div>
  );
});
