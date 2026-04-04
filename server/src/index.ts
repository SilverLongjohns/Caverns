import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@caverns/shared';
import { Lobby } from './Lobby.js';
import { GameSession } from './GameSession.js';

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
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  } else {
    // SPA fallback — serve index.html for any unknown route
    const indexPath = join(CLIENT_DIR, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
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

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function sendTo(playerId: string, msg: ServerMessage): void {
  const ws = clients.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const lobby = new Lobby(broadcast, sendTo);
let gameSession: GameSession | null = null;

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
        lobby.addPlayer(playerId, msg.playerName);
        break;
      }
      case 'start_game': {
        if (!lobby.isHost(playerId)) {
          sendTo(playerId, { type: 'error', message: 'Only the host can start the game.' });
          break;
        }
        gameSession = new GameSession(broadcast, sendTo);
        for (const p of lobby.getPlayers()) {
          gameSession.addPlayer(p.id, p.name);
        }
        gameSession.startGame();
        break;
      }
      case 'move': {
        gameSession?.handleMove(playerId, msg.direction);
        break;
      }
      case 'combat_action': {
        gameSession?.handleCombatAction(playerId, msg.action, msg.targetId, msg.itemIndex, msg.fleeDirection);
        break;
      }
      case 'loot_choice': {
        gameSession?.handleLootChoice(playerId, msg.itemId, msg.choice);
        break;
      }
      case 'revive': {
        gameSession?.handleRevive(playerId, msg.targetPlayerId);
        break;
      }
      case 'equip_item': {
        gameSession?.handleEquipItem(playerId, msg.inventoryIndex);
        break;
      }
      case 'drop_item': {
        gameSession?.handleDropItem(playerId, msg.inventoryIndex);
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(playerId);
    lobby.removePlayer(playerId);
    if (gameSession && clients.size === 0) {
      gameSession = null;
      console.log('All clients disconnected — game session ended.');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Caverns server listening on port ${PORT}`);
});
