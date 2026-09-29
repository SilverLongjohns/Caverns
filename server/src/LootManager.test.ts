import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LootManager } from './LootManager.js';
import type { Item } from '@caverns/shared';

const testItem: Item = {
  id: 'item1', name: 'Test Sword', description: '', rarity: 'common',
  slot: 'weapon', stats: { damage: 10 },
};

const testItem2: Item = {
  id: 'item2', name: 'Test Shield', description: '', rarity: 'uncommon',
  slot: 'offhand', stats: { defense: 5 },
};

describe('LootManager', () => {
  it('auto-awards loot to a solo player', () => {
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem], ['p1']);
    expect(results).toEqual([{ item: testItem, winnerId: 'p1' }]);
  });

  it('need beats greed', () => {
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'greed');
    lm.submitChoice('p2', 'item1', 'need');
    expect(results).toEqual([{ item: testItem, winnerId: 'p2' }]);
  });

  it('resolves ties randomly', () => {
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    lm.submitChoice('p2', 'item1', 'need');
    expect(results).toHaveLength(1);
    expect(['p1', 'p2']).toContain(results[0].winnerId);
  });

  it('pass from all players means nobody gets the item', () => {
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'pass');
    lm.submitChoice('p2', 'item1', 'pass');
    expect(results).toEqual([]);
  });

  it('handles multiple items in one loot round', () => {
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem, testItem2], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    lm.submitChoice('p2', 'item1', 'pass');
    lm.submitChoice('p1', 'item2', 'pass');
    lm.submitChoice('p2', 'item2', 'need');
    expect(results).toHaveLength(2);
    expect(results).toContainEqual({ item: testItem, winnerId: 'p1' });
    expect(results).toContainEqual({ item: testItem2, winnerId: 'p2' });
  });

  it('timeout defaults to pass', () => {
    vi.useFakeTimers();
    const results: { item: Item; winnerId: string }[] = [];
    const lm = new LootManager((item, winnerId) => { results.push({ item, winnerId }); });
    lm.startLootRound('room1', [testItem], ['p1', 'p2']);
    lm.submitChoice('p1', 'item1', 'need');
    vi.advanceTimersByTime(15000);
    expect(results).toEqual([{ item: testItem, winnerId: 'p1' }]);
    vi.useRealTimers();
  });
});

describe('LootManager seat helpers', () => {
  it('reports who a pending round waits on and follows a re-keyed seat', () => {
    const awarded: [string, string][] = [];
    const lm = new LootManager((item, winner) => awarded.push([item.id, winner]));
    const item = { id: 'i1', name: 'Rock', slot: 'weapon', rarity: 'common', stats: {} } as any;
    lm.startLootRound('r1', [item], ['p1', 'p2']);
    expect(lm.hasPendingFor('p1')).toBe(true);
    expect(lm.hasPendingFor('p3')).toBe(false);
    lm.submitChoice('p1', 'i1', 'need');
    lm.replacePlayerId('p1', 'p1b');
    expect(lm.hasPendingFor('p1')).toBe(false);
    expect(lm.hasPendingFor('p1b')).toBe(true);
    lm.submitChoice('p2', 'i1', 'pass'); // completes the round: p1b's earlier 'need' still counts
    expect(awarded).toEqual([['i1', 'p1b']]);
  });
});
