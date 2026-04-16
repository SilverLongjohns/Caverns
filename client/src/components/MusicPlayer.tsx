import { useRef, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'caverns_music_volume';
const TRACK_URL = '/audio/gasket_maples.mp3';

function loadVolume(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return parseFloat(saved);
  } catch { /* ignore */ }
  return 0.3;
}

export function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio(TRACK_URL);
    audio.loop = true;
    audio.volume = loadVolume();
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
    try { localStorage.setItem(STORAGE_KEY, String(volume)); } catch { /* ignore */ }
  }, [volume, muted]);

  // Start playback on first user interaction (browsers block autoplay)
  const ensureStarted = useCallback(() => {
    if (!started && audioRef.current) {
      audioRef.current.play().catch(() => {});
      setStarted(true);
    }
  }, [started]);

  useEffect(() => {
    document.addEventListener('click', ensureStarted, { once: true });
    document.addEventListener('keydown', ensureStarted, { once: true });
    return () => {
      document.removeEventListener('click', ensureStarted);
      document.removeEventListener('keydown', ensureStarted);
    };
  }, [ensureStarted]);

  return (
    <div className="music-player">
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
