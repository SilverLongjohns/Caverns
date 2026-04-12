import { describe, it, expect } from 'vitest';
import { OVERWORLD_MAPS, isWalkable, getTile, type OverworldMap } from './overworld.js';

function bfsReachable(map: OverworldMap): Set<string> {
  const seen = new Set<string>();
  const q: Array<[number, number]> = [[map.spawnTile.x, map.spawnTile.y]];
  seen.add(`${map.spawnTile.x},${map.spawnTile.y}`);
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      const t = getTile(map, nx, ny);
      if (!t || !isWalkable(t)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('starter overworld map', () => {
  const map = OVERWORLD_MAPS.starter;

  it('exists', () => {
    expect(map).toBeDefined();
  });

  it('has matching width/height dimensions', () => {
    expect(map.tiles.length).toBe(map.height);
    for (const row of map.tiles) {
      expect(row.length).toBe(map.width);
    }
  });

  it('has a walkable spawn tile in bounds', () => {
    const t = getTile(map, map.spawnTile.x, map.spawnTile.y);
    expect(t).not.toBeNull();
    expect(isWalkable(t!)).toBe(true);
  });

  it('places every portal on a walkable tile in bounds', () => {
    for (const p of map.portals) {
      const t = getTile(map, p.x, p.y);
      expect(t, `portal ${p.id}`).not.toBeNull();
      expect(isWalkable(t!), `portal ${p.id}`).toBe(true);
    }
  });

  it('places every interactable on a walkable tile in bounds', () => {
    for (const it of map.interactables) {
      const t = getTile(map, it.x, it.y);
      expect(t, `interactable ${it.id}`).not.toBeNull();
      expect(isWalkable(t!), `interactable ${it.id}`).toBe(true);
    }
  });

  it('keeps every region inside map bounds', () => {
    for (const r of map.regions) {
      expect(r.bounds.x).toBeGreaterThanOrEqual(0);
      expect(r.bounds.y).toBeGreaterThanOrEqual(0);
      expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(map.width);
      expect(r.bounds.y + r.bounds.height).toBeLessThanOrEqual(map.height);
    }
  });

  it('reaches every portal and interactable from spawn via walkable tiles', () => {
    const reachable = bfsReachable(map);
    for (const p of map.portals) {
      expect(reachable.has(`${p.x},${p.y}`), `portal ${p.id} unreachable`).toBe(true);
    }
    for (const it of map.interactables) {
      expect(reachable.has(`${it.x},${it.y}`), `interactable ${it.id} unreachable`).toBe(true);
    }
  });

  it('has no duplicate portal or interactable IDs', () => {
    const portalIds = map.portals.map((p) => p.id);
    expect(new Set(portalIds).size).toBe(portalIds.length);
    const itIds = map.interactables.map((i) => i.id);
    expect(new Set(itIds).size).toBe(itIds.length);
  });
});
