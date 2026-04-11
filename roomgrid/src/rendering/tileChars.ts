import type { TileType } from '../types.js';

export const TILE_CHARS: Record<Exclude<TileType, 'wall'>, string> = {
  floor:  '.',
  exit:   '▓',
  water:  '~',
  chasm:  ' ',
  hazard: '^',
  bridge: '=',
};

/**
 * Box-drawing characters indexed by 4-bit cardinal neighbor mask.
 * Bit layout: N=1, S=2, E=4, W=8.
 * A neighbor is "connected" if it is a wall tile or out of bounds.
 */
export const WALL_CHARS: readonly string[] = [
  '□', // 0:  isolated
  '║', // 1:  N
  '║', // 2:  S
  '║', // 3:  N+S
  '═', // 4:  E
  '╚', // 5:  N+E
  '╔', // 6:  S+E
  '╠', // 7:  N+S+E
  '═', // 8:  W
  '╝', // 9:  N+W
  '╗', // 10: S+W
  '╣', // 11: N+S+W
  '═', // 12: E+W
  '╩', // 13: N+E+W
  '╦', // 14: S+E+W
  '╬', // 15: N+S+E+W
];

export function getWallChar(tiles: TileType[][], x: number, y: number): string {
  if (!tiles.length || !tiles[0].length) return WALL_CHARS[0];
  const height = tiles.length;
  const width = tiles[0].length;

  let mask = 0;
  if (y === 0 || tiles[y - 1][x] === 'wall') mask |= 1;
  if (y === height - 1 || tiles[y + 1][x] === 'wall') mask |= 2;
  if (x === width - 1 || tiles[y][x + 1] === 'wall') mask |= 4;
  if (x === 0 || tiles[y][x - 1] === 'wall') mask |= 8;

  return WALL_CHARS[mask];
}

function getBridgeChar(tiles: TileType[][], x: number, y: number): string {
  const height = tiles.length;
  const width = tiles[0].length;
  // Check if chasm/bridge neighbors are to the east/west (vertical chasm → horizontal bridge)
  const chasmEW =
    (x > 0 && (tiles[y][x - 1] === 'chasm' || tiles[y][x - 1] === 'bridge')) ||
    (x < width - 1 && (tiles[y][x + 1] === 'chasm' || tiles[y][x + 1] === 'bridge'));
  const chasmNS =
    (y > 0 && (tiles[y - 1][x] === 'chasm' || tiles[y - 1][x] === 'bridge')) ||
    (y < height - 1 && (tiles[y + 1][x] === 'chasm' || tiles[y + 1][x] === 'bridge'));
  // Chasm runs east-west → bridge runs north-south
  if (chasmNS && !chasmEW) return '║';
  return '=';
}

export function getTileChar(tiles: TileType[][], x: number, y: number): string {
  const type = tiles[y][x];
  if (type === 'wall') return getWallChar(tiles, x, y);
  if (type === 'bridge') return getBridgeChar(tiles, x, y);
  return TILE_CHARS[type];
}
