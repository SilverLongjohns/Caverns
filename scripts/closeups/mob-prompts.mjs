// Build PixelLab prompts for mob close-up sprites from the data: node scripts/closeups/mob-prompts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const pool = JSON.parse(readFileSync('shared/src/data/mobPool.json', 'utf8'));
const RAW = 'https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/sprites/glyphs/mobs/';
const out = pool.map((m) => ({
  id: m.id,
  biome: m.biomes[0],
  ref: `${RAW}${m.id}.png`,
  prompt: `the SAME creature as the reference image — identical shape and colours — ${m.name}, ${m.description} — full-body, head to feet, small in frame, side view facing left, menacing ready stance, no text, no letters, no symbols written`,
}));
mkdirSync('art/closeups', { recursive: true });
writeFileSync('art/closeups/mob-prompts.json', JSON.stringify(out, null, 1));
console.log(`${out.length} prompts`, Object.entries(out.reduce((a, m) => ({ ...a, [m.biome]: (a[m.biome] ?? 0) + 1 }), {})));
