/**
 * Mulberry32 PRNG — returns a function that produces deterministic
 * floats in [0, 1) from a 32-bit seed. Falls back to Math.random
 * when no seed is given.
 */
export function createRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;

  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
