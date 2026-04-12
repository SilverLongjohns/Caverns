import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, CharacterSummary } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { generateProceduralDungeon } from './ProceduralGenerator.js';
import { db } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { NameAuthProvider } from './auth/NameAuthProvider.js';
import { SessionStore } from './auth/SessionStore.js';
import { CharacterRepository } from './CharacterRepository.js';
import { StashRepository } from './StashRepository.js';
import { WorldRepository } from './WorldRepository.js';
import { WorldSession } from './WorldSession.js';
import * as worldSessionManager from './worldSessionManager.js';
import { ActiveSessionMap } from './ActiveSessionMap.js';
import type { CharactersTable } from './db/types.js';

const PORT = Number(process.env.PORT) || 3001;

// === Account / character persistence services ===
const nameAuth = db ? new NameAuthProvider(db) : null;
const sessionStore = db ? new SessionStore(db) : null;
const characterRepo = db ? new CharacterRepository(db) : null;
const stashRepo = db ? new StashRepository(db) : null;
const worldRepo = db ? new WorldRepository(db) : null;
const activeSessions = new ActiveSessionMap();

// Per-connection auth state.
interface ConnectionAccount {
  accountId: string;
  sessionToken: string;
  characterId?: string;
  selectedWorldId: string | null;
}
const connectionAccounts = new Map<string, ConnectionAccount>();

// Run boot housekeeping: migrations, then clear leftover in_use flags + expired sessions.
(async () => {
  try {
    if (db) await runMigrations();
    if (characterRepo) await characterRepo.clearAllInUse();
    if (sessionStore) await sessionStore.clearExpired();
  } catch (err) {
    console.error('[boot] DB init failed', err);
  }
})();

function toSummary(row: CharactersTable): CharacterSummary {
  return {
    id: row.id,
    name: row.name,
    className: row.class,
    level: row.level,
    gold: row.gold,
    lastPlayedAt: row.last_played_at ? (row.last_played_at as Date).toISOString() : null,
    inUse: row.in_use,
  };
}

async function sendAuthResult(ws: WebSocket, accountId: string, token: string): Promise<void> {
  if (!characterRepo || !db) return;
  const acc = await db
    .selectFrom('accounts')
    .select(['id', 'display_name'])
    .where('id', '=', accountId)
    .executeTakeFirstOrThrow();
  // Characters are scoped to a selected world, so send empty here — the
  // client will receive a populated character_list after select_world.
  sendToWs(ws, {
    type: 'auth_result',
    token,
    account: { id: acc.id, displayName: acc.display_name },
    characters: [],
  });
}

async function sendWorldList(ws: WebSocket, accountId: string): Promise<void> {
  if (!worldRepo || !db) return;
  const dbRef = db;
  const rows = await worldRepo.listForAccount(accountId);
  const summaries = await Promise.all(rows.map(async (w) => {
    const owner = await dbRef
      .selectFrom('accounts')
      .select(['display_name'])
      .where('id', '=', w.owner_account_id)
      .executeTakeFirst();
    return {
      id: w.id,
      name: w.name,
      ownerDisplayName: owner?.display_name ?? 'Unknown',
      memberCount: await worldRepo.countMembers(w.id),
      isOwner: w.owner_account_id === accountId,
      inviteCode: w.invite_code,
    };
  }));
  sendToWs(ws, { type: 'world_list', worlds: summaries });
}

async function sendCharacterListForWorld(
  ws: WebSocket, accountId: string, worldId: string | null,
): Promise<void> {
  if (!characterRepo) return;
  const list = worldId ? await characterRepo.listForWorld(accountId, worldId) : [];
  sendToWs(ws, { type: 'character_list', characters: list.map(toSummary) });
}

function sendToWs(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_DIR = join(__dirname, '..', '..', 'client', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = req.url?.split('?')[0] ?? '/';
  let filePath = join(CLIENT_DIR, url === '/' ? 'index.html' : url);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    const isHtml = ext === '.html';
    const headers: Record<string, string> = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': isHtml
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=31536000, immutable',
    };
    if (isHtml) {
      headers['CDN-Cache-Control'] = 'no-store';
      headers['Surrogate-Control'] = 'no-store';
    }
    res.writeHead(200, headers);
    res.end(readFileSync(filePath));
  } else {
    const indexPath = join(CLIENT_DIR, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Surrogate-Control': 'no-store',
      });
      res.end(readFileSync(indexPath));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});
const wss = new WebSocketServer({ server });

const clients = new Map<string, WebSocket>();
let nextId = 1;

// Reverse lookup: connectionId → worldId for WorldSession membership.
const worldConnections = new Map<string, string>();

function getWorldSession(connectionId: string): WorldSession | undefined {
  const worldId = worldConnections.get(connectionId);
  return worldId ? worldSessionManager.getSession(worldId) : undefined;
}

function worldBroadcast(worldId: string) {
  return (msg: ServerMessage, exceptConnectionId?: string) => {
    for (const [connId, wId] of worldConnections) {
      if (wId !== worldId) continue;
      if (exceptConnectionId && connId === exceptConnectionId) continue;
      sendTo(connId, msg);
    }
  };
}

async function detachFromWorldSession(connectionId: string): Promise<void> {
  const session = getWorldSession(connectionId);
  if (!session) return;
  const result = await session.removeConnection(connectionId);
  worldConnections.delete(connectionId);
  if (result === 'destroyed') worldSessionManager.unregisterSession(session.worldId);
}

// === Dungeon instances (Phase 5 portal-spawned GameSessions) ===
// Keyed by sessionId. Lifetime: created on portal_enter, removed when the
// GameSession's onGameOver fires and returnFromDungeon completes.
interface DungeonInstance {
  sessionId: string;
  worldId: string;
  gameSession: GameSession;
  connections: Set<string>;
}
const dungeonInstances = new Map<string, DungeonInstance>();
const dungeonConnections = new Map<string /* connectionId */, string /* sessionId */>();
let nextDungeonId = 1;

function getDungeonInstance(connectionId: string): DungeonInstance | undefined {
  const sessionId = dungeonConnections.get(connectionId);
  return sessionId ? dungeonInstances.get(sessionId) : undefined;
}

/** Resolve the GameSession a connection is currently in. */
function getGameSession(connectionId: string): GameSession | undefined {
  return getDungeonInstance(connectionId)?.gameSession;
}

function dungeonBroadcast(sessionId: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    const inst = dungeonInstances.get(sessionId);
    if (!inst) return;
    const data = JSON.stringify(msg);
    for (const connId of inst.connections) {
      const ws = clients.get(connId);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };
}

function sendTo(playerId: string, msg: ServerMessage): void {
  const ws = clients.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
  const playerId = `player_${nextId++}`;
  clients.set(playerId, ws);

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'login': {
        if (!nameAuth || !sessionStore) {
          sendTo(playerId, { type: 'auth_error', reason: 'Database unavailable' });
          break;
        }
        const result = await nameAuth.authenticate({ name: msg.name });
        if (!result) {
          sendTo(playerId, { type: 'auth_error', reason: 'Invalid name' });
          break;
        }
        const token = await sessionStore.create(result.accountId);
        connectionAccounts.set(playerId, { accountId: result.accountId, sessionToken: token, selectedWorldId: null });
        await sendAuthResult(ws, result.accountId, token);
        await sendWorldList(ws, result.accountId);
        break;
      }

      case 'resume_session': {
        if (!sessionStore || !characterRepo) {
          sendTo(playerId, { type: 'auth_error', reason: 'Database unavailable' });
          break;
        }
        const info = await sessionStore.resolve(msg.token);
        if (!info) {
          sendTo(playerId, { type: 'auth_error', reason: 'Session expired' });
          break;
        }
        connectionAccounts.set(playerId, { accountId: info.accountId, sessionToken: info.token, selectedWorldId: null });
        // If there's no active game session owning any character for this
        // account, any lingering in_use flag is stranded from a dead
        // connection (e.g. browser refresh race). Clear before sending the
        // character list so the client doesn't see stale "In use" buttons.
        const existingSessionId = activeSessions.get(info.accountId);
        if (!existingSessionId) {
          try { await characterRepo.clearInUseForAccount(info.accountId); } catch (e) { console.error(e); }
        }
        await sendAuthResult(ws, info.accountId, info.token);
        await sendWorldList(ws, info.accountId);
        // Reconnection reattach to an active run.
        if (existingSessionId) {
          const dungeonInst = dungeonInstances.get(existingSessionId);
          if (dungeonInst) {
            const oldConn = dungeonInst.gameSession.findConnectionByAccount(info.accountId);
            if (oldConn && oldConn !== playerId) {
              dungeonInst.gameSession.reattachConnection(oldConn, playerId);
              dungeonInst.connections.delete(oldConn);
              dungeonInst.connections.add(playerId);
              dungeonConnections.delete(oldConn);
              dungeonConnections.set(playerId, dungeonInst.sessionId);
              clients.delete(oldConn);
              dungeonInst.gameSession.markConnected(playerId);
              const charId = dungeonInst.gameSession.getCharacterIdFor(playerId);
              const ctx = connectionAccounts.get(playerId);
              if (ctx) ctx.characterId = charId;
              sendTo(playerId, { type: 'dungeon_entered', dungeonSessionId: dungeonInst.sessionId });
            }
          }
        }
        break;
      }

      case 'logout': {
        const ctx = connectionAccounts.get(playerId);
        await detachFromWorldSession(playerId);
        if (ctx) {
          activeSessions.detach(ctx.accountId);
          if (ctx.characterId && characterRepo) {
            try { await characterRepo.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
          }
          if (sessionStore) {
            try { await sessionStore.delete(ctx.sessionToken); } catch (e) { console.error(e); }
          }
        }
        connectionAccounts.delete(playerId);
        break;
      }

      case 'list_worlds': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !worldRepo) {
          sendTo(playerId, { type: 'world_error', reason: 'Not logged in' });
          break;
        }
        await sendWorldList(ws, ctx.accountId);
        break;
      }

      case 'create_world': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !worldRepo) {
          sendTo(playerId, { type: 'world_error', reason: 'Not logged in' });
          break;
        }
        try {
          await worldRepo.create(ctx.accountId, msg.name);
        } catch (e) {
          sendTo(playerId, { type: 'world_error', reason: (e as Error).message });
          break;
        }
        await sendWorldList(ws, ctx.accountId);
        break;
      }

      case 'join_world': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !worldRepo) {
          sendTo(playerId, { type: 'world_error', reason: 'Not logged in' });
          break;
        }
        const code = msg.inviteCode.trim().toUpperCase();
        const world = await worldRepo.getByInviteCode(code);
        if (!world) {
          sendTo(playerId, { type: 'world_error', reason: 'Invite code not found' });
          break;
        }
        if (world.owner_account_id === ctx.accountId) {
          sendTo(playerId, { type: 'world_error', reason: 'You already own this world' });
          break;
        }
        if (await worldRepo.isMember(world.id, ctx.accountId)) {
          sendTo(playerId, { type: 'world_error', reason: 'You are already a member' });
          break;
        }
        await worldRepo.addMember(world.id, ctx.accountId);
        await sendWorldList(ws, ctx.accountId);
        break;
      }

      case 'select_world': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !worldRepo) {
          sendTo(playerId, { type: 'world_error', reason: 'Not logged in' });
          break;
        }
        if (!(await worldRepo.isMember(msg.worldId, ctx.accountId))) {
          sendTo(playerId, { type: 'world_error', reason: 'Not a member of that world' });
          break;
        }
        ctx.selectedWorldId = msg.worldId;
        sendTo(playerId, { type: 'world_selected', worldId: msg.worldId });
        await sendCharacterListForWorld(ws, ctx.accountId, msg.worldId);
        break;
      }

      case 'create_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) {
          sendTo(playerId, { type: 'auth_error', reason: 'Not logged in' });
          break;
        }
        if (!ctx.selectedWorldId) {
          sendTo(playerId, { type: 'world_error', reason: 'No world selected' });
          break;
        }
        try {
          await characterRepo.create(ctx.accountId, ctx.selectedWorldId, { name: msg.name, class: msg.class });
        } catch (e) {
          sendTo(playerId, { type: 'auth_error', reason: (e as Error).message });
          break;
        }
        await sendCharacterListForWorld(ws, ctx.accountId, ctx.selectedWorldId);
        break;
      }

      case 'delete_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) break;
        await characterRepo.delete(ctx.accountId, msg.characterId);
        await sendCharacterListForWorld(ws, ctx.accountId, ctx.selectedWorldId);
        break;
      }

      case 'select_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) break;
        const ch = await characterRepo.getById(msg.characterId);
        if (!ch || ch.account_id !== ctx.accountId) {
          sendTo(playerId, { type: 'error', message: 'Character not found' });
          break;
        }
        if (!ctx.selectedWorldId || ch.world_id !== ctx.selectedWorldId) {
          sendTo(playerId, { type: 'world_error', reason: 'Character is not in the selected world' });
          break;
        }
        if (ch.in_use) {
          sendTo(playerId, { type: 'error', message: 'Character already in use' });
          break;
        }
        await characterRepo.markInUse(ch.id, true);
        ctx.characterId = ch.id;

        if (!worldRepo || !db) {
          sendTo(playerId, { type: 'world_error', reason: 'World unavailable' });
          break;
        }
        const world = await worldRepo.getById(ctx.selectedWorldId);
        if (!world) {
          sendTo(playerId, { type: 'world_error', reason: 'World not found' });
          break;
        }
        const accRow = await db
          .selectFrom('accounts')
          .select(['display_name'])
          .where('id', '=', ctx.accountId)
          .executeTakeFirst();

        let session = worldSessionManager.getSession(world.id);
        if (!session) {
          session = new WorldSession({
            worldId: world.id,
            worldName: world.name,
            worldRepo,
            characterRepo,
            broadcast: worldBroadcast(world.id),
            sendTo,
          });
          worldSessionManager.registerSession(session);
        }

        worldConnections.set(playerId, world.id);
        await session.addConnection({
          connectionId: playerId,
          accountId: ctx.accountId,
          characterId: ch.id,
          displayName: accRow?.display_name ?? 'Unknown',
          characterName: ch.name,
          className: ch.class,
          level: ch.level,
          savedPos: ch.overworld_pos ?? null,
        });
        break;
      }

      case 'overworld_move': {
        const session = getWorldSession(playerId);
        if (!session) break;
        const result = session.requestMove(playerId, { x: msg.targetX, y: msg.targetY });
        if (result !== 'ok') {
          sendTo(playerId, { type: 'world_move_rejected', reason: result });
        }
        break;
      }

      case 'portal_ready': {
        getWorldSession(playerId)?.setReadyAtPortal(playerId);
        break;
      }

      case 'portal_unready': {
        getWorldSession(playerId)?.setUnreadyAtPortal(playerId);
        break;
      }

      case 'portal_enter': {
        const session = getWorldSession(playerId);
        if (!session) break;
        const entry = session.beginDungeonEntry(playerId);
        if (entry.status !== 'ok') {
          sendTo(playerId, { type: 'error', message: `Cannot enter portal: ${entry.status}` });
          break;
        }

        const dungeon = generateProceduralDungeon(3);
        const sessionId = `dungeon_${nextDungeonId++}`;

        const handleGameOver = async () => {
          const inst = dungeonInstances.get(sessionId);
          if (!inst) return;
          const worldSession = worldSessionManager.getSession(inst.worldId);
          const activeConns = new Set<string>();
          for (const connId of inst.connections) {
            const ws = clients.get(connId);
            if (ws && ws.readyState === WebSocket.OPEN) activeConns.add(connId);
          }
          if (worldSession) {
            await worldSession.returnFromDungeon(sessionId, activeConns);
            for (const connId of activeConns) {
              worldConnections.set(connId, inst.worldId);
            }
            // If the world session is idle with no outbound dungeons, it may
            // already be scheduled for teardown — re-check and unregister.
            if (worldSession.memberCount() === 0 && worldSession.outboundDungeonCount() === 0) {
              worldSessionManager.unregisterSession(worldSession.worldId);
            }
          }
          for (const connId of inst.connections) {
            dungeonConnections.delete(connId);
          }
          dungeonInstances.delete(sessionId);
        };

        const gameSession = new GameSession(
          dungeonBroadcast(sessionId),
          sendTo,
          dungeon,
          () => { void handleGameOver(); },
          characterRepo,
          activeSessions,
          sessionId,
          entry.origin,
        );

        const inst: DungeonInstance = {
          sessionId,
          worldId: session.worldId,
          gameSession,
          connections: new Set(entry.party.map((p) => p.connectionId)),
        };
        dungeonInstances.set(sessionId, inst);

        session.registerOutboundDungeon({
          sessionId,
          portalId: entry.origin.portalId,
          portalPos: entry.origin.portalPos,
          party: entry.party,
        });

        for (const p of entry.party) {
          worldConnections.delete(p.connectionId);
          dungeonConnections.set(p.connectionId, sessionId);
          gameSession.addPlayer(p.connectionId, p.characterName, p.className);
          try {
            await gameSession.hydratePlayerFromCharacter(p.connectionId, p.accountId, p.characterId);
          } catch (e) {
            console.error('[portal_enter] hydrate failed', e);
          }
        }

        session.removePartyForDungeon(entry.party.map((p) => p.connectionId));

        for (const p of entry.party) {
          sendTo(p.connectionId, { type: 'dungeon_entered', dungeonSessionId: sessionId });
        }

        gameSession.startGame();
        break;
      }

      case 'leave_world': {
        const ctx = connectionAccounts.get(playerId);
        await detachFromWorldSession(playerId);
        if (ctx?.characterId && characterRepo) {
          try { await characterRepo.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
          ctx.characterId = undefined;
        }
        if (ctx?.selectedWorldId) {
          await sendCharacterListForWorld(ws, ctx.accountId, ctx.selectedWorldId);
        }
        break;
      }

      case 'overworld_interact': {
        const session = getWorldSession(playerId);
        if (!session) break;
        const it = session.getInteractableAtMember(playerId, msg.interactableId);
        if (!it) {
          sendTo(playerId, { type: 'error', message: 'Nothing to interact with here.' });
          break;
        }
        if (it.kind === 'stash') {
          const ctx = connectionAccounts.get(playerId);
          if (!ctx?.characterId || !stashRepo || !characterRepo) break;
          await stashRepo.ensure(ctx.characterId);
          const stash = await stashRepo.get(ctx.characterId);
          const ch = await characterRepo.getById(ctx.characterId);
          if (!ch) break;
          sendTo(playerId, {
            type: 'stash_opened',
            stash: { items: stash.items, capacity: stash.capacity },
            character: { inventory: ch.inventory, consumables: ch.consumables },
          });
        }
        break;
      }

      case 'stash_deposit': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx?.characterId || !stashRepo || !characterRepo) break;
        // Enforce: only allowed in the overworld (not during a dungeon).
        if (dungeonConnections.has(playerId)) {
          sendTo(playerId, { type: 'stash_error', reason: 'Cannot use stash in a dungeon.' });
          break;
        }
        const ch = await characterRepo.getById(ctx.characterId);
        if (!ch) break;
        const sourceArray = msg.from === 'inventory' ? [...ch.inventory] : [...ch.consumables];
        const item = sourceArray[msg.fromIndex];
        if (!item) {
          sendTo(playerId, { type: 'stash_error', reason: 'No item in that slot.' });
          break;
        }
        const stash = await stashRepo.get(ctx.characterId);
        const items = [...stash.items];
        const freeIdx = items.findIndex((s) => s === null);
        if (freeIdx < 0) {
          sendTo(playerId, { type: 'stash_error', reason: 'Stash is full.' });
          break;
        }
        items[freeIdx] = item;
        sourceArray[msg.fromIndex] = null;
        const newInventory = msg.from === 'inventory' ? sourceArray : ch.inventory;
        const newConsumables = msg.from === 'consumables' ? sourceArray : ch.consumables;
        await stashRepo.setItems(ctx.characterId, items);
        await characterRepo.snapshotInventory(ctx.characterId, newInventory, newConsumables);
        sendTo(playerId, {
          type: 'stash_updated',
          stash: { items, capacity: stash.capacity },
          character: { inventory: newInventory, consumables: newConsumables },
        });
        break;
      }

      case 'stash_withdraw': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx?.characterId || !stashRepo || !characterRepo) break;
        if (dungeonConnections.has(playerId)) {
          sendTo(playerId, { type: 'stash_error', reason: 'Cannot use stash in a dungeon.' });
          break;
        }
        const ch = await characterRepo.getById(ctx.characterId);
        if (!ch) break;
        const stash = await stashRepo.get(ctx.characterId);
        const items = [...stash.items];
        const item = items[msg.stashIndex];
        if (!item) {
          sendTo(playerId, { type: 'stash_error', reason: 'No item in that stash slot.' });
          break;
        }
        const destArray = msg.to === 'inventory' ? [...ch.inventory] : [...ch.consumables];
        const freeIdx = destArray.findIndex((s) => s === null);
        if (freeIdx < 0) {
          sendTo(playerId, {
            type: 'stash_error',
            reason: msg.to === 'inventory' ? 'Inventory is full.' : 'Pouch is full.',
          });
          break;
        }
        destArray[freeIdx] = item;
        items[msg.stashIndex] = null;
        const newInventory = msg.to === 'inventory' ? destArray : ch.inventory;
        const newConsumables = msg.to === 'consumables' ? destArray : ch.consumables;
        await stashRepo.setItems(ctx.characterId, items);
        await characterRepo.snapshotInventory(ctx.characterId, newInventory, newConsumables);
        sendTo(playerId, {
          type: 'stash_updated',
          stash: { items, capacity: stash.capacity },
          character: { inventory: newInventory, consumables: newConsumables },
        });
        break;
      }

      case 'grid_move': {
        getGameSession(playerId)?.handleGridMove(playerId, msg.direction);
        break;
      }
      case 'combat_action': {
        if (msg.action === 'use_ability' && msg.abilityId) {
          getGameSession(playerId)?.handleUseAbility(playerId, msg.abilityId, msg.targetId);
        } else if (msg.action === 'use_item_effect' && msg.effectId) {
          getGameSession(playerId)?.handleItemEffectAction(playerId, msg.effectId, msg.targetId);
        } else {
          getGameSession(playerId)?.handleCombatAction(playerId, msg.action as 'attack' | 'defend' | 'use_item' | 'flee', msg.targetId, msg.itemIndex, msg.fleeDirection, msg.critMultiplier);
        }
        break;
      }
      case 'defend_result': {
        getGameSession(playerId)?.handleDefendResult(playerId, msg.damageReduction);
        break;
      }
      case 'loot_choice': {
        getGameSession(playerId)?.handleLootChoice(playerId, msg.itemId, msg.choice);
        break;
      }
      case 'revive': {
        getGameSession(playerId)?.handleRevive(playerId, msg.targetPlayerId);
        break;
      }
      case 'equip_item': {
        getGameSession(playerId)?.handleEquipItem(playerId, msg.inventoryIndex);
        break;
      }
      case 'drop_item': {
        getGameSession(playerId)?.handleDropItem(playerId, msg.inventoryIndex);
        break;
      }
      case 'use_consumable': {
        getGameSession(playerId)?.handleUseConsumable(playerId, msg.consumableIndex);
        break;
      }
      case 'puzzle_answer': {
        getGameSession(playerId)?.handlePuzzleAnswer(playerId, msg.roomId, msg.answerIndex);
        break;
      }
      case 'interact_action': {
        getGameSession(playerId)?.handleInteractAction(playerId, msg.interactableId, msg.actionId);
        break;
      }
      case 'allocate_stat': {
        getGameSession(playerId)?.handleAllocateStat(playerId, msg.statId, msg.points);
        break;
      }
      case 'chat': {
        const text = msg.text.trim().slice(0, 200);
        if (!text) break;
        const dungeon = getDungeonInstance(playerId);
        if (dungeon) {
          const name = dungeon.gameSession.getPlayerName(playerId) ?? 'Unknown';
          dungeonBroadcast(dungeon.sessionId)({ type: 'text_log', message: `${name}: ${text}`, logType: 'chat' });
          break;
        }
        // TODO: world chat scoped to WorldSession members (Phase 5.5).
        break;
      }
      case 'debug_teleport': {
        getGameSession(playerId)?.debugTeleport(playerId, msg.roomId);
        break;
      }
      case 'debug_reveal_all': {
        getGameSession(playerId)?.debugRevealAll(playerId);
        break;
      }
      case 'debug_give_item': {
        getGameSession(playerId)?.debugGiveItem(playerId, msg.itemId);
        break;
      }
    }
  });

  ws.on('close', async () => {
    clients.delete(playerId);
    // If the player was in a portal-spawned dungeon, mark them disconnected on
    // the GameSession and keep them in dungeonConnections so reconnect can
    // re-attach. Don't detach them or clear in_use — GameSession owns both.
    const dungeon = getDungeonInstance(playerId);
    if (dungeon) {
      dungeon.gameSession.markDisconnected(playerId);
      connectionAccounts.delete(playerId);
      return;
    }
    await detachFromWorldSession(playerId);
    // Release the character lock. Portal-spawned dungeons handle their own
    // in_use lifecycle via GameSession finalize and return above.
    {
      const ctx = connectionAccounts.get(playerId);
      if (ctx?.characterId && characterRepo) {
        try { await characterRepo.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
      }
    }
    connectionAccounts.delete(playerId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Caverns server listening on 0.0.0.0:${PORT}`);
});
