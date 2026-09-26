import { SANDBOX_PRESETS, buildSandboxQuery, type SandboxOverrides } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import type { SandboxRequest } from '../sandbox/sandboxMode.js';

interface SandboxBarProps {
  request: SandboxRequest;
  onRestart: () => void;
}

export function SandboxBar({ request, onRestart }: SandboxBarProps) {
  const error = useGameStore((s) => s.sandboxError);
  const preset = SANDBOX_PRESETS.find((p) => p.id === request.preset);
  const seed = request.overrides.seed ?? preset?.seed;
  const go = (presetId: string, overrides: SandboxOverrides) => {
    window.location.search = buildSandboxQuery(presetId, overrides);
  };

  return (
    <div className="sandbox-bar">
      <span className="sandbox-bar-tag">SANDBOX</span>
      <select value={request.preset} onChange={(e) => go(e.target.value, {})}>
        {!preset && <option value={request.preset}>{request.preset}</option>}
        {SANDBOX_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <span className="sandbox-bar-seed">seed {seed ?? 'random'}</span>
      <button onClick={onRestart}>Restart</button>
      <button onClick={() => go(request.preset, { ...request.overrides, seed: Math.floor(Math.random() * 1_000_000) })}>New seed</button>
      {error && <span className="sandbox-bar-error">{error}</span>}
    </div>
  );
}
