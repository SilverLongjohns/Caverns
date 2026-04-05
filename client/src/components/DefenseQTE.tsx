import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { QTE_CONFIG, type DamageReduction } from '@caverns/shared';

interface DefenseQTEProps {
  initiative: number;
  onComplete: (reduction: DamageReduction) => void;
}

function getReductionForRatio(ratio: number): { label: string; reduction: DamageReduction } {
  const { perfect, good, graze } = QTE_CONFIG.defense;
  if (ratio >= perfect.min && ratio <= perfect.max) return { label: 'PERFECT BLOCK 75%', reduction: 0.75 };
  if (ratio >= good.min && ratio <= good.max) return { label: 'GOOD BLOCK 50%', reduction: 0.5 };
  if (ratio >= graze.min && ratio <= graze.max) return { label: 'GRAZE 25%', reduction: 0.25 };
  return { label: 'MISS', reduction: 0 };
}

export const DefenseQTE = memo(function DefenseQTE({ initiative, onComplete }: DefenseQTEProps) {
  const [result, setResult] = useState<{ label: string; reduction: DamageReduction } | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const scaleRef = useRef(3.0);
  const outerRef = useRef<HTMLDivElement>(null);
  const durationMs = QTE_CONFIG.defense.baseDurationMs + initiative * QTE_CONFIG.defense.initBonusMs;
  const completedRef = useRef(false);
  const innerSize = 50;

  const handleClick = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    cancelAnimationFrame(animRef.current);
    const res = getReductionForRatio(scaleRef.current);
    setResult(res);
    setTimeout(() => onComplete(res.reduction), 500);
  }, [onComplete]);

  useEffect(() => {
    startTimeRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(elapsed / durationMs, 1);
      const scale = 3.0 * (1 - progress);
      scaleRef.current = scale;

      // Direct DOM update — scale circle via GPU-composited transform (no layout trigger)
      if (outerRef.current) {
        outerRef.current.style.transform = `translate(-50%, -50%) scale(${scale / 3})`;
      }

      if (progress >= 1) {
        if (!completedRef.current) {
          completedRef.current = true;
          setResult({ label: 'MISS', reduction: 0 });
          setTimeout(() => onComplete(0), 500);
        }
        return;
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [durationMs, onComplete, innerSize]);

  return (
    <div className="qte-overlay" onClick={handleClick}>
      <div className="qte-content">
        <div className="qte-label">Brace for impact...</div>
        <div className="qte-circle-container">
          <div className="qte-inner-circle" style={{ width: innerSize, height: innerSize }} />
          <div
            ref={outerRef}
            className="qte-outer-circle"
            style={{ width: innerSize * 3, height: innerSize * 3, transform: 'translate(-50%, -50%) scale(1)' }}
          />
        </div>
        {result && (
          <div className={`qte-result qte-result-${result.reduction > 0 ? 'green' : 'red'}`}>
            {result.label}
          </div>
        )}
      </div>
    </div>
  );
});
