// Dev-only: audition staged SFX takes, keep the good ones, export picks.json for scripts/sfx_promote.py.
import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audioEngine.js';
import { SFX, SFX_FILES } from '../sfxManifest.js';
import { loadPicks, pendingIds, setReroll, toggleKeep, type Picks } from './picks.js';
import './audition.css';

type Entry = { prompt: string; kind: 'oneshot' | 'bed'; takes: string[] };
type Index = Record<string, Entry>;

const STORE_KEY = 'caverns.sfxPicks';
const STEP_CADENCE_MS = 150;
const buffers = new Map<string, Promise<AudioBuffer>>();

function load(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((d) => audioEngine.context().decodeAudioData(d));
    buffers.set(url, p);
  }
  return p;
}

async function play(url: string, loop = false): Promise<() => void> {
  await audioEngine.unlock();
  const buf = await load(url);
  const ctx = audioEngine.context();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(audioEngine.sfxDestination());
  src.start();
  return () => { try { src.stop(); } catch { /* already stopped */ } };
}

export function AuditionPage() {
  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Picks>(() => {
    try { return loadPicks(localStorage.getItem(STORE_KEY)); } catch { return {}; }
  });
  const stopRef = useRef<(() => void) | null>(null);
  const timerRef = useRef(0);

  useEffect(() => {
    fetch('/audio/_staging/index.json')
      .then((r) => { if (!r.ok) throw new Error(`index.json ${r.status}`); return r.json(); })
      .then(setIndex, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(picks)); } catch { /* storage blocked */ }
  }, [picks]);

  const stopAll = () => {
    window.clearInterval(timerRef.current);
    stopRef.current?.();
    stopRef.current = null;
  };

  /** A bed replaces whatever is playing; a one-shot plays on top, so it can be heard against a looping bed. */
  const playTake = async (url: string, loop: boolean) => {
    if (!loop) { void play(url); return; }
    stopAll();
    stopRef.current = await play(url, true);
  };

  /** Kept takes (or all takes if none kept) round-robin at walking pace, the way the game plays steps. */
  const cadence = (entry: Entry, id: string) => {
    stopAll();
    const kept = picks[id]?.keep.length ? picks[id].keep.map((i) => entry.takes[i]) : entry.takes;
    let last = -1;
    timerRef.current = window.setInterval(() => {
      let i = Math.floor(Math.random() * kept.length);
      if (kept.length > 1 && i === last) i = (i + 1) % kept.length;
      last = i;
      void play(kept[i]);
    }, STEP_CADENCE_MS);
  };

  const exportPicks = () => {
    const blob = new Blob([JSON.stringify(picks, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'picks.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <div className="audition">No staging index ({error}). Run <code>python3 scripts/sfx_stage_index.py</code>.</div>;
  if (!index) return <div className="audition">Loading…</div>;

  const targets = Object.fromEntries(Object.entries(SFX).map(([id, t]) => [id, t.takes]));
  const ids = pendingIds(Object.keys(index), SFX_FILES, targets).filter((id) => index[id].takes.length > 0);
  const done = ids.filter((id) => (picks[id]?.keep.length ?? 0) > 0).length;

  return (
    <div className="audition">
      <header className="audition__bar">
        <h1>SFX audition</h1>
        <span>{done}/{ids.length} curated</span>
        <button onClick={stopAll}>Stop</button>
        <button onClick={exportPicks}>Export picks</button>
      </header>
      {ids.map((id) => {
        const entry = index[id];
        const pick = picks[id];
        return (
          <section key={id} className={`audition__row${pick?.keep.length ? ' audition__row--done' : ''}`}>
            <div className="audition__id">{id} <small>{entry.kind}</small></div>
            <div className="audition__prompt">{entry.prompt}</div>
            <div className="audition__takes">
              {entry.takes.map((url, i) => (
                <span key={url} className="audition__take">
                  <button onClick={() => void playTake(url, entry.kind === 'bed')}>▶ {i + 1}</button>
                  <label>
                    <input type="checkbox" checked={pick?.keep.includes(i) ?? false} onChange={() => setPicks((p) => toggleKeep(p, id, i))} />
                    keep
                  </label>
                </span>
              ))}
              {(id === 'step' || id === 'step_wet') && <button onClick={() => cadence(entry, id)}>walk</button>}
            </div>
            <input
              className="audition__reroll"
              placeholder="re-roll note (leave empty if fine)"
              value={pick?.reroll ?? ''}
              onChange={(e) => setPicks((p) => setReroll(p, id, e.target.value))}
            />
          </section>
        );
      })}
    </div>
  );
}
