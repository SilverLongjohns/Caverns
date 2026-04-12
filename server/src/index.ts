import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, CharacterSummary } from '@caverns/shared';
import { Lobby } from './Lobby.js';
import { GameSession } from './GameSession.js';
import { generateDungeon } from './DungeonGenerator.js';
import { generateProceduralDungeon } from './ProceduralGenerator.js';
import { generateRoomCode } from './roomCode.js';
import { db } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { NameAuthProvider } from './auth/NameAuthProvider.js';
import { SessionStore } from './auth/SessionStore.js';
import { CharacterRepository } from './CharacterRepository.js';
import { ActiveSessionMap } from './ActiveSessionMap.js';
import type { CharactersTable } from './db/types.js';

const PORT = Number(process.env.PORT) || 3001;

// === Account / character persistence services ===
const nameAuth = db ? new NameAuthProvider(db) : null;
const sessionStore = db ? new SessionStore(db) : null;
const characterRepo = db ? new CharacterRepository(db) : null;
const activeSessions = new ActiveSessionMap();

// Per-connection auth state.
interface ConnectionAccount {
  accountId: string;
  sessionToken: string;
  characterId?: string;
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
  const list = await characterRepo.listForAccount(accountId);
  sendToWs(ws, {
    type: 'auth_result',
    token,
    account: { id: acc.id, displayName: acc.display_name },
    characters: list.map(toSummary),
  });
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

interface LobbyRoom {
  code: string;
  lobby: Lobby;
  gameSession: GameSession | null;
  playerIds: Set<string>;
}

const rooms = new Map<string, LobbyRoom>();
const playerRoom = new Map<string, string>();

function getRoom(playerId: string): LobbyRoom | undefined {
  const code = playerRoom.get(playerId);
  return code ? rooms.get(code) : undefined;
}

function roomBroadcast(roomCode: string): (msg: ServerMessage) => void {
  return (msg: ServerMessage) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const pid of room.playerIds) {
      const ws = clients.get(pid);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  };
}

function sendTo(playerId: string, msg: ServerMessage): void {
  const ws = clients.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function destroyRoom(code: string): void {
  const room = rooms.get(code);
  if (room?.gameSession) {
    void room.gameSession.cleanup();
  }
  rooms.delete(code);
  console.log(`Room ${code} destroyed — all players left.`);
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
        connectionAccounts.set(playerId, { accountId: result.accountId, sessionToken: token });
        await sendAuthResult(ws, result.accountId, token);
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
        connectionAccounts.set(playerId, { accountId: info.accountId, sessionToken: info.token });
        // If there's no active game session owning any character for this
        // account, any lingering in_use flag is stranded from a dead
        // connection (e.g. browser refresh race). Clear before sending the
        // character list so the client doesn't see stale "In use" buttons.
        const existingSessionId = activeSessions.get(info.accountId);
        if (!existingSessionId) {
          try { await characterRepo.clearInUseForAccount(info.accountId); } catch (e) { console.error(e); }
        }
        await sendAuthResult(ws, info.accountId, info.token);
        // Reconnection reattach to an active run.
        if (existingSessionId) {
          const room = rooms.get(existingSessionId);
          if (room?.gameSession) {
            const oldConn = room.gameSession.findConnectionByAccount(info.accountId);
            if (oldConn && oldConn !== playerId) {
              // Transfer socket ownership, rekey internal maps.
              room.gameSession.reattachConnection(oldConn, playerId);
              room.playerIds.delete(oldConn);
              room.playerIds.add(playerId);
              playerRoom.set(playerId, room.code);
              playerRoom.delete(oldConn);
              clients.delete(oldConn);
              room.gameSession.markConnected(playerId);
              const charId = room.gameSession.getCharacterIdFor(playerId);
              const ctx = connectionAccounts.get(playerId);
              if (ctx) ctx.characterId = charId;
            }
          }
        }
        break;
      }

      case 'logout': {
        const ctx = connectionAccounts.get(playerId);
        // Fully detach from any room / game session the user was reattached
        // to via resume_session — otherwise playerRoom stays set and the
        // next join_lobby silently early-returns.
        const currentRoom = getRoom(playerId);
        if (currentRoom) {
          // Detach from playerRoom unconditionally so the next join_lobby
          // can proceed. If the room is still in lobby phase, fully remove;
          // if a game is underway, leave the gameSession's internal state
          // alone (it has no public removePlayer) — the run is abandoned.
          playerRoom.delete(playerId);
          if (!currentRoom.gameSession) {
            currentRoom.playerIds.delete(playerId);
            currentRoom.lobby.removePlayer(playerId);
            if (currentRoom.playerIds.size === 0) {
              destroyRoom(currentRoom.code);
            }
          }
        }
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

      case 'create_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) {
          sendTo(playerId, { type: 'auth_error', reason: 'Not logged in' });
          break;
        }
        try {
          await characterRepo.create(ctx.accountId, { name: msg.name, class: msg.class });
        } catch (e) {
          sendTo(playerId, { type: 'auth_error', reason: (e as Error).message });
          break;
        }
        const list = await characterRepo.listForAccount(ctx.accountId);
        sendTo(playerId, { type: 'character_list', characters: list.map(toSummary) });
        break;
      }

      case 'delete_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) break;
        await characterRepo.delete(ctx.accountId, msg.characterId);
        const list = await characterRepo.listForAccount(ctx.accountId);
        sendTo(playerId, { type: 'character_list', characters: list.map(toSummary) });
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
        if (ch.in_use) {
          sendTo(playerId, { type: 'error', message: 'Character already in use' });
          break;
        }
        await characterRepo.markInUse(ch.id, true);
        ctx.characterId = ch.id;
        const room = getRoom(playerId);
        if (room) {
          room.lobby.attachCharacterToConnection(playerId, {
            id: ch.id, name: ch.name, className: ch.class, level: ch.level,
          });
        }
        break;
      }

      case 'set_ready': {
        const room = getRoom(playerId);
        if (room) room.lobby.setReady(playerId, msg.ready);
        break;
      }

      case 'join_lobby': {
        if (playerRoom.has(playerId)) break;

        let joinedRoom: LobbyRoom | undefined;
        if (msg.roomCode) {
          const code = msg.roomCode.toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            sendTo(playerId, { type: 'error', message: 'Room not found.' });
            break;
          }
          if (room.gameSession) {
            sendTo(playerId, { type: 'error', message: 'Game already in progress.' });
            break;
          }
          if (room.playerIds.size >= 4) {
            sendTo(playerId, { type: 'error', message: 'Room is full.' });
            break;
          }
          room.playerIds.add(playerId);
          playerRoom.set(playerId, code);
          room.lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard', connectionAccounts.get(playerId)?.accountId);
          joinedRoom = room;
        } else {
          const code = generateRoomCode(new Set(rooms.keys()));
          const broadcast = roomBroadcast(code);
          const lobby = new Lobby(code, broadcast, sendTo);
          const room: LobbyRoom = { code, lobby, gameSession: null, playerIds: new Set([playerId]) };
          rooms.set(code, room);
          playerRoom.set(playerId, code);
          lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard', connectionAccounts.get(playerId)?.accountId);
          console.log(`Room ${code} created by ${msg.playerName}.`);
          joinedRoom = room;
        }

        // If this connection already picked a persistent character at the
        // character-select stage, attach it to the fresh lobby entry now so
        // hydrateEntries() can load gear/inventory at start_game.
        const joinCtx = connectionAccounts.get(playerId);
        if (joinedRoom && joinCtx?.characterId && characterRepo) {
          const ch = await characterRepo.getById(joinCtx.characterId);
          if (ch && ch.account_id === joinCtx.accountId) {
            joinedRoom.lobby.attachCharacterToConnection(playerId, {
              id: ch.id, name: ch.name, className: ch.class, level: ch.level,
            });
          }
        }
        break;
      }

      case 'set_difficulty': {
        const room = getRoom(playerId);
        if (room) room.lobby.setDifficulty(playerId, msg.difficulty);
        break;
      }

      case 'start_game': {
        const room = getRoom(playerId);
        if (!room) break;
        if (!room.lobby.isHost(playerId)) {
          sendTo(playerId, { type: 'error', message: 'Only the host can start the game.' });
          break;
        }
        if (!room.lobby.allReady()) {
          sendTo(playerId, { type: 'error', message: 'Not all players are ready.' });
          break;
        }

        const difficulty = msg.difficulty ?? room.lobby.getDifficulty();
        const apiKey = msg.apiKey;
        const broadcast = roomBroadcast(room.code);
        const sessionId = room.code;

        const onGameOver = () => {
          room.gameSession = null;
          room.lobby.broadcastState();
        };

        const hydrateEntries = async (session: GameSession) => {
          if (!characterRepo) return;
          for (const entry of room.lobby.getEntries()) {
            if (!entry.character || entry.character.id.startsWith('stub_')) continue;
            await session.hydratePlayerFromCharacter(
              entry.connectionId,
              entry.accountId,
              entry.character.id,
            );
          }
        };

        if (!apiKey) {
          const dungeon = generateProceduralDungeon(3);
          const session = new GameSession(
            broadcast, sendTo, dungeon, onGameOver,
            characterRepo, activeSessions, sessionId,
          );
          room.gameSession = session;
          for (const p of room.lobby.getPlayers()) {
            session.addPlayer(p.id, p.name, p.className);
          }
          await hydrateEntries(session);
          session.startGame();
          break;
        }

        broadcast({ type: 'generation_status', status: 'generating' });

        generateDungeon(apiKey, difficulty).then(async (result) => {
          if (!result.generated) {
            broadcast({
              type: 'generation_status',
              status: 'failed',
              reason: result.error ?? 'Generation failed',
            });
          }

          const session = new GameSession(
            broadcast, sendTo, result.dungeon, onGameOver,
            characterRepo, activeSessions, sessionId,
          );
          room.gameSession = session;
          for (const p of room.lobby.getPlayers()) {
            session.addPlayer(p.id, p.name, p.className);
          }
          await hydrateEntries(session);
          session.startGame();

          if (!result.generated) {
            broadcast({
              type: 'text_log',
              message: 'Dungeon generation failed \u2014 playing The Dripping Halls instead.',
              logType: 'system',
            });
          }
        });

        break;
      }

      case 'grid_move': {
        getRoom(playerId)?.gameSession?.handleGridMove(playerId, msg.direction);
        break;
      }
      case 'combat_action': {
        if (msg.action === 'use_ability' && msg.abilityId) {
          getRoom(playerId)?.gameSession?.handleUseAbility(playerId, msg.abilityId, msg.targetId);
        } else if (msg.action === 'use_item_effect' && msg.effectId) {
          getRoom(playerId)?.gameSession?.handleItemEffectAction(playerId, msg.effectId, msg.targetId);
        } else {
          getRoom(playerId)?.gameSession?.handleCombatAction(playerId, msg.action as 'attack' | 'defend' | 'use_item' | 'flee', msg.targetId, msg.itemIndex, msg.fleeDirection, msg.critMultiplier);
        }
        break;
      }
      case 'defend_result': {
        getRoom(playerId)?.gameSession?.handleDefendResult(playerId, msg.damageReduction);
        break;
      }
      case 'loot_choice': {
        getRoom(playerId)?.gameSession?.handleLootChoice(playerId, msg.itemId, msg.choice);
        break;
      }
      case 'revive': {
        getRoom(playerId)?.gameSession?.handleRevive(playerId, msg.targetPlayerId);
        break;
      }
      case 'equip_item': {
        getRoom(playerId)?.gameSession?.handleEquipItem(playerId, msg.inventoryIndex);
        break;
      }
      case 'drop_item': {
        getRoom(playerId)?.gameSession?.handleDropItem(playerId, msg.inventoryIndex);
        break;
      }
      case 'use_consumable': {
        getRoom(playerId)?.gameSession?.handleUseConsumable(playerId, msg.consumableIndex);
        break;
      }
      case 'puzzle_answer': {
        getRoom(playerId)?.gameSession?.handlePuzzleAnswer(playerId, msg.roomId, msg.answerIndex);
        break;
      }
case 'interact_action': {
        getRoom(playerId)?.gameSession?.handleInteractAction(playerId, msg.interactableId, msg.actionId);
        break;
      }
      case 'allocate_stat': {
        getRoom(playerId)?.gameSession?.handleAllocateStat(playerId, msg.statId, msg.points);
        break;
      }
      case 'chat': {
        const room = getRoom(playerId);
        if (!room) break;
        const text = msg.text.trim().slice(0, 200);
        if (!text) break;
        const name = room.lobby.getPlayerName(playerId) ?? 'Unknown';
        roomBroadcast(room.code)({ type: 'text_log', message: `${name}: ${text}`, logType: 'chat' });
        break;
      }
      case 'debug_teleport': {
        const room = getRoom(playerId);
        if (!room?.gameSession) break;
        room.gameSession.debugTeleport(playerId, msg.roomId);
        break;
      }
      case 'debug_reveal_all': {
        const room = getRoom(playerId);
        if (!room?.gameSession) break;
        room.gameSession.debugRevealAll(playerId);
        break;
      }
      case 'debug_give_item': {
        const room = getRoom(playerId);
        if (!room?.gameSession) break;
        room.gameSession.debugGiveItem(playerId, msg.itemId);
        break;
      }
    }
  });

  ws.on('close', async () => {
    clients.delete(playerId);
    const room = getRoom(playerId);
    const inActiveGame = !!(room?.gameSession && room.gameSession.hasPlayer(playerId));
    if (room) {
      // If a game is in progress, keep the player slot so they can reconnect.
      if (inActiveGame) {
        room.gameSession!.markDisconnected(playerId);
      } else {
        room.playerIds.delete(playerId);
        room.lobby.removePlayer(playerId);
        playerRoom.delete(playerId);
      }
      if (room.playerIds.size === 0) {
        destroyRoom(room.code);
      }
    }
    // Release the character lock unless an active game session still owns it
    // (GameSession clears in_use itself at end-of-game / wipe).
    if (!inActiveGame) {
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
