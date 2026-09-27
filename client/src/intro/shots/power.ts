// POWER-ON (0–1.6 s): an old analogue set warming up: dot → line → tube snaps open →
// snow, one vertical roll, barrel bulge relaxing into the Waste.
import { clamp, inv, ease } from '../math.js';

export interface PowerState {
  /** 0..1 size of the centre dot. */ dot: number;
  /** 0..1 width of the horizontal line. */ line: number;
  /** 0..1 vertical aperture. */ open: number;
  /** 0..1 overbright wash. */ over: number;
  /** 0..1 static snow mix. */ snow: number;
  /** 0..1 vertical-hold roll progress (1 = settled). */ roll: number;
  /** Barrel distortion strength. */ barrel: number;
  /** Signed degauss wobble. */ wobble: number;
}

export function powerState(t: number): PowerState {
  return {
    dot: t < 0 ? 0 : ease.out2(inv(0, 0.06, t)),
    line: t < 0.06 ? 0 : ease.out3(inv(0.06, 0.25, t)),
    open: t < 0.25 ? 0 : ease.outExpo(inv(0.25, 0.55, t)),
    over: t < 0.25 ? 1 : Math.exp(-(t - 0.25) * 6),
    snow: t < 0.7 ? 1 : clamp(1 - inv(0.7, 1.35, t)),
    roll: ease.inOut(inv(0.72, 1.22, t)),
    barrel: t < 0.25 ? 0.35 : 0.35 * (1 - ease.out3(inv(0.25, 1.6, t))),
    wobble: t < 0.28 || t > 1.0 ? 0 : Math.exp(-(t - 0.28) * 4) * Math.sin(t * 55),
  };
}
