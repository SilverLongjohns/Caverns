# Descent layers + falling figure (Task 9, phase A)

Raw files in `art/intro/raw/`.

## Bake (Task 9, phase B)

Baked with the unified palette (see NOTES.md, "Unified regeneration"), which was regenerated to include these raw layers so their key hues survive the snap:

```
for n in descent_far wall_conduits wall_screens wall_fungal wall_crystal near_wall ledge; do
  bash scripts/intro-bake.sh layer art/intro/raw/$n.png $n
done
bash scripts/intro-bake.sh strip figure_fall art/intro/raw/fig_00.png art/intro/raw/fig_01.png art/intro/raw/fig_02.png art/intro/raw/fig_03.png art/intro/raw/fig_04.png art/intro/raw/fig_05.png art/intro/raw/fig_06.png art/intro/raw/fig_07.png
```

Dimensions (all within the brief's limits): `descent_far` 320x256, `wall_conduits`/`wall_screens`/`wall_fungal`/`wall_crystal` 128x256, `near_wall` 96x224, `ledge` 320x40, `figure_fall` 512x64 (8 frames x 64x64 — the renderer uses the strip height as the frame size, so 64 px frames are fine even though the plan text said 48). `descent_far` pans by at most 69 px during the descent (see Task 9 plan), well under its 256 px height, so it does not need to be seamlessly tileable despite the hard seam noted below.

Side-by-side raw-vs-baked contact sheets were built and read for every wall plus `near_wall`, `ledge` and `descent_far`: violet stays violet on `wall_crystal`, green stays green on `wall_fungal`, teal stays teal on `wall_screens`, and the rust/amber conduits and dark strata layers are unchanged. No layer needed the `dither=bayer` fallback at `max_colors=40`.

## Chosen raw files (ffprobe W×H)

| file | size | source |
|---|---|---|
| descent_far.png | 320×256 | = descent_far_c (Pro, flat front-on strata wall, rusted pipes and relic panels). Not tileable: there is a hard seam top to bottom |
| wall_conduits.png | 128×256 | = wall_conduits_b (pixflux seed 202) |
| wall_screens.png | 128×256 | = wall_screens_b (pixflux seed 202) |
| wall_fungal.png | 128×256 | = wall_fungal_b (pixflux seed 202) |
| wall_crystal.png | 128×256 | = wall_crystal_c (Pro, fungal_b used as layout reference) |
| near_wall.png | 96×224 | near_wall_c (Pro) made vertically tileable: the bottom 32 rows are Bayer-dithered into the top 32 rows, and the result is cropped to 224 |
| ledge.png | 320×40 | = ledge_e (Pro) |
| fig_00…fig_07.png | 64×64 each | tumble loop built from the Pro character "Sump Traveler" (dff7bffe-6e45-47b1-b80e-dcfcf373918c), `front-flip` template frames 1–4 plus their 180° rotations (lossless), each re-centred on a 64×64 canvas |

Rejected candidates are kept with suffixes: descent_far_a/b/d, wall_*_a, wall_crystal_a/b, near_wall_a/b/c, ledge_a/b/c/d, figA_* (v3 "falling": the figure stands in place), figB_* (v3 "freefall tumble": it tips over and lies flat), figF_* (raw front-flip frames), fig_char_east.png (the character's side rotation, for reference).

## SCREEN_SPOTS (wall_screens.png pixel coords: centres of the screen glass)

```
SCREEN_SPOTS = [[79, 28], [75, 74], [77, 122], [77, 168], [81, 218]]
```
