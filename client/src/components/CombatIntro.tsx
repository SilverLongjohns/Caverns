import { useState, useEffect } from 'react';

interface CombatIntroProps {
  enemyNames: string[];
}

export function CombatIntro({ enemyNames }: CombatIntroProps) {
  const [phase, setPhase] = useState<'static' | 'title' | 'enemies' | 'fadeout'>('static');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('title'), 300);
    const t2 = setTimeout(() => setPhase('enemies'), 1000);
    const t3 = setTimeout(() => setPhase('fadeout'), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Deduplicate enemy names with counts
  const nameCounts = new Map<string, number>();
  for (const name of enemyNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const enemyList = [...nameCounts.entries()].map(([name, count]) =>
    count > 1 ? `${name} x${count}` : name
  );

  return (
    <div className={`combat-intro ${phase === 'fadeout' ? 'combat-intro-fadeout' : ''}`}>
      <div className="combat-intro-static" />
      {(phase === 'title' || phase === 'enemies' || phase === 'fadeout') && (
        <div className="combat-intro-title">ENCOUNTER</div>
      )}
      {(phase === 'enemies' || phase === 'fadeout') && (
        <div className="combat-intro-enemies">
          {enemyList.map((entry, i) => (
            <div key={i} className="combat-intro-enemy-name">{entry}</div>
          ))}
        </div>
      )}
      <div className="combat-intro-scanlines" />
    </div>
  );
}
