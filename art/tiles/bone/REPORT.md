# Bone ("Ossuary Halls") terrain tileset -- report

Status: **pending user review** (gate artifacts ready, not installed to `client/public/tiles`).

## What was generated

Per the dispatch (bone is a *structured* biome -- built halls, no water/chasm/hazard-terrain
themes), only the **rock** corner set was generated, plus floor variants and all 5 stamps
(bridges + hazard included for fallback consistency even though bone's own mockup room doesn't
place a bridge).

- **Rock corner set** (16 tiles, `create_tiles_pro` tileset mode): floor = "worn catacomb
  flagstone floor dusted with pale bone dust, dark ash-grey and bone-yellow"; upper = "ossuary
  wall mass of packed skulls and long bones set in dark mortar, near-black in shadow, a few
  rusted relic-tech brackets". Job `e03aba33-6ad2-4888-9a89-72cbc967f68e`.
- **Floor variants** (5): scattered small bones, cracked flagstone, pale bone-dust drift,
  half-buried rusted relic-tech plate, one tiny dim amber relic candle-light. One batch job,
  all 5 motifs found without a supplemental. Job `c926c8e5-15d9-4859-a5a5-8e04620419bf`.
- **Stamps** (5): hazard, bridge_h, bridge_v, exit, torch. First batch job
  `284538f1-8778-444b-9dd9-3408700b9665` supplied hazard, bridge_h, bridge_v; torch needed a
  standalone supplemental (`0ff99d67-...`, same gap starter hit); exit needed a standalone
  reroll (`ba577939-...`) after the batch job's archway candidates cut down to a too-faint
  dotted outline.

## Picks

| Piece | Source | Pick |
|---|---|---|
| rock | rock tileset job | all 16 tiles (mask = 15-fileIndex, `maskBit: "lower"`, same convention as starter -- verified via `placement_rules` and visually at masks 0/15/8/1) |
| floor variant: bones | floor variants job | tile_1 |
| floor variant: cracked | floor variants job | tile_5 |
| floor variant: dust | floor variants job | tile_11 (re-picked -- see "what was weak" below) |
| floor variant: plate | floor variants job | tile_12 |
| floor variant: candle | floor variants job | tile_15 |
| stamp: hazard | stamps batch | tile_0 |
| stamp: bridge_h | stamps batch | tile_4 |
| stamp: bridge_v | stamps batch | tile_9 (re-picked -- see below) |
| stamp: exit | exit reroll | tile_10 |
| stamp: torch | torch supplemental | tile_10 |

## Post-processing

Same pipeline as starter: seam-repair the rock set's pure-floor tile (`tile_15`, mask 0),
grade the whole family (16 rock + 5 floor variants) with one Lab transform, palette-match
floor variants to the repaired floor before grading, cutout+cleanalpha the stamps.

**Grade target**: the brief asked to match starter's darkness (graded floor L~21.7) while
keeping bone's own hue/chroma, not starter's umber. There was no bone-specific approved spike
to sample a reference crop from, so the reference was built synthetically: measured the
sample's own mean Lab (L=47.75, chroma 7.37, hue ~80.4deg -- very hue-consistent pixel to
pixel), then constructed an 8x8 swatch at the SAME chroma and hue but L=21.7, and used that as
`--ref`. Because `apply_grade` scales each pixel's own (a,b) uniformly rather than remapping to
the reference's hue, this produced `l_offset=-26.07, chroma_scale=1.030` -- i.e. matches
starter's target darkness while leaving bone's own saturation essentially untouched (not
flattened), per the brief's instruction.

**Extra fix not in the starter playbook -- highlight compression.** The raw rock tiles baked in
an uneven bright dust-cloud/highlight artifact on the floor portion of several (not all) of the
16 masks (raw p95 luma ranged from L=55 to L=90 across masks). Tiling several different masks
next to each other in a room made this read as a patchy, semi-random glow rather than a
deliberate accent -- clearly visible in the first room-mockup render as pale cloud shapes
repeating along every straight wall edge and around both pillars. A full reroll was considered
(stochastic, and the underlying "dusted with pale bone dust" floor concept is correct per the
recipe) but rejected in favour of a zero-PixelLab-spend, pipeline-only fix in the same spirit as
starter's `fill` step: a uniform Lab-space highlight compression (knee=25, ratio=0.4) applied to
all 16 graded rock tiles, so any pixel above L=25 gets compressed toward that knee by 60%, base
floor darkness (~L=21.7, below the knee) untouched. This DID reintroduce a small seam
discontinuity on the pure-floor tile (band_score jumped to 1.77), so `seam --repair` was
re-run on it afterward (down to 0.215, well under the 1.0 threshold). Verified by re-rendering
the room mockup before/after: the pale cloud artifact reads as a tasteful "dust/rubble scatter
at the wall base" afterward, consistent with the recipe's own floor description, not a defect.

**Exit stamp needed a reroll.** The first batch job's 4 archway candidates all had ordinary
floor-toned pixels inside the doorway opening, which `cutout` flood-removed (border-connected
through the open bottom of the arch), leaving a thin, sparse dotted skull-chain outline --
decorative but too faint to read as "findable" at 48px in the room mockup. Rerolled with
starter's proven "doorway filled with solid black void" framing; the result (`tile_10`) came
back already alpha-clean (corners outside the arch silhouette transparent, void interior solid
opaque black, frame solid opaque stone) and was shipped verbatim, no cutout pass needed.

**Bridge_v needed a re-pick, not a reroll.** The first bridge_v pick (`tile_10`, cutout with
default all-sides) lost ~97.6% of its subject -- its bone/rope colour was apparently too close
in Lab distance to the checkerboard placeholder background at tolerance 12, unlike starter's
equivalent failure (which needed a whole rejected reroll job). Diagnosed with
`cutout_removed_fraction` before running the real cutout, then just switched to a different
candidate from the SAME already-generated batch (`tile_9`, cutout with `sides=left,right`,
~53% opaque remaining) -- zero extra spend, no reroll needed. Bridge_h and bridge_v here are
two independently generated tiles, not a rotated pair like starter's fallback; their plank/rung
spacing differs slightly between orientations but both read cleanly as "lashed bone bridge".

## Gate artifacts

- `art/tiles/bone/_sheet.png` -- contact sheet of all 26 packed tiles (16 rock masks, 5 floor
  variants, 5 stamps), cropped straight from the packed sheet and labelled.
- `art/tiles/bone/mockup-grid.json` -- a 12x9 room: outer rock walls (straight edges + inner
  corners), a lone 1x1 pillar, a 2x2 pillar block, plain floor with variants scattered in,
  a hazard cell, an exit cell, and a torch-themed wall cell. Per the dispatch, bone has no
  water/chasm so the grid omits those and any bridge placement (bridge_h/bridge_v were still
  generated and packed, for fallback consistency, but aren't exercised in this room).
- `art/tiles/bone/_mock.png` -- rendered at 48px/cell via `client/scripts/terrain-mockup.mts`
  (the real `autotile.ts`/`terrainDrawOps.ts`, unmodified) piped through a small ad hoc
  Pillow compositor (no existing generic ops-compositor script was found in `scripts/tiles/`;
  `postprocess.py preview` is for tiling a single tile, not compositing a multi-cell ops list).
  Checked by eye: mask orientation is correct (pillars render as solid rock blobs, not floor
  holes; straight wall edges and inner/outer corners look continuous), no lattice/seam
  artifacts, hazard/exit/torch stamps sit correctly on floor/wall, exit reads as a clearly
  findable archway.

## Spend

The PixelLab credit pool is shared with other biome-generation agents running concurrently in
this session (recipes.json picked up a `crystal` and then a `volcanic` entry from other agents
while this task was in progress), so a simple balance-before/balance-after delta is not a clean
measure of this biome's own spend. First balance check this session: **$15.65**. Last balance
check after all 5 of this biome's jobs: **$13.37** (raw delta $2.28, contaminated by concurrent
jobs). This biome's own job list -- 1 sixteen-tile corner-set tileset, 1 five-item floor-variant
batch, 1 five-item stamp batch, 2 single-item supplementals (torch, exit reroll) -- is
structurally the same shape as starter's job list (which totalled $1.24 for a comparable or
larger job count, including water+chasm sets bone doesn't have), so this biome's own
attributable spend is estimated at roughly **$0.8-1.2**, within the ~$1.60 ceiling.

## Weak pieces / would reroll if given more budget

1. **Rock corner set's uneven raw highlights.** Fixed via a pipeline-only highlight-compress
   pass (see above), which reads fine in the mockup, but the underlying raw generation still has
   uneven per-mask brightness (p95 luma L=55 to L=90 across the 16 masks). A reroll with an
   explicit "evenly dim, no light source, no glow" prompt addition might produce a cleaner base
   tileset if the user wants to spend more credits chasing it -- not attempted here since the
   compression fix already resolves the visible symptom.
2. **bridge_h/bridge_v are independently generated, not a rotated pair.** Both read cleanly as
   "lashed bone bridge" stamps individually, but their plank/rung spacing differs slightly
   between orientations. Since bone has no water/chasm, neither is exercised in the approval
   mockup room -- worth a specific check (a small water/chasm test room, or just trusting the
   default-set fallback logic) before this pair is ever actually placed in a real dungeon floor
   for a future biome that reuses this bone bridge art, or before bone itself gains a themed
   water/chasm set later.

## Round 2 (user review fixes)

User approved the walls, floor, exit and torch, and requested two fixes.

**1. Floor-halo fix (zero PixelLab spend).** Waited for `scripts/tiles/postprocess.py
unifyfloor` (built concurrently by the crystal-biome agent per the coordinator's instruction);
it already existed on first check, so no polling wait was needed. Re-derived the pre-compress
graded rock tiles from raw (deterministic), re-applied the same round-1 highlight-compress pass,
re-repaired the seam, then ran `unifyfloor` on all 16 compressed rock tiles against that
compressed+repaired pure-floor tile as `--floor-ref`.

The tool's default `--tolerance 9` barely touched the halo -- the brightest halo pixels were
still Lab-distant enough from the floor palette to be classified as "not floor" and left alone.
Measured the actual gap directly: bone's own darkest mortar pixels sit at Lab distance ~16.4-16.8
from the floor palette, while the brightest sampled halo pixels were ~14.4 -- closer to the floor
than mortar is, but only just, leaving a narrow safe window. Binary-searched it: `--tolerance 16`
removes nearly all the visible halo while leaving rock/mortar texture intact; `--tolerance 18`
crosses the cliff (one test tile jumped from 66% to 98.8% of its pixels replaced and visually lost
all its skull/mortar texture). Shipped at `--tolerance 16`.

Re-ran `postprocess.py seam` on the resulting pure-floor tile: unifyfloor made no change to that
tile (it IS the floor-ref, 0/576 pixels replaced), so no new seam repair was needed --
band_score col=0.215 row=0.200, both comfortably under the 1.0 threshold.

Verified in the room mockup by eye: before, pale cloud shapes rang every straight wall edge and
both pillars; after, floor reads uniformly right up to every rock edge in the room, no visible
halo anywhere.

**2. Hazard reroll.** The round-1 hazard read as "a flat green blob" with no form. Rerolled with
`"sickly green grave-rot seep welling up between cracked flagstones, glistening, with scattered
small bones"`. Picked `tile_0` from the new batch: an organic radiating shape (not round/flat)
with lighter-green glistening highlights, cracked-flagstone lines radiating outward, and a
distinct small bone at the lower edge -- fills noticeably more of the tile with visible texture
than the round-1 pick. Cut out with the same params as round 1 (tolerance 12, border 1, sides
all, feather 0).

## Round 2 spend

Round-1 balance: $15.65 -> $13.37. Round-2 balance (this pass, one hazard-reroll job only --
the floor-halo fix cost nothing): $13.09 -> $12.42 (raw delta $0.67). As in round 1, this pool is
shared with other concurrent biome agents, so the raw delta isn't a clean measure; a single
supplemental job of this kind cost starter and this biome's own earlier supplementals roughly
$0.19-0.22 each, consistent with staying inside the ~$0.40 round-2 budget.

## Round 2 gate artifacts

`_sheet.png` and `_mock.png` were regenerated in place (same paths as round 1) after both fixes.
`chosen.json` was updated with a `reviewRound2` section (floor-halo fix) and the hazard entry now
records both the round-2 pick and the rejected round-1 pick.
