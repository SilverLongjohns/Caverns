import type { WorldSession } from './WorldSession.js';

const sessions = new Map<string, WorldSession>();

export function getSession(worldId: string): WorldSession | undefined {
  return sessions.get(worldId);
}

export function registerSession(session: WorldSession): void {
  sessions.set(session.worldId, session);
}

export function unregisterSession(worldId: string): void {
  sessions.delete(worldId);
}

export function allSessions(): IterableIterator<WorldSession> {
  return sessions.values();
}
