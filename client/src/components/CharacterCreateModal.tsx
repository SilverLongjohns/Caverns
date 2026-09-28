import { useMemo, useState } from 'react';
import {
  CLASS_DEFINITIONS,
  CLASS_STARTER_ITEMS,
  CHARACTER_CREATION_CONFIG,
  emptyStatPoints,
  PROGRESSION_CONFIG,
} from '@caverns/shared';
import type { StatPoints } from '@caverns/shared';
import { MenuConsole } from './menu/index.js';
import { RelicButton, ItemIcon } from './relic/index.js';
import { getClassPortrait } from '../classPortraits.js';

interface Props {
  onCreate: (name: string, className: string, statPoints: StatPoints) => void;
  onCancel: () => void;
}

export function CharacterCreateModal({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [className, setClassName] = useState(CLASS_DEFINITIONS[0]?.id ?? 'vanguard');
  const [points, setPoints] = useState<StatPoints>(() => emptyStatPoints());

  const spent = useMemo(
    () => Object.values(points).reduce((sum, n) => sum + n, 0),
    [points],
  );
  const remaining = CHARACTER_CREATION_CONFIG.pointBudget - spent;

  const statDefs = useMemo(
    () =>
      PROGRESSION_CONFIG.statDefinitions.filter((d) =>
        CHARACTER_CREATION_CONFIG.statIds.includes(d.id),
      ),
    [],
  );

  const classDef = CLASS_DEFINITIONS.find((c) => c.id === className);
  const starterItems = CLASS_STARTER_ITEMS[className];

  const adjust = (id: string, delta: number): void => {
    setPoints((prev) => {
      const current = prev[id] ?? 0;
      const next = current + delta;
      if (next < CHARACTER_CREATION_CONFIG.perStatMin) return prev;
      if (next > CHARACTER_CREATION_CONFIG.perStatMax) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      return { ...prev, [id]: next };
    });
  };

  const canCreate = name.trim().length > 0;

  return (
    <MenuConsole
      title="New Character"
      width="860px"
      footer={
        <div className="char-create-footer">
          <RelicButton className="char-create-submit" hot onClick={() => onCreate(name.trim(), className, points)} disabled={!canCreate}>
            Create
          </RelicButton>
          <RelicButton onClick={onCancel}>Cancel</RelicButton>
        </div>
      }
    >
      <div className="char-create-modal">
        <aside className="char-create-portrait-col">
          <div className="char-create-portrait">
            {(() => {
              const src = getClassPortrait(className);
              return src ? <img src={src} alt={classDef?.displayName ?? className} /> : <span className="relic-socket__glyph">☉</span>;
            })()}
          </div>
          <input autoFocus className="char-create-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={20} />
        </aside>

        <section className="char-create-class-col">
          <div className="char-create-class-tabs">
            {CLASS_DEFINITIONS.map((c) => (
              <RelicButton key={c.id} size="sm" hot={className === c.id} className="char-create-class-tab" onClick={() => setClassName(c.id)}>
                {c.displayName}
              </RelicButton>
            ))}
          </div>
          {classDef && (
            <>
              <p className="char-create-class-desc">{classDef.description}</p>
              <div className="char-create-loadout">
                <h4>Starting Gear</h4>
                {starterItems ? (
                  <div className="char-create-gear">
                    <div className="char-create-gear-row"><ItemIcon item={starterItems.weapon} /><span>{starterItems.weapon.name}</span></div>
                    <div className="char-create-gear-row"><ItemIcon item={starterItems.offhand} /><span>{starterItems.offhand.name}</span></div>
                    <div className="char-create-gear-row"><ItemIcon item={starterItems.ranged} /><span>{starterItems.ranged.name}</span></div>
                  </div>
                ) : (
                  <p>—</p>
                )}
              </div>
              <div className="char-create-abilities">
                <h4>Abilities</h4>
                <ul>
                  {classDef.abilities.map((a) => (
                    <li key={a.id}><strong>{a.name}</strong> — {a.description}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        <aside className="char-create-stats-col">
          <div className="char-create-points-header">Points: {remaining} / {CHARACTER_CREATION_CONFIG.pointBudget}</div>
          <div className="char-create-stats">
            {statDefs.map((def) => (
              <div key={def.id} className="char-create-stat-row">
                <span className="char-create-stat-name">{def.displayName}</span>
                <RelicButton size="sm" onClick={() => adjust(def.id, -1)}>−</RelicButton>
                <span className="char-create-stat-value">{points[def.id] ?? 0}</span>
                <RelicButton size="sm" onClick={() => adjust(def.id, +1)}>+</RelicButton>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </MenuConsole>
  );
}
