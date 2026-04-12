import type { DungeonContent } from '@caverns/shared';

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

  for (const room of dungeon.rooms) {
    if (room.encounter && !mobIds.has(room.encounter.mobId)) {
      errors.push(`Room "${room.id}" encounter references nonexistent mob "${room.encounter.mobId}"`);
    }
    if (room.loot) {
      for (const loot of room.loot) {
        if (!itemIds.has(loot.itemId)) {
          errors.push(`Room "${room.id}" loot references nonexistent item "${loot.itemId}"`);
        }
      }
    }
  }

  for (const mob of dungeon.mobs) {
    for (const drop of mob.lootTable) {
      if ('consumableId' in drop) {
        if (!itemIds.has(drop.consumableId)) {
          errors.push(`Mob "${mob.id}" lootTable references nonexistent consumable "${drop.consumableId}"`);
        }
      }
      // GeneratedLootDrop entries don't reference items by ID — validated by types
    }
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

  // At least one room must contain the key item that unlocks the boss room
  const lockedDirs = dungeon.rooms.flatMap(r =>
    r.lockedExits ? Object.values(r.lockedExits) : []
  );
  for (const keyItemId of lockedDirs) {
    const keyExists = dungeon.rooms.some(r =>
      r.loot?.some(l => l.itemId === keyItemId)
    );
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
