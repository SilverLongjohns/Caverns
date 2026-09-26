// Drive a sandbox fight in headless Edge: node scripts/sandbox-drive.mjs "<preset>[?query]" [steps]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const ARROWS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };

const USAGE = `Usage: node scripts/sandbox-drive.mjs "<preset>[?room=boss&seed=7]" [steps] [options]
Steps (run in order):
  --wait ready|my-turn|ended   wait for sandbox state (ready is added first if no --wait given)
  --shot <name>                screenshot to <out>/<name>.png
  --end-turn [n]               click End Turn on my next n turns (default 1, must be a positive integer)
  --attack-nearest             click Attack, then an adjacent enemy
  --click x,y                  click arena cell x,y — it must be inside the visible camera window;
                                use --wait my-turn and --pan first
  --pan left|right|up|down[,n] press an arrow key n times (n defaults to 1, must be a positive integer)
Options:
  --out <dir>        output directory (default .sandbox/shots)
  --base <url>       client URL (default http://localhost:5173)
  --viewport WxH     browser size (default 1600x1000, W and H must be positive integers)
Notes:
  - Passing your own --wait suppresses the auto-inserted "--wait ready" before the first step —
    add --wait ready explicitly if you also wait on something later (e.g. --wait ended).
  - --wait ended needs the human seat to actually act (there's no idle/AFK auto-skip while
    connected) — interleave --end-turn N (e.g. --end-turn 30) so the fight can conclude.
  - The camera follows whichever unit's turn is active, so a manual --pan only sticks if you
    do it during your own turn (--wait my-turn first).
Needs the dev servers: npm run dev:sandbox`;

const isPosInt = (s) => /^\d+$/.test(s) && Number(s) > 0;
const isNonNegInt = (s) => /^\d+$/.test(s);

const argv = process.argv.slice(2);
if (!argv[0] || argv[0].startsWith('--')) { console.error(USAGE); process.exit(2); }
const [preset, query = ''] = argv[0].split('?');
let base = 'http://localhost:5173';
let out = '.sandbox/shots';
let viewport = { width: 1600, height: 1000 };
const steps = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) { console.error(`Missing value for ${a}\n${USAGE}`); process.exit(2); }
    return v;
  };
  const fail = (msg) => { console.error(`${msg}\n${USAGE}`); process.exit(2); };
  switch (a) {
    case '--base': base = next(); break;
    case '--out': out = next(); break;
    case '--viewport': {
      const v = next();
      const m = /^(\d+)x(\d+)$/.exec(v);
      if (!m || !isPosInt(m[1]) || !isPosInt(m[2])) fail(`Invalid --viewport "${v}" (expected WxH with positive integers, e.g. 1600x1000)`);
      viewport = { width: Number(m[1]), height: Number(m[2]) };
      break;
    }
    case '--wait': steps.push({ kind: 'wait', what: next() }); break;
    case '--shot': steps.push({ kind: 'shot', name: next() }); break;
    case '--end-turn': {
      let n = 1;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        const v = next();
        if (!isPosInt(v)) fail(`Invalid --end-turn "${v}" (expected a positive integer)`);
        n = Number(v);
      }
      steps.push({ kind: 'end-turn', n });
      break;
    }
    case '--attack-nearest': steps.push({ kind: 'attack-nearest' }); break;
    case '--click': {
      const v = next();
      const m = /^(\d+),(\d+)$/.exec(v);
      if (!m || !isNonNegInt(m[1]) || !isNonNegInt(m[2])) fail(`Invalid --click "${v}" (expected x,y with non-negative integers)`);
      steps.push({ kind: 'click', x: Number(m[1]), y: Number(m[2]) });
      break;
    }
    case '--pan': {
      const v = next();
      const [dir, nRaw] = v.split(',');
      if (!ARROWS[dir]) fail(`Invalid --pan "${v}" (direction must be left, right, up, or down)`);
      let n = 1;
      if (nRaw !== undefined) {
        if (!isPosInt(nRaw)) fail(`Invalid --pan "${v}" (count must be a positive integer)`);
        n = Number(nRaw);
      }
      steps.push({ kind: 'pan', dir, n });
      break;
    }
    default: fail(`Unknown option ${a}`);
  }
}
if (!steps.some((s) => s.kind === 'wait')) steps.unshift({ kind: 'wait', what: 'ready' });

try {
  const r = await fetch(base);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.error(`Can't reach the client at ${base} (${e.message}). Start the dev servers with: npm run dev:sandbox`);
  process.exit(3);
}

mkdirSync(out, { recursive: true });

const pageErrors = [];
let browser = null;
let page = null;

const url = `${base}/?sandbox=${encodeURIComponent(preset)}${query ? `&${query}` : ''}`;
const hook = () => page.evaluate(() => window.__cavernsSandbox ?? null);

async function waitFor(pred, what, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    const h = await hook();
    if (h?.status === 'error') throw new Error(`Sandbox error: ${h.error}`);
    if (h && pred(h)) return h;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what} (status: ${h?.status ?? 'no hook'})`);
    await page.waitForTimeout(100);
  }
}
const isReady = (h) => h.status === 'my_turn' || h.status === 'waiting';
const cell = (x, y) => page.locator(`.room-grid > .room-row:nth-child(${y + 1}) > span:nth-child(${x + 1})`);

/** Cells outside the camera's .arena-viewport are CSS-clipped (overflow: hidden) and unclickable. */
async function assertCellVisible(x, y) {
  const [viewportBox, cellBox] = await Promise.all([
    page.locator('.arena-viewport').boundingBox(),
    cell(x, y).boundingBox(),
  ]);
  const inside = viewportBox && cellBox
    && cellBox.x >= viewportBox.x && cellBox.y >= viewportBox.y
    && cellBox.x + cellBox.width <= viewportBox.x + viewportBox.width
    && cellBox.y + cellBox.height <= viewportBox.y + viewportBox.height;
  if (!inside) throw new Error(`Cell ${x},${y} is outside the visible arena window — pan first (--pan)`);
}

let exitCode = 0;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(url);
  for (const s of steps) {
    switch (s.kind) {
      case 'wait':
        if (s.what === 'ready') await waitFor(isReady, 'the arena');
        else if (s.what === 'my-turn') await waitFor((h) => h.status === 'my_turn', 'my turn', 60000);
        else if (s.what === 'ended') await waitFor((h) => h.status === 'ended', 'combat end', 180000);
        else throw new Error(`Unknown wait target "${s.what}"`);
        break;
      case 'shot': {
        const file = join(out, `${s.name}.png`);
        await page.screenshot({ path: file });
        console.log(`shot ${file}`);
        break;
      }
      case 'end-turn':
        for (let k = 0; k < s.n; k++) {
          const h = await waitFor((x) => x.status === 'my_turn' || x.status === 'ended', 'my turn', 60000);
          if (h.status === 'ended') break;
          // Mob turns never get their own combat_turn broadcast (only players do), so in a
          // solo fight status goes straight from my_turn round N to my_turn round N+1 with no
          // observable dip to 'waiting' — wait for a new combat_turn event instead of a status flip.
          const turnsBefore = h.events.filter((e) => e.type === 'combat_turn').length;
          await page.click('.arena-btn-end');
          await waitFor((x) => x.status === 'ended' || x.events.filter((e) => e.type === 'combat_turn').length > turnsBefore, 'the turn to pass');
        }
        break;
      case 'attack-nearest': {
        const h = await waitFor((x) => x.status === 'my_turn', 'my turn', 60000);
        const me = h.positions[h.playerId];
        const target = h.combat.participants.find((p) => p.type === 'mob' && h.positions[p.id]
          && Math.abs(h.positions[p.id].x - me.x) + Math.abs(h.positions[p.id].y - me.y) === 1);
        if (!target) throw new Error('No enemy adjacent to the player');
        await page.click('.arena-btn-attack');
        const pos = h.positions[target.id];
        await assertCellVisible(pos.x, pos.y);
        await cell(pos.x, pos.y).click();
        break;
      }
      case 'click':
        await assertCellVisible(s.x, s.y);
        await cell(s.x, s.y).click();
        break;
      case 'pan':
        for (let k = 0; k < s.n; k++) await page.keyboard.press(ARROWS[s.dir]);
        break;
    }
  }
} catch (e) {
  exitCode = 1;
  console.error(String(e.message ?? e));
  if (page) {
    await page.screenshot({ path: join(out, 'error.png') }).catch(() => {});
    console.error(`error screenshot: ${join(out, 'error.png')}`);
  }
} finally {
  const h = page ? await hook().catch(() => null) : null;
  writeFileSync(join(out, 'events.json'), JSON.stringify({ url, finalStatus: h?.status ?? null, pageErrors, events: h?.events ?? [] }, null, 2));
  if (pageErrors.length) console.error(`page errors:\n  ${pageErrors.join('\n  ')}`);
  await browser?.close();
}
process.exit(exitCode);
