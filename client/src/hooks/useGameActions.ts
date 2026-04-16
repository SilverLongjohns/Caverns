import { useCallback } from 'react';
import type { ClientMessage, Direction, GridDirection } from '@caverns/shared';
import { useGameStore } from '../store/gameStore';

export function useGameActions(wsRef: React.RefObject<WebSocket | null>) {
  const send = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      const id = (ws as unknown as { __id?: number } | null)?.__id;
      if (ws?.readyState === WebSocket.OPEN) {
        console.log('[send] SEND', msg.type, 'via ws', id);
        ws.send(JSON.stringify(msg));
      } else {
        console.warn('[send] DROPPED', msg.type, 'via ws', id, 'readyState=', ws?.readyState);
      }
    },
    [wsRef]
  );

  return {
    gridMove: (direction: GridDirection) => send({ type: 'grid_move', direction }),
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
    puzzleAnswer: (roomId: string, answerIndex: number) => send({ type: 'puzzle_answer', roomId, answerIndex }),
    interactAction: (interactableId: string, actionId: string) =>
      send({ type: 'interact_action', interactableId, actionId }),
    useAbility: (abilityId: string, targetId?: string) =>
      send({ type: 'combat_action', action: 'use_ability', abilityId, targetId }),
    useItemEffect: (effectId: string, targetId?: string) =>
      send({ type: 'combat_action', action: 'use_item_effect', effectId, targetId }),
    chat: (text: string) => send({ type: 'chat', text }),
    debugTeleport: (roomId: string) => send({ type: 'debug_teleport', roomId }),
    debugRevealAll: () => send({ type: 'debug_reveal_all' }),
    debugGiveItem: (itemId: string) => send({ type: 'debug_give_item', itemId }),
    allocateStat: (statId: string, points: number) =>
      send({ type: 'allocate_stat', statId, points }),
    login: (name: string) => send({ type: 'login', name }),
    logout: () => send({ type: 'logout' }),
    createCharacter: useCallback((name: string, className: string, statPoints: Record<string, number>) => {
      send({ type: 'create_character', name, class: className, statPoints });
    }, [send]),
    selectCharacter: (characterId: string) => {
      send({ type: 'select_character', characterId });
      useGameStore.setState({ selectedCharacterId: characterId });
    },
    deleteCharacter: (characterId: string) =>
      send({ type: 'delete_character', characterId }),
    listWorlds: () => send({ type: 'list_worlds' }),
    createWorld: (name: string) => send({ type: 'create_world', name }),
    joinWorld: (inviteCode: string) => send({ type: 'join_world', inviteCode }),
    selectWorld: (worldId: string) => {
      send({ type: 'select_world', worldId });
      useGameStore.setState({ selectedWorldId: worldId });
    },
    overworldMove: (x: number, y: number) => {
      send({ type: 'overworld_move', targetX: x, targetY: y });
    },
    portalReady: () => send({ type: 'portal_ready' }),
    portalUnready: () => send({ type: 'portal_unready' }),
    portalEnter: () => send({ type: 'portal_enter' }),
    interactOverworld: (interactableId: string) =>
      send({ type: 'overworld_interact', interactableId }),
    stashDeposit: (from: 'inventory' | 'consumables', fromIndex: number) =>
      send({ type: 'stash_deposit', from, fromIndex }),
    stashWithdraw: (stashIndex: number, to: 'inventory' | 'consumables') =>
      send({ type: 'stash_withdraw', stashIndex, to }),
    closeStash: () => useGameStore.setState({ openStash: null, stashError: null }),
    shopBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) =>
      send({ type: 'shop_buy', shopId, slotType, index }),
    shopSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) =>
      send({ type: 'shop_sell', shopId, from, fromIndex }),
    shopReroll: (shopId: string) => send({ type: 'shop_reroll', shopId }),
    closeShop: () => useGameStore.setState({ openShop: null, shopError: null }),
    leaveWorld: () => {
      send({ type: 'leave_world' });
      useGameStore.setState({
        currentWorld: null,
        worldMap: null,
        worldMembers: [],
        overworldPathPreview: [],
        selectedCharacterId: null,
      });
    },
    arenaMove: (targetX: number, targetY: number) => send({ type: 'arena_move', targetX, targetY }),
    arenaEndTurn: () => send({ type: 'arena_end_turn' }),
  };
}
