import { useState } from 'react';
import { CLASS_DEFINITIONS } from '@caverns/shared';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onCreate: (name: string, className: string) => void;
  onCancel: () => void;
}

export function CharacterCreatePanel({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [className, setClassName] = useState(CLASS_DEFINITIONS[0]?.id ?? 'vanguard');

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Create Character</p>
      <div className="char-create">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          maxLength={20}
        />
        <div className="class-selector">
          <p className="lobby-label">Choose your class:</p>
          <div className="class-options">
            {CLASS_DEFINITIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`class-btn ${className === c.id ? 'class-selected' : ''}`}
                onClick={() => setClassName(c.id)}
              >
                <span className="class-name">{c.displayName}</span>
                <span className="class-desc">{c.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="lobby-choose">
          <button
            className="lobby-start"
            onClick={() => onCreate(name.trim(), className)}
            disabled={!name.trim()}
          >
            Create
          </button>
          <button className="lobby-start" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
