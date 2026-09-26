import { resolveSetup, SANDBOX_PRESETS, type SandboxOverrides } from '@caverns/shared';
import { simulateFight, type SimResult } from './simulate.js';

const USAGE = `Usage: npm run sim -- <preset> [--seeds N] [--seed S] [--party a,b] [--mobs a,b] [--room R] [--biome B] [--level L]
Presets: ${SANDBOX_PRESETS.map((p) => p.id).join(', ')}`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const preset = args[0];
  if (!preset || preset.startsWith('--')) { console.error(USAGE); return 2; }
  let seeds = 20;
  let startSeed = 1;
  const overrides: SandboxOverrides = {};
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (value === undefined) { console.error(`Missing value for ${flag}\n${USAGE}`); return 2; }
    switch (flag) {
      case '--seeds': {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) { console.error(`--seeds must be a positive integer (got "${value}")\n${USAGE}`); return 2; }
        seeds = n;
        break;
      }
      case '--seed': {
        const n = Number(value);
        if (!Number.isInteger(n)) { console.error(`--seed must be an integer (got "${value}")\n${USAGE}`); return 2; }
        startSeed = n;
        break;
      }
      case '--party': overrides.party = value.split(','); break;
      case '--mobs': overrides.mobs = value.split(','); break;
      case '--room': overrides.room = value; break;
      case '--biome': overrides.biome = value; break;
      case '--level': {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) { console.error(`--level must be a positive integer (got "${value}")\n${USAGE}`); return 2; }
        overrides.level = n;
        break;
      }
      default: console.error(`Unknown option ${flag}\n${USAGE}`); return 2;
    }
  }

  const results: SimResult[] = [];
  for (let n = 0; n < seeds; n++) {
    const r = resolveSetup(preset, { ...overrides, seed: startSeed + n });
    if (!r.ok) { console.error(r.error); return 2; }
    results.push(await simulateFight(r.setup));
  }

  const count = (k: SimResult['result']) => results.filter((r) => r.result === k).length;
  const rounds = results.map((r) => r.rounds);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`${preset} × ${seeds} seeds (from ${startSeed})`);
  console.log(`  victory ${count('victory')} (${Math.round((100 * count('victory')) / seeds)}%) · wipe ${count('wipe')} · timeout ${count('timeout')} · error ${count('error')}`);
  console.log(`  rounds mean ${mean(rounds).toFixed(1)} · min ${Math.min(...rounds)} · max ${Math.max(...rounds)}`);
  const ids = new Set(results.flatMap((r) => Object.keys(r.names)));
  console.log('  per unit (mean dealt / taken):');
  for (const id of ids) {
    const name = results.find((r) => r.names[id])!.names[id];
    const dealt = mean(results.map((r) => r.damageDealt[id] ?? 0));
    const taken = mean(results.map((r) => r.damageTaken[id] ?? 0));
    console.log(`    ${name.padEnd(24)} ${dealt.toFixed(1).padStart(7)} / ${taken.toFixed(1).padStart(7)}`);
  }
  const errors = results.flatMap((r) => r.errors);
  for (const e of errors.slice(0, 5)) console.error(`  error: ${e}`);
  return errors.length > 0 ? 1 : 0;
}

// Exit explicitly: post-combat loot timers would otherwise keep the process alive.
main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
