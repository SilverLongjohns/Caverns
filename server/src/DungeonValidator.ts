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
    for (const lootItemId of mob.lootTable) {
      if (!itemIds.has(lootItemId)) {
        errors.push(`Mob "${mob.id}" lootTable references nonexistent item "${lootItemId}"`);
      }
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

  return errors;
}
