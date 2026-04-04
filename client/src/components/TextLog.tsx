import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';

const LOG_COLORS: Record<string, string> = {
  narration: '#e0e0e0',
  combat: '#ff6b6b',
  loot: '#ffd93d',
  system: '#888',
};

export function TextLog() {
  const textLog = useGameStore((s) => s.textLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [textLog]);

  return (
    <div className="text-log">
      {textLog.map((entry) => (
        <div
          key={entry.id}
          className="log-entry"
          style={{ color: LOG_COLORS[entry.logType] ?? '#e0e0e0' }}
        >
          {entry.message.split('\n').map((line, i) => (
            <div key={i}>{line || '\u00A0'}</div>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
