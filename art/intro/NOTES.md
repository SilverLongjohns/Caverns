# Intro art notes (Task 8)

## Keyframes (PixelLab)

| File | Model | Verdict |
|---|---|---|
| raw/kf_waste_1.png | pixflux 320x180 | Rejected. Generic tower in the centre, green lights, crescent moon, figure not at the foot. |
| raw/kf_waste_2.png | create_image_pro 320x180, phaseknife style ref (palette/detail/shading) | **Chosen.** Leaning relic monolith, grid of dead round signal lamps, teal glyphs, ringed planet, violet/rust sky bands, sump with amber lantern at the foot. The generator painted a white frame about 6 px wide round the edges, so it was cropped to (15,8)-(303,170) = 288x162 (16:9) -> raw/kf_waste_2_crop.png. |
| raw/kf_threshold_1.png | pixflux 320x180 | Rejected. No shaft, no dusk, figure standing on a block. |
| raw/kf_threshold_2.png | create_image_pro 320x180, phaseknife style ref | **Chosen.** Gas-masked sump, scrap pauldron, amber lantern, square black shaft lower right, teal glyph wall, salt specks, a sliver of dusk at the far left. It is darker and more interior than the prompt asked for, but the silhouette reads clearly. |

keyframes/waste.png = kf_waste_2_crop.png (288x162; the pipeline area-scales it to 320x180).
keyframes/threshold.png = kf_threshold_2.png (320x180).

## Palette

- `palette` now uses `max_colors=40` (was 32). At 32 the snap lost the teal, and the keyframes came out speckled and grey.
- The keyframes are passed 3x each, so they carry weight equal to the six portrait and logo inputs. That cut the mean snap error from 3.75/2.86 to 2.93/2.70 (waste/threshold), recovered the teal glyphs and kept the warm monolith greys.
- raw/palette_v1_unweighted.png is the first 40-colour attempt, kept for reference.

### Unified regeneration (bake phase, controller ruling)

The palette above only saw the plates; it did not see the descent shaft layers (Task 9), whose fungal greens, crystal violets and screen teals are much more saturated than anything in the waste/threshold keyframes. Regenerated once, adding the seven descent raw layers plus one figure frame to the same weighted keyframe set, so a single shared palette now serves plates, walls and figure:

```
bash scripts/intro-bake.sh palette \
  art/intro/keyframes/waste.png art/intro/keyframes/waste.png art/intro/keyframes/waste.png \
  art/intro/keyframes/threshold.png art/intro/keyframes/threshold.png art/intro/keyframes/threshold.png \
  art/intro/raw/descent_far.png art/intro/raw/wall_conduits.png art/intro/raw/wall_screens.png \
  art/intro/raw/wall_fungal.png art/intro/raw/wall_crystal.png art/intro/raw/near_wall.png \
  art/intro/raw/ledge.png art/intro/raw/fig_00.png
```

Kept `max_colors=40` (did not need to raise to 48): the resulting palette still carries a run of violets (#c97fe2 #973ede #5f1eb1), greens (#4d7e55 #49c67e #5b7467) and a dark teal (#2b5157), and side-by-side raw-vs-baked contact sheets for `wall_crystal`, `wall_fungal`, `wall_screens`, `wall_conduits`, `near_wall`, `ledge` and both plates (`art/intro/raw/*_baked_contact.png` vs the original video contact sheets) show no hue collapse — violet stays violet, green stays green, teal stays teal on every layer and on the waste sky bands / threshold glyph wall. No layer needed the `dither=bayer` fallback.

Contents (old + new hues): violets #4c425b #664958 #6c6575 #c97fe2 #973ede #5f1eb1, rust/orange #853f25 #a74d29 #a26048 #77331b, teal #2a4646 #2b5157 (dark; still no bright glyph teal), greens #4d7e55 #49c67e #5b7467, lantern ambers #f6a236 #f6bd63 #f7dd8b, salt whites #d1d0c9 #e3e8e6. One reserved transparent slot (#00ff00), kept so `layer`/`strip` preserve alpha.

## Video takes (ElevenLabs flow "Caverns intro", ojfMCKTDEcG1Yvpmg84I)

**Upload gotcha:** the paletted (pal8) start PNGs from `paletteuse` reached ElevenLabs as a near-black 8.9 KB asset. Every model ignored the start frame and made an unrelated scene that fades in from black. That wasted 6 takes (batch 1: veo/kling/seedance x waste/threshold). Always upload an **rgb24** copy (`ffmpeg -i start.png -pix_fmt rgb24 start_rgb.png`). The copies actually uploaded are raw/start_*_rgb.png. They were snapped with a transparent-slot-free variant of the same palette, and the difference is negligible. The broken batch-1 takes that were downloaded are in raw/broken/.

### Waste (8 s source)
| Take | Model | Verdict |
|---|---|---|
| raw/waste_veolite.mp4 | veo-3.1-lite-generate-001 (prompt tweak: "one small round signal lamp glows faint amber for a moment, then goes dark"; negative adds fire/lightning) | **Recommended.** Holds the composition, gentle push-in, diagonal wind-streaked salt dust, coat flapping, figure still. A single lamp (middle row, 3rd hole) lights at about 2.9 s and holds to about 6.5 s. Weak points: the banded sky gains generic puffy cumulus, and the lantern flares bright at about 1.8-3 s. |
| raw/waste_veo.mp4 | veo-3.1-generate-001 | Alternate. Richer sky (gold cloud rims) and holds the pixel style. But a billowing dust wall swallows the monolith base, and at about 5.3-6.0 s a fire/lightning squiggle erupts in the lamp grille before the right-hand lamps light amber. The glitch falls inside the 0-6.6 s bake window. |

### Threshold (6 s source)
| Take | Model | Verdict |
|---|---|---|
| raw/threshold_kling.mp4 | kling-3-pro 1080p | **Recommended (the only valid take).** Composition and style held, locked-off. The sump walks along the ledge from about 3.7 s, steps off at 5.21 s and drops. The lantern falls into the shaft, leaving a glow at 5.75 s. Weak points: darker overall than the keyframe; he never really lowers the lantern or looks down; the pauldron flips shoulders and there is some smear at 5.29-5.42 s during the fall. |

No second Threshold take: the ElevenLabs quota ran out (the kling-waste and veo-threshold v2 nodes were refused).

## Measured values

- **THRESHOLD_STEP_IN = 5.208 s** (frame 125 @ 24 fps in raw/threshold_kling.mp4). This is the last frame with the trailing foot on the ledge; at 5.250 s the body is over the void. Step 7 in-point = 5.208 - 4.6 = **0.608 s**, dur 5.2 (ends 5.81 s, inside the 6.04 s clip).
- **WASTE_LIGHT = (219, 87)** in 320x180 coords, read off raw/start_waste.png ÷ 4: middle row, 3rd lamp of the grille, the lamp the Veo Lite take lights. Other dead lamps for reference: top row (203,73) (212,74) (221,74) (231,76) (240,76); middle row y≈87 at x≈200/209/219/228/238.

## Spend
- PixelLab: 2 pixflux (1 gen each) + 2 pro (25 each) = 52 generations (3811 before -> ~3759 left).
- ElevenLabs: 9 takes charged, about 81,000 credits (~$13.5). 6 of them were wasted by the pal8 upload bug. Plan quota is now exhausted.
