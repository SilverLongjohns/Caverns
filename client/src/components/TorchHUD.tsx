import { useGameStore } from '../store/gameStore.js';

export function TorchHUD() {
  const fuel = useGameStore((s) => s.torchFuel);
  const maxFuel = useGameStore((s) => s.torchMaxFuel);

  if (fuel <= 0) return null;

  const pct = fuel / maxFuel;
  const barClass = pct < 0.2 ? 'torch-low' : pct < 0.5 ? 'torch-mid' : 'torch-full';

  return (
    <div className="torch-hud">
      <span className="torch-icon">†</span>
      <div className="torch-bar-bg">
        <div
          className={`torch-bar-fill ${barClass}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
