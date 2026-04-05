import { create } from 'zustand';
import type {
  Player,
  Room,
  CombatState,
  Item,
  ServerMessage,
} from '@caverns/shared';

export interface TextLogEntry {
  message: string;
  logType: 'narration' | 'combat' | 'loot' | 'system';
  id: number;
}

let logIdCounter = 0;

export interface GameStore {
  connectionStatus: 'disconnected' | 'connected' | 'in_lobby' | 'in_game';
  setConnectionStatus: (status: GameStore['connectionStatus']) => void;
  lobbyPlayers: { id: string; name: string }[];
  isHost: boolean;
  playerId: string;
  players: Record<string, Player>;
  rooms: Record<string, Room>;
  currentRoomId: string;
  textLog: TextLogEntry[];
  activeCombat: CombatState | null;
  currentTurnId: string | null;
  pendingLoot: { items: Item[]; timeout: number } | null;
  lootChoices: Record<string, 'need' | 'greed' | 'pass'>;
  gameOver: { result: 'victory' | 'wipe' } | null;
  pendingDefendQte: { pendingDamage: number; actorName: string } | null;
  combatAnim: { attackerId: string; targetId: string } | null;
  dyingMobIds: Set<string>;
  generationStatus: 'idle' | 'generating' | 'failed';
  generationError: string | null;
  lobbyDifficulty: 'easy' | 'medium' | 'hard';
  handleServerMessage: (msg: ServerMessage) => void;
  setLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as const,
  lobbyPlayers: [],
  isHost: false,
  playerId: '',
  players: {},
  rooms: {},
  currentRoomId: '',
  textLog: [],
  activeCombat: null,
  currentTurnId: null,
  pendingLoot: null,
  lootChoices: {},
  gameOver: null,
  pendingDefendQte: null,
  combatAnim: null,
  dyingMobIds: new Set<string>(),
  generationStatus: 'idle' as const,
  generationError: null,
  lobbyDifficulty: 'medium' as const,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLootChoice: (itemId, choice) => set((state) => ({
    lootChoices: { ...state.lootChoices, [itemId]: choice },
  })),

  handleServerMessage: (msg: ServerMessage) => {
    switch (msg.type) {
      case 'lobby_state':
        set({
          connectionStatus: 'in_lobby',
          lobbyPlayers: msg.players,
          isHost: msg.hostId === msg.yourId,
          playerId: msg.yourId,
          lobbyDifficulty: msg.difficulty,
        });
        break;

      case 'game_start':
        set({
          connectionStatus: 'in_game',
          generationStatus: 'idle',
          generationError: null,
          playerId: msg.playerId,
          players: msg.players,
          rooms: msg.rooms,
          currentRoomId: msg.currentRoomId,
          textLog: [],
          activeCombat: null,
          pendingLoot: null,
          pendingDefendQte: null,
          gameOver: null,
        });
        break;

      case 'room_reveal':
        set((state) => ({
          rooms: { ...state.rooms, [msg.room.id]: msg.room },
        }));
        break;

      case 'player_moved': {
        const { playerId } = get();
        set((state) => ({
          players: {
            ...state.players,
            [msg.playerId]: { ...state.players[msg.playerId], roomId: msg.roomId },
          },
          currentRoomId: msg.playerId === playerId ? msg.roomId : state.currentRoomId,
        }));
        break;
      }

      case 'combat_start':
        set({ activeCombat: msg.combat, currentTurnId: msg.combat.currentTurnId });
        break;

      case 'combat_turn':
        set({ currentTurnId: msg.currentTurnId });
        break;

      case 'combat_action_result':
        set((state) => {
          if (!state.activeCombat) return {};
          const participants = state.activeCombat.participants.map((p) => {
            if (p.id === msg.targetId && msg.targetHp !== undefined) return { ...p, hp: msg.targetHp };
            if (p.id === msg.actorId && msg.actorHp !== undefined) return { ...p, hp: msg.actorHp };
            return p;
          }).filter((p) => {
            // Still remove fled actors immediately
            if (msg.fled && p.id === msg.actorId) return false;
            return true;
          });

          const pendingDefendQte = (msg.defendQte && msg.targetId === state.playerId)
            ? { pendingDamage: msg.pendingDamage ?? 0, actorName: msg.actorName }
            : state.pendingDefendQte;

          const combatAnim = (msg.action === 'attack' && msg.targetId)
            ? { attackerId: msg.actorId, targetId: msg.targetId }
            : null;

          if (combatAnim) {
            setTimeout(() => useGameStore.setState({ combatAnim: null }), 400);
          }

          // Mark dying mobs — keep them in participants for the animation
          let dyingMobIds = state.dyingMobIds;
          if (msg.targetDowned && msg.targetId) {
            const target = participants.find((p) => p.id === msg.targetId);
            if (target?.type === 'mob') {
              dyingMobIds = new Set(state.dyingMobIds);
              dyingMobIds.add(msg.targetId);
              // Remove from participants after animation completes
              setTimeout(() => {
                useGameStore.setState((s) => {
                  if (!s.activeCombat) return {};
                  const newDying = new Set(s.dyingMobIds);
                  newDying.delete(msg.targetId!);
                  return {
                    activeCombat: {
                      ...s.activeCombat,
                      participants: s.activeCombat.participants.filter((p) => p.id !== msg.targetId),
                    },
                    dyingMobIds: newDying,
                  };
                });
              }, 800);
            }
          }

          return {
            activeCombat: { ...state.activeCombat, participants },
            pendingDefendQte,
            dyingMobIds,
            combatAnim,
          };
        });
        break;

      case 'combat_end':
        set({ activeCombat: null, currentTurnId: null, pendingDefendQte: null, dyingMobIds: new Set() });
        break;

      case 'loot_prompt':
        if (msg.items.length === 0) {
          set({ pendingLoot: null, lootChoices: {} });
        } else {
          set({ pendingLoot: { items: msg.items, timeout: msg.timeout }, lootChoices: {} });
        }
        break;

      case 'loot_result':
        set((state) => {
          if (!state.pendingLoot) return {};
          const items = state.pendingLoot.items.filter((i) => i.id !== msg.itemId);
          return { pendingLoot: items.length > 0 ? { ...state.pendingLoot, items } : null };
        });
        break;

      case 'player_update':
        set((state) => ({
          players: { ...state.players, [msg.player.id]: msg.player },
        }));
        break;

      case 'game_over':
        set({ gameOver: { result: msg.result }, activeCombat: null });
        break;

      case 'text_log':
        set((state) => ({
          textLog: [...state.textLog, { message: msg.message, logType: msg.logType, id: ++logIdCounter }],
        }));
        break;

      case 'error':
        set((state) => ({
          textLog: [...state.textLog, { message: msg.message, logType: 'system', id: ++logIdCounter }],
        }));
        break;

      case 'generation_status':
        set({
          generationStatus: msg.status,
          generationError: msg.reason ?? null,
        });
        break;
    }
  },

  reset: () => set(initialState),
}));
