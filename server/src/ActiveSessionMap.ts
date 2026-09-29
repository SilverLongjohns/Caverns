export interface CharacterRun {
  characterId: string;
  sessionId: string;
}

/**
 * Which dungeon run each character is seated in. Keyed by character, not account,
 * so one account can have a character parked in a run while playing another.
 */
export class ActiveSessionMap {
  private byCharacter = new Map<string, { accountId: string; sessionId: string }>();

  attach(characterId: string, accountId: string, sessionId: string): void {
    this.byCharacter.set(characterId, { accountId, sessionId });
  }

  detachCharacter(characterId: string): void {
    this.byCharacter.delete(characterId);
  }

  detachSession(sessionId: string): void {
    for (const [characterId, run] of this.byCharacter) {
      if (run.sessionId === sessionId) this.byCharacter.delete(characterId);
    }
  }

  getByCharacter(characterId: string): string | undefined {
    return this.byCharacter.get(characterId)?.sessionId;
  }

  listForAccount(accountId: string): CharacterRun[] {
    const out: CharacterRun[] = [];
    for (const [characterId, run] of this.byCharacter) {
      if (run.accountId === accountId) out.push({ characterId, sessionId: run.sessionId });
    }
    return out;
  }

  clear(): void {
    this.byCharacter.clear();
  }
}
