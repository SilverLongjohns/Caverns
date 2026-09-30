import type { AbilityDefinition } from '../classTypes.js';
import { chebyshev, hasLineOfSight } from './ranged.js';

type Tile = { x: number; y: number };

// A type alias (not an interface) so it stays assignable to AbilityEffect's index signature.
export type TeleportEffect = { type: 'teleport'; baseRange: number; perSpeed: number; requiresLineOfSight: boolean };

export interface TeleportCheck {
  grid: { width: number; height: number; tiles: string[][] };
  from: Tile;
  effect: TeleportEffect;
  initiative: number;
  /** "x,y" keys of tiles holding a living unit (other than the caster). */
  occupied: Set<string>;
  isWalkable: (tile: string) => boolean;
}

export function teleportEffectOf(ability: AbilityDefinition): TeleportEffect | undefined {
  return ability.effects.find((e) => e.type === 'teleport') as TeleportEffect | undefined;
}

/** Tiles (Chebyshev) a teleport reaches: baseRange + floor(initiative × perSpeed). */
export function teleportRange(effect: TeleportEffect, initiative: number): number {
  return effect.baseRange + Math.floor(initiative * effect.perSpeed);
}

export function isValidTeleportDestination(c: TeleportCheck, to: Tile): boolean {
  if (to.x < 0 || to.y < 0 || to.x >= c.grid.width || to.y >= c.grid.height) return false;
  if (to.x === c.from.x && to.y === c.from.y) return false;
  const range = teleportRange(c.effect, c.initiative);
  if (chebyshev(c.from, to) > range) return false;
  if (!c.isWalkable(c.grid.tiles[to.y][to.x])) return false;
  if (c.occupied.has(`${to.x},${to.y}`)) return false;
  if (c.effect.requiresLineOfSight && !hasLineOfSight(c.grid, c.from, to, range)) return false;
  return true;
}

export function teleportDestinations(c: TeleportCheck): Tile[] {
  const range = teleportRange(c.effect, c.initiative);
  const out: Tile[] = [];
  for (let y = c.from.y - range; y <= c.from.y + range; y++) {
    for (let x = c.from.x - range; x <= c.from.x + range; x++) {
      if (isValidTeleportDestination(c, { x, y })) out.push({ x, y });
    }
  }
  return out;
}
