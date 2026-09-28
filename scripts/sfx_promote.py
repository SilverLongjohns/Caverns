#!/usr/bin/env python3
"""Promote auditioned SFX takes.

Usage: python3 scripts/sfx_promote.py path/to/picks.json

One-shots: trim silence, loudness-normalise to -18 LUFS, mono 128k.
Beds (generated as seamless loops): static gain to -26 LUFS, stereo 160k, no trimming.
Writes client/public/audio/sfx/<id>_<n>.mp3 and merges client/src/audio/sfxFiles.json.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get('SFX_ROOT', Path(__file__).resolve().parent.parent))
PUBLIC = ROOT / 'client/public'
STAGING = PUBLIC / 'audio/_staging'
OUT = PUBLIC / 'audio/sfx'
FILES_JSON = ROOT / 'client/src/audio/sfxFiles.json'


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def promote_oneshot(src, dst):
    af = ('silenceremove=start_periods=1:start_threshold=-50dB,'
          'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
          'loudnorm=I=-18:TP=-1.5:LRA=11,aresample=44100')
    ffmpeg(['-i', str(src), '-af', af, '-ac', '1', '-b:a', '128k', str(dst)])


def integrated_lufs(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', 'ebur128', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])


def promote_bed(src, dst):
    # Beds are generated as seamless loops; one static gain keeps the seam intact
    # (single-pass loudnorm varies gain over time and would put a step at the loop point).
    gain_db = -26 - integrated_lufs(src)
    ffmpeg(['-i', str(src), '-af', f'volume={gain_db:.2f}dB,aresample=44100', '-ac', '2', '-b:a', '160k', str(dst)])


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    picks = json.loads(Path(sys.argv[1]).read_text())
    index = json.loads((STAGING / 'index.json').read_text())
    files = json.loads(FILES_JSON.read_text()) if FILES_JSON.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    rerolls = []
    for sid, pick in sorted(picks.items()):
        if pick.get('reroll'):
            rerolls.append(f"{sid}: {pick['reroll']}")
        keep = sorted(set(pick.get('keep', [])))
        if not keep:
            continue
        entry = index[sid]
        mine = re.compile(rf'^{re.escape(sid)}_\d+\.mp3$')
        for old in OUT.iterdir():
            if mine.match(old.name):
                old.unlink()
        urls = []
        for n, take in enumerate(keep, start=1):
            src = PUBLIC / entry['takes'][take].lstrip('/')
            dst = OUT / f'{sid}_{n}.mp3'
            (promote_bed if entry['kind'] == 'bed' else promote_oneshot)(src, dst)
            urls.append(f'/audio/sfx/{dst.name}')
        files[sid] = urls
        print(f'promoted {sid}: {len(urls)} take(s)')
    FILES_JSON.write_text(json.dumps(dict(sorted(files.items())), indent=2) + '\n')
    if rerolls:
        print('\nRe-roll requested:')
        for r in rerolls:
            print(f'  {r}')


if __name__ == '__main__':
    main()
