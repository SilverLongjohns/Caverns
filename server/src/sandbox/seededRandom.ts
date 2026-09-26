/**
 * Replace Math.random with a seeded mulberry32 generator. Process-wide, so this is
 * only acceptable in dev sandbox/simulator runs; call the returned restore() on teardown.
 *
 * Supports overlapping installs (e.g. two dev sandbox tabs each seeding their own fight):
 * installs form a stack, Math.random always delegates to the top install's generator (or
 * the true original when the stack is empty), and restore() removes that particular
 * install from the stack wherever it sits, idempotently.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let trueOriginal: (() => number) | null = null;
const stack: Array<() => number> = [];

function repoint(): void {
  Math.random = stack.length > 0 ? stack[stack.length - 1] : trueOriginal!;
}

export function installSeededRandom(seed: number): () => void {
  if (trueOriginal === null) trueOriginal = Math.random;
  const generator = mulberry32(seed);
  stack.push(generator);
  repoint();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const i = stack.indexOf(generator);
    if (i !== -1) stack.splice(i, 1);
    repoint();
  };
}
