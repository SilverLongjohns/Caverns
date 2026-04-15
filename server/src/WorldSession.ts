import type { ServerMessage, WorldMemberSummary, OverworldMap, OverworldTickStep, OverworldPortal, OverworldInteractable } from '@caverns/shared';
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

export interface DungeonPartyMember {
  connectionId: string;
  accountId: string;
  characterId: string;
  displayName: string;
  characterName: string;
  className: string;
  level: number;
}

export interface OutboundDungeonHandle {
  sessionId: string;
  portalId: string;
  portalPos: { x: number; y: number };
  party: DungeonPartyMember[];
}

export type BeginDungeonEntryResult =
  | {
      status: 'ok';
      origin: { worldId: string; portalId: string; portalPos: { x: number; y: number } };
      party: DungeonPartyMember[];
    }
  | { status: 'not_on_portal' | 'not_ready' | 'not_member' };

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
  private musters = new Map<string /* portalId */, Set<string /* connectionId */>>();
  private outboundDungeons = new Map<string /* sessionId */, OutboundDungeonHandle>();
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
    const map = OVERWORLD_MAPS.starter;
    if (!map) throw new Error('starter overworld map missing');
    this.map = map;
  }

  async addConnection(args: AddConnectionArgs): Promise<void> {
    const firstMember = this.members.size === 0 && this.outboundDungeons.size === 0;
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
    if (this.tickHandle === undefined) this.startTickLoop();

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

    this.setUnreadyAtPortal(connectionId);
    this.members.delete(connectionId);
    this.broadcast({
      type: 'world_member_left',
      connectionId,
      characterId: member.characterId,
    });

    if (this.members.size === 0) {
      this.stopTickLoop();
      if (this.outboundDungeons.size === 0) {
        await this.snapshot();
        return 'destroyed';
      }
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

  outboundDungeonCount(): number {
    return this.outboundDungeons.size;
  }

  getInteractableAtMember(connectionId: string, interactableId: string): OverworldInteractable | null {
    const member = this.members.get(connectionId);
    if (!member) return null;
    const it = this.map.interactables.find((i) => i.id === interactableId);
    if (!it) return null;
    return it;
  }

  outboundDungeonSessionIdFor(connectionId: string): string | undefined {
    for (const h of this.outboundDungeons.values()) {
      if (h.party.some((p) => p.connectionId === connectionId)) return h.sessionId;
    }
    return undefined;
  }

  getMembers(): WorldMemberSummary[] {
    return [...this.members.values()].map((m) => this.toSummary(m));
  }

  // === Portal muster (Task 2) ===

  private getPortalAt(pos: { x: number; y: number }): OverworldPortal | undefined {
    return this.map.portals.find((p) => p.x === pos.x && p.y === pos.y);
  }

  setReadyAtPortal(connectionId: string): 'ok' | 'not_on_portal' | 'not_member' {
    const member = this.members.get(connectionId);
    if (!member) return 'not_member';
    const portal = this.getPortalAt(member.pos) ?? this.map.portals[0];
    if (!portal) return 'not_on_portal';

    let muster = this.musters.get(portal.id);
    if (!muster) {
      muster = new Set();
      this.musters.set(portal.id, muster);
    }
    muster.add(connectionId);
    this.broadcastMuster(portal.id);
    return 'ok';
  }

  setUnreadyAtPortal(connectionId: string): void {
    for (const [portalId, set] of [...this.musters]) {
      if (set.delete(connectionId)) {
        if (set.size === 0) this.musters.delete(portalId);
        this.broadcastMuster(portalId);
      }
    }
  }

  private broadcastMuster(portalId: string): void {
    const set = this.musters.get(portalId) ?? new Set<string>();
    const readyMembers: WorldMemberSummary[] = [];
    for (const connId of set) {
      const m = this.members.get(connId);
      if (m) readyMembers.push(this.toSummary(m));
    }
    this.broadcast({
      type: 'portal_muster_update',
      portalId,
      readyMembers,
    });
  }

  // === Dungeon entry / return (Tasks 3 & 4) ===

  /**
   * Validate muster for the requester, clear it, and return the party. Caller
   * is responsible for constructing the GameSession, calling
   * registerOutboundDungeon and removePartyForDungeon, and routing connections.
   */
  beginDungeonEntry(requesterConnectionId: string): BeginDungeonEntryResult {
    const member = this.members.get(requesterConnectionId);
    if (!member) return { status: 'not_member' };
    const portal = this.getPortalAt(member.pos) ?? this.map.portals[0];
    if (!portal) return { status: 'not_on_portal' };

    const muster = this.musters.get(portal.id);
    if (!muster || !muster.has(requesterConnectionId)) return { status: 'not_ready' };

    const party: DungeonPartyMember[] = [];
    for (const connId of muster) {
      const m = this.members.get(connId);
      if (!m) continue;
      party.push({
        connectionId: m.connectionId,
        accountId: m.accountId,
        characterId: m.characterId,
        displayName: m.displayName,
        characterName: m.characterName,
        className: m.className,
        level: m.level,
      });
    }

    // Clear muster so remaining members see it dissolve.
    this.musters.delete(portal.id);
    this.broadcastMuster(portal.id);

    return {
      status: 'ok',
      origin: { worldId: this.worldId, portalId: portal.id, portalPos: { x: portal.x, y: portal.y } },
      party,
    };
  }

  registerOutboundDungeon(handle: OutboundDungeonHandle): void {
    this.outboundDungeons.set(handle.sessionId, handle);
  }

  /**
   * Remove party members from `members` without snapshotting overworld_pos
   * (their position is fixed at the portal on return). Broadcasts
   * world_member_left for each.
   */
  removePartyForDungeon(partyConnIds: string[]): void {
    for (const connId of partyConnIds) {
      const m = this.members.get(connId);
      if (!m) continue;
      this.setUnreadyAtPortal(connId);
      this.members.delete(connId);
      this.broadcast({
        type: 'world_member_left',
        connectionId: connId,
        characterId: m.characterId,
      });
    }
    if (this.members.size === 0) this.stopTickLoop();
  }

  /**
   * Called when a dungeon ends. Snapshots portal pos for every party member,
   * then re-admits members whose connections are still live.
   */
  async returnFromDungeon(sessionId: string, activeConnIds: Set<string>): Promise<void> {
    const handle = this.outboundDungeons.get(sessionId);
    if (!handle) return;
    this.outboundDungeons.delete(sessionId);

    const pos = handle.portalPos;
    for (const p of handle.party) {
      try {
        await this.characterRepo.snapshotOverworldPos(p.characterId, pos);
      } catch (e) {
        console.error('[WorldSession] snapshot on dungeon return failed', e);
      }
    }

    for (const p of handle.party) {
      if (!activeConnIds.has(p.connectionId)) continue;
      const member: WorldSessionMember = {
        connectionId: p.connectionId,
        accountId: p.accountId,
        characterId: p.characterId,
        displayName: p.displayName,
        characterName: p.characterName,
        className: p.className,
        level: p.level,
        pos: { ...pos },
        path: [],
      };
      this.members.set(p.connectionId, member);
      this.sendTo(p.connectionId, { type: 'dungeon_returned' });
      this.sendTo(p.connectionId, {
        type: 'world_state',
        worldId: this.worldId,
        worldName: this.worldName,
        map: this.map,
        members: this.getMembers(),
      });
      this.broadcast(
        { type: 'world_member_joined', member: this.toSummary(member) },
        p.connectionId,
      );
    }
    if (this.members.size > 0 && this.tickHandle === undefined) this.startTickLoop();
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

      // Auto-unready if we walked off a portal muster.
      for (const [portalId, set] of this.musters) {
        if (!set.has(member.connectionId)) continue;
        const portal = this.map.portals.find((p) => p.id === portalId);
        if (!portal) continue;
        if (portal.x !== member.pos.x || portal.y !== member.pos.y) {
          set.delete(member.connectionId);
          if (set.size === 0) this.musters.delete(portalId);
          this.broadcastMuster(portalId);
        }
      }
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
    void this.worldRepo;
    void this.characterRepo;
  }

  private async snapshot(): Promise<void> {
    // Members snapshot individually on removal/arrival.
  }
}
