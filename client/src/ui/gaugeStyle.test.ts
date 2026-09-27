import { describe, it, expect } from 'vitest';
import { gaugeStyle } from './gaugeStyle.js';

describe('gaugeStyle', () => {
  it('computes percentage', () => {
    expect(gaugeStyle(25, 50, 'hp').pct).toBe(50);
  });

  it('shifts hp colour at 50% and 25%', () => {
    expect(gaugeStyle(40, 50, 'hp').color).toBe('var(--relic-hp-high)');
    expect(gaugeStyle(25, 50, 'hp').color).toBe('var(--relic-hp-mid)');
    expect(gaugeStyle(12, 50, 'hp').color).toBe('var(--relic-hp-low)');
  });

  it('uses fixed colours for xp and resource', () => {
    expect(gaugeStyle(1, 10, 'xp').color).toBe('var(--relic-xp)');
    expect(gaugeStyle(1, 10, 'resource').color).toBe('var(--relic-resource)');
  });

  it('clamps and never returns NaN', () => {
    expect(gaugeStyle(60, 50, 'hp').pct).toBe(100);
    expect(gaugeStyle(-5, 50, 'hp').pct).toBe(0);
    expect(gaugeStyle(10, 0, 'hp').pct).toBe(0);
    expect(gaugeStyle(Number.NaN, 50, 'hp').pct).toBe(0);
    expect(gaugeStyle(10, Number.NaN, 'xp').pct).toBe(0);
  });
});
