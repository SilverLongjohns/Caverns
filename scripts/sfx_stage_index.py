#!/usr/bin/env python3
"""Build client/public/audio/_staging/index.json from art/sfx/prompts.json and the staged takes."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / 'art/sfx/prompts.json'
STAGING = ROOT / 'client/public/audio/_staging'
TAKE = re.compile(r'^take_(\d+)\.mp3$')


def main() -> None:
    prompts = json.loads(PROMPTS.read_text())
    index = {}
    for sid, entry in prompts.items():
        folder = STAGING / sid
        takes = []
        if folder.is_dir():
            found = sorted((int(m.group(1)), f.name) for f in folder.iterdir() if (m := TAKE.match(f.name)))
            takes = [f'/audio/_staging/{sid}/{name}' for _, name in found]
        index[sid] = {'prompt': entry['prompt'], 'kind': entry['kind'], 'takes': takes}
    STAGING.mkdir(parents=True, exist_ok=True)
    (STAGING / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
    staged = sum(1 for v in index.values() if v['takes'])
    print(f'index.json: {staged}/{len(index)} sounds have takes')


if __name__ == '__main__':
    main()
