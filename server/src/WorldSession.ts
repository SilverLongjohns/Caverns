import type { ServerMessage, WorldMemberSummary, OverworldMap } from '@caverns/shared';
import { OVERWORLD_MAPS, isWalkable, getTile } from '@caverns/shared';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

export interface WorldSessionMember {
  connectionId: string;
  accountId: string;
  characterId: string;
  displayName: string;
  characterName: string;
  className: string;
  level: number;
  pos: { x: number; y: number };
}

export interface AddConnectionArgs {
  connectionId: string;
  accountId: string;
  characterId: string;
  displayName: string;
  characterName: string;
  className: string;
  level: number;
  savedPos: { x: number; y: number } | null;
}

export interface WorldSessionDeps {
  worldId: string;
  worldName: string;
  worldRepo: WorldRepository;
  characterRepo: CharacterRepository;
  broadcast: (msg: ServerMessage, exceptConnectionId?: string) => void;
  sendTo: (connectionId: string, msg: ServerMessage) => void;
}

function resolveStartPos(
  saved: { x: number; y: number } | null,
  map: OverworldMap,
): { x: number; y: number } {
  if (saved) {
    const t = getTile(map, saved.x, saved.y);
    if (t && isWalkable(t)) return saved;
  }
  return map.spawnTile;
}

export class WorldSession {
  readonly worldId: string;
  readonly worldName: string;
  private readonly map: OverworldMap;
  private members = new Map<string, WorldSessionMember>();
  private worldRepo: WorldRepository;
  private characterRepo: CharacterRepository;
  private broadcast: (msg: ServerMessage, exceptConnectionId?: string) => void;
  private sendTo: (connectionId: string, msg: ServerMessage) => void;

  constructor(deps: WorldSessionDeps) {
    this.worldId = deps.worldId;
    this.worldName = deps.worldName;
    this.worldRepo = deps.worldRepo;
    this.characterRepo = deps.characterRepo;
    this.broadcast = deps.broadcast;
    this.sendTo = deps.sendTo;
    // TODO(post-v1): resolve map ID from world row. For now, every world uses 'starter'.
    const map = OVERWORLD_MAPS.starter;
    if (!map) throw new Error('starter overworld map missing');
    this.map = map;
  }

  async addConnection(args: AddConnectionArgs): Promise<void> {
    if (this.members.size === 0) {
      await this.hydrate();
    }
    const pos = resolveStartPos(args.savedPos, this.map);
    const member: WorldSessionMember = {
      connectionId: args.connectionId,
      accountId: args.accountId,
      characterId: args.characterId,
      displayName: args.displayName,
      characterName: args.characterName,
      className: args.className,
      level: args.level,
      pos,
    };
    this.members.set(member.connectionId, member);

    this.sendTo(member.connectionId, {
      type: 'world_state',
      worldId: this.worldId,
      worldName: this.worldName,
      map: this.map,
      members: this.getMembers(),
    });

    this.broadcast(
      { type: 'world_member_joined', member: this.toSummary(member) },
      member.connectionId,
    );
  }

  async removeConnection(connectionId: string): Promise<'destroyed' | 'still_active'> {
    const member = this.members.get(connectionId);
    if (!member) return 'still_active';

    this.members.delete(connectionId);
    this.broadcast({
      type: 'world_member_left',
      connectionId,
      characterId: member.characterId,
    });

    // Phase 5 invariant: `&& outboundDungeons.size === 0` — teardown must not
    // happen while a dungeon instance is still tied to this world.
    if (this.members.size === 0) {
      await this.snapshot();
      return 'destroyed';
    }
    return 'still_active';
  }

  hasMember(connectionId: string): boolean {
    return this.members.has(connectionId);
  }

  memberCount(): number {
    return this.members.size;
  }

  getMembers(): WorldMemberSummary[] {
    return [...this.members.values()].map((m) => this.toSummary(m));
  }

  private toSummary(m: WorldSessionMember): WorldMemberSummary {
    return {
      connectionId: m.connectionId,
      characterId: m.characterId,
      characterName: m.characterName,
      displayName: m.displayName,
      className: m.className,
      level: m.level,
      pos: m.pos,
    };
  }

  private async hydrate(): Promise<void> {
    // Phase 2: nothing to load.
    // Phase 3: map is loaded in the constructor.
    // Phase 4+: load per-character overworld_pos for returning members.
    // Phase 5: check for abandoned dungeon instances owned by this world.
    void this.worldRepo;
    void this.characterRepo;
  }

  private async snapshot(): Promise<void> {
    // Phase 2: nothing to persist.
    // Phase 4+: write per-character overworld_pos.
    // Phase 5+: write world.state jsonb via worldRepo.snapshotState.
  }
}
