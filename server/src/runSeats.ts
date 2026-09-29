/**
 * Pure seat/connection rules for runs, kept out of index.ts (which starts the server on import)
 * so they can be unit tested.
 */

/** The part of a connection's auth state that holds a character's in_use lock. */
export interface CharacterHolder {
  characterId?: string;
}

/**
 * Whether a seat is safe for a new connection to take over via reconnect. `dropped:` placeholders
 * and any other seat with no live, open socket qualify; `parked:` seats never do — they wait for
 * `select_character` instead, and a seat with a live open socket belongs to another live tab.
 */
export function seatIsReconnectable(seatId: string, isDisconnected: boolean, hasLiveSocket: boolean): boolean {
  if (seatId.startsWith('parked:')) return false;
  if (isDisconnected) return true;
  if (seatId.includes(':')) return false;
  return !hasLiveSocket;
}

/**
 * A new connection took over a seat keyed by a raw connection id (a reload whose old socket
 * may not have closed yet). The old connection no longer holds the character, so its late
 * close must not release the lock of a character that is still seated in the run.
 */
export function releaseSupersededConnection(accounts: Map<string, CharacterHolder>, seatId: string): void {
  if (seatId.includes(':')) return; // placeholders were never connections
  const old = accounts.get(seatId);
  if (old) old.characterId = undefined;
}

/** The character lock a closing socket should release, if any. A socket still routed into a run leaves it to the run. */
export function lockReleasedOnClose(account: CharacterHolder | undefined, stillInRun: boolean): string | undefined {
  if (stillInRun) return undefined;
  return account?.characterId;
}

/** Why this character can't be deleted right now, or null. A character seated in a run (parked, dropped or playing) stays. */
export function characterDeleteBlocker(runs: { getByCharacter(characterId: string): string | undefined }, characterId: string): string | null {
  return runs.getByCharacter(characterId) ? 'That character is still in a dungeon run.' : null;
}
