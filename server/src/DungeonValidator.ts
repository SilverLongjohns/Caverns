import type { DungeonContent, DropSpec, DropSpecRef } from '@caverns/shared';
import { DROP_SPECS } from '@caverns/shared';

export interface ValidationConstraints {
  minRooms: number;
  maxRooms: number;
}

export function validateDungeon(dungeon: DungeonContent, constraints: ValidationConstraints): string[] {
  const errors: string[] = [];

  // Build lookup sets
  const roomIds = new Set<string>();
  const mobIds = new Set<string>();
  const itemIds = new Set<string>();

  // Check for duplicate IDs
  for (const room of dungeon.rooms) {
    if (roomIds.has(room.id)) errors.push(`Duplicate room ID: "${room.id}"`);
    roomIds.add(room.id);
  }
  for (const mob of dungeon.mobs) {
    if (mobIds.has(mob.id)) errors.push(`Duplicate mob ID: "${mob.id}"`);
    mobIds.add(mob.id);
  }
  for (const item of dungeon.items) {
    if (itemIds.has(item.id)) errors.push(`Duplicate item ID: "${item.id}"`);
    itemIds.add(item.id);
  }

  // Referential integrity
  if (!roomIds.has(dungeon.entranceRoomId)) {
    errors.push(`entranceRoomId "${dungeon.entranceRoomId}" does not match any room`);
  }
  if (!mobIds.has(dungeon.bossId)) {
    errors.push(`bossId "${dungeon.bossId}" does not match any mob`);
  }

  // Helper: resolve a DropSpecRef to a DropSpec (via registry or inline).
  const resolveRef = (ref: DropSpecRef): DropSpec | undefined => {
    if ('dropSpecId' in ref) return DROP_SPECS[ref.dropSpecId];
    return ref.drops;
  };

  const validateDropRef = (ref: DropSpecRef | undefined, ownerDesc: string): void => {
    if (!ref) {
      errors.push(`${ownerDesc} is missing required drops field`);
      return;
    }
    if ('dropSpecId' in ref) {
      if (!DROP_SPECS[ref.dropSpecId]) {
        errors.push(`${ownerDesc} references unknown dropSpecId "${ref.dropSpecId}"`);
        return;
      }
    }
    const spec = resolveRef(ref);
    if (!spec) return;
    for (const pool of spec.pools) {
      for (const entry of pool.entries) {
        if (entry.type === 'consumable' && !itemIds.has(entry.consumableId)) {
          errors.push(`${ownerDesc} drop references nonexistent consumable "${entry.consumableId}"`);
        }
      }
    }
  };

  for (const room of dungeon.rooms) {
    if (room.encounter && !mobIds.has(room.encounter.mobId)) {
      errors.push(`Room "${room.id}" encounter references nonexistent mob "${room.encounter.mobId}"`);
    }
    if (room.drops) {
      validateDropRef(room.drops, `Room "${room.id}"`);
    }
  }

  for (const mob of dungeon.mobs) {
    validateDropRef(mob.drops, `Mob "${mob.id}"`);
  }

  // Bidirectional exits
  const roomMap = new Map(dungeon.rooms.map((r) => [r.id, r]));
  const opposites: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };

  for (const room of dungeon.rooms) {
    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (!targetId) continue;
      const target = roomMap.get(targetId);
      if (!target) {
        errors.push(`Room "${room.id}" exit ${dir} points to nonexistent room "${targetId}"`);
        continue;
      }
      const oppositeDir = opposites[dir];
      if (target.exits[oppositeDir as keyof typeof target.exits] !== room.id) {
        errors.push(`Exit not bidirectional: "${room.id}" -> ${dir} -> "${targetId}" but "${targetId}" does not exit ${oppositeDir} to "${room.id}"`);
      }
    }
  }

  // Locked exits validation
  for (const room of dungeon.rooms) {
    if (room.lockedExits) {
      for (const [dir, keyId] of Object.entries(room.lockedExits)) {
        if (!room.exits[dir as keyof typeof room.exits]) {
          errors.push(`Room "${room.id}" has lockedExit ${dir} but no corresponding exit`);
        }
      }
    }
  }

  // Graph connectivity (BFS from entrance)
  if (roomIds.has(dungeon.entranceRoomId)) {
    const visited = new Set<string>();
    const queue = [dungeon.entranceRoomId];
    visited.add(dungeon.entranceRoomId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const room = roomMap.get(current);
      if (!room) continue;
      for (const targetId of Object.values(room.exits)) {
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          queue.push(targetId);
        }
      }
    }
    for (const roomId of roomIds) {
      if (!visited.has(roomId)) {
        errors.push(`Room "${roomId}" is unreachable from entrance`);
      }
    }
  }

  // Constraint checks
  if (dungeon.rooms.length < constraints.minRooms || dungeon.rooms.length > constraints.maxRooms) {
    errors.push(`Room count ${dungeon.rooms.length} outside range [${constraints.minRooms}, ${constraints.maxRooms}]`);
  }

  const entranceRoom = roomMap.get(dungeon.entranceRoomId);
  if (entranceRoom?.encounter) {
    errors.push(`Entrance room must not have an encounter`);
  }

  const bossRooms = dungeon.rooms.filter((r) => r.type === 'boss');
  if (bossRooms.length !== 1) {
    errors.push(`Expected exactly 1 boss room, found ${bossRooms.length}`);
  }

  // Boss room must have the boss encounter
  if (bossRooms.length === 1) {
    const boss = bossRooms[0];
    if (!boss.encounter) {
      errors.push(`Boss room "${boss.id}" has no encounter`);
    } else if (boss.encounter.mobId !== dungeon.bossId) {
      errors.push(`Boss room encounter mob "${boss.encounter.mobId}" does not match bossId "${dungeon.bossId}"`);
    }
    // Boss room must be reachable (already covered by connectivity check above,
    // but verify it has at least one exit)
    if (Object.keys(boss.exits).length === 0) {
      errors.push(`Boss room "${boss.id}" has no exits — it is disconnected`);
    }
  }

  // At least one room/mob must drop the key that unlocks each locked exit.
  const lockedDirs = dungeon.rooms.flatMap(r =>
    r.lockedExits ? Object.values(r.lockedExits) : []
  );
  const specHasKey = (ref: DropSpecRef | undefined, keyItemId: string): boolean => {
    if (!ref) return false;
    const spec = resolveRef(ref);
    if (!spec) return false;
    return spec.pools.some(pool =>
      pool.entries.some(e => e.type === 'key' && e.keyId === keyItemId)
    );
  };
  for (const keyItemId of lockedDirs) {
    const keyExists =
      dungeon.rooms.some(r => specHasKey(r.drops, keyItemId)) ||
      dungeon.mobs.some(m => specHasKey(m.drops, keyItemId));
    if (!keyExists) {
      errors.push(`Key item "${keyItemId}" required by a locked exit is not placed in any room`);
    }
  }

  // Puzzle density: no more than ~1 per 8 rooms
  const puzzleRooms = dungeon.rooms.filter(r => r.puzzle);
  const maxPuzzles = Math.max(2, Math.ceil(dungeon.rooms.length / 8));
  if (puzzleRooms.length > maxPuzzles) {
    errors.push(`Too many puzzle rooms: ${puzzleRooms.length} (max ${maxPuzzles} for ${dungeon.rooms.length} rooms)`);
  }

  return errors;
}
