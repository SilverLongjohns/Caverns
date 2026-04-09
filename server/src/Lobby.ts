import type { ServerMessage } from '@caverns/shared';

interface LobbyPlayer {
  id: string;
  name: string;
  className: string;
}

export class Lobby {
  private players: LobbyPlayer[] = [];
  private hostId: string | null = null;
  private difficulty: 'easy' | 'medium' | 'hard' = 'medium';
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;
  private roomCode: string;

  constructor(
    roomCode: string,
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void
  ) {
    this.roomCode = roomCode;
    this.broadcast = broadcast;
    this.sendTo = sendTo;
  }

  addPlayer(id: string, name: string, className: string = 'vanguard'): void {
    this.players.push({ id, name, className });
    if (!this.hostId) this.hostId = id;
    this.broadcastState();
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) {
      this.hostId = this.players[0]?.id ?? null;
    }
    this.broadcastState();
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  getPlayers(): LobbyPlayer[] {
    return this.players;
  }

  getPlayerCount(): number {
    return this.players.length;
  }

  getPlayerName(id: string): string | undefined {
    return this.players.find(p => p.id === id)?.name;
  }

  getDifficulty(): 'easy' | 'medium' | 'hard' {
    return this.difficulty;
  }

  setDifficulty(playerId: string, difficulty: 'easy' | 'medium' | 'hard'): void {
    if (this.hostId !== playerId) return;
    this.difficulty = difficulty;
    this.broadcastState();
  }

  broadcastState(): void {
    for (const p of this.players) {
      this.sendTo(p.id, {
        type: 'lobby_state',
        players: this.players.map(pl => ({ id: pl.id, name: pl.name, className: pl.className })),
        hostId: this.hostId!,
        yourId: p.id,
        difficulty: this.difficulty,
        roomCode: this.roomCode,
      });
    }
  }
}
