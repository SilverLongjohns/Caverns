// Whether the cold open should play. It plays on every page load.

export interface IntroEnv { search: string; reducedMotion: boolean }

export function parseStill(search: string): number | null {
  const v = new URLSearchParams(search).get('still');
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The `?still=<t>` tooling mode (renders one frame, exposes window.__intro). Enabled only in dev
 * builds or alongside `?intro`, which scripts/intro-render.mjs always passes.
 */
export function stillTime(search: string, dev: boolean): number | null {
  if (!dev && !new URLSearchParams(search).has('intro')) return null;
  return parseStill(search);
}

export function shouldPlayIntro(env: IntroEnv): boolean {
  const params = new URLSearchParams(env.search);
  if (params.has('sandbox')) return false;
  if (params.has('intro')) return true;
  return !env.reducedMotion;
}

export function readIntroEnv(): IntroEnv {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browsers */ }
  return { search: window.location.search, reducedMotion };
}
