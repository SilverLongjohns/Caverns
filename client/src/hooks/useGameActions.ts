import { useCallback } from 'react';
import type { ClientMessage, Direction } from '@caverns/shared';

export function useGameActions(wsRef: React.RefObject<WebSocket | null>) {
  const send = useCallback(
    (msg: ClientMessage) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [wsRef]
  );

  return {
    joinLobby: (playerName: string) => send({ type: 'join_lobby', playerName }),
    startGame: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') =>
      send({ type: 'start_game', apiKey, difficulty }),
    setDifficulty: (difficulty: 'easy' | 'medium' | 'hard') =>
      send({ type: 'set_difficulty', difficulty }),
    move: (direction: Direction) => send({ type: 'move', direction }),
    combatAction: (
      action: 'attack' | 'defend' | 'use_item' | 'flee',
      targetId?: string, itemIndex?: number, fleeDirection?: Direction,
      critMultiplier?: number
    ) => send({ type: 'combat_action', action, targetId, itemIndex, fleeDirection, critMultiplier }),
    defendResult: (damageReduction: number) => send({ type: 'defend_result', damageReduction }),
    lootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => send({ type: 'loot_choice', itemId, choice }),
    revive: (targetPlayerId: string) => send({ type: 'revive', targetPlayerId }),
    equipItem: (inventoryIndex: number) => send({ type: 'equip_item', inventoryIndex }),
    dropItem: (inventoryIndex: number) => send({ type: 'drop_item', inventoryIndex }),
    useConsumable: (consumableIndex: number) => send({ type: 'use_consumable', consumableIndex }),
  };
}
