// Whether the cold open should play, and the "seen" flag. Storage is always try/catch-guarded.

export const SEEN_KEY = 'caverns_intro_seen';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface IntroEnv { storage: StorageLike | null; search: string; reducedMotion: boolean }

export function hasSeenIntro(storage: StorageLike | null): boolean {
  try { return storage?.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function markIntroSeen(storage: StorageLike | null): void {
  try { storage?.setItem(SEEN_KEY, '1'); } catch { /* private mode etc. */ }
}

export function parseStill(search: string): number | null {
  const v = new URLSearchParams(search).get('still');
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function shouldPlayIntro(env: IntroEnv): boolean {
  const params = new URLSearchParams(env.search);
  if (params.has('sandbox')) return false;
  if (params.has('intro')) return true;
  if (env.reducedMotion) return false;
  return !hasSeenIntro(env.storage);
}

export function safeStorage(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

export function readIntroEnv(): IntroEnv {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browsers */ }
  return { storage: safeStorage(), search: window.location.search, reducedMotion };
}
