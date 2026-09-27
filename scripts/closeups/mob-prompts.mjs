// Build PixelLab prompts for mob close-up sprites from the data: node scripts/closeups/mob-prompts.mjs
// Style: "Qud-weird" (user choice 2026-09-27) — each mob reimagined as a strange post-collapse mutant, with a
// per-biome flavour (user: fungal should drop the crystal/tech look). Optional per-mob art notes live in
// art/closeups/mob-prompt-notes.json ({ "<mob id>": "extra direction" }) — data, not code.
// The mob's board sprite is the identity reference (body plan/silhouette); a class portrait is the style reference.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
const pool = JSON.parse(readFileSync('shared/src/data/mobPool.json', 'utf8'));
const notesPath = 'art/closeups/mob-prompt-notes.json';
const notes = existsSync(notesPath) ? JSON.parse(readFileSync(notesPath, 'utf8')) : {};
const RAW = 'https://raw.githubusercontent.com/SilverLongjohns/Caverns/main/client/public/';
const STYLE_REF = `${RAW}portraits/junk_prophet.png`;
const BIOME_STYLE = {
  starter: 'grafted relic machine parts, crystalline growths, glowing teal veins or lenses, rust and salt-crusted',
  fungal: 'overgrown with bioluminescent fungus, bracket mushrooms, dripping mycelium threads and spore sacs, rot and damp decay, organic and uncanny — no crystals, little or no machinery',
  crystal: 'grafted relic machine parts, crystalline growths, glowing teal veins or lenses, rust and salt-crusted',
  flooded: 'slick drowned flesh, barnacles, kelp and brine-corroded relic salvage, bioluminescent lures, pale deep-sea horror',
  bone: 'bleached bone, grave-wax and ossified growths, cracked reliquary metal, cold pale fire, necrotic and ancient',
  volcanic: 'cooling slag and obsidian, glowing magma seams, soot and scorched forge-relic metal, heat shimmer',
};
const out = pool.map((m) => {
  const biome = m.biomes[0];
  const note = notes[m.id] ? ` ${notes[m.id]}.` : '';
  return {
    id: m.id,
    biome,
    ref: `${RAW}sprites/glyphs/mobs/${m.id}.png`,
    styleRef: STYLE_REF,
    prompt: `${m.name}: ${m.description}${note} Same body plan as the reference creature, but a strange Caves-of-Qud-style mutant of a post-collapse world: ${BIOME_STYLE[biome] ?? BIOME_STYLE.starter} — full-body, small in frame, side view facing left, menacing ready stance, isolated with no ground or floor, no text, no letters, no symbols written`,
  };
});
mkdirSync('art/closeups', { recursive: true });
writeFileSync('art/closeups/mob-prompts.json', JSON.stringify(out, null, 1));
console.log(`${out.length} prompts`, Object.entries(out.reduce((a, m) => ({ ...a, [m.biome]: (a[m.biome] ?? 0) + 1 }), {})));
