#!/usr/bin/env bash
# Offline asset baking for the intro cold open. Runs in WSL (ffmpeg). See client/src/intro/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART="$ROOT/art/intro"
OUT="$ROOT/client/public/intro"
PAL="$ART/palette.png"
mkdir -p "$ART/raw" "$OUT"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
sec() { awk "BEGIN{print $1/1000}"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  palette)   # 40-colour (override with MAX_COLORS env, up to 48) palette from the class portraits (style anchor), the logo, and any extra images
    mc="${MAX_COLORS:-40}"
    inputs=(); filters=""; n=0
    for f in "$ROOT"/client/public/portraits/*.png "$ROOT/client/public/Caverns_Logo.png" "$@"; do
      inputs+=(-i "$f"); filters+="[$n:v]scale=256:256:flags=neighbor,format=rgb24[s$n];"; n=$((n+1))
    done
    stack=""; for ((i=0; i<n; i++)); do stack+="[s$i]"; done
    ff "${inputs[@]}" -filter_complex "${filters}${stack}hstack=inputs=$n,palettegen=max_colors=$mc:stats_mode=full" -update 1 "$PAL"
    echo "$PAL" ;;

  layer)     # layer <src.png> <name> [dither=none|bayer]: palette-snap a still, keep alpha
    d="${3:-none}"; opt="dither=$d"; [ "$d" = bayer ] && opt="dither=bayer:bayer_scale=3"
    ff -i "$1" -i "$PAL" -filter_complex "[0:v][1:v]paletteuse=$opt:alpha_threshold=128" "$OUT/$2.png"
    echo "$OUT/$2.png" ;;

  # The plate/preview/strip/layer/palette material (the score_main, braam, plates and descent of the
  # cut 30 s version) was cut from the shipped intro (the 9 s ident); these are kept only as source tools.
  plate)     # plate <id> <src.mp4> <inSec> <durSec> [fps]: re-pixelate a video take into atlases + manifest
    id="$1"; src="$2"; ss="$3"; dur="$4"; fps="${5:-24}"
    tmp="$(mktemp -d)"
    ff -ss "$ss" -t "$dur" -i "$src" -i "$PAL" -filter_complex \
      "[0:v]fps=$fps,scale=320:180:force_original_aspect_ratio=increase:flags=area,crop=320:180,eq=contrast=1.06:saturation=1.08[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3" \
      "$tmp/f%04d.png"
    frames=$(ls "$tmp"/f*.png | wc -l)
    rm -f "$OUT/${id}"_*.png
    ff -framerate "$fps" -i "$tmp/f%04d.png" -i "$PAL" -filter_complex \
      "[0:v]format=rgb24,tile=4x4[t];[t][1:v]paletteuse=dither=none" -start_number 0 "$OUT/${id}_%02d.png"
    files=$(cd "$OUT" && ls "${id}"_*.png | sort | sed 's/.*/"&"/' | paste -sd, -)
    atlases=$(cd "$OUT" && ls "${id}"_*.png | wc -l)
    need=$(( (frames + 15) / 16 ))
    [ "$atlases" -eq "$need" ] || { echo "atlas count $atlases != expected $need" >&2; exit 1; }
    printf '{"fps":%s,"frames":%s,"cols":4,"rows":4,"w":320,"h":180,"files":[%s]}\n' "$fps" "$frames" "$files" > "$OUT/$id.json"
    ff -framerate "$fps" -i "$tmp/f%04d.png" -vf "select='not(mod(n\,12))',scale=640:360:flags=neighbor,tile=3x4" -frames:v 1 "$ART/raw/${id}_baked_contact.png"
    rm -rf "$tmp"
    echo "$id: $frames frames @${fps}fps in $atlases atlases, $(du -ch "$OUT/${id}"_*.png | tail -1 | cut -f1)" ;;

  preview)   # preview <src.mp4> <inSec> <durSec> <out.mp4>: the same re-pixelation, upscaled ×4 for eyeballing
    ff -ss "$2" -t "$3" -i "$1" -i "$PAL" -filter_complex \
      "[0:v]fps=24,scale=320:180:force_original_aspect_ratio=increase:flags=area,crop=320:180,eq=contrast=1.06:saturation=1.08[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3,scale=1280:720:flags=neighbor" \
      -c:v libx264 -crf 14 -pix_fmt yuv420p "$4"
    echo "$4" ;;

  strip)     # strip <outName> <frame.png...>: horizontal sprite strip, palette-snapped
    name="$1"; shift; n=$#; inputs=(); stack=""
    i=0; for f in "$@"; do inputs+=(-i "$f"); stack+="[$i:v]"; i=$((i+1)); done
    ff "${inputs[@]}" -i "$PAL" -filter_complex "${stack}hstack=inputs=$n[s];[s][$n:v]paletteuse=dither=none:alpha_threshold=128" "$OUT/$name.png"
    echo "$OUT/$name.png ($n frames)" ;;

  audio)     # audio <id> <src> [ss=0] [dur] [fadeInMs=5] [fadeOutMs=30] [norm=none|loud|peak]: trim, edge-fade, optionally normalize, encode AAC 48 kHz
    id="$1"; src="$2"; ss="${3:-0}"; dur="${4:-}"; fi="${5:-5}"; fo="${6:-30}"; norm="${7:-none}"
    br="${BITRATE:-192k}"
    topt=(); [ -n "$dur" ] && topt=(-t "$dur")
    pre="highpass=f=20"
    case "$norm" in
      loud) pre+=",loudnorm=I=-18:TP=-1.5:LRA=11" ;;
      peak)
        maxvol=$(ffmpeg -hide_banner -ss "$ss" "${topt[@]}" -i "$src" -af "highpass=f=20,volumedetect" -f null - 2>&1 | grep -o "max_volume: [-0-9.]* dB" | grep -o "\-\?[0-9.]*")
        gain=$(awk "BEGIN{print -3 - ($maxvol)}")
        pre+=",volume=${gain}dB"
        ;;
      none|*) : ;;
    esac
    af="$pre,aresample=48000"
    [ "$fi" != 0 ] && af+=",afade=t=in:d=$(sec "$fi")"
    [ "$fo" != 0 ] && af+=",areverse,afade=t=in:d=$(sec "$fo"),areverse"
    af+=",alimiter=limit=0.89:level=false"
    ff -ss "$ss" "${topt[@]}" -i "$src" -af "$af" -ac 2 -c:a aac -b:a "$br" -movflags +faststart "$OUT/$id.m4a"
    echo "$OUT/$id.m4a" ;;

  analyze)   # analyze <audio> <outPrefix>: loudness, true peak, silences, waveform + spectrogram PNGs
    ffmpeg -hide_banner -i "$1" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" || true
    ffmpeg -hide_banner -i "$1" -af silencedetect=n=-45dB:d=0.25 -f null - 2>&1 | grep -o "silence_\(start\|end\): [0-9.]*" || true
    ff -i "$1" -lavfi "showspectrumpic=s=1200x400:legend=1" "$2_spec.png"
    ff -i "$1" -filter_complex "showwavespic=s=1200x200" -frames:v 1 "$2_wave.png"
    echo "$2_spec.png $2_wave.png" ;;

  contact)   # contact <video> <out.png> [cols=4] [rows=3]: evenly sampled contact sheet
    c="${3:-4}"; r="${4:-3}"; n=$((c * r))
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    ff -i "$1" -vf "fps=$n/$d,scale=320:-2,tile=${c}x${r}" -frames:v 1 "$2"
    echo "$2" ;;

  sizes)     # total shipped size
    du -ch "$OUT"/* | tail -1 ;;

  *) echo "usage: scripts/intro-bake.sh palette|layer|plate|preview|strip|audio|analyze|contact|sizes ..." >&2; exit 2 ;;
esac
