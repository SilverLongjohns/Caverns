import type { ServerMessage } from '@caverns/shared';

interface LobbyPlayer {
  id: string;
  name: string;
}

export class Lobby {
  private players: LobbyPlayer[] = [];
  private hostId: string | null = null;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;
  }

  addPlayer(id: string, name: string): void {
    this.players.push({ id, name });
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

  private broadcastState(): void {
    for (const p of this.players) {
      this.sendTo(p.id, {
        type: 'lobby_state',
        players: this.players,
        hostId: this.hostId!,
        yourId: p.id,
      });
    }
  }
}
