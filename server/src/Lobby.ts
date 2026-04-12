import type { ServerMessage, LobbyPlayer } from '@caverns/shared';

export interface LobbyEntry {
  connectionId: string;
  accountId: string;
  displayName: string;
  isHost: boolean;
  ready: boolean;
  character?: { id: string; name: string; className: string; level: number };
}

export class Lobby {
  private entries = new Map<string, LobbyEntry>();
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

  /**
   * Add a player to the lobby. `accountId` may match `connectionId` in DB-less mode.
   * If a character was already chosen at lobby-join (legacy flow), it can be supplied.
   */
  addPlayer(
    connectionId: string,
    displayName: string,
    className: string = 'vanguard',
    accountId?: string,
  ): void {
    const isHost = this.entries.size === 0;
    const entry: LobbyEntry = {
      connectionId,
      accountId: accountId ?? connectionId,
      displayName,
      isHost,
      ready: false,
    };
    // Legacy path: if a className was passed with no character persistence,
    // auto-create a stub character so DB-less mode still works.
    if (className) {
      entry.character = {
        id: `stub_${connectionId}`,
        name: displayName,
        className,
        level: 1,
      };
      // Stub characters are auto-ready so the old flow (pre-persistence) still
      // starts from host clicking start_game.
      entry.ready = true;
    }
    this.entries.set(connectionId, entry);
    if (!this.hostId) this.hostId = connectionId;
    this.broadcastState();
  }

  removePlayer(connectionId: string): void {
    this.entries.delete(connectionId);
    if (this.hostId === connectionId) {
      this.hostId = this.entries.keys().next().value ?? null;
      if (this.hostId) {
        const next = this.entries.get(this.hostId);
        if (next) next.isHost = true;
      }
    }
    this.broadcastState();
  }

  attachCharacterToConnection(
    connectionId: string,
    character: NonNullable<LobbyEntry['character']>,
  ): void {
    const entry = this.entries.get(connectionId);
    if (!entry) return;
    entry.character = character;
    entry.ready = false;
    this.broadcastState();
  }

  setReady(connectionId: string, ready: boolean): void {
    const entry = this.entries.get(connectionId);
    if (!entry || !entry.character) return;
    entry.ready = ready;
    this.broadcastState();
  }

  allReady(): boolean {
    if (this.entries.size === 0) return false;
    return [...this.entries.values()].every((e) => e.character && e.ready);
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  getEntries(): LobbyEntry[] {
    return [...this.entries.values()];
  }

  getEntry(connectionId: string): LobbyEntry | undefined {
    return this.entries.get(connectionId);
  }

  /**
   * Back-compat helper used by GameSession startup — returns the old
   * {id, name, className} shape expected by existing code paths.
   */
  getPlayers(): { id: string; name: string; className: string }[] {
    return [...this.entries.values()].map((e) => ({
      id: e.connectionId,
      name: e.character?.name ?? e.displayName,
      className: e.character?.className ?? 'vanguard',
    }));
  }

  getPlayerCount(): number {
    return this.entries.size;
  }

  getPlayerName(id: string): string | undefined {
    const e = this.entries.get(id);
    return e?.character?.name ?? e?.displayName;
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
    const players: LobbyPlayer[] = [...this.entries.values()].map((e) => ({
      connectionId: e.connectionId,
      accountId: e.accountId,
      displayName: e.displayName,
      isHost: e.connectionId === this.hostId,
      ready: e.ready,
      character: e.character,
    }));
    for (const connectionId of this.entries.keys()) {
      this.sendTo(connectionId, {
        type: 'lobby_state',
        players,
        hostId: this.hostId ?? '',
        yourId: connectionId,
        difficulty: this.difficulty,
        roomCode: this.roomCode,
      });
    }
  }
}
