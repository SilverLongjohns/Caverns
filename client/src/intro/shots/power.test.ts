import { describe, it, expect } from 'vitest';
import { powerState } from './power.js';

describe('powerState', () => {
  it('starts as a dot, becomes a line, then opens the tube', () => {
    expect(powerState(0.03).line).toBe(0);
    expect(powerState(0.03).dot).toBeGreaterThan(0);
    expect(powerState(0.2).line).toBeGreaterThan(0.5);
    expect(powerState(0.2).open).toBe(0);
    expect(powerState(0.6).open).toBeGreaterThan(0.95);
  });
  it('snow, barrel and roll are finished by the time the Waste shot starts', () => {
    const s = powerState(1.6);
    expect(s.snow).toBe(0);
    expect(s.barrel).toBeCloseTo(0, 5);
    expect(s.roll).toBe(1);
  });
  it('overbright decays after the snap', () => {
    expect(powerState(0.26).over).toBeGreaterThan(powerState(0.5).over);
  });
});
