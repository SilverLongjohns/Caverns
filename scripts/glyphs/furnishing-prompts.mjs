#!/usr/bin/env node
// Builds PixelLab prompts for furnishing glyph sprites from the data file.
// Never hand-write per-item prompts — this script is the only place prompts are composed.
//
// Usage: node scripts/glyphs/furnishing-prompts.mjs
// Prints a JSON array of { id, name, biome, prompt } to stdout.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, '../../server/src/data/furnishingData.json');

const furnishings = JSON.parse(readFileSync(dataPath, 'utf8'));

function buildPrompt(name, biome) {
  return `${name}, a piece of cave furniture from the ${biome} caverns, strange post-collapse relic-tech, multi-colour pixel-art game object, top-down 3/4 view, isolated on transparent background, no floor`;
}

const prompts = furnishings.map(({ id, name, biomes }) => {
  const biome = biomes[0];
  return { id, name, biome, prompt: buildPrompt(name, biome) };
});

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(prompts, null, 2));
}

export { prompts, buildPrompt };
