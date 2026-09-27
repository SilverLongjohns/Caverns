// THE DESCENT (13–22 s): a vertical fall through four strata, each boundary landing on a braam.
import { STRATA } from '../timeline.js';

export const DESCENT_T0 = 13;
/** Screen row (low-res px) of the falling figure. */
export const FIG_Y = 90;

/** Camera depth in low-res px after u seconds of falling: accelerating. */
export function fallDepth(u: number): number {
  return 28 * u + 4 * u * u;
}

/** Depth where stratum i begins: its boundary crosses the figure exactly at STRATA[i].t0. */
export function stratumTop(i: number): number {
  return i === 0 ? -Infinity : fallDepth(STRATA[i].t0 - DESCENT_T0) + FIG_Y;
}

export function stratumAtDepth(d: number): number {
  let k = 0;
  for (let i = 1; i < STRATA.length; i++) if (d >= stratumTop(i)) k = i;
  return k;
}
