/** The part of `text` visible `elapsedMs` into typing at `cps` characters/second. Slices by code point. */
export function typedSlice(text: string, elapsedMs: number, cps: number): string {
  if (!(elapsedMs > 0) || !(cps > 0)) return '';
  const chars = Array.from(text);
  const n = Math.min(chars.length, Math.floor((elapsedMs * cps) / 1000));
  return chars.slice(0, n).join('');
}
