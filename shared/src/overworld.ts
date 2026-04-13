export type TileKind =
  | 'floor'
  | 'wall'
  | 'grass'
  | 'path'
  | 'water'
  | 'town_floor'
  | 'door';

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
  kind: 'stash' | 'npc' | 'shop';
  label: string;
  /** Only present when kind === 'shop' */
  shopId?: string;
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
}

export function isWalkable(kind: TileKind): boolean {
  return kind !== 'wall' && kind !== 'water';
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
};

// 40×40 starter map. Town in top-left, south door at (6,11), east door at (11,6).
// Stash sits inside town at (6,6). Path runs from south door through spawn at
// (6,14) east to a dungeon portal floor tile at (37,15).
const STARTER_ROWS: string[] = [
  '########################################', // 0
  '#......................................#', // 1
  '#.##########...........................#', // 2
  '#.#::::::::#...........................#', // 3
  '#.#::::::::#...........................#', // 4
  '#.#::::::::#...........................#', // 5
  '#.#::::::::+...........................#', // 6  east door at col 11
  '#.#::::::::#...........................#', // 7
  '#.#::::::::#...........................#', // 8
  '#.#::::::::#...........................#', // 9
  '#.#::::::::#...........................#', // 10
  '#.####+#####...........................#', // 11 south door at col 6
  '#.....-................................#', // 12
  '#.....-................................#', // 13
  '#.....-................................#', // 14 spawn
  '#.....-------------------------------f.#', // 15 path east, portal floor at col 37
  '#......................................#', // 16
  '#......................................#', // 17
  '#......................................#', // 18
  '#......................................#', // 19
  '#......................................#', // 20
  '#......................................#', // 21
  '#......................................#', // 22
  '#......................................#', // 23
  '#..................~~~.................#', // 24
  '#..................~~~.................#', // 25
  '#..................~~~.................#', // 26
  '#......................................#', // 27
  '#......................................#', // 28
  '#......................................#', // 29
  '#......................................#', // 30
  '#......................................#', // 31
  '#......................................#', // 32
  '#......................................#', // 33
  '#......................................#', // 34
  '#......................................#', // 35
  '#......................................#', // 36
  '#......................................#', // 37
  '#......................................#', // 38
  '########################################', // 39
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

const STARTER_MAP: OverworldMap = {
  id: 'starter',
  name: 'Whispering Hollow',
  width: 40,
  height: 40,
  tiles: parseRows(STARTER_ROWS),
  spawnTile: { x: 6, y: 14 },
  regions: [
    {
      id: 'starter_town',
      name: 'Hollow Village',
      kind: 'town',
      bounds: { x: 2, y: 2, width: 10, height: 10 },
    },
    {
      id: 'starter_wild',
      name: 'Whispering Hollow',
      kind: 'wild',
      bounds: { x: 0, y: 0, width: 40, height: 40 },
    },
  ],
  portals: [
    {
      id: 'starter_portal',
      x: 37,
      y: 15,
      dungeonKind: 'standard',
      label: 'Dripping Halls',
    },
  ],
  interactables: [
    {
      id: 'starter_stash',
      x: 6,
      y: 6,
      kind: 'stash',
      label: 'Adventurer\u2019s Stash',
    },
    {
      id: 'starter_shop',
      x: 8,
      y: 6,
      kind: 'shop',
      label: 'General Store',
      shopId: 'starter_general_store',
    },
  ],
};

export const OVERWORLD_MAPS: Record<string, OverworldMap> = {
  starter: STARTER_MAP,
};
