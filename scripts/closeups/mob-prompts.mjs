// Build PixelLab prompts for mob close-up sprites from the data: node scripts/closeups/mob-prompts.mjs
// Style: "Qud-weird" (user choice 2026-09-27) — each mob reimagined as a strange post-collapse retro-future mutant.
// The mob's board sprite is the identity reference (body plan/silhouette); a class portrait is the style reference.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const pool = JSON.parse(readFileSync('shared/src/data/mobPool.json', 'utf8'));
const RAW = 'https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/';
const STYLE_REF = `${RAW}portraits/junk_prophet.png`;
const out = pool.map((m) => ({
  id: m.id,
  biome: m.biomes[0],
  ref: `${RAW}sprites/glyphs/mobs/${m.id}.png`,
  styleRef: STYLE_REF,
  prompt: `${m.name}: ${m.description} Same body plan as the reference creature, but a strange Caves-of-Qud-style mutant of a post-collapse retro-future world: grafted relic machine parts, crystalline growths, glowing teal veins or lenses, rust and salt-crusted — full-body, small in frame, side view facing left, menacing ready stance, isolated with no ground or floor, no text, no letters, no symbols written`,
}));
mkdirSync('art/closeups', { recursive: true });
writeFileSync('art/closeups/mob-prompts.json', JSON.stringify(out, null, 1));
console.log(`${out.length} prompts`, Object.entries(out.reduce((a, m) => ({ ...a, [m.biome]: (a[m.biome] ?? 0) + 1 }), {})));
