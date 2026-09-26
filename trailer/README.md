# Caverns — Trailer

A 96-second cinematic trailer for Caverns, built in plain JavaScript: Canvas 2D for picture, Web Audio for sound. No libraries and no build step.

## Watch

Open `trailer/index.html` in a browser. Click to begin (sound on).

| Key | Action |
| --- | --- |
| Space / click | play · pause |
| ← / → | seek 5 s |
| R | restart |
| F | fullscreen |

URL params: `?t=42` starts at 42 s, `?still=42` renders one frame, `?mute` runs without audio.

Serving the folder over HTTP gives sample-accurate A/V sync. For example, run `npx serve trailer` or use the server built into `tools/render.mjs`. Opening from `file://` also works; sync then falls back to an `<audio>` element clock.

## How it's built

| File | Role |
| --- | --- |
| `js/core.js` | Timeline constants, easing/noise helpers, typed-text and impact cue tables, asset loading |
| `js/scenes.js` | Every shot, written as a pure function of time. Any frame can be rendered on demand |
| `js/score.js` | The soundtrack, fully synthesized: drones, braams, taiko, string ostinato, horns, formant choir, risers and SFX. It's scheduled into an `OfflineAudioContext` |
| `js/main.js` | Compositor: camera shake, chromatic split on hits, bloom, film grain, scanlines, vignette, letterbox. Also handles playback and export hooks |
| `tools/render.mjs` | Zero-dependency headless renderer (DevTools protocol) for stills, the score WAV and MP4 export |

Picture and sound share one source of truth. `TYPED` in `core.js` drives both the on-screen typing and the key-click SFX. `HITS` drives shake, flash and aberration on the same marks where the score lands its impacts.

`assets/score.m4a` is a cached render of `score.js`, so playback can start at once. If it's missing, the player synthesizes the score live, which takes about 30–60 s. To regenerate it after editing the score:

```bash
node tools/render.mjs wav out/score.wav
ffmpeg -y -i out/score.wav -c:a aac -b:a 256k -movflags +faststart assets/score.m4a
```

## Export to video

```bash
node tools/render.mjs wav out/score.wav
node tools/render.mjs frames 60 | ffmpeg -f image2pipe -framerate 60 -c:v mjpeg -i - -i out/score.wav \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 320k -shortest out/caverns-trailer.mp4
```

Frames come straight off the canvas at exact timestamps, so the export is frame-perfect however fast the machine is. Set `BROWSER` if Edge/Chrome isn't at the default path.

## Art

- Existing game art: class portraits, shopkeep, town backdrop, logo (`client/public`).
- New pixel art generated with PixelLab for the trailer: six biome backdrops (cave mouth, Fungal Depths, Crystal Caverns, Drowned Passages, Ossuary Halls, Magma Rifts), the throne room, the Mycelium King, the Rat King, the Charnel King, the Forge Titan and the Drowned Leviathan.
- Fonts (SIL OFL): Cinzel, Cormorant Garamond Italic, VT323.

## Script

| Time | Beat |
| --- | --- |
| 0:00 | A CRT wakes: *"Daylight fades behind you."* |
| 0:06 | The last fire. The shopkeep: *"Another sump for the deep. Coin up front. The dead don't pay."* |
| 0:15 | The cave mouth. *"Every delve begins where the light ends."* Push into the dark. |
| 0:21 | Tunnel dive, with subliminal flashes of what waits below → **EVERY DELVE / A NEW DARK** |
| 0:27 | Depths II–VI: Fungal, Crystal, Drowned, Ossuary, Magma, one bar each |
| 0:42 | **FOUR CALLINGS / WHO DESCENDS?** Then Templar, Phaseknife, Suturist, Junk Prophet |
| 0:57 | Lineup: **CO-OP FOR 1–4 PLAYERS / ONE SHARED DARK** |
| 1:00 | Montage: combat log, threat skulls, PERFECT QTE crit, Worldsplitter drop with need/greed/pass, downed and sutured |
| 1:12 | Hard cut to silence. Heartbeat. *Throne of the Mycelium King.* Eyes open |
| 1:18 | The King. **DESCEND TOGETHER. / OR FALL TOGETHER.** |
| 1:24 | Logo. *A co-operative dungeon crawler for 1–4 players.* `> PLAY IN YOUR BROWSER` |
