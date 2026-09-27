# The intro cold open

A 30-second, wordless cinematic that plays before the login screen the first time a browser visits
Caverns: a figure crosses a wasteland to a monolith, steps into a shaft, falls through four strata
of the underworld, hits black silence, then resolves into the game's logo and the login cavern
underneath it. It exists to set tone (Qud-style post-collapse relic-tech, not classic fantasy)
before the player ever sees a text field.

It plays in `client/src/App.tsx`, mounted as `{introActive && <IntroCutscene />}` alongside the
normal screen router. While it's active, `App.tsx` forces the `connecting` view to render
`LoginScreen` (instead of the plain "Connecting..." placeholder) so the real DOM — cavern
background, glyphs, eyes, logo — already exists underneath the canvas for the handoff at the end.
If a stored session token resolves login before the intro finishes, the view can advance to
`character_select` while the intro is still playing; that's fine, because `CharacterSelect` also
renders `CaveBackground` + the `.lobby-logo` image, so the handoff target look identical either way.

## Whether it plays

`introState.ts` (`shouldPlayIntro`) decides: skip it entirely with `?sandbox` in the URL, force it
with `?intro`, skip it if the browser has `prefers-reduced-motion: reduce`, otherwise play it once
per browser (`localStorage['caverns_intro_seen']`). The `↺ intro` button on the login screen
(`LoginScreen.tsx`) replays it via `useIntroStore().replay()`, which sets `gateless: true` — a
replay already happened inside a user gesture (the click), so it skips the "PRESS ANY KEY" gate and
goes straight to loading assets and playing.

## File map

```
client/src/intro/
  math.ts            easing, noise, hash, clamp/lerp/inv (pure)
  timeline.ts        shots, hits, strata, eye order, audio cues, key times — the single source
                      of truth (see below)
  introState.ts      should-play logic, seen flag, URL params
  introStore.ts      zustand store: active / musicHold / gateless
  clock.ts           IntroClock (skip-aware) + pickClockSource
  layout.ts          coverFit, glyphRevealTime (pure) + measureLayout (DOM)
  plate.ts           atlas frame math + drawPlate (reads the baked sprite-sheet manifests)
  assets.ts          asset manifest + loader (fetches everything under client/public/intro/)
  audio.ts           planCues/encodeWav (pure) + scheduleCues (Web Audio) + renderIntroMix
  renderer.ts        IntroRenderer: low-res (320x180) scene composited, upscaled, CRT-posted,
                      then native-resolution layers (glyphs, logo, eyes) drawn on top
  shots/power.ts     power-on: dead glass, CRT warm-up pass, aperture
  shots/plates.ts    waste + threshold: baked video plates with dust/signal-light overlays
  shots/descent.ts   fall depth/stratum math + parallax fall through the four strata
  shots/dark.ts      the drip + ripple (low-res) and the ten cave eyes (native res)
  shots/resolve.ts   ASCII glyph cavern build-in, logo burn-in, underlay fade to the real DOM
  IntroCutscene.tsx  React shell: gate, input handling, render loop, lifecycle, still/export hooks
  README.md          this file
  *.test.ts          unit tests for every pure module
client/src/audio/
  audioEngine.ts     shared AudioContext; master/intro/music buses; WORLD_URL/AMBIENCE_URL;
                      setTrack() crossfades between the pre-game ambience loop and the world music
                      (gasket_maples.mp3) with a 2.5s linear ramp — the intro owns the whole
                      soundstage while it plays (musicHold), then hands it back on release
  musicTrack.ts      pickTrack(view, hold): pure view -> track mapping
client/src/components/MusicPlayer.tsx   UI over audioEngine (mute/volume), hidden while the intro
                                         plays so its controls don't show through the canvas
client/src/components/LoginScreen.tsx   the `↺ intro` replay button
client/src/App.tsx                      mounts the intro; keeps LoginScreen mounted underneath
                                         while `connecting` and the intro is active
scripts/intro-bake.sh                   ffmpeg pipeline: palette, plates -> atlases, layers, audio
scripts/intro-render.mjs                Playwright tooling: stills, frames, wav, handoff, keys
client/public/intro/                    shipped, baked assets (plates, layers, audio) — see sizes
art/intro/                              palette.png + keyframes (tracked); raw/ generations
                                         (gitignored); NOTES*.md (picks and rationale, tracked)
```

## `timeline.ts` is the single source of truth

Every shot boundary, key moment (the step off the ledge, the hard cut to black, when each of the
ten cave eyes opens, when the logo burns in) and every audio cue's timing and gain lives in
`timeline.ts` as plain data. `renderer.ts` and the `shots/*` modules read the same constants the
audio scheduler reads (`audio.ts`'s `scheduleCues`/`renderIntroMix`), so picture and sound can never
drift apart — moving a hit or a shot boundary is a one-line change in one file. `MASTER_TRIM` is
the single global level knob for the whole mix (see "Tuning the mix" below); everything else is a
per-cue `gain` in the `CUES` array.

## Tuning a shot

Use the `stills` tool to render exact frames without waiting through the whole 30 seconds. It needs
the Vite dev server running (`npm run dev`):

```bash
node scripts/intro-render.mjs stills 0.1,5,12.6,20,24,29.99 [--out .intro/stills] [--viewport 1920x1080]
```

Each time renders through `window.__intro.render(t)`, the same code path the real playback loop
uses, so what you see is exactly what ships. Edit the shot module or `timeline.ts`, re-run, look at
the PNGs.

## Re-baking plates, layers and audio

All offline asset baking happens in WSL via ffmpeg (`scripts/intro-bake.sh`; not available on
Windows). The picks (which raw take, in-point, fades, normalization mode) and the measurements
behind them are recorded in three notes files under `art/intro/` — read all three before touching a
bake command, since the shared palette and levels were chosen looking at all of them together:

- `art/intro/NOTES.md` — palette generation, the waste/threshold video plate picks and their
  measured in-points (`THRESHOLD_STEP_IN`, `WASTE_LIGHT`).
- `art/intro/NOTES-descent.md` — the descent strata wall layers, the falling-figure sprite strip,
  and `SCREEN_SPOTS` (glyph positions on `wall_screens.png`).
- `art/intro/NOTES-audio.md` — every audio pick, the `audio` subcommand's normalization modes
  (`loud` for sustained/atmospheric cues, `peak` for one-shots), and the post-bake loudness/peak
  measurements.

Subcommands (see the script header comments for full argument lists):

```bash
bash scripts/intro-bake.sh palette <extra images...>       # shared 40-colour palette
bash scripts/intro-bake.sh layer <src.png> <name>            # palette-snap a still, keep alpha
bash scripts/intro-bake.sh plate <id> <src.mp4> <inSec> <durSec> [fps]   # video -> atlas + manifest
bash scripts/intro-bake.sh strip <outName> <frame.png...>     # sprite strip (e.g. figure_fall)
bash scripts/intro-bake.sh audio <id> <src> [ss] [dur] [fadeInMs] [fadeOutMs] [none|loud|peak]
bash scripts/intro-bake.sh analyze <audio> <outPrefix>        # loudness/peak/silences + PNGs
bash scripts/intro-bake.sh contact <video> <out.png> [cols] [rows]   # sampled contact sheet
bash scripts/intro-bake.sh sizes                              # total bytes under client/public/intro/
```

Raw generations (video takes, PixelLab raw PNGs, raw audio) live in `art/intro/raw/` and are
gitignored — regenerate or re-fetch them if needed, they are not committed. The chosen takes and
why are recorded in `art/intro/NOTES.md` (plates), `NOTES-descent.md` (descent layers/figure) and
`NOTES-audio.md` (all audio).

### Tuning the mix

The whole mix is leveled by one global constant plus per-cue gains, both in `timeline.ts`:

```bash
node scripts/intro-render.mjs wav                       # renders the full mix via Web Audio
bash scripts/intro-bake.sh analyze .intro/intro.wav .intro/mix   # I/LRA/Peak + waveform/spectrogram
```

Set `MASTER_TRIM = 10 ** ((-16 - I) / 20)` (rounded to 2 decimals) from the printed integrated
loudness `I`, re-render and re-analyze until `I` is about -16 LUFS (+/-1) and Peak is <= -1 dBFS.
If a single hit pushes the peak over even after the master trim is right, lower that cue's own
`gain` in `CUES` rather than the master trim (it'll pull the whole mix down again). As shipped,
`MASTER_TRIM = 0.66` gives I = -16.8 LUFS, Peak = -1.1 dBFS, with the expected hard silence at
about 22.0-22.8s (the cut to black before the resolve).

Individual audio assets are pre-conditioned at bake time (20 Hz high-pass; loudnorm -18 LUFS for
beds/score/ambience or a single-pass peak-to- -3 dBFS gain for one-shots; a limiter at 0.89) — see
`NOTES-audio.md`. `MASTER_TRIM` and the per-cue gains in `timeline.ts` operate on top of that
already-leveled material; they're the runtime mix, not the source conditioning.

## Verifying

```bash
node scripts/intro-render.mjs handoff [--viewport 1920x1080]
node scripts/intro-render.mjs keys
```

`handoff` runs two pixel-diff checks against the real login page it hands over to: a smoke check at
t=29.99 (canvas should already be fully transparent — mean diff <=1.5, <=0.5% of pixels differing
by >24), and a stricter alignment check at t=28.99 (canvas still fully opaque) that also verifies
the glyph cavern and logo are registered to within one CSS pixel against the live DOM. Both must
print `PASS`. `keys` checks the intro doesn't leak keystrokes into the login name field during
playback and doesn't replay once `caverns_intro_seen` is set; it must print `keys: OK`.

Run `npx vitest run src/intro src/audio` for the unit tests, `npx tsc --noEmit && npm run build` for
a clean typecheck/build, and `bash scripts/intro-bake.sh sizes` to confirm the shipped assets stay
under the 6 MB budget (5.6 MB as of this writing).

## Exporting a review video

```bash
node scripts/intro-render.mjs wav                                     # renders the mix
node scripts/intro-render.mjs frames 30 --to 31                       # ~930 JPEG frames, run in
                                                                        # the background if slow
ffmpeg -framerate 30 -i .intro/frames/f%05d.jpg -i .intro/intro.wav \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest .intro/intro.mp4
```

`.intro/` is gitignored — these are review artifacts, not shipped output (the game itself renders
the intro live in Canvas + Web Audio; nothing is ever a baked video in production). For a smaller
copy to share (crf 22, target <=25 MB), re-encode with a lower bitrate, e.g.
`-crf 23 -c:a aac -b:a 160k .intro/intro_share.mp4`.
