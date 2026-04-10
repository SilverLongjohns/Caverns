import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { LOG_COLORS_CONFIG } from '../uiconfig/logColors.js';

const LOG_COLORS: Record<string, string> = { ...LOG_COLORS_CONFIG };

const RARITY_PATTERN = /\{(common|uncommon|rare|legendary|unique):([^}]+)\}/g;

function renderLine(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  RARITY_PATTERN.lastIndex = 0;
  while ((match = RARITY_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className={`rarity-${match[1]}`}>{match[2]}</span>
    );
    lastIndex = RARITY_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

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
            <div key={i}>{line ? renderLine(line) : '\u00A0'}</div>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
