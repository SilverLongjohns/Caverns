export type TileKind =
  | 'floor'
  | 'wall'
  | 'grass'
  | 'path'
  | 'water'
  | 'town_floor'
  | 'door'
  | 'pillar';

export interface OverworldRegion {
  id: string;
  name: string;
  kind: 'town' | 'wild';
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OverworldPortal {
  id: string;
  x: number;
  y: number;
  dungeonKind: 'standard';
  label?: string;
}

export interface OverworldInteractable {
  id: string;
  x: number;
  y: number;
  kind: 'stash' | 'npc' | 'shop' | 'sign';
  label: string;
  /** Only present when kind === 'shop' */
  shopId?: string;
  /** Optional descriptive tooltip shown on hover/inspect */
  tooltip?: string;
}

export interface OverworldMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  spawnTile: { x: number; y: number };
  regions: OverworldRegion[];
  portals: OverworldPortal[];
  interactables: OverworldInteractable[];
  /** Optional per-tile theme tag parallel to `tiles` (e.g. 'rock', 'dirt'). */
  themes?: (string | null)[][];
}

export function isWalkable(kind: TileKind): boolean {
  return kind !== 'wall' && kind !== 'water' && kind !== 'pillar';
}

export function getTile(map: OverworldMap, x: number, y: number): TileKind | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.tiles[y][x];
}

const LEGEND: Record<string, TileKind> = {
  '#': 'wall',
  '.': 'grass',
  '-': 'path',
  '~': 'water',
  ':': 'town_floor',
  '+': 'door',
  'f': 'floor',
  'P': 'pillar',
};

// 40×22 starter map. Hollow Village: two rows of three 8-wide houses each,
// separated by a central plaza. Stash (5,4) and General Store (15,4) in the
// north row; Miller/Hunter/Elder homesteads in the south row. Spawn is on the
// main road at (14,17). The road runs east past the village to the dungeon
// portal floor at (37,17), flanked by four ominous pillars.
const STARTER_ROWS: string[] = [
  '########################################', // 0
  '#......................................#', // 1
  '#.########..########..########.........#', // 2  north house tops
  '#.#::::::#..#::::::#..#::::::#.........#', // 3
  '#.#::::::#..#::::::#..#::::::#.........#', // 4  stash (5,4), shop (15,4)
  '#.#::::::#..#::::::#..#::::::#.........#', // 5
  '#.#::::::#..#::::::#..#::::::#.........#', // 6
  '#.###.####..###.####..###.####.........#', // 7  south walls, doors (5,7)(15,7)(25,7)
  '#......................................#', // 8  plaza row — signs for north houses
  '#......................................#', // 9  plaza row — signs for south houses
  '#.###.####..###.####..###.####.........#', // 10 south house tops, doors (5,10)(15,10)(25,10)
  '#.#::::::#..#::::::#..#::::::#.........#', // 11
  '#.#::::::#..#::::::#..#::::::#.........#', // 12
  '#.#::::::#..#::::::#..#::::::#.........#', // 13
  '#.#::::::#..#::::::#..#::::::#.........#', // 14
  '#.########..########..########.........#', // 15 south house bottoms (sealed)
  '#...................................P.P#', // 16 pillars (36,16)(38,16)
  '#.............-----------------------f.#', // 17 spawn (14,17); portal (37,17)
  '#...................................P.P#', // 18 pillars (36,18)(38,18)
  '#......................................#', // 19
  '#.................~~~..................#', // 20 wild pool
  '########################################', // 21
];

function parseRows(rows: string[]): TileKind[][] {
  return rows.map((row, y) => {
    if (row.length !== 40) {
      throw new Error(`starter map row ${y} has length ${row.length}, expected 40`);
    }
    return [...row].map((ch) => {
      const kind = LEGEND[ch];
      if (!kind) throw new Error(`starter map row ${y} has unknown char '${ch}'`);
      return kind;
    });
  });
}

function buildStarterThemes(tiles: TileKind[][]): (string | null)[][] {
  return tiles.map((row) =>
    row.map((t) => {
      if (t === 'wall' || t === 'pillar') return 'rock';
      if (t === 'floor') return 'dirt';
      return null;
    }),
  );
}

const STARTER_TILES: TileKind[][] = parseRows(STARTER_ROWS);

const STARTER_MAP: OverworldMap = {
  id: 'starter',
  name: 'Whispering Hollow',
  width: 40,
  height: 22,
  tiles: STARTER_TILES,
  themes: buildStarterThemes(STARTER_TILES),
  spawnTile: { x: 14, y: 17 },
  regions: [
    {
      id: 'starter_town',
      name: 'Hollow Village',
      kind: 'town',
      bounds: { x: 1, y: 1, width: 30, height: 15 },
    },
    {
      id: 'starter_wild',
      name: 'Whispering Hollow',
      kind: 'wild',
      bounds: { x: 0, y: 0, width: 40, height: 22 },
    },
  ],
  portals: [
    {
      id: 'starter_portal',
      x: 37,
      y: 17,
      dungeonKind: 'standard',
      label: 'Dripping Halls',
    },
  ],
  interactables: [
    {
      id: 'starter_stash',
      x: 5,
      y: 4,
      kind: 'stash',
      label: 'Adventurer\u2019s Stash',
    },
    {
      id: 'starter_shop',
      x: 15,
      y: 4,
      kind: 'shop',
      label: 'General Store',
      shopId: 'starter_general_store',
    },
    {
      id: 'starter_sign_stash',
      x: 5,
      y: 8,
      kind: 'sign',
      label: 'Stash',
      tooltip: 'Adventurer\u2019s Stash \u2014 deposit and withdraw gear',
    },
    {
      id: 'starter_sign_shop',
      x: 15,
      y: 8,
      kind: 'sign',
      label: 'General Store',
      tooltip: 'General Store \u2014 buy and sell wares',
    },
    {
      id: 'starter_sign_weaver',
      x: 25,
      y: 8,
      kind: 'sign',
      label: 'Eldra the Weaver',
      tooltip: 'Eldra the Weaver \u2014 home of the village cloth-maker',
    },
    {
      id: 'starter_sign_miller',
      x: 5,
      y: 9,
      kind: 'sign',
      label: 'Miller\u2019s Cottage',
      tooltip: 'Miller\u2019s Cottage \u2014 the old mill has long since gone quiet',
    },
    {
      id: 'starter_sign_hunter',
      x: 15,
      y: 9,
      kind: 'sign',
      label: 'Hunter\u2019s Lodge',
      tooltip: 'Hunter\u2019s Lodge \u2014 pelts and snares line the walls',
    },
    {
      id: 'starter_sign_elder',
      x: 25,
      y: 9,
      kind: 'sign',
      label: 'Hamlin\u2019s Hut',
      tooltip: 'Old Hamlin\u2019s Hut \u2014 the village elder lives here',
    },
  ],
};

export const OVERWORLD_MAPS: Record<string, OverworldMap> = {
  starter: STARTER_MAP,
};
