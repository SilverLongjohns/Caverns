import { useEffect, useState, useSyncExternalStore } from 'react';
import { audioEngine } from '../audio/audioEngine.js';
import { pickTrack } from '../audio/musicTrack.js';
import { useGameStore, selectCurrentView } from '../store/gameStore.js';
import { useIntroStore } from '../intro/introStore.js';

const STORAGE_KEY = 'caverns_music_volume';

function loadVolume(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return parseFloat(saved);
  } catch { /* ignore */ }
  return 0.3;
}

export function MusicPlayer() {
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const view = useGameStore(selectCurrentView);
  const hold = useIntroStore((s) => s.musicHold);
  const introActive = useIntroStore((s) => s.active);
  const unlocked = useSyncExternalStore(audioEngine.subscribe, audioEngine.getUnlocked);

  useEffect(() => {
    audioEngine.setVolume(volume, muted);
    try { localStorage.setItem(STORAGE_KEY, String(volume)); } catch { /* ignore */ }
  }, [volume, muted]);

  // Browsers block audio until a gesture. The intro unlocks on its own gate; otherwise the first click/key does.
  useEffect(() => {
    const unlock = () => { void audioEngine.unlock(); };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (unlocked) audioEngine.setTrack(pickTrack(view, hold));
  }, [unlocked, view, hold]);

  return (
    <div className={`music-player${introActive ? ' music-player--hidden' : ''}`}>
      <button
        className="music-mute-btn"
        onClick={() => setMuted((m) => !m)}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '♪✕' : '♪'}
      </button>
      <input
        type="range"
        className="music-volume-slider"
        min="0"
        max="1"
        step="0.05"
        value={muted ? 0 : volume}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setVolume(v);
          if (muted && v > 0) setMuted(false);
        }}
      />
    </div>
  );
}
