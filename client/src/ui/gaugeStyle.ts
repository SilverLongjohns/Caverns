export type GaugeKind = 'hp' | 'xp' | 'resource';

/** Fill width (0-100, never NaN) and fill colour (a relic.css token) for a Gauge. */
export function gaugeStyle(value: number, max: number, kind: GaugeKind): { pct: number; color: string } {
  const raw = max > 0 ? (value / max) * 100 : 0;
  const pct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  if (kind === 'xp') return { pct, color: 'var(--relic-xp)' };
  if (kind === 'resource') return { pct, color: 'var(--relic-resource)' };
  const color = pct > 50 ? 'var(--relic-hp-high)' : pct > 25 ? 'var(--relic-hp-mid)' : 'var(--relic-hp-low)';
  return { pct, color };
}
