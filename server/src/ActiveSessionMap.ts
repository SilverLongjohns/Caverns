export class ActiveSessionMap {
  private accountToSession = new Map<string, string>();

  attach(accountId: string, sessionId: string): void {
    this.accountToSession.set(accountId, sessionId);
  }

  detach(accountId: string): void {
    this.accountToSession.delete(accountId);
  }

  detachSession(sessionId: string): void {
    for (const [accountId, sid] of this.accountToSession) {
      if (sid === sessionId) this.accountToSession.delete(accountId);
    }
  }

  get(accountId: string): string | undefined {
    return this.accountToSession.get(accountId);
  }

  clear(): void {
    this.accountToSession.clear();
  }
}
