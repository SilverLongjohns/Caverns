import { describe, it, expect } from 'vitest';
import { teleportRange, isValidTeleportDestination, teleportDestinations, teleportEffectOf, type TeleportEffect, type TeleportCheck } from './teleport.js';
import type { AbilityDefinition } from '../classTypes.js';

// 7x5: border walls, a wall column at x=3 (y=1..3), floor elsewhere
function grid() {
  const tiles: string[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: string[] = [];
    for (let x = 0; x < 7; x++) row.push(y === 0 || y === 4 || x === 0 || x === 6 || x === 3 ? 'wall' : 'floor');
    tiles.push(row);
  }
  return { width: 7, height: 5, tiles };
}
const walkable = (t: string) => t === 'floor' || t === 'hazard' || t === 'water';
const phase: TeleportEffect = { type: 'teleport', baseRange: 1, perSpeed: 0.34, requiresLineOfSight: false };
const sighted: TeleportEffect = { ...phase, requiresLineOfSight: true };
const check = (over: Partial<TeleportCheck> = {}): TeleportCheck => ({
  grid: grid(), from: { x: 2, y: 2 }, effect: phase, initiative: 5, occupied: new Set(), isWalkable: walkable, ...over,
});

describe('teleportRange', () => {
  it('is baseRange + floor(initiative * perSpeed)', () => {
    expect(teleportRange(phase, 5)).toBe(2);   // 1 + floor(1.7)
    expect(teleportRange(phase, 9)).toBe(4);   // 1 + floor(3.06)
    expect(teleportRange(phase, 0)).toBe(1);
  });
});

describe('isValidTeleportDestination', () => {
  it('accepts open floor within range, passing through a wall when LoS is not required', () => {
    expect(isValidTeleportDestination(check(), { x: 4, y: 2 })).toBe(true); // across the x=3 wall, distance 2
  });
  it('rejects out of range', () => {
    expect(isValidTeleportDestination(check(), { x: 5, y: 2 })).toBe(false); // distance 3 > 2
  });
  it('rejects non-integer or missing coordinates instead of throwing', () => {
    expect(isValidTeleportDestination(check(), { x: 2, y: 1.5 })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: 2, y: null as unknown as number })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: Number.NaN, y: 2 })).toBe(false);
  });
  it('rejects walls and off-grid tiles', () => {
    expect(isValidTeleportDestination(check(), { x: 3, y: 2 })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: -1, y: 2 })).toBe(false);
  });
  it('rejects occupied tiles and the caster\'s own tile', () => {
    expect(isValidTeleportDestination(check({ occupied: new Set(['1,1']) }), { x: 1, y: 1 })).toBe(false);
    expect(isValidTeleportDestination(check(), { x: 2, y: 2 })).toBe(false);
  });
  it('requires line of sight only when the effect says so', () => {
    expect(isValidTeleportDestination(check({ effect: sighted }), { x: 4, y: 2 })).toBe(false);
    expect(isValidTeleportDestination(check({ effect: sighted }), { x: 1, y: 1 })).toBe(true);
  });
});

describe('teleportDestinations', () => {
  it('lists exactly the valid tiles', () => {
    const tiles = teleportDestinations(check({ occupied: new Set(['1,1']) }));
    const keys = tiles.map((t) => `${t.x},${t.y}`).sort();
    expect(keys).toEqual(['1,2', '1,3', '2,1', '2,3', '4,1', '4,2', '4,3'].sort());
  });
});

describe('teleportEffectOf', () => {
  it('returns the first teleport effect, or undefined', () => {
    const base = { id: 'x', name: 'X', description: '', energyCost: 0, passive: false } as const;
    const a: AbilityDefinition = { ...base, targetType: 'tile', effects: [{ type: 'heal' }, phase] };
    const b: AbilityDefinition = { ...base, targetType: 'none', effects: [{ type: 'heal' }] };
    expect(teleportEffectOf(a)).toEqual(phase);
    expect(teleportEffectOf(b)).toBeUndefined();
  });
});
