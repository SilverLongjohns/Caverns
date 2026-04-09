import { describe, it, expect, beforeEach } from 'vitest';
import { InteractionResolver } from './InteractionResolver.js';
import type { Room, InteractableInstance, InteractableDefinition, Item } from '@caverns/shared';

function makeRoom(interactables: InteractableInstance[]): Room {
  return {
    id: 'room_1',
    type: 'chamber',
    name: 'Test Chamber',
    description: 'A test room.',
    exits: { north: 'room_2' },
    interactables,
  };
}

function makeDefinition(overrides?: Partial<InteractableDefinition>): InteractableDefinition {
  return {
    id: 'fungal_glowing_cluster',
    name: 'Glowing cluster',
    asciiChar: '♧',
    biomes: ['fungal'],
    slotSize: 'small',
    actions: [
      {
        id: 'examine',
        label: 'Examine',
        outcomes: { weights: { loot: 40, hazard: 15, intel: 15, secret: 10, flavor: 20 } },
      },
    ],
    ...overrides,
  };
}

function makeInstance(overrides?: Partial<InteractableInstance>): InteractableInstance {
  return {
    definitionId: 'fungal_glowing_cluster',
    instanceId: 'int_001',
    position: { x: 5, y: 3 },
    usedActions: {},
    ...overrides,
  };
}

const mockItems: Item[] = [
  {
    id: 'potion_minor',
    name: 'Minor Potion',
    description: 'Heals a little.',
    rarity: 'common',
    slot: 'consumable',
    stats: { healAmount: 10 },
  },
];

describe('InteractionResolver', () => {
  let resolver: InteractionResolver;

  beforeEach(() => {
    resolver = new InteractionResolver([makeDefinition()], mockItems);
  });

  describe('getActions', () => {
    it('returns available actions for an interactable', () => {
      const room = makeRoom([makeInstance()]);
      const result = resolver.getActions('int_001', room, 'vanguard', false);
      expect('actions' in result).toBe(true);
      if ('actions' in result) {
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0].id).toBe('examine');
        expect(result.actions[0].locked).toBe(false);
      }
    });

    it('shows class-gated actions as locked for wrong class', () => {
      const def = makeDefinition({
        actions: [
          { id: 'examine', label: 'Examine', outcomes: { weights: { flavor: 100 } } },
          { id: 'commune', label: 'Commune', requiresClass: 'cleric', outcomes: { weights: { loot: 100 } } },
        ],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.getActions('int_001', room, 'vanguard', false);
      expect('actions' in result).toBe(true);
      if ('actions' in result) {
        expect(result.actions).toHaveLength(2);
        const commune = result.actions.find(a => a.id === 'commune')!;
        expect(commune.locked).toBe(true);
        expect(commune.lockReason).toContain('cleric');
      }
    });

    it('hides multiplayer-only actions in solo', () => {
      const def = makeDefinition({
        actions: [
          { id: 'examine', label: 'Examine', outcomes: { weights: { flavor: 100 } } },
          { id: 'ritual', label: 'Ritual', multiplayerOnly: true, outcomes: { weights: { loot: 100 } } },
        ],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.getActions('int_001', room, 'vanguard', true);
      if ('actions' in result) {
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0].id).toBe('examine');
      }
    });

    it('hides used non-repeatable actions', () => {
      const room = makeRoom([makeInstance({ usedActions: { examine: 'Player1' } })]);
      const result = resolver.getActions('int_001', room, 'vanguard', false);
      if ('actions' in result) {
        expect(result.actions).toHaveLength(0);
      }
    });
  });

  describe('resolve', () => {
    it('rejects non-existent interactable', () => {
      const room = makeRoom([makeInstance()]);
      const result = resolver.resolve('p1', 'Player1', 'bad_id', 'examine', room, 'vanguard', false);
      expect(result.error).toBe('Interactable not found.');
    });

    it('rejects already-used non-repeatable action', () => {
      const room = makeRoom([makeInstance({ usedActions: { examine: 'Player1' } })]);
      const result = resolver.resolve('p1', 'Player1', 'int_001', 'examine', room, 'vanguard', false);
      expect(result.error).toBe('Already used.');
    });

    it('rejects wrong class for class-gated action', () => {
      const def = makeDefinition({
        actions: [
          { id: 'commune', label: 'Commune', requiresClass: 'cleric', outcomes: { weights: { loot: 100 } } },
        ],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.resolve('p1', 'Player1', 'int_001', 'commune', room, 'vanguard', false);
      expect(result.error).toContain('cleric');
    });

    it('resolves a valid action and marks it used', () => {
      const instance = makeInstance();
      const room = makeRoom([instance]);
      const result = resolver.resolve('p1', 'Player1', 'int_001', 'examine', room, 'vanguard', false);
      expect(result.error).toBeUndefined();
      expect(result.outcomeType).toBeDefined();
      expect(instance.usedActions['examine']).toBe('Player1');
    });

    it('loot outcome returns an item', () => {
      const def = makeDefinition({
        actions: [{ id: 'examine', label: 'Examine', outcomes: { weights: { loot: 100 } } }],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.resolve('p1', 'Player1', 'int_001', 'examine', room, 'vanguard', false);
      expect(result.outcomeType).toBe('loot');
      expect(result.lootItem).toBeDefined();
    });

    it('hazard outcome returns damage', () => {
      const def = makeDefinition({
        actions: [{ id: 'examine', label: 'Examine', outcomes: { weights: { hazard: 100 } } }],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.resolve('p1', 'Player1', 'int_001', 'examine', room, 'vanguard', false);
      expect(result.outcomeType).toBe('hazard');
      expect(result.damage).toBeGreaterThanOrEqual(5);
      expect(result.damage).toBeLessThanOrEqual(15);
    });

    it('intel outcome returns target room', () => {
      const def = makeDefinition({
        actions: [{ id: 'examine', label: 'Examine', outcomes: { weights: { intel: 100 } } }],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const room = makeRoom([makeInstance()]);
      const result = resolver2.resolve('p1', 'Player1', 'int_001', 'examine', room, 'vanguard', false);
      expect(result.outcomeType).toBe('intel');
      expect(result.intel!.targetRoomId).toBe('room_2');
    });

    it('allows repeatable actions to be used multiple times', () => {
      const def = makeDefinition({
        actions: [{ id: 'look', label: 'Look', repeatable: true, outcomes: { weights: { flavor: 100 } } }],
      });
      const resolver2 = new InteractionResolver([def], mockItems);
      const instance = makeInstance();
      const room = makeRoom([instance]);
      const r1 = resolver2.resolve('p1', 'Player1', 'int_001', 'look', room, 'vanguard', false);
      expect(r1.error).toBeUndefined();
      const r2 = resolver2.resolve('p2', 'Player2', 'int_001', 'look', room, 'vanguard', false);
      expect(r2.error).toBeUndefined();
    });
  });
});
