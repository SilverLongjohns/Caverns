import type { Item } from '@caverns/shared';

type LootChoice = 'need' | 'greed' | 'pass';

interface PendingLootRound {
  items: Item[];
  playerIds: string[];
  choices: Map<string, Map<string, LootChoice>>;
  timer: ReturnType<typeof setTimeout> | null;
}

export class LootManager {
  private pendingRound: PendingLootRound | null = null;
  private onItemAwarded: (itemId: string, winnerId: string) => void;

  constructor(onItemAwarded: (itemId: string, winnerId: string) => void) {
    this.onItemAwarded = onItemAwarded;
  }

  startLootRound(roomId: string, items: Item[], playerIds: string[]): void {
    if (playerIds.length === 1) {
      for (const item of items) { this.onItemAwarded(item.id, playerIds[0]); }
      return;
    }
    const choices = new Map<string, Map<string, LootChoice>>();
    for (const item of items) { choices.set(item.id, new Map()); }
    this.pendingRound = {
      items, playerIds, choices,
      timer: setTimeout(() => this.resolveRound(), 15000),
    };
  }

  submitChoice(playerId: string, itemId: string, choice: LootChoice): void {
    if (!this.pendingRound) return;
    const itemChoices = this.pendingRound.choices.get(itemId);
    if (!itemChoices) return;
    itemChoices.set(playerId, choice);
    const allSubmitted = Array.from(this.pendingRound.choices.values()).every(
      (ic) => this.pendingRound!.playerIds.every((pid) => ic.has(pid))
    );
    if (allSubmitted) {
      if (this.pendingRound.timer) clearTimeout(this.pendingRound.timer);
      this.resolveRound();
    }
  }

  private resolveRound(): void {
    if (!this.pendingRound) return;
    const { items, playerIds, choices } = this.pendingRound;
    this.pendingRound = null;
    for (const item of items) {
      const itemChoices = choices.get(item.id)!;
      for (const pid of playerIds) {
        if (!itemChoices.has(pid)) itemChoices.set(pid, 'pass');
      }
      const needPlayers: string[] = [];
      const greedPlayers: string[] = [];
      for (const [pid, choice] of itemChoices) {
        if (choice === 'need') needPlayers.push(pid);
        else if (choice === 'greed') greedPlayers.push(pid);
      }
      const pool = needPlayers.length > 0 ? needPlayers : greedPlayers;
      if (pool.length > 0) {
        const winner = pool[Math.floor(Math.random() * pool.length)];
        this.onItemAwarded(item.id, winner);
      }
    }
  }
}
