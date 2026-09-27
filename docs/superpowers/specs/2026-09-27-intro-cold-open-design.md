# Intro Cold Open — Design

**Date:** 2026-09-27
**Status:** Approved in brainstorming; awaiting spec review

## Intent

Add a ~30-second, wordless, high-production-value cinematic cold open that plays before the
login screen on first visit and **resolves seamlessly into the existing login screen**.

What the user asked for:
- Cold open before the title/login screen; skippable; replayable.
- A mood piece with no words: no narration, lore text or title cards (the logo excepted).
- Hybrid picture: a canvas engine carries the piece, and AI video plates are used where natural motion pays off.
- Audio from ElevenLabs (Music v2 score, SFX v2 effects and ambience).
- Opens with an old-TV CRT power-on.
- `CaveBackground` (ASCII cavern and eyes) and the logo stay **unchanged**. They are the destination.
- Production value is the top priority.

Art direction: Caves-of-Qud-style retro-future post-collapse, with relic megastructures, salt waste and strange skies. No classic fantasy. The class portraits in `client/public/portraits` are the style anchor.

Success criteria:
- A first-time visitor sees a TV switch on, a 30 s cinematic, and a final frame that is pixel-for-pixel the
  login screen. There's no visible cut at the handoff.
- Picture and sound stay in sync on all hits, even when frames drop.
- It's never a blocker: skip, failure or reduced-motion always reach a working login screen quickly.
- AI plates are indistinguishable in style from the PixelLab pixel art after re-pixelation.

## Storyboard (30.0 s)

| Time | Shot | Source | Picture | Sound |
|---|---|---|---|---|
| gate | **DEAD TV** | Canvas | Near-black glass, faint curved-tube reflection, standby-LED glow; dim `▌ PRESS ANY KEY`. | Silence. |
| 0.00–1.60 | **POWER-ON** | Canvas | Keypress → a white dot at centre stretches to a horizontal line (0.25 s) → snaps open vertically with an overbright flash, a degauss colour wobble and strong barrel distortion → snow/static, vertical hold rolls once, channel tunes into the Waste plate while the barrel relaxes. | Relay clunk + flyback whine; degauss thwumm; static bed. |
| 1.60–8.00 | **THE WASTE** | AI plate #1 | Dusk over a salt flat. A colossal half-buried monolith with dead signal lights, one of which flickers once. Clouds race and salt dust streams. A tiny masked figure stands at its foot. Slow push-in. | Wind, low drone, distant machine groan; score enters softly. |
| 8.00–13.00 | **THE THRESHOLD** | AI plate #2 | The figure at a square shaft cut into the monolith's base, lantern light on their mask. They look down, then step off. | Lantern creak, held breath; **hit** on the step (~12.6 s). |
| 13.00–22.00 | **THE DESCENT** | Canvas | A vertical fall through strata in 4–5 parallax planes: relic conduits, dead screens flickering game glyphs, fungal bioluminescence, crystal veins, dark rock. The figure tumbles as a small silhouette in lantern light. The daylight above shrinks to a coin, then a star. | Rising score; braam at each of 3 stratum boundaries; rushing air and debris. |
| 22.00–26.00 | **THE DARK** | Canvas | Hard cut to black, total silence. One drip lands with a ripple of light. Eyes open pair by pair at exactly the `CaveBackground` `EYES` positions. | Silence → drip → heartbeat → a wet tick per eye pair. |
| 26.00–30.00 | **THE RESOLVE** | Canvas → DOM | Phosphor glyphs `░▒▓█` scan in line by line and build the real stalagmites and stalactites in their exact layout. The logo burns in with its existing glow. The prompt cursor blinks. Invisible swap to the live DOM. | Final chord blooms and decays into the menu ambience loop; glyph crackle. |

The figure is a generic gas-masked sump, not one of the four classes. The opening is a warming-up
analogue set, deliberately distinct from the trailer's clean CRT wake.

## Architecture

New directory `client/src/intro/`:

| Unit | Responsibility |
|---|---|
| `timeline.ts` | Shot table, hit marks, SFX cue list, durations. Single source of truth. Hits drive both picture effects (shake, flash, chromatic split) and SFX scheduling. Pure data + lookup helpers. |
| `shots/*.ts` | One pure function per shot: `(ctx, localT, assets, layout) => void`. Any frame is renderable in isolation. |
| `compositor.ts` | Renders at an internal 320×180, upscales nearest-neighbour, then applies bloom, grain, shake, chromatic split, vignette and CRT power-on barrel distortion. The app's existing scanline/flicker overlay remains on top. |
| `plate.ts` | Draws the current `<video>` frame through re-pixelation: downsample to 320×180 → snap to the shared palette → ordered (Bayer) dither on gradients. |
| `audio.ts` | Web Audio graph: score buffer + SFX one-shots scheduled at timeline marks against `AudioContext.currentTime`; ambience loop with crossfade. Exposes the audio clock. |
| `assets.ts` | Preloads images, videos and audio buffers with a timeout; reports readiness or failure. |
| `introState.ts` | `localStorage` flag `caverns_intro_seen` (try/catch-guarded), `?intro` force-play, `?still=t` param, reduced-motion check. |
| `IntroCutscene.tsx` | React wrapper: canvas, gate, input (skip), render loop, lifecycle, `onDone`. |

**Clocking:** the picture time is derived from `AudioContext.currentTime` minus the start offset, so picture follows audio. Without audio (muted/unavailable) it falls back to `performance.now()`.

**Palette:** a ~32-colour palette derived from the class portraits plus the logo gold, stored in
`timeline.ts` (or `palette.ts`). All PixelLab layers and the re-pixelated plates snap to it.

## Integration & flow

1. `App` decides whether to show the intro: on first visit (flag unset) or `?intro`, and not under
   `prefers-reduced-motion`. It covers both the `connecting` and `login` views. `LoginScreen` renders underneath but hidden, so connection proceeds behind the intro.
2. **Gate:** the dead-TV screen. The keypress/click unlocks audio (browsers require a gesture) and starts playback. Assets preload behind the gate.
3. **Exact handoff:** from 26 s the component measures the real `LoginScreen` DOM
   (`getBoundingClientRect` on each stalagmite/stalactite `<pre>`, each eye element, and the logo) plus
   computed fonts, and draws the glyph build-up at those exact coordinates at full resolution. The glyph and logo layers render at native resolution rather than 320×180, so they match the DOM. At 30.0 s the canvas fades out over ~300 ms onto identical pixels, sets the seen flag, and unmounts.
4. **Skip:** any key/click after the gate → 1 s accelerated glyph-scan → handoff. On the gate itself, Escape skips entirely.
5. **Replay:** a small dim `↺ intro` link in a corner of `LoginScreen` (the only change to that screen), plus `?intro`.
6. **Fallbacks:** assets fail, or aren't ready 8 s after the gate → go straight to the login screen. Any runtime error in the render loop → handoff immediately. The intro never blocks login.

**Music:** after the intro, the ElevenLabs ambience loop plays on login, character select and character create.
On entering a world it crossfades to `gasket_maples`. `MusicPlayer`'s mute/volume controls both, and the
existing `caverns_music_volume` key is reused. If the intro is skipped entirely (seen before), the ambience
starts on the first user gesture, as `gasket_maples` does today.

## Assets

`client/public/intro/`. Target total under 6 MB.

- `plate_waste.mp4`, `plate_threshold.mp4`: 720p, H.264, no audio, ~1–2 MB each
- PixelLab layers: Waste and Threshold keyframes (320×180, also plate start frames), 5 tileable descent strata, tumbling-figure sprite sheet, lantern glow
- `score.m4a`, `ambience.m4a` (seamless loop), SFX one-shots (`.m4a`)

## Production pipeline

**Picture**
1. Derive the palette from the portraits and the logo.
2. PixelLab keyframes for the Waste and the Threshold at 320×180.
3. ElevenLabs image-to-video from each keyframe: several takes across Veo 3.1, Kling 3.0 and Seedance 2.5. Takes are judged as rendered through `plate.ts`, not raw.
4. PixelLab descent strata, figure sprite and lantern glow. Dead screens reuse the game's glyph sprites.

**Audio**
1. Score: Music v2, instrumental, ~31 s, prompted with a time-structured arc (sparse drone + lonely metallic motif → building low strings and pulses → hard stop at 22 s → silence → dissonant-resolving chord bloom at 26 s). Several takes; trim/align so the stop is exactly 22.0 s. **Fallback:** two separate cues (0–22 s and 26–30 s) placed precisely, which guarantees the silence.
2. Ambience: SFX v2 `loop: true`, 30 s: room tone, drips, machine hum, distant groans. Verify the loop seam.
3. SFX v2, 2–3 takes each: relay clunk + flyback whine, degauss, static, wind, machine groan, step-off hit,
   3 braams, rushing air, drip, heartbeat, eye tick, glyph crackle.
4. Mix levels are set in the `timeline.ts` cue list. Master normalized to ~−16 LUFS.

Expected spend: ~10–15 image generations, 6–10 video takes, 3–5 music takes, ~30 SFX takes (approved).

## Testing & review

- **Vitest:** `timeline` (shot lookup at boundaries, marks sorted and within duration, total = 30.0 s,
  shots contiguous); `introState` (flag read/write incl. throwing storage, `?intro`, reduced-motion,
  skip-state transitions).
- **Stills:** `?intro&still=<t>` renders one frame. Headless screenshot pass (same method as
  `trailer/tools/render.mjs`) at key times per shot, reviewed visually.
- **Handoff check:** screenshot at 30.0 s vs the DOM login screen at 1280×720 and 1920×1080. They must match.
- **Full export:** MP4 with audio via headless frame capture, reviewed end-to-end and delivered to the user.
- Manual: skip at several points, replay link, reduced-motion, blocked audio, slow network (throttled).

## Out of scope

- Any change to `CaveBackground`, the logo, or the login input behaviour (beyond the replay link).
- Settings screen, credits, new menu features.
- Changes to the trailer.
