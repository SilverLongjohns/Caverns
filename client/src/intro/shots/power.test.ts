import { describe, it, expect } from 'vitest';
import { powerState } from './power.js';
import { POWER_END_T } from '../timeline.js';

describe('powerState', () => {
  it('starts as a dot, becomes a line, then opens the tube', () => {
    expect(powerState(0.03).line).toBe(0);
    expect(powerState(0.03).dot).toBeGreaterThan(0);
    expect(powerState(0.2).line).toBeGreaterThan(0.5);
    expect(powerState(0.2).open).toBe(0);
    expect(powerState(0.6).open).toBeGreaterThan(0.95);
  });
  it('snow, barrel and roll are finished (black, settled) by the end of the power-on', () => {
    const s = powerState(POWER_END_T);
    expect(s.snow).toBe(0);
    expect(s.barrel).toBeCloseTo(0, 5);
    expect(s.roll).toBe(1);
  });
  it('snow holds through the roll, then decays steadily into black', () => {
    expect(powerState(0.7).snow).toBe(1);
    expect(powerState(1.0).snow).toBeGreaterThan(powerState(1.3).snow);
    expect(powerState(1.3).snow).toBeGreaterThan(0);
    expect(powerState(1.5).snow).toBe(0);
  });
  it('overbright decays after the snap', () => {
    expect(powerState(0.26).over).toBeGreaterThan(powerState(0.5).over);
  });
});
