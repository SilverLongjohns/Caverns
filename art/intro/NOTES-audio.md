# Intro audio: raw takes and picks (Task 10 phase A + bake, phase B)

ElevenLabs flow: "Caverns intro audio", https://elevenlabs.io/app/flows/T8kdxRgXdDtT0mMtSrF7
Raw files: `art/intro/raw/<id>_<n>.mp3` (gitignored). Analysis PNGs: `art/intro/raw/<name>_{wave,spec}.png`.
SFX: eleven_text_to_sound_v2, prompt_influence 0.5 (relay retakes 0.6). Score: eleven_music_v2, instrumental.
Nobody has listened to these yet. The picks come from measurements only, so they are provisional until the user listens.

## Picks (bake arguments)

| id | pick | in-point (s) | notes |
|---|---|---|---|
| score_main | score_main_5 | 0.32 | 28 s take. Rises steadily across the used 0.32 to 20.92 s (1 s RMS −47 → −13 dB). Band-limited drop at 21.75 s, after the cut. Alt: score_main_2 (in 0). |
| score_bloom | score_bloom_2 | 0 | Blooms right away (peak at 0.5 to 1.5 s), decays to silence by 5.4 s. Alt: score_bloom_1 (in 0.5, slow swell peaking about 4 s). |
| ambience | ambience_1 | 0 | Loops cleanly at the sample level. Has the most distinct drip events. Quietest take (−27 LUFS). Alt: ambience_3. |
| sfx_relay | sfx_relay_4 | 0 | Retake. The round-1 takes measured −50 LUFS. |
| sfx_flyback | sfx_flyback_1 | 0 | Rises at 0.2 s, sustains, settles. |
| sfx_degauss | sfx_degauss_2 | 0 | Peaks at about 0.2 s, decays by 1.3 s. |
| sfx_static | sfx_static_1 | 0 | Flat, very hot noise (−5.5 LUFS). |
| sfx_wind | sfx_wind_2 | 0 | Most gust dynamics. |
| sfx_groan | sfx_groan_1 | 0 | Swells over 0.4 s, sustains to about 2 s, long decay. |
| sfx_creak | sfx_creak_1 | 0 | Several creak events. Low confidence. |
| sfx_step | sfx_step_2 | 0 | Metallic ringing impact, then a second hit and sub drop at 0.47 s. |
| sfx_air | sfx_air_4 | 0 | Retake (14 s). Rises to 6 s, holds to 10.5 s, so it is at full level at the 9.25 s cut. |
| sfx_braam | sfx_braam_2 | 0 | Brightest and biggest. 0.13 % of samples at or above 0.98, DC −0.023. Alt: sfx_braam_3 (darker, cleanest). |
| sfx_drip | sfx_drip_1 | 0 | Sharp plip (−14 dB) and long tail. Takes 2 and 3 are nearly silent. |
| sfx_heart | sfx_heart_2 | 0 | Lub-dub at 0 / 1.0 / 2.0 s (60 bpm). |
| sfx_tick | sfx_tick_2 | 0.07 | Single clean click at about 0.08 s. |
| sfx_crackle | sfx_crackle_2 | 0 | Sustains, then fades over the last second. |

## Measurements

Scores (EBU R128 integrated / LRA / true peak; silences below −45 dB):
- score_main_1: −18.8 LUFS, LRA 24.9. Loud hit at 0 s, near-silent 4 to 9 s, peak at 16 s, then decays through 17 to 20 s, so it is quiet at the cut. Fails the rising-energy check.
- score_main_2: −14.6 LUFS. Sparse 0 to 5 s (with a hard splice-like change at about 5 s), big hit at 10.8 s, then a flat −10 dB plateau to 21.5 s. The spectrogram gets denser and brighter from 11 to 21 s, but RMS stays level.
- score_main_3: −14.0 LUFS, LRA 8. Loud and flat from 0 s with no sparse intro. Decays from 19 s, so it falls at the cut. Rejected.
- score_main_4 (28 s re-prompt): −15.9 LUFS. Loud from 1 s, flat to 20 s, peak at 22 s. No sparse intro. Leading silence 0.33 s.
- score_main_5 (28 s re-prompt): −16.2 LUFS, LRA 20. Monotonic crescendo. Rhythmic pulses from about 12.3 s, full band from 16 s, loudest at 18 to 21.7 s. Leading silence 0.36 s.
- score_bloom_1: −22.6 LUFS. Leading silence 0.5 s. Swells to −19 dB at 4 s, silent by 7.3 s.
- score_bloom_2: −23.7 LUFS. Onset 0.07 s, peak at 0.5 to 1.5 s, below −45 dB from 5.4 s.
- Vocal check: all 7 score takes were concatenated and run through Scribe. The transcript was empty (no words).

Ambience (30.000 s decoded, loop: true):
- Integrated: amb1 −27.1, amb2 −23.7, amb3 −23.5 LUFS. About 12 dB of that is below 150 Hz (after a 150 Hz high-pass: −38.9 / −36.7 / −35.9 LUFS). Laptop speakers will mostly play the drips.
- First versus last 50 ms RMS: amb1 −28.9 / −25.6, amb2 −25.2 / −21.2, amb3 −29.4 / −25.1 dB.
- Sample step across the loop point (L/R) against p99 of all sample steps: amb1 0.0001/0.0009, amb2 0.005/0.002, amb3 0.002/0.001, all at or below the p99 of about 0.002. The takes are genuinely sample-continuous.
- The 2× loop renders (`ambience_<n>_twice.wav`) show no dip or spike at 30 s in the waveform, and no silence detected.
- Watch at bake time: `ffprobe` reports 30.04 s because of MP3 padding, and `-sseof -0.05` measures that padding as −inf. The AAC re-encode adds priming samples, so the seam must be re-checked on the baked m4a, as the brief's Step 5 says.

## Bake (Task 10, phase B)

All picks from the table above (user-approved, unchanged). The `audio` subcommand was extended (controller ruling) with a 7th `norm` argument: `highpass=f=20` is now always applied first (removes DC offset), then optionally `loudnorm=I=-18:TP=-1.5:LRA=11` (`loud`) or a single-pass peak-to-−3dBFS `volume` gain measured with `volumedetect` (`peak`), then the existing edge fades, then always `alimiter=limit=0.89:level=false` to stop AAC overs.

- `loud` (sustained/atmospheric cues): score_main, score_bloom, ambience, sfx_wind, sfx_air, sfx_groan, sfx_heart, sfx_static.
- `peak` (one-shots): sfx_relay, sfx_flyback, sfx_degauss, sfx_creak, sfx_step, sfx_braam, sfx_drip, sfx_tick, sfx_crackle.
- Ambience kept `fadeIn=0 fadeOut=0` (no edge fades), per the brief.

Bake commands (in-points/fades as in the picks table; `art/intro/raw/<id>_<n>.mp3` sources):
```
audio score_main   score_main_5.mp3   0.32 "" 5   30  loud
audio score_bloom  score_bloom_2.mp3  0    "" 5   200 loud
audio ambience     ambience_1.mp3     0    "" 0   0   loud
audio sfx_relay    sfx_relay_4.mp3    0    "" 5   30  peak
audio sfx_flyback  sfx_flyback_1.mp3  0    "" 5   30  peak
audio sfx_degauss  sfx_degauss_2.mp3  0    "" 5   30  peak
audio sfx_static   sfx_static_1.mp3   0    "" 5   30  loud
audio sfx_wind     sfx_wind_2.mp3     0    "" 5   30  loud
audio sfx_groan    sfx_groan_1.mp3    0    "" 5   30  loud
audio sfx_creak    sfx_creak_1.mp3    0    "" 5   30  peak
audio sfx_step     sfx_step_2.mp3     0    "" 5   30  peak
audio sfx_air      sfx_air_4.mp3      0    "" 5   30  loud
audio sfx_braam    sfx_braam_2.mp3    0    "" 5   30  peak
audio sfx_drip     sfx_drip_1.mp3     0    "" 5   30  peak
audio sfx_heart    sfx_heart_2.mp3    0    "" 5   30  loud
audio sfx_tick     sfx_tick_2.mp3     0.07 "" 5   30  peak
audio sfx_crackle  sfx_crackle_2.mp3  0    "" 5   30  peak
```

### Post-bake I/Peak (ruling: analyze score_main, ambience, sfx_braam)

| file | I (LUFS) | LRA | Peak (dBFS) |
|---|---|---|---|
| score_main.m4a | -14.6 | 11.9 | -1.6 |
| ambience.m4a | -17.9 | 1.1 | -4.9 |
| sfx_braam.m4a | -10.6 | 20.0 | -0.7 |

`loudnorm` here is explicitly single-pass ("two-pass-free" per the controller ruling), so the measured I lands a few LU above the -18 target (score_main -14.6, ambience -17.9 is close) rather than matching it exactly; all peaks sit at or below the `alimiter` ceiling (≈ -1.0 dBFS for `limit=0.89`), so no AAC-encode overs.

### Ambience loop-seam check

`ffmpeg -i ambience.m4a -af "aloop=loop=1:size=2e9" -t 60 amb_twice.wav` then `analyze` on it showed no silence detection at -45 dB and a continuous-looking waveform at 30 s, **but** a tighter, sample-level check (Python, reading raw PCM) found an exact-zero run of ~12 ms starting about 3.9 ms after the nominal seam, reproducible identically with `ambience_3` as the source too — i.e. it is an artifact of ffmpeg's own CLI decode of the AAC edit list (elst media_time=1024, the encoder's priming delay), not a content mismatch between the take's first/last 50 ms (the raw take starts with normal non-zero content, no leading silence). Re-baking from a different take would not remove it, since it reproduces identically regardless of source.

The app never loops the encoded file this way, though (`client/src/audio/audioEngine.ts`: "The ambience is a decoded buffer looped sample-accurately (HTMLAudio loops of AAC have gaps)" — it calls `ctx.decodeAudioData` once and loops the resulting `AudioBuffer` in the PCM domain). That is the path that actually matters, so it was checked directly with a Playwright probe against the real dev server, using Edge's own Web Audio decoder:
```
node scripts/tmp-ambience-probe.mjs http://localhost:5173   # scratch script, removed after use
```
Result: `decodeAudioData` produces a buffer of exactly 1,440,000 samples (30.000000 s @ 48 kHz) — no exact-zero run at all at the start or end, only 37 samples (0.77 ms) below a 0.002 near-zero threshold at the very start and 9 samples (0.19 ms) at the tail, both inaudible. **No re-bake needed**; the ffmpeg CLI loop check was a false positive from the CLI's own decode path, not a real gap in what the game plays.

Total shipped size (`sizes`, plates + audio): **5.6 MB**, under the 6 MB gate — no 128k SFX re-encode needed.

## Retakes beyond the brief
- score_main_4/5: prompted for "one continuous crescendo, no fade, no outro" at 28 s, so the model's natural ending lands after the 20.6 s actually used.
- sfx_relay_4/5: all three round-1 relay takes were about −50 LUFS with peaks of −24 to −29 dBFS.
- sfx_air_4/5 (14 s): round-1 air takes all decayed before the 9.25 s hard cut (air_1 also had 0.67 s of leading silence).
