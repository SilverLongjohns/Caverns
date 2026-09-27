export const GLITCH_MS = 400;
const GLITCH_MIN = 8000;
const GLITCH_MAX = 15000;

/** Delay before a console's next glitch line: 8-15s. */
export function nextGlitchDelay(rand: () => number = Math.random): number {
  const r = rand();
  const t = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  return Math.round(GLITCH_MIN + t * (GLITCH_MAX - GLITCH_MIN));
}
