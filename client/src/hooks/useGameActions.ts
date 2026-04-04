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
    startGame: () => send({ type: 'start_game' }),
    move: (direction: Direction) => send({ type: 'move', direction }),
    combatAction: (
      action: 'attack' | 'defend' | 'use_item' | 'flee',
      targetId?: string, itemIndex?: number, fleeDirection?: Direction
    ) => send({ type: 'combat_action', action, targetId, itemIndex, fleeDirection }),
    lootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => send({ type: 'loot_choice', itemId, choice }),
    revive: (targetPlayerId: string) => send({ type: 'revive', targetPlayerId }),
    equipItem: (inventoryIndex: number) => send({ type: 'equip_item', inventoryIndex }),
    dropItem: (inventoryIndex: number) => send({ type: 'drop_item', inventoryIndex }),
  };
}
