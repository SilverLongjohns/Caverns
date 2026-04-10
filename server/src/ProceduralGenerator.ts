import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Room, MobTemplate, Item, Direction, DungeonContent, Rarity, InteractableDefinition, InteractableInstance } from '@caverns/shared';
import { LOOT_CONFIG, DUNGEON_CONFIG } from '@caverns/shared';
import type { RoomChit, MobPoolEntry, BiomeDefinition, PuzzleTemplate } from '@caverns/shared';
import { validateDungeon } from './DungeonValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJSON<T>(relativePath: string): T {
  const fullPath = resolve(__dirname, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8')) as T;
}

const allRoomChits = loadJSON<RoomChit[]>('../../shared/src/data/roomChits.json');
const allMobPool = loadJSON<MobPoolEntry[]>('../../shared/src/data/mobPool.json');
const allBiomes = loadJSON<BiomeDefinition[]>('../../shared/src/data/biomes.json');
const allItems = loadJSON<Item[]>('../../shared/src/data/items.json');
const allUniqueItems = loadJSON<Item[]>('../../shared/src/data/uniqueItems.json');
const allPuzzles = loadJSON<PuzzleTemplate[]>('../../shared/src/data/puzzles.json');
const allInteractables = loadJSON<InteractableDefinition[]>('../../shared/src/data/interactables.json');

const OPPOSITES: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const ALL_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

// ── Utility ──────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Main Generator ───────────────────────────────────────

const MAX_GENERATION_ATTEMPTS = 10;

export function generateProceduralDungeon(zoneCount: number): DungeonContent {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const dungeon = attemptGenerateDungeon(zoneCount);
    const minRooms = zoneCount * 8;
    const maxRooms = zoneCount * 25;
    const errors = validateDungeon(dungeon, { minRooms, maxRooms });
    if (errors.length === 0) {
      return dungeon;
    }
    console.warn(`[ProceduralGenerator] Attempt ${attempt + 1} failed validation:`, errors);
  }
  // Last attempt — return it even if imperfect rather than crashing
  console.warn(`[ProceduralGenerator] All ${MAX_GENERATION_ATTEMPTS} attempts failed validation, using last result`);
  return attemptGenerateDungeon(zoneCount);
}

function attemptGenerateDungeon(zoneCount: number): DungeonContent {
  // 1. Select biomes — starter biome always first
  const starterBiome = allBiomes.find(b => b.isStarter);
  const nonStarterBiomes = shuffle(allBiomes.filter(b => !b.isStarter));
  const biomes: BiomeDefinition[] = [];
  if (starterBiome) biomes.push(starterBiome);
  for (let i = 0; biomes.length < zoneCount; i++) {
    biomes.push(nonStarterBiomes[i % nonStarterBiomes.length]);
  }

  let genCounter = 0;
  const allRooms: Room[] = [];
  const usedMobIds = new Set<string>();
  const usedItemIds = new Set<string>();
  const zoneHubs: string[][] = []; // hubs per zone
  const zoneEntries: string[] = []; // entry room id per zone

  // Global spatial tracking — prevents rooms from overlapping
  const occupiedCells = new Map<string, string>(); // "x,y" -> roomId
  const roomPositions = new Map<string, { x: number; y: number }>(); // roomId -> grid pos

  function cellKey(x: number, y: number): string { return `${x},${y}`; }

  // Track the hub/dir from the previous zone so we can place the next zone's entry adjacent to it
  let prevZoneHubId: string | null = null;
  let prevZoneHubDir: Direction | null = null;

  // 2. For each zone, build a room sub-graph
  for (let zoneIndex = 0; zoneIndex < zoneCount; zoneIndex++) {
    const biome = biomes[zoneIndex];
    const roomCount = randInt(biome.roomCount.min, biome.roomCount.max);

    // Get chits matching this biome
    const biomeChits = allRoomChits.filter(c => c.biomes.includes(biome.id));
    const hubs = biomeChits.filter(c => c.maxExits >= 3);
    const deadEnds = biomeChits.filter(c => c.maxExits === 1);

    // Select chits: at least 1 hub, at least 1 dead end, fill remaining
    const selectedChits: RoomChit[] = [];
    selectedChits.push(pick(hubs));
    selectedChits.push(pick(deadEnds));

    // Fill remaining from all biome chits
    const remaining = roomCount - selectedChits.length;
    for (let i = 0; i < remaining; i++) {
      selectedChits.push(pick(biomeChits));
    }

    // Shuffle so placement order is random
    const shuffledChits = shuffle(selectedChits);

    // Build sub-graph
    const zoneRooms: Room[] = [];
    const roomExitCapacity = new Map<string, number>(); // roomId -> max exits
    const roomUsedDirs = new Map<string, Set<Direction>>(); // roomId -> used directions

    for (const chit of shuffledChits) {
      const roomId = `${chit.id}_z${zoneIndex}_${genCounter++}`;
      const room: Room = {
        id: roomId,
        type: chit.type,
        name: chit.name,
        description: chit.description,
        exits: {},
      };
      zoneRooms.push(room);
      roomExitCapacity.set(roomId, chit.maxExits);
      roomUsedDirs.set(roomId, new Set());
    }

    // Place first room — either at origin (zone 0) or adjacent to previous zone's hub
    const firstRoom = zoneRooms[0];
    let startX = 0;
    let startY = 0;

    if (prevZoneHubId && prevZoneHubDir) {
      const hubPos = roomPositions.get(prevZoneHubId)!;
      startX = hubPos.x + DIR_DELTA[prevZoneHubDir].dx;
      startY = hubPos.y + DIR_DELTA[prevZoneHubDir].dy;

      // Connect the previous zone's hub to this zone's entry
      const hubRoom = allRooms.find(r => r.id === prevZoneHubId)!;
      const opp = OPPOSITES[prevZoneHubDir];
      hubRoom.exits[prevZoneHubDir] = firstRoom.id;
      firstRoom.exits[opp] = prevZoneHubId;
    }

    roomPositions.set(firstRoom.id, { x: startX, y: startY });
    occupiedCells.set(cellKey(startX, startY), firstRoom.id);

    // Grow graph: connect rooms sequentially, position-aware
    for (let i = 1; i < zoneRooms.length; i++) {
      // Only consider rooms that have been placed on the grid
      const placed = zoneRooms.slice(0, i).filter(r => roomPositions.has(r.id));
      const newRoom = zoneRooms[i];

      // Find a placed room with spare capacity AND a free adjacent cell
      const candidates = shuffle(placed).filter(r => {
        const cap = roomExitCapacity.get(r.id)!;
        const used = roomUsedDirs.get(r.id)!.size;
        if (used >= cap) return false;
        const pos = roomPositions.get(r.id)!;
        const usedDirs = roomUsedDirs.get(r.id)!;
        return ALL_DIRECTIONS.some(dir => {
          if (usedDirs.has(dir)) return false;
          const nx = pos.x + DIR_DELTA[dir].dx;
          const ny = pos.y + DIR_DELTA[dir].dy;
          return !occupiedCells.has(cellKey(nx, ny));
        });
      });

      let parentRoom: Room;
      if (candidates.length > 0) {
        parentRoom = candidates[0];
      } else {
        // Force: find any placed room with a free adjacent cell (ignore capacity)
        const forced = shuffle(placed).find(r => {
          const pos = roomPositions.get(r.id)!;
          return ALL_DIRECTIONS.some(dir => {
            const nx = pos.x + DIR_DELTA[dir].dx;
            const ny = pos.y + DIR_DELTA[dir].dy;
            return !occupiedCells.has(cellKey(nx, ny));
          });
        });
        if (forced) {
          const cap = roomExitCapacity.get(forced.id)!;
          roomExitCapacity.set(forced.id, cap + 1);
          parentRoom = forced;
        } else {
          // All adjacent cells full — drop this room from the zone
          zoneRooms.splice(i, 1);
          i--;
          continue;
        }
      }

      placeRoom(parentRoom, newRoom, roomUsedDirs, roomExitCapacity, roomPositions, occupiedCells);
    }

    // Cross-link ALL grid-adjacent room pairs that have matching free directions.
    // This creates loops and alternate paths, eliminating dead-end feel.
    const placedRooms = zoneRooms.filter(r => roomPositions.has(r.id));
    for (const roomA of placedRooms) {
      const posA = roomPositions.get(roomA.id)!;
      const usedA = roomUsedDirs.get(roomA.id)!;
      for (const dir of ALL_DIRECTIONS) {
        if (usedA.has(dir)) continue;
        const nx = posA.x + DIR_DELTA[dir].dx;
        const ny = posA.y + DIR_DELTA[dir].dy;
        const neighborId = occupiedCells.get(cellKey(nx, ny));
        if (!neighborId) continue;
        // Only cross-link within this zone
        const neighborRoom = zoneRooms.find(r => r.id === neighborId);
        if (!neighborRoom) continue;
        if (Object.values(roomA.exits).includes(neighborId)) continue;
        const opp = OPPOSITES[dir];
        const usedB = roomUsedDirs.get(neighborId)!;
        if (usedB.has(opp)) continue;
        roomA.exits[dir] = neighborId;
        neighborRoom.exits[opp] = roomA.id;
        usedA.add(dir);
        usedB.add(opp);
      }
    }

    // Track zone info
    const hubIds = zoneRooms
      .filter(r => (roomExitCapacity.get(r.id)! >= 3) || r.type === 'cavern' || r.type === 'chamber')
      .map(r => r.id);
    zoneHubs.push(hubIds.length > 0 ? hubIds : [zoneRooms[0].id]);
    zoneEntries.push(zoneRooms[0].id);

    allRooms.push(...zoneRooms);

    // Find a hub with a free adjacent cell for the next zone to attach to
    prevZoneHubId = null;
    prevZoneHubDir = null;
    if (zoneIndex < zoneCount - 1) {
      const hubCandidates: string[] = shuffle([...hubIds, zoneRooms[0].id]);
      for (const hubId of hubCandidates) {
        const pos = roomPositions.get(hubId)!;
        const used: Set<Direction> = new Set(Object.keys(allRooms.find(r => r.id === hubId)!.exits) as Direction[]);
        for (const dir of shuffle([...ALL_DIRECTIONS])) {
          if (used.has(dir)) continue;
          const nx = pos.x + DIR_DELTA[dir].dx;
          const ny = pos.y + DIR_DELTA[dir].dy;
          if (!occupiedCells.has(cellKey(nx, ny))) {
            prevZoneHubId = hubId;
            prevZoneHubDir = dir;
            break;
          }
        }
        if (prevZoneHubId) break;
      }
      // Fallback: if all hubs are surrounded, find any room with a free cell
      if (!prevZoneHubId) {
        for (const room of shuffle([...zoneRooms])) {
          if (!roomPositions.has(room.id)) continue;
          const pos = roomPositions.get(room.id)!;
          for (const dir of shuffle([...ALL_DIRECTIONS])) {
            const nx = pos.x + DIR_DELTA[dir].dx;
            const ny = pos.y + DIR_DELTA[dir].dy;
            if (!occupiedCells.has(cellKey(nx, ny))) {
              prevZoneHubId = room.id;
              prevZoneHubDir = dir;
              break;
            }
          }
          if (prevZoneHubId) break;
        }
      }
      // Last resort: scan outward from zone center to find a free cell
      if (!prevZoneHubId) {
        const anchor = zoneRooms.find(r => roomPositions.has(r.id))!;
        const anchorPos = roomPositions.get(anchor.id)!;
        for (let radius = 1; radius <= 20 && !prevZoneHubId; radius++) {
          for (let dx = -radius; dx <= radius && !prevZoneHubId; dx++) {
            for (let dy = -radius; dy <= radius && !prevZoneHubId; dy++) {
              if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
              const cx = anchorPos.x + dx;
              const cy = anchorPos.y + dy;
              if (occupiedCells.has(cellKey(cx, cy))) continue;
              // Find an adjacent occupied cell to connect from
              for (const dir of ALL_DIRECTIONS) {
                const adjX = cx - DIR_DELTA[dir].dx;
                const adjY = cy - DIR_DELTA[dir].dy;
                const adjRoomId = occupiedCells.get(cellKey(adjX, adjY));
                if (adjRoomId) {
                  prevZoneHubId = adjRoomId;
                  prevZoneHubDir = dir;
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  // 3. Zones are now connected during placement (above). Build roomMap for later use.
  const roomMap = new Map(allRooms.map(r => [r.id, r]));

  // 4. Boss room — dead end connected to a hub in the final zone
  const finalBiome = biomes[zoneCount - 1];
  const bossRoomId = `boss_z${zoneCount - 1}_${genCounter++}`;
  const bossRoom: Room = {
    id: bossRoomId,
    type: 'boss',
    name: finalBiome.bossRoom.name,
    description: finalBiome.bossRoom.description,
    exits: {},
  };

  // Find a hub in the final zone to connect boss room — position-aware
  const finalZoneHubs = zoneHubs[zoneCount - 1];
  let bossParentId = finalZoneHubs[finalZoneHubs.length - 1];
  let bossParent = allRooms.find(r => r.id === bossParentId)!;
  let bossDir: Direction | null = null;

  // Try each hub, pick a direction where the adjacent cell is free
  for (const hubId of shuffle([...finalZoneHubs])) {
    const hub = allRooms.find(r => r.id === hubId)!;
    const hubPos = roomPositions.get(hubId)!;
    const used = new Set(Object.keys(hub.exits) as Direction[]);
    for (const dir of shuffle([...ALL_DIRECTIONS])) {
      if (used.has(dir)) continue;
      const nx = hubPos.x + DIR_DELTA[dir].dx;
      const ny = hubPos.y + DIR_DELTA[dir].dy;
      if (!occupiedCells.has(`${nx},${ny}`)) {
        bossDir = dir;
        bossParent = hub;
        bossParentId = hubId;
        break;
      }
    }
    if (bossDir) break;
  }

  if (!bossDir) {
    // Fallback: try any room in the final zone with a free adjacent cell
    const finalZoneRooms = getRoomsInZone(allRooms, zoneCount - 1);
    for (const room of shuffle([...finalZoneRooms])) {
      const pos = roomPositions.get(room.id)!;
      for (const dir of shuffle([...ALL_DIRECTIONS])) {
        const nx = pos.x + DIR_DELTA[dir].dx;
        const ny = pos.y + DIR_DELTA[dir].dy;
        if (!occupiedCells.has(`${nx},${ny}`)) {
          bossDir = dir;
          bossParent = room;
          bossParentId = room.id;
          break;
        }
      }
      if (bossDir) break;
    }
  }

  if (!bossDir) {
    // Last resort: scan outward from the final zone to find any free cell
    // adjacent to an existing room
    const finalZoneRooms = getRoomsInZone(allRooms, zoneCount - 1);
    const anchorRoom = finalZoneRooms.find(r => roomPositions.has(r.id))!;
    const anchorPos = roomPositions.get(anchorRoom.id)!;
    for (let radius = 1; radius <= 20 && !bossDir; radius++) {
      for (let dx = -radius; dx <= radius && !bossDir; dx++) {
        for (let dy = -radius; dy <= radius && !bossDir; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const cx = anchorPos.x + dx;
          const cy = anchorPos.y + dy;
          if (occupiedCells.has(cellKey(cx, cy))) continue;
          for (const dir of ALL_DIRECTIONS) {
            const adjX = cx - DIR_DELTA[dir].dx;
            const adjY = cy - DIR_DELTA[dir].dy;
            const adjRoomId = occupiedCells.get(cellKey(adjX, adjY));
            if (adjRoomId) {
              bossParentId = adjRoomId;
              bossParent = allRooms.find(r => r.id === adjRoomId)!;
              bossDir = dir;
              break;
            }
          }
        }
      }
    }
    if (!bossDir) { bossDir = 'north'; } // absolute last resort
  }

  const bossParentPos = roomPositions.get(bossParentId)!;
  const bossX = bossParentPos.x + DIR_DELTA[bossDir].dx;
  const bossY = bossParentPos.y + DIR_DELTA[bossDir].dy;
  roomPositions.set(bossRoomId, { x: bossX, y: bossY });
  occupiedCells.set(`${bossX},${bossY}`, bossRoomId);

  bossParent.exits[bossDir] = bossRoomId;
  bossRoom.exits[OPPOSITES[bossDir]] = bossParentId;

  // Set locked exit
  bossParent.lockedExits = { [bossDir]: finalBiome.keyItem.id };

  // Find boss mob (skull-3 from final biome)
  const bossMobs = allMobPool.filter(m => m.skullRating === 3 && m.biomes.includes(finalBiome.id));
  const bossMobEntry = pick(bossMobs);

  const bossMob: MobTemplate = {
    id: bossMobEntry.id,
    name: bossMobEntry.name,
    description: bossMobEntry.description,
    skullRating: 3,
    maxHp: bossMobEntry.baseStats.maxHp,
    damage: bossMobEntry.baseStats.damage,
    defense: bossMobEntry.baseStats.defense,
    initiative: bossMobEntry.baseStats.initiative,
    lootTable: bossMobEntry.lootTable,
  };

  bossRoom.encounter = { mobId: bossMob.id, skullRating: 3 };
  usedMobIds.add(bossMob.id);

  // Add boss loot table items
  for (const itemId of bossMob.lootTable) {
    usedItemIds.add(itemId);
  }

  allRooms.push(bossRoom);

  // 4b. Connectivity repair — reconnect any orphaned rooms
  repairConnectivity(allRooms, allRooms[0].id);

  // 5. Populate mobs
  const entranceRoomId = allRooms[0].id;
  for (const room of allRooms) {
    if (room.id === entranceRoomId) continue; // skip entrance
    if (room.type === 'boss') continue; // already handled
    // Skip transition rooms (zone entry rooms after first zone)
    if (zoneEntries.slice(1).includes(room.id)) continue;

    if (Math.random() < getBiomeForRoom(room, biomes, zoneEntries, zoneCount).mobDensity) {
      const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
      const biomeMobs = allMobPool.filter(m =>
        m.biomes.includes(biome.id) && m.skullRating !== 3
      );

      if (biomeMobs.length === 0) continue;

      // Roll skull tier
      const skull1Mobs = biomeMobs.filter(m => m.skullRating === 1);
      const skull2Mobs = biomeMobs.filter(m => m.skullRating === 2);

      let selectedMob: MobPoolEntry;
      if (skull2Mobs.length > 0 && Math.random() < biome.skull2Weight) {
        selectedMob = pick(skull2Mobs);
      } else if (skull1Mobs.length > 0) {
        selectedMob = pick(skull1Mobs);
      } else {
        selectedMob = pick(biomeMobs);
      }

      const mobTemplate: MobTemplate = {
        id: selectedMob.id,
        name: selectedMob.name,
        description: selectedMob.description,
        skullRating: selectedMob.skullRating,
        maxHp: selectedMob.baseStats.maxHp,
        damage: selectedMob.baseStats.damage,
        defense: selectedMob.baseStats.defense,
        initiative: selectedMob.baseStats.initiative,
        lootTable: selectedMob.lootTable,
      };

      room.encounter = { mobId: mobTemplate.id, skullRating: mobTemplate.skullRating };
      usedMobIds.add(mobTemplate.id);

      for (const itemId of mobTemplate.lootTable) {
        usedItemIds.add(itemId);
      }
    }
  }

  // 6. Distribute loot
  const defaultRarityWeights: { rarity: Rarity; weight: number }[] = (Object.entries(LOOT_CONFIG.defaultLootWeights) as [Rarity, number][])
    .map(([rarity, weight]) => ({ rarity, weight }));

  const starterRarityWeights: { rarity: Rarity; weight: number }[] = (Object.entries(LOOT_CONFIG.starterLootWeights) as [Rarity, number][])
    .map(([rarity, weight]) => ({ rarity, weight }));

  for (const room of allRooms) {
    if (room.type === 'boss') continue;
    if (room.id === entranceRoomId) continue;

    const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
    const rarityWeights = biome.isStarter ? starterRarityWeights : defaultRarityWeights;
    if (Math.random() < biome.lootDensity) {
      const selectedRarity = rollRarity(rarityWeights);
      let candidateItems: Item[];

      if (selectedRarity === 'unique') {
        candidateItems = allUniqueItems;
      } else {
        candidateItems = allItems.filter(i => i.rarity === selectedRarity);
      }

      if (candidateItems.length > 0) {
        const item = pick(candidateItems);
        usedItemIds.add(item.id);

        // Pick a loot location from the room chit
        const chitForRoom = allRoomChits.find(c => room.id.startsWith(c.id + '_'));
        const locations: ('chest' | 'floor' | 'hidden')[] =
          chitForRoom && chitForRoom.lootLocations.length > 0
            ? chitForRoom.lootLocations as ('chest' | 'floor' | 'hidden')[]
            : ['floor'];

        if (!room.loot) room.loot = [];
        room.loot.push({ itemId: item.id, location: pick(locations) });
      }
    }
  }

  // 7. Place key — in a room at 60-75% dungeon depth (by zone index)
  const targetZoneMin = Math.floor(zoneCount * DUNGEON_CONFIG.keyPlacementDepthMin);
  const targetZoneMax = Math.floor(zoneCount * DUNGEON_CONFIG.keyPlacementDepthMax);
  const keyZoneIndex = Math.max(0, Math.min(zoneCount - 2, randInt(targetZoneMin, Math.max(targetZoneMin, targetZoneMax))));

  // Get rooms in the key zone
  const keyZoneRooms = getRoomsInZone(allRooms, keyZoneIndex);
  const keyRoom = pick(keyZoneRooms.filter(r => r.type !== 'boss' && r.id !== entranceRoomId));
  if (!keyRoom.loot) keyRoom.loot = [];
  keyRoom.loot.push({ itemId: finalBiome.keyItem.id, location: 'hidden' });
  usedItemIds.add(finalBiome.keyItem.id);

  // 8. Place puzzles — 2-3 per zone in rooms without encounters
  const usedPuzzleIds = new Set<string>();
  for (let z = 0; z < zoneCount; z++) {
    const biome = biomes[z];
    const biomePuzzles = allPuzzles.filter(p =>
      p.biomes.includes(biome.id) && !usedPuzzleIds.has(p.id)
    );
    if (biomePuzzles.length === 0) continue;

    const zoneRooms = getRoomsInZone(allRooms, z);
    const eligibleRooms = zoneRooms.filter(r =>
      !r.encounter && r.type !== 'boss' && r.id !== entranceRoomId
    );
    if (eligibleRooms.length === 0) continue;

    const puzzleCount = DUNGEON_CONFIG.puzzlesPerZone;
    const shuffledRooms = shuffle([...eligibleRooms]);
    const shuffledPuzzles = shuffle([...biomePuzzles]);

    for (let i = 0; i < puzzleCount && i < shuffledRooms.length && i < shuffledPuzzles.length; i++) {
      const puzzleRoom = shuffledRooms[i];
      const puzzle = shuffledPuzzles[i];
      puzzleRoom.puzzle = {
        id: puzzle.id,
        description: puzzle.description,
        options: [...puzzle.options],
        correctIndex: puzzle.correctIndex,
      };
      usedPuzzleIds.add(puzzle.id);

      // Guarantee puzzle rooms have loot as a reward
      if (!puzzleRoom.loot || puzzleRoom.loot.length === 0) {
        const rarityWeights = biome.isStarter ? starterRarityWeights : defaultRarityWeights;
        const selectedRarity = rollRarity(rarityWeights);
        const candidateItems = selectedRarity === 'unique'
          ? allUniqueItems
          : allItems.filter(it => it.rarity === selectedRarity);
        if (candidateItems.length > 0) {
          const item = pick(candidateItems);
          usedItemIds.add(item.id);
          puzzleRoom.loot = [{ itemId: item.id, location: 'hidden' as const }];
        }
      }
    }
  }

  // 9. Place interactables
  let intCounter = 0;

  for (const room of allRooms) {
    if (room.type === 'boss') continue;
    if (room.id === entranceRoomId) continue;

    const chitForRoom = allRoomChits.find(c => room.id.startsWith(c.id + '_'));
    if (!chitForRoom?.interactableSlots || chitForRoom.interactableSlots.length === 0) continue;

    if (Math.random() > DUNGEON_CONFIG.interactableDensity) continue;

    const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
    const biomeInteractables = allInteractables.filter(d => d.biomes.includes(biome.id));
    if (biomeInteractables.length === 0) continue;

    const usedDefIds = new Set<string>();
    const instances: InteractableInstance[] = [];

    for (const slot of chitForRoom.interactableSlots) {
      const candidates = biomeInteractables.filter(
        d => d.slotSize === slot.size && !usedDefIds.has(d.id)
      );
      if (candidates.length === 0) continue;

      const def = pick(candidates);
      usedDefIds.add(def.id);
      intCounter++;

      instances.push({
        definitionId: def.id,
        instanceId: `int_${String(intCounter).padStart(3, '0')}`,
        position: { x: slot.position.x, y: slot.position.y },
        usedActions: {},
      });
    }

    if (instances.length > 0) {
      room.interactables = instances;
    }
  }

  // 10. Output — collect only used mobs and items
  const usedMobs: MobTemplate[] = [];
  const addedMobIds = new Set<string>();
  for (const room of allRooms) {
    if (room.encounter && !addedMobIds.has(room.encounter.mobId)) {
      const poolEntry = allMobPool.find(m => m.id === room.encounter!.mobId);
      if (poolEntry) {
        usedMobs.push({
          id: poolEntry.id,
          name: poolEntry.name,
          description: poolEntry.description,
          skullRating: poolEntry.skullRating,
          maxHp: poolEntry.baseStats.maxHp,
          damage: poolEntry.baseStats.damage,
          defense: poolEntry.baseStats.defense,
          initiative: poolEntry.baseStats.initiative,
          lootTable: poolEntry.lootTable,
        });
        addedMobIds.add(poolEntry.id);
      }
    }
  }

  // Collect all used items
  const collectedItemIds = new Set<string>();
  const usedItemsList: Item[] = [];

  for (const itemId of usedItemIds) {
    if (collectedItemIds.has(itemId)) continue;
    const item = allItems.find(i => i.id === itemId) ?? allUniqueItems.find(i => i.id === itemId);
    if (item) {
      usedItemsList.push(item);
      collectedItemIds.add(itemId);
    }
  }

  // Add key item — it comes from the biome definition, not the item pools
  if (!collectedItemIds.has(finalBiome.keyItem.id)) {
    usedItemsList.push({
      id: finalBiome.keyItem.id,
      name: finalBiome.keyItem.name,
      description: finalBiome.keyItem.description,
      rarity: 'unique',
      slot: 'accessory',
      stats: {},
    });
    collectedItemIds.add(finalBiome.keyItem.id);
  }

  // Stamp grid positions onto rooms so the client can lay them out without BFS
  for (const room of allRooms) {
    const pos = roomPositions.get(room.id);
    if (pos) {
      room.gridX = pos.x;
      room.gridY = pos.y;
    }
  }

  // Build zone transition narration map
  const zoneTransitions: Record<string, string> = {};
  for (let z = 1; z < biomes.length; z++) {
    zoneTransitions[zoneEntries[z]] = biomes[z].transitionText;
  }

  return {
    name: `The ${biomes.map(b => b.name).join(' / ')}`,
    theme: biomes.map(b => b.name).join(', '),
    atmosphere: biomes.map(b => b.transitionText).join(' '),
    rooms: allRooms,
    mobs: usedMobs,
    items: usedItemsList,
    bossId: bossMob.id,
    entranceRoomId,
    zoneTransitions,
  };
}

// ── Helpers ──────────────────────────────────────────────

/** Safely remove an exit from a room and its reciprocal link. */
function disconnectExit(room: Room, dir: Direction, roomMap: Map<string, Room>): void {
  const targetId = room.exits[dir];
  if (!targetId) return;
  const target = roomMap.get(targetId);
  if (target) {
    const opp = OPPOSITES[dir];
    if (target.exits[opp] === room.id) {
      delete target.exits[opp];
    }
  }
  delete room.exits[dir];
}

/** Place newRoom adjacent to parentRoom in an unoccupied cell. */
function placeRoom(
  parentRoom: Room,
  newRoom: Room,
  roomUsedDirs: Map<string, Set<Direction>>,
  roomExitCapacity: Map<string, number>,
  roomPositions: Map<string, { x: number; y: number }>,
  occupiedCells: Map<string, string>,
): boolean {
  const parentPos = roomPositions.get(parentRoom.id)!;
  const usedParent = roomUsedDirs.get(parentRoom.id) ?? new Set<Direction>();

  for (const dir of shuffle([...ALL_DIRECTIONS])) {
    if (usedParent.has(dir)) continue;
    const nx = parentPos.x + DIR_DELTA[dir].dx;
    const ny = parentPos.y + DIR_DELTA[dir].dy;
    const key = `${nx},${ny}`;
    if (occupiedCells.has(key)) continue;

    const opp = OPPOSITES[dir];
    parentRoom.exits[dir] = newRoom.id;
    newRoom.exits[opp] = parentRoom.id;
    usedParent.add(dir);
    const usedNew = roomUsedDirs.get(newRoom.id) ?? new Set<Direction>();
    usedNew.add(opp);
    roomUsedDirs.set(parentRoom.id, usedParent);
    roomUsedDirs.set(newRoom.id, usedNew);

    roomPositions.set(newRoom.id, { x: nx, y: ny });
    occupiedCells.set(key, newRoom.id);
    return true;
  }
  return false;
}

/** Returns the direction from posA to posB if they are grid-adjacent, else null. */
function getAdjacentDirection(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
): Direction | null {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  if (dx === 1 && dy === 0) return 'east';
  if (dx === -1 && dy === 0) return 'west';
  if (dx === 0 && dy === -1) return 'north';
  if (dx === 0 && dy === 1) return 'south';
  return null;
}

function getBiomeForRoom(
  room: Room,
  biomes: BiomeDefinition[],
  zoneEntries: string[],
  zoneCount: number,
): BiomeDefinition {
  // Determine which zone a room belongs to by checking its id suffix
  for (let z = 0; z < zoneCount; z++) {
    if (room.id.includes(`_z${z}_`)) {
      return biomes[z];
    }
  }
  // Fallback: boss room
  for (let z = zoneCount - 1; z >= 0; z--) {
    if (room.id.includes(`_z${z}_`)) {
      return biomes[z];
    }
  }
  return biomes[0];
}

function repairConnectivity(allRooms: Room[], entranceId: string): void {
  const roomMap = new Map(allRooms.map(r => [r.id, r]));
  const visited = new Set<string>();
  const queue = [entranceId];
  visited.add(entranceId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const room = roomMap.get(current)!;
    for (const targetId of Object.values(room.exits)) {
      if (targetId && !visited.has(targetId)) {
        visited.add(targetId);
        queue.push(targetId);
      }
    }
  }

  // Find orphaned rooms and reconnect them
  for (const room of allRooms) {
    if (visited.has(room.id)) continue;

    // Find a reachable room that has an available direction
    const usedDirs = new Set(Object.keys(room.exits) as Direction[]);
    let reconnected = false;

    for (const reachable of allRooms) {
      if (!visited.has(reachable.id)) continue;
      const reachableUsed = new Set(Object.keys(reachable.exits) as Direction[]);

      for (const dir of ALL_DIRECTIONS) {
        const opp = OPPOSITES[dir];
        if (!reachableUsed.has(dir) && !usedDirs.has(opp)) {
          reachable.exits[dir] = room.id;
          room.exits[opp] = reachable.id;
          reconnected = true;
          break;
        }
      }
      if (reconnected) break;
    }

    if (!reconnected) {
      // Force: pick any reachable room, overwrite a direction
      const target = allRooms.find(r => visited.has(r.id) && r.type !== 'boss')!;
      const dir: Direction = 'north';
      const opp = OPPOSITES[dir];
      disconnectExit(target, dir, roomMap);
      disconnectExit(room, opp, roomMap);
      target.exits[dir] = room.id;
      room.exits[opp] = target.id;
    }

    // Mark this room and anything connected to it as visited
    visited.add(room.id);
    const subQueue = [room.id];
    while (subQueue.length > 0) {
      const current = subQueue.shift()!;
      const r = roomMap.get(current)!;
      for (const targetId of Object.values(r.exits)) {
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          subQueue.push(targetId);
        }
      }
    }
  }
}

function getRoomsInZone(rooms: Room[], zoneIndex: number): Room[] {
  return rooms.filter(r => r.id.includes(`_z${zoneIndex}_`));
}

function rollRarity(weights: { rarity: Rarity; weight: number }[]): Rarity {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.rarity;
  }
  return weights[0].rarity;
}
