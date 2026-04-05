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
  private onItemAwarded: (item: Item, winnerId: string) => void;
  private onRoundComplete: (() => void) | null;
  private onChoiceMade: ((playerId: string, itemName: string, choice: LootChoice) => void) | null;
  private onRollResult: ((itemName: string, rolls: { playerId: string; roll: number }[], winnerId: string) => void) | null;

  constructor(
    onItemAwarded: (item: Item, winnerId: string) => void,
    onRoundComplete?: () => void,
    onChoiceMade?: (playerId: string, itemName: string, choice: LootChoice) => void,
    onRollResult?: (itemName: string, rolls: { playerId: string; roll: number }[], winnerId: string) => void,
  ) {
    this.onItemAwarded = onItemAwarded;
    this.onRoundComplete = onRoundComplete ?? null;
    this.onChoiceMade = onChoiceMade ?? null;
    this.onRollResult = onRollResult ?? null;
  }

  startLootRound(roomId: string, items: Item[], playerIds: string[]): void {
    if (playerIds.length === 1) {
      for (const item of items) { this.onItemAwarded(item, playerIds[0]); }
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
    const item = this.pendingRound.items.find((i) => i.id === itemId);
    if (item) {
      this.onChoiceMade?.(playerId, item.name, choice);
    }
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
        const rolls = pool.map((pid) => ({ playerId: pid, roll: Math.floor(Math.random() * 100) + 1 }));
        rolls.sort((a, b) => b.roll - a.roll);
        const winner = rolls[0].playerId;
        this.onRollResult?.(item.name, rolls, winner);
        this.onItemAwarded(item, winner);
      }
    }
    this.onRoundComplete?.();
  }
}
