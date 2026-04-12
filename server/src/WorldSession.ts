import type { ServerMessage, WorldMemberSummary, OverworldMap, OverworldTickStep } from '@caverns/shared';
import { OVERWORLD_MAPS, isWalkable, getTile, findOverworldPath } from '@caverns/shared';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

const TICK_INTERVAL_MS = 250;

export interface WorldSessionMember {
  connectionId: string;
  accountId: string;
  characterId: string;
  displayName: string;
  characterName: string;
  className: string;
  level: number;
  pos: { x: number; y: number };
  path: { x: number; y: number }[];
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

export type MoveResult = 'ok' | 'unreachable' | 'out_of_bounds' | 'not_walkable';

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
  private tickHandle: ReturnType<typeof setInterval> | undefined;
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
    const firstMember = this.members.size === 0;
    if (firstMember) {
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
      path: [],
    };
    this.members.set(member.connectionId, member);
    if (firstMember) this.startTickLoop();

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

    try {
      await this.characterRepo.snapshotOverworldPos(member.characterId, member.pos);
    } catch (e) {
      console.error('[WorldSession] snapshot on remove failed', e);
    }

    this.members.delete(connectionId);
    this.broadcast({
      type: 'world_member_left',
      connectionId,
      characterId: member.characterId,
    });

    if (this.members.size === 0) {
      this.stopTickLoop();
      await this.snapshot();
      return 'destroyed';
    }
    return 'still_active';
  }

  requestMove(connectionId: string, target: { x: number; y: number }): MoveResult {
    const member = this.members.get(connectionId);
    if (!member) return 'unreachable';

    if (
      target.x < 0 || target.y < 0 ||
      target.x >= this.map.width || target.y >= this.map.height
    ) {
      return 'out_of_bounds';
    }
    const tile = getTile(this.map, target.x, target.y);
    if (!tile || !isWalkable(tile)) return 'not_walkable';

    const path = findOverworldPath(this.map, member.pos, target);
    if (path === null) return 'unreachable';

    member.path = path;
    return 'ok';
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

  /** Test-only hook for deterministic tick-driving. */
  async runTickForTest(): Promise<void> {
    await this.tick();
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

  private startTickLoop(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      this.tick().catch((e) => console.error('[WorldSession] tick error', e));
    }, TICK_INTERVAL_MS);
  }

  private stopTickLoop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
  }

  private async tick(): Promise<void> {
    const steps: OverworldTickStep[] = [];
    const arrivedMembers: WorldSessionMember[] = [];

    for (const member of this.members.values()) {
      if (member.path.length === 0) continue;
      const next = member.path.shift()!;
      member.pos = next;
      const arrived = member.path.length === 0;
      steps.push({ connectionId: member.connectionId, x: next.x, y: next.y, arrived });
      if (arrived) arrivedMembers.push(member);
    }

    if (steps.length > 0) {
      this.broadcast({ type: 'overworld_tick', steps });
    }

    for (const m of arrivedMembers) {
      try {
        await this.characterRepo.snapshotOverworldPos(m.characterId, m.pos);
      } catch (e) {
        console.error('[WorldSession] snapshot on arrival failed', e);
      }
    }
  }

  private async hydrate(): Promise<void> {
    // Phase 4: nothing to hydrate. Per-member positions resolved in addConnection.
    // Phase 5: check for abandoned dungeon instances owned by this world.
    void this.worldRepo;
    void this.characterRepo;
  }

  private async snapshot(): Promise<void> {
    // Phase 4: members snapshot individually on removal/arrival.
    // Phase 5+: write world.state jsonb via worldRepo.snapshotState.
  }
}
