import type { CSSProperties } from 'react';
import { gaugeStyle, type GaugeKind } from '../../ui/gaugeStyle.js';

interface GaugeProps {
  value: number;
  max: number;
  kind: GaugeKind;
  text?: string;
  size?: 'md' | 'sm';
}

export function Gauge({ value, max, kind, text, size = 'md' }: GaugeProps) {
  const { pct, color } = gaugeStyle(value, max, kind);
  const fill = { width: `${pct}%`, '--gauge-color': color } as CSSProperties;
  return (
    <div className={`relic-gauge relic-gauge--${kind} relic-gauge--${size}`}>
      <div className="relic-gauge__fill" style={fill} />
      <span className="relic-gauge__text">{text ?? `${value} / ${max}`}</span>
    </div>
  );
}
