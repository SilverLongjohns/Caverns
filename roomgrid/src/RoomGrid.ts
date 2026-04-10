import type {
  Tile,
  TileType,
  Entity,
  EntityType,
  GridPosition,
  GridDirection,
  RoomGridConfig,
  MoveResult,
  PathfindingOpts,
} from './types.js';
import { DIRECTION_OFFSETS, TILE_PROPERTIES } from './types.js';
import { hasLineOfSight as losCheck, getVisibleTiles as visCheck } from './lineOfSight.js';
import { findPath as astarFind } from './pathfinding.js';

export class RoomGrid {
  private readonly tiles: Tile[][];
  private readonly width: number;
  private readonly height: number;
  private readonly entities = new Map<string, Entity>();

  constructor(config: RoomGridConfig) {
    if (config.tiles.length !== config.height) {
      throw new Error(`Tile array height ${config.tiles.length} does not match config height ${config.height}`);
    }
    for (let y = 0; y < config.tiles.length; y++) {
      if (config.tiles[y].length !== config.width) {
        throw new Error(`Tile row ${y} width ${config.tiles[y].length} does not match config width ${config.width}`);
      }
    }

    this.width = config.width;
    this.height = config.height;

    // Build Tile[][] from TileType[][]
    this.tiles = config.tiles.map(row =>
      row.map((type): Tile => ({ type }))
    );

    // Apply exit data
    if (config.exits) {
      for (const exit of config.exits) {
        const tile = this.tiles[exit.position.y]?.[exit.position.x];
        if (tile && tile.type === 'exit') {
          tile.exit = exit.data;
        }
      }
    }
  }

  getTile(pos: GridPosition): Tile | null {
    if (!this.isInBounds(pos)) return null;
    return this.tiles[pos.y][pos.x];
  }

  isWalkable(pos: GridPosition): boolean {
    const tile = this.getTile(pos);
    if (!tile) return false;
    return TILE_PROPERTIES[tile.type].walkable;
  }

  isInBounds(pos: GridPosition): boolean {
    return pos.x >= 0 && pos.x < this.width && pos.y >= 0 && pos.y < this.height;
  }

  addEntity(entity: Entity): void {
    if (!this.isWalkable(entity.position)) {
      throw new Error(`Cannot place entity ${entity.id} on non-walkable tile at (${entity.position.x}, ${entity.position.y})`);
    }
    this.entities.set(entity.id, { ...entity, position: { ...entity.position } });
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  getEntity(id: string): Entity | null {
    const entity = this.entities.get(id);
    if (!entity) return null;
    return { ...entity, position: { ...entity.position } };
  }

  getEntitiesAt(pos: GridPosition): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.position.x === pos.x && entity.position.y === pos.y) {
        result.push({ ...entity, position: { ...entity.position } });
      }
    }
    return result;
  }

  getEntitiesByType(type: EntityType): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.type === type) {
        result.push({ ...entity, position: { ...entity.position } });
      }
    }
    return result;
  }

  moveEntity(id: string, direction: GridDirection): MoveResult {
    const entity = this.entities.get(id);
    if (!entity) {
      return { success: false, events: [] };
    }

    const offset = DIRECTION_OFFSETS[direction];
    const target: GridPosition = {
      x: entity.position.x + offset.dx,
      y: entity.position.y + offset.dy,
    };

    if (!this.isWalkable(target)) {
      return { success: false, events: [] };
    }

    const events: MoveResult['events'] = [];

    // Check entities at target
    const targetEntities = this.getEntitiesAt(target);

    // Combat: player moving onto mob tile
    if (entity.type === 'player') {
      const mob = targetEntities.find(e => e.type === 'mob');
      if (mob) {
        // Player stays in place, combat triggered
        return {
          success: true,
          newPosition: { ...entity.position },
          events: [{ type: 'combat', entityId: mob.id }],
        };
      }
    }

    // Move the entity
    entity.position = { ...target };

    // Check for interactable
    if (entity.type === 'player') {
      const interactable = targetEntities.find(e => e.type === 'interactable');
      if (interactable) {
        events.push({ type: 'interact', entityId: interactable.id });
      }
    }

    // Check for hazard tile
    if (entity.type === 'player') {
      const targetTile = this.getTile(target);
      if (targetTile) {
        const props = TILE_PROPERTIES[targetTile.type];
        if (props.damageOnEntry !== undefined) {
          events.push({ type: 'hazard', damage: props.damageOnEntry });
        }
      }
    }

    // Check for exit tile
    const tile = this.getTile(target);
    if (tile?.type === 'exit' && tile.exit) {
      events.push({ type: 'exit', exit: tile.exit });
    }

    return {
      success: true,
      newPosition: { ...target },
      events,
    };
  }

  getVisibleTiles(from: GridPosition, range: number): GridPosition[] {
    return visCheck(this.tiles, from, range);
  }

  hasLineOfSight(from: GridPosition, to: GridPosition): boolean {
    return losCheck(this.tiles, from, to);
  }

  findPath(from: GridPosition, to: GridPosition, opts?: PathfindingOpts): GridPosition[] | null {
    const entityList = Array.from(this.entities.values());
    return astarFind(this.tiles, entityList, from, to, opts);
  }
}
