# The intro cold open

A 9-second, wordless CRT ident that plays before the login screen the first time a browser visits
Caverns. It speaks only the game's own language — an amber-terminal dungeon crawler: an old set
powers on into dead static that dies to black, a single drip lands in the silence, a heartbeat as
eleven pairs of red eyes open, then the ASCII cavern scans in, the logo burns in, and the whole
frame crossfades onto the live login screen underneath, pixel for pixel.

| Time (s)  | Shot      | Beat |
|-----------|-----------|------|
| gate      | —         | dead-TV glass with a standby LED and `▌ PRESS ANY KEY` (needed for the audio unlock) |
| 0–1.6     | `power`   | dot → line → tube snaps open (the only hit) → snow with one vertical roll, barrel relaxing; the snow cools from the edges into black (`BG`) — there is no picture under it |
| 1.6–2.4   | `dark`    | black and hard silence |
| 2.4       | `dark`    | `DRIP_T`: one drip and a ripple of light |
| 2.8–4.8   | `dark`    | heartbeat; the 11 eye pairs open in `EYE_ORDER`, one every 0.2 s, each with a tick |
| 5.0–7.2   | `resolve` | the ASCII cavern scans in (`GLYPH_T0`–`GLYPH_T1`), chord bloom + crackle at 5.0 |
| 6.0–7.4   | `resolve` | the logo burns in (`LOGO_T0`–`LOGO_T1`); menu ambience starts fading in at `MUSIC_RELEASE_T` = 6.0 |
| 7.4–8.4   | `resolve` | canvas eyes converge on the live DOM eyes' opacity |
| 8.0–8.8   | `resolve` | whole-frame crossfade to the real login DOM (`UNDERLAY_T0`–`UNDERLAY_T1`); done at 9.0 |

Any key or click during playback skips: the clock jumps to the start of the resolve (`SKIP_FROM`
= 5.0, or carries on from later) and runs at 3×, with `SKIP_CUES` replacing the rest of the audio.

An earlier 30-second cut (a wasteland, a monolith threshold and a fall through four strata, built
from AI video plates and PixelLab layers) was rejected as not fitting the game. Its source art and
the notes behind it are still in `art/intro/` (`NOTES.md`, `NOTES-descent.md`) and in git history,
should any of it be wanted elsewhere; the shipped assets and shot code for it are gone.

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
  timeline.ts        shots, key times, the hit, eye order, audio cues and MASTER_TRIM — the single
                      source of truth (see below)
  introState.ts      should-play logic, seen flag, URL params
  introStore.ts      zustand store: active / musicHold / gateless
  clock.ts           IntroClock (skip-aware) + pickClockSource
  layout.ts          coverFit, glyphRevealTime (pure) + measureLayout (DOM)
  assets.ts          asset manifest + loader (the logo, plus the audio under client/public/intro/)
  audio.ts           planCues/encodeWav (pure) + scheduleCues (Web Audio) + renderIntroMix
  renderer.ts        IntroRenderer: low-res (320x180) scene composited, upscaled, CRT-posted,
                      then native-resolution layers (glyphs, logo, eyes) drawn on top
  shots/power.ts     power-on: dead glass (gate), raster glow + CRT warm-up pass (snow, roll,
                      barrel, cooling into black), tube aperture
  shots/dark.ts      the drip + ripple (low-res) and the eleven cave eyes (native res)
  shots/resolve.ts   ASCII glyph cavern build-in, logo burn-in, whole-frame crossfade to the real DOM
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
scripts/intro-bake.sh                   ffmpeg pipeline: audio conditioning, analysis, sizes (plus the
                                         palette/plate/layer/strip tools the cut shots used)
scripts/intro-render.mjs                Playwright tooling: stills, frames, wav, handoff, keys
client/public/intro/                    shipped, baked audio (cues + the menu ambience loop)
art/intro/                              source art for the cut 30 s version, kept for reuse:
                                         palette.png + keyframes (tracked); raw/ generations
                                         (gitignored); NOTES*.md (picks and rationale, tracked)
```

## `timeline.ts` is the single source of truth

Every shot boundary, key moment (the end of the power-on, the drip, when each of the eleven cave
eyes opens, when the glyphs and logo build, the crossfade) and every audio cue's timing and gain lives in
`timeline.ts` as plain data. `renderer.ts` and the `shots/*` modules read the same constants the
audio scheduler reads (`audio.ts`'s `scheduleCues`/`renderIntroMix`), so picture and sound can never
drift apart — moving a hit or a shot boundary is a one-line change in one file. `MASTER_TRIM` is
the single global level knob for the whole mix (see "Tuning the mix" below); everything else is a
per-cue `gain` in the `CUES` array.

## Tuning a shot

Use the `stills` tool to render exact frames without playing the piece. It needs the Vite dev
server running (`npm run dev`):

```bash
node scripts/intro-render.mjs stills 0.03,0.3,0.8,1.3,1.7,2.45,3.5,4.9,5.6,6.5,7.3,8.3 [--out .intro/stills] [--viewport 1920x1080]
```

Each time renders through `window.__intro.render(t)`, the same code path the real playback loop
uses, so what you see is exactly what ships. Edit the shot module or `timeline.ts`, re-run, look at
the PNGs.

## Re-baking audio

All offline asset baking happens in WSL via ffmpeg (`scripts/intro-bake.sh`; not available on
Windows). Every audio pick (raw take, in-point, fades, normalization mode) and the post-bake
loudness/peak measurements are recorded in `art/intro/NOTES-audio.md` — read it before touching a
bake command. (It also covers the cues the cut 30 s version used; only the ids in `AUDIO_IDS` ship.)
`art/intro/NOTES.md` and `NOTES-descent.md` document the palette, plates and descent layers of the
cut shots, for reference only.

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
gitignored — regenerate or re-fetch them if needed, they are not committed.

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
`MASTER_TRIM = 1.45` gives I = -16.7 LUFS, true peak = -1.3 dBFS over the 12 s render (9 s piece +
3 s of ambience tail), with the expected hard silence at about 1.57-2.41 s (end of the power-on to
the drip). The power-on cues are deliberately trimmed so the tube snap tops out only ~2 LU
(momentary) above the chord bloom — the bloom is the payoff and must not sound smaller than the relay.

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
t=8.99 (canvas should already be fully transparent — mean diff <=1.5, <=0.5% of pixels differing
by >24), and a stricter alignment check at t=7.99 (just before the crossfade; canvas still fully opaque) that also verifies
the glyph cavern and logo are registered to within one CSS pixel against the live DOM. Both must
print `PASS`. `keys` checks the intro doesn't leak keystrokes into the login name field during
playback and doesn't replay once `caverns_intro_seen` is set; it must print `keys: OK`. (It types
three seconds after the gate, i.e. during the dark: the first key skips, the rest arrive mid-skip.)
`ALIGN_T`/`SMOKE_T` in the script mirror `UNDERLAY_T0`/`DURATION` — update them if those move.

Run `npx vitest run src/intro src/audio` for the unit tests, `npx tsc --noEmit && npm run build` for
a clean typecheck/build, and `bash scripts/intro-bake.sh sizes` to confirm the shipped assets stay
under the 6 MB budget (1.4 MB as of this writing).

## Exporting a review video

```bash
node scripts/intro-render.mjs wav                                     # renders the mix
node scripts/intro-render.mjs frames 30 --to 9.5                      # 285 JPEG frames
ffmpeg -framerate 30 -i .intro/frames/f%05d.jpg -i .intro/intro.wav \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest .intro/intro.mp4
```

`.intro/` is gitignored — these are review artifacts, not shipped output (the game itself renders
the intro live in Canvas + Web Audio; nothing is ever a baked video in production). For a smaller
copy to share (crf 22, target <=25 MB), re-encode with a lower bitrate, e.g.
`-crf 22 -c:a aac -b:a 160k .intro/intro_share.mp4` (about 8 MB for the 9.5 s export).
