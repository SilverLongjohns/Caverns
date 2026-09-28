import { describe, it, expect } from 'vitest';
import { classify, vertexTile, autotile } from './autotile.js';
import type { TerrainManifest } from './terrainManifest.js';

interface Grid {
  width: number;
  height: number;
  tiles: string[][];
  themes?: (string | null)[][];
}

/** Builds a grid from rows of chars: # wall, . floor, ~ water, X chasm, = bridge, ^ hazard, E exit, T wall+torch. */
function buildGrid(rows: string[]): Grid {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: string[][] = [];
  const themes: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const tileRow: string[] = [];
    const themeRow: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      let tile: string;
      let theme: string | null = null;
      switch (ch) {
        case '#':
          tile = 'wall';
          break;
        case '~':
          tile = 'water';
          break;
        case 'X':
          tile = 'chasm';
          break;
        case '=':
          tile = 'bridge';
          break;
        case '^':
          tile = 'hazard';
          break;
        case 'E':
          tile = 'exit';
          break;
        case 'T':
          tile = 'wall';
          theme = 'torch';
          break;
        default:
          tile = 'floor';
      }
      tileRow.push(tile);
      themeRow.push(theme);
    }
    tiles.push(tileRow);
    themes.push(themeRow);
  }
  return { width, height, tiles, themes };
}

/** Synthetic manifest: every set maps mask i -> a distinct, readable-back position. */
function makeManifest(overrides: Partial<TerrainManifest> = {}): TerrainManifest {
  const rock: Record<string, [number, number]> = {};
  const water: Record<string, [number, number]> = {};
  const chasm: Record<string, [number, number]> = {};
  for (let i = 0; i <= 15; i++) {
    rock[String(i)] = [i, 0];
    water[String(i)] = [i, 1];
    chasm[String(i)] = [i, 2];
  }
  return {
    tileSize: 24,
    sets: { rock, water, chasm },
    floorVariants: [
      [100, 0],
      [100, 1],
      [100, 2],
      [100, 3],
    ],
    stamps: {
      hazard: [200, 0],
      exit: [200, 1],
      torch: [200, 2],
      bridge_h: [200, 3],
      bridge_v: [200, 4],
    },
    ...overrides,
  };
}

const manifest = makeManifest();

describe('classify', () => {
  it('treats out-of-bounds as rock', () => {
    const grid = buildGrid(['...', '...', '...']);
    expect(classify(grid, -1, 0)).toBe('rock');
    expect(classify(grid, 0, -1)).toBe('rock');
    expect(classify(grid, 3, 0)).toBe('rock');
    expect(classify(grid, 0, 3)).toBe('rock');
  });

  it('classifies wall as rock, water and chasm as themselves, everything else as floor', () => {
    const grid = buildGrid(['#~X', '.^E']);
    expect(classify(grid, 0, 0)).toBe('rock');
    expect(classify(grid, 1, 0)).toBe('water');
    expect(classify(grid, 2, 0)).toBe('chasm');
    expect(classify(grid, 0, 1)).toBe('floor');
    expect(classify(grid, 1, 1)).toBe('floor'); // hazard
    expect(classify(grid, 2, 1)).toBe('floor'); // exit
  });

  it('classifies a bridge as water when any orthogonal neighbour is water', () => {
    const grid = buildGrid(['.~.', '.=.', '...']);
    expect(classify(grid, 1, 1)).toBe('water');
  });

  it('classifies a bridge as chasm when no orthogonal neighbour is water', () => {
    const grid = buildGrid(['.X.', '.=.', '...']);
    expect(classify(grid, 1, 1)).toBe('chasm');
  });
});

describe('vertexTile', () => {
  it('resolves a mixed rock/water vertex to the rock set (priority rock > chasm > water)', () => {
    // vertex (1,1): NW=wall, NE=wall, SW=wall, SE=water -> rock wins, mask 1110 = 14
    const grid = buildGrid(['##...', '#~...', '.....']);
    expect(vertexTile(grid, 1, 1, manifest)).toEqual([14, 0]);
  });

  it('returns null when the resolved set is missing from the manifest', () => {
    const grid = buildGrid(['......', '.~~...', '.~~...', '......']);
    const noWater = makeManifest({ sets: { rock: manifest.sets.rock, chasm: manifest.sets.chasm } });
    // vertex (2,2) is a pure-water vertex (mask 15 in the water set), which is now missing.
    expect(vertexTile(grid, 2, 2, noWater)).toBeNull();
  });
});

describe('autotile — wall borders, corners and pillars', () => {
  const bordered = buildGrid(['#####', '#...#', '#...#', '#...#', '#####']);

  it('gives the centre cell all-rock mask-0 quads (plain floor)', () => {
    const cells = autotile(bordered, 'room', manifest);
    const centre = cells[2][2];
    expect(centre.quads).toEqual([
      { tile: [0, 0], qx: 1, qy: 1 },
      { tile: [0, 0], qx: 0, qy: 1 },
      { tile: [0, 0], qx: 1, qy: 0 },
      { tile: [0, 0], qx: 0, qy: 0 },
    ]);
  });

  it('gives an edge/corner-adjacent cell rock bits toward the border', () => {
    const cells = autotile(bordered, 'room', manifest);
    const cell = cells[1][1]; // top-left interior cell
    // NW quad = SE quarter of vertexTile(1,1) = mask 14 (outer corner: 3 rock corners)
    expect(cell.quads[0]).toEqual({ tile: [14, 0], qx: 1, qy: 1 });
    // NE quad = SW quarter of vertexTile(2,1) = mask 12 (straight top edge)
    expect(cell.quads[1]).toEqual({ tile: [12, 0], qx: 0, qy: 1 });
    // SW quad = NE quarter of vertexTile(1,2) = mask 10 (straight left edge)
    expect(cell.quads[2]).toEqual({ tile: [10, 0], qx: 1, qy: 0 });
    // SE quad = NW quarter of vertexTile(2,2) = mask 0 (interior)
    expect(cell.quads[3]).toEqual({ tile: [0, 0], qx: 0, qy: 0 });
  });

  it('counts out-of-bounds as rock for a borderless grid corner', () => {
    const grid = buildGrid(['...', '...', '...']);
    const cells = autotile(grid, 'room', manifest);
    const corner = cells[0][0];
    // NW quad = SE quarter of vertexTile(0,0); all three OOB corners count as rock -> mask 14
    expect(corner.quads[0]).toEqual({ tile: [14, 0], qx: 1, qy: 1 });
  });

  it('renders a lone 1x1 pillar as a rock blob (all quads non-zero mask)', () => {
    const grid = buildGrid(['.....', '.....', '..#..', '.....', '.....']);
    const cells = autotile(grid, 'room', manifest);
    const pillar = cells[2][2];
    expect(pillar.quads[0]).toEqual({ tile: [1, 0], qx: 1, qy: 1 }); // NW quad: only SE corner (this cell) is rock
    expect(pillar.quads[1]).toEqual({ tile: [2, 0], qx: 0, qy: 1 }); // NE quad: only SW corner is rock
    expect(pillar.quads[2]).toEqual({ tile: [4, 0], qx: 1, qy: 0 }); // SW quad: only NE corner is rock
    expect(pillar.quads[3]).toEqual({ tile: [8, 0], qx: 0, qy: 0 }); // SE quad: only NW corner is rock
    for (const q of pillar.quads) {
      expect(q).not.toBeNull();
      expect(q!.tile[0]).not.toBe(0);
    }
  });
});

describe('autotile — water', () => {
  it('uses the water set for a pure-water vertex', () => {
    const grid = buildGrid(['......', '.~~...', '.~~...', '......']);
    const cells = autotile(grid, 'room', manifest);
    // cell (1,1): SE quad = NW quarter of vertexTile(2,2), a fully-interior water vertex -> mask 15
    expect(cells[1][1].quads[3]).toEqual({ tile: [15, 1], qx: 0, qy: 0 });
  });

  it('resolves a rock/water mixed vertex to the rock set', () => {
    const grid = buildGrid(['##...', '#~...', '.....']);
    const cells = autotile(grid, 'room', manifest);
    // cell (0,0)'s SE quad = NW quarter of vertexTile(1,1), computed above as rock mask 14
    expect(cells[0][0].quads[3]).toEqual({ tile: [14, 0], qx: 0, qy: 0 });
  });

  it('gives null quads for water cells when the water set is missing, without throwing', () => {
    const grid = buildGrid(['......', '.~~...', '.~~...', '......']);
    const noWater = makeManifest({ sets: { rock: manifest.sets.rock, chasm: manifest.sets.chasm } });
    expect(() => autotile(grid, 'room', noWater)).not.toThrow();
    const cells = autotile(grid, 'room', noWater);
    expect(cells[1][1].quads[3]).toBeNull();
  });
});

describe('autotile — bridges', () => {
  it('stamps a horizontal bridge over water (water above/below, floor left/right)', () => {
    const grid = buildGrid(['.~.', '.=.', '.~.']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 3]); // bridge_h
  });

  it('stamps a vertical bridge over water (water left/right, floor above/below)', () => {
    const grid = buildGrid(['...', '~=~', '...']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 4]); // bridge_v
  });

  it('stamps a horizontal bridge over chasm', () => {
    const grid = buildGrid(['.X.', '.=.', '.X.']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 3]); // bridge_h
  });
});

describe('autotile — stamps', () => {
  it('stamps hazard tiles', () => {
    const grid = buildGrid(['...', '.^.', '...']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 0]);
  });

  it('stamps exit tiles', () => {
    const grid = buildGrid(['...', '.E.', '...']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 1]);
  });

  it('stamps a torch-themed wall', () => {
    const grid = buildGrid(['...', '.T.', '...']);
    const cells = autotile(grid, 'room', manifest);
    expect(cells[1][1].stamp).toEqual([200, 2]);
  });

  it('gives a missing stamp as null without failing the base render', () => {
    const grid = buildGrid(['...', '.^.', '...']);
    const bare = makeManifest({ stamps: {} });
    const cells = autotile(grid, 'room', bare);
    expect(cells[1][1].stamp).toBeNull();
    expect(cells[1][1].quads[3]).not.toBeNull();
  });
});

describe('autotile — floor variants', () => {
  function bigFloorGrid(size: number): Grid {
    const rows: string[] = [];
    for (let y = 0; y < size; y++) rows.push('.'.repeat(size));
    return buildGrid(rows);
  }

  it('is deterministic: the same room and grid give the same variants', () => {
    const grid = bigFloorGrid(20);
    const a = autotile(grid, 'room-a', manifest);
    const b = autotile(grid, 'room-a', manifest);
    expect(a).toEqual(b);
  });

  it('only applies to floor cells whose four vertices are all mask 0', () => {
    const grid = buildGrid(['#####', '#...#', '#...#', '#...#', '#####']);
    const cells = autotile(grid, 'room', manifest);
    // edge-adjacent interior cells touch a non-zero-mask vertex, so never get a variant,
    // regardless of hash.
    expect(cells[1][1].variant).toBeNull();
    expect(cells[1][2].variant).toBeNull();
    expect(cells[2][1].variant).toBeNull();
  });

  it('gives roughly 15% (8%-25%) of pure-floor cells in a big room a variant', () => {
    const size = 60;
    const grid = bigFloorGrid(size);
    const cells = autotile(grid, 'variant-room', manifest);
    let pureFloor = 0;
    let withVariant = 0;
    for (let y = 2; y < size - 2; y++) {
      for (let x = 2; x < size - 2; x++) {
        pureFloor++;
        if (cells[y][x].variant !== null) withVariant++;
      }
    }
    const pct = (withVariant / pureFloor) * 100;
    expect(pct).toBeGreaterThan(8);
    expect(pct).toBeLessThan(25);
    for (let y = 2; y < size - 2; y++) {
      for (let x = 2; x < size - 2; x++) {
        const v = cells[y][x].variant;
        if (v !== null) {
          expect(manifest.floorVariants).toContainEqual(v);
        }
      }
    }
  });
});
