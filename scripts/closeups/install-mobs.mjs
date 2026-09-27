// Copy approved mob picks (art/closeups/chosen.json keys "mob-<id>" with a "file" under art/closeups/) into
// client/public/closeups/mobs/ and rewrite the client manifest: node scripts/closeups/install-mobs.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
const chosen = JSON.parse(readFileSync('art/closeups/chosen.json', 'utf8'));
const dir = 'client/public/closeups/mobs';
mkdirSync(dir, { recursive: true });
let n = 0;
for (const [key, e] of Object.entries(chosen)) {
  if (!key.startsWith('mob-') || !e.file) continue;
  copyFileSync(`art/closeups/${e.file}`, `${dir}/${key.slice(4)}.png`);
  n++;
}
const ids = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
writeFileSync('client/src/combat/mobCloseUpManifest.ts',
  `// Mob template ids with a close-up PNG in client/public/closeups/mobs/. Written by scripts/closeups/install-mobs.mjs.\nexport const MOB_CLOSE_UPS: readonly string[] = [\n${ids.map((i) => `  '${i}',`).join('\n')}\n];\n`);
console.log(`copied ${n}, manifest has ${ids.length}`);
