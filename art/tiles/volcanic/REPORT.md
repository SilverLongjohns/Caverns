# Volcanic ("Magma Rifts") terrain tileset -- report

Sandbox work, not installed to `client/public/tiles`. Follows the recipe in `art/tiles/starter/chosen.json`
and the brief at `.sandbox/tiles-biomes/brief.md`.

## What was generated

Recipe added to `art/tiles/recipes.json` under `"volcanic"` (alongside `crystal` and `bone`, added
concurrently by other agents in the same session -- only my own key was touched).

Four PixelLab `create_tiles_pro` jobs, `tile_size 24`, `square_topdown`, `top-down`, `segmentation`
outline, zero rerolls:

1. **rock corner set** (job `abc07da4-d934-4ac8-97c1-41d2d28544c1`) -- basalt floor / obsidian rock.
2. **chasm corner set** (job `43fb4426-ec76-4058-be0e-3740c1605700`) -- basalt floor / glowing magma chasm.
3. **floor variants** (job `43b05573-7787-42d0-9d21-4cbce8f10b3f`) -- 5 numbered motifs, shape mode.
4. **stamps batch** (job `502acf82-c163-4cf1-a92b-272ec17bec47`) -- hazard, bridge_h, bridge_v, exit, torch.

No water set (per the brief -- volcanic only needed rock + chasm).

## Picks

- **Floor variants**: crack = tile_1 (bright ember-glow crack), cinders = tile_6 (two dim ember flecks),
  ripple = tile_14 (dark reddish diagonal band), girder = tile_9 (grey-blue diagonal band, no ember),
  ember = tile_5 (one tiny glowing dot). All 5 came from the single 16-tile canvas -- no supplemental
  needed (unlike starter, which needed one for its "cable" variant).
- **Stamps**: hazard = tile_4 (lava pool with a basalt rock rim, gave cutout a real background to key
  off -- several other candidates in the batch were full-bleed lava with no floor border and were
  rejected for that reason), torch = tile_14 (simple clean brazier), bridge_h = tile_8, bridge_v =
  tile_10 (verified as genuinely different orientations -- background/floor strip on top for bridge_h,
  on the left for bridge_v -- confirmed by inspecting the raw tiles before cutout, so no rotation trick
  was needed, unlike starter's bridge_v), exit = tile_13 (symmetric archway with a visible floor scratch
  mark; shipped uncut like starter's exit -- the frame material has no separable background, so cutout
  was skipped and alpha was just clamped to opaque).

## Post-processing

- Seam-repaired rock's pure-floor tile (`tile_15`): band score 3.945/3.514 -> 0.137/0.320 (threshold 1.0).
- Graded the whole family (32 corner-set tiles + 5 floor variants) with ONE Lab transform:
  `l_offset +9.14, chroma_scale 1.345`. Unlike starter (which darkened/desaturated to hit its target),
  volcanic's raw output came out *darker and less saturated* than starter's target (L 12.51 vs target
  21.7; chroma 5.00), so the transform **lightens and boosts saturation** instead, landing at the same
  ~21.7 darkness while keeping the ember-red identity readable rather than flattening it further.
  Reference was a synthetic Lab-target swatch, not an image crop (volcanic has no approved spike mockup
  to sample from) -- see `chosen.json.grade.reason` for the full rationale.
- `fill`-treated chasm's fully-surrounded tile (raw `tile_0`, stored mask 15) to avoid the rim/pit
  lattice artifact starter hit with its water/chasm mask-15 tiles. Band score after: 0.151/0.130.
  Verified with a 4x4 tiled preview (`work/chasm_fill_tiled_preview.png`) and in the real room mockup
  -- no banding visible either way.
- Cutout + cleanalpha on hazard/torch/bridge_h/bridge_v (tolerance 12, feather 0); exit shipped raw
  with alpha clamped to opaque (no separable background).

## Pack

`art/tiles/volcanic/pack-spec.json` -> `python3 scripts/tiles/pack.py art/tiles/volcanic/pack-spec.json art/tiles/volcanic/pack`
-- 42 tiles into an 8x6 sheet (rock x16, chasm x16, floor variants x5, stamps x5), desaturate 0.0.

## Gate artifacts

- `art/tiles/volcanic/_sheet.png` -- labeled contact sheet of every packed tile/stamp.
- `art/tiles/volcanic/mockup-grid.json` -- 14x12 room: obsidian walls with a lone pillar and a 2x2
  pillar block, floor (with variants appearing pseudo-randomly, confirmed in the render), a north-south
  chasm column crossed by a **bridge_h** (grate spans east-west), an east-west chasm band crossed by a
  **bridge_v** (grate spans north-south), a hazard pool, a basalt archway exit by the right wall, and a
  torch on the north wall.
- `art/tiles/volcanic/_mock.png` -- rendered at 48px/cell via the real `client/scripts/terrain-mockup.mts`
  (unmodified `autotile.ts`/`terrainDrawOps.ts`), composited with a small PIL script
  (`.sandbox/tiles-biomes/composite_mock.py`, following the `.mts` file's own header-comment recipe --
  no reusable compositor existed yet in the repo, so one was written; it just crops/pastes/alpha-composites
  the ops JSON, no game logic). Reviewed close-up crops of both bridge orientations and the exit -- no
  seams, correct orientations, clean readability at 48px.

## Weak pieces / would reroll

None outright broken, but two notes for the user:

1. **bridge_h and bridge_v look quite similar at a glance** (both are grey iron-grate lattices; the
   orientation tell is subtle -- a thin strip of visible basalt floor on one edge vs. an adjacent edge).
   They're verified *functionally* correct (confirmed via alpha maps and the room mockup, each reads
   right against its own chasm channel), but if the user wants the two bridge stamps to be more visually
   distinct at a glance (not just via floor-strip position), that would need a reroll with a more
   directional prompt (e.g. explicit plank/beam direction instead of a symmetric grate).
2. **Grade reference was synthetic**, not sampled from an approved spike mockup (volcanic has none, unlike
   starter's mock-A2). The absolute darkness target (L~=21.7) matches starter by design, but there's no
   independently-approved "this is what volcanic should look like" image to have graded against -- the
   room mockup is the only visual check. Worth a quick user look before calling the darkness/saturation
   correct.

## Spend

The PixelLab credit balance is **shared** across concurrently-running biome agents (crystal, bone, and
this one all ran in the same session), so a simple before/after delta does not isolate this biome's
spend. My 4 jobs (2 corner sets + floor variants + stamps, all 1K-canvas `create_tiles_pro` jobs, zero
rerolls) are the same class of job as starter's round-1 generate, which cost $0.86 for 3 jobs -- so my
spend is plausibly **~$1.0-1.2**, within the $1.60 ceiling. Balance at dispatch: $15.65. Balance after
all 4 of my jobs were submitted and I stopped generating: $13.47 (a $2.18 drop, but that includes other
agents' concurrent jobs in the same window -- not attributable to volcanic alone).

## Reroll 1 (after user review)

Walls, floor, torch and bridges were approved as-is. Chasm, hazard, and exit were sent back and rerolled:

- **Chasm**: new prompt ("deep rift ... falling away into darkness, dim molten orange glow far below")
  reads as a dark maroon rift instead of a flat bright orange river. The raw 16-tile canvas had a real
  generation defect -- 7 of 16 mask tiles had wrong corner geometry (masks 2/3/4 came out all-floor with
  zero chasm; masks 8/10/12/14 had chasm in the wrong quadrant). Rather than spend a 4th job rerolling
  (budget was tight), those 7 tiles were reconstructed by direct quadrant compositing from the graded
  floor and chasm textures -- verified this matches how the autotiler actually slices quadrants, and
  re-verified all 16 tiles' geometry afterward. A floor halo (grey-purple rectangle around the chasm,
  from the raw generation's own floor grain not matching our repaired floor tile) was found and fixed
  with the new `postprocess.py unifyfloor` subcommand at `--tolerance 5` (the documented default of 9
  was too aggressive and erased chasm content on several tiles -- tuned down after testing each tile).
  Grade and fill were redone on the new chasm set.
- **Hazard**: new prompt ("fills most of the tile ... dark crust rim") now fills ~74% of the cell with a
  clearly visible bubbling pool, not a small blob.
- **Exit**: new prompt (starter's exact framing). True alpha cutout was attempted extensively (12+
  tolerance/sides/keep-dark combinations, plus a luma-map scan of the raw art) and could not be achieved
  -- the stone frame has no separable background at any usable tolerance, same finding starter documented
  for its own exit. What WAS fixed: the raw tile's cold grey-purple colour was palette-matched to the
  basalt floor, which is almost certainly what actually read as "an opaque grey box". Shipped fully
  opaque, now blending into the biome's palette. Flagged for the user in chosen.json -- true transparency
  would need a differently-composed prompt or a manual/geometric mask.

Repacked, re-rendered `_sheet.png` and `_mock.png`, updated `chosen.json`. Spend: $13.09 -> $12.42
($0.67 of the $0.80 reroll budget), zero PixelLab spend on the geometry fix or the halo fix (both
pure post-processing).

## Revert 1 (after second user review, zero new spend)

reroll1's chasm read as flat dull maroon (no depth/glow); reroll1's hazard was a hard-edged square.
User approved fixing both with post-processing only, zero PixelLab spend:

- **Chasm**: reverted to round-1's raw generation (art/tiles/volcanic/raw/chasm, still on disk --
  correct geometry on all 16 masks, just too bright/saturated). Classified each tile's pixels as
  floor-or-chasm (Lab distance to floor vs chasm reference), left floor pixels matched to the plain
  floor, and applied a chasm-only tone-down (l_offset -19, chroma_scale 0.32 relative to their own
  graded value) -- pure-chasm mean went from L=49/chroma=94 to roughly L=30/chroma=30. Added a dark
  basalt lip: a per-tile pixel-distance-to-floor transform darkens chasm pixels within 4px of the
  boundary, falling off with distance, applied identically to all 16 tiles for seamless joins (verified
  with a distance-bucketed luminance check: a clean monotonic darkening toward the edge). Re-ran fill on
  the pure-chasm tile and unifyfloor (same tuned tolerance 5) afterward.
- **Hazard**: built a deterministic organic blob alpha mask (irregular polar boundary from fixed sine
  harmonics, not a circle) covering 66.5% of the tile, with a darker crust ring following the blob's own
  edge, colour sampled from the raw tile's own interior (avoiding its baked-in edge crust). No new
  generation.
- **Exit**: left untouched.

Repacked, re-rendered `_sheet.png`/`_mock.png`, viewed the result, updated `chosen.json` (new `revert1`
section). Balance unchanged: $12.42 -> $12.42, zero PixelLab calls.

## Chasm tone-down correction (after third user review, zero spend)

revert1's chasm tone-down (l_offset -19, chroma_scale 0.32) went too far -- read as "rusty-brown dirt",
not magma. Hazard blob and chasm lip were approved as-is. Eased the tone-down only, keeping the lip
script's parameters completely unchanged: re-ran the same classify-then-tone-down step from the
untouched round-1 base-graded tiles, tried two candidates (A: l_offset -10/chroma_scale 0.55, B: same
l_offset/chroma_scale 0.60), rendered both in the real room mockup, and picked **B** (l_offset -10,
chroma_scale 0.60) -- slightly more vivid than A, reads unambiguously as a molten glow rather than a
muted ember, while still far calmer than round-1's original (pure-chasm L 49.17/chroma 93.77 -> now
L 39.53/chroma 56.34). Re-ran fill and unifyfloor (tolerance unchanged). Repacked, re-rendered
`_sheet.png`/`_mock.png`, viewed the result, updated `chosen.json`. Balance unchanged: $12.42 -> $12.42.
