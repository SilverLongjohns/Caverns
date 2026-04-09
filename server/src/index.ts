import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@caverns/shared';
import { Lobby } from './Lobby.js';
import { GameSession } from './GameSession.js';
import { generateDungeon } from './DungeonGenerator.js';
import { generateProceduralDungeon } from './ProceduralGenerator.js';
import { generateRoomCode } from './roomCode.js';

const PORT = Number(process.env.PORT) || 3001;

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
  rooms.delete(code);
  console.log(`Room ${code} destroyed — all players left.`);
}

wss.on('connection', (ws) => {
  const playerId = `player_${nextId++}`;
  clients.set(playerId, ws);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join_lobby': {
        if (playerRoom.has(playerId)) break;

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
          room.lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard');
        } else {
          const code = generateRoomCode(new Set(rooms.keys()));
          const broadcast = roomBroadcast(code);
          const lobby = new Lobby(code, broadcast, sendTo);
          const room: LobbyRoom = { code, lobby, gameSession: null, playerIds: new Set([playerId]) };
          rooms.set(code, room);
          playerRoom.set(playerId, code);
          lobby.addPlayer(playerId, msg.playerName, msg.className ?? 'vanguard');
          console.log(`Room ${code} created by ${msg.playerName}.`);
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

        const difficulty = msg.difficulty ?? room.lobby.getDifficulty();
        const apiKey = msg.apiKey;
        const broadcast = roomBroadcast(room.code);

        const onGameOver = () => {
          room.gameSession = null;
          room.lobby.broadcastState();
        };

        if (!apiKey) {
          const dungeon = generateProceduralDungeon(3);
          room.gameSession = new GameSession(broadcast, sendTo, dungeon, onGameOver);
          for (const p of room.lobby.getPlayers()) {
            room.gameSession.addPlayer(p.id, p.name, p.className);
          }
          room.gameSession.startGame();
          break;
        }

        broadcast({ type: 'generation_status', status: 'generating' });

        generateDungeon(apiKey, difficulty).then((result) => {
          if (!result.generated) {
            broadcast({
              type: 'generation_status',
              status: 'failed',
              reason: result.error ?? 'Generation failed',
            });
          }

          room.gameSession = new GameSession(broadcast, sendTo, result.dungeon, onGameOver);
          for (const p of room.lobby.getPlayers()) {
            room.gameSession.addPlayer(p.id, p.name, p.className);
          }
          room.gameSession.startGame();

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

      case 'move': {
        getRoom(playerId)?.gameSession?.handleMove(playerId, msg.direction);
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
      case 'interact': {
        getRoom(playerId)?.gameSession?.handleInteract(playerId, msg.interactableId);
        break;
      }
      case 'interact_action': {
        getRoom(playerId)?.gameSession?.handleInteractAction(playerId, msg.interactableId, msg.actionId);
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
    }
  });

  ws.on('close', () => {
    clients.delete(playerId);
    const room = getRoom(playerId);
    if (room) {
      room.playerIds.delete(playerId);
      room.lobby.removePlayer(playerId);
      playerRoom.delete(playerId);
      if (room.playerIds.size === 0) {
        destroyRoom(room.code);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Caverns server listening on 0.0.0.0:${PORT}`);
});
