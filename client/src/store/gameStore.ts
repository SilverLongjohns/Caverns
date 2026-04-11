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
  logType: 'narration' | 'combat' | 'loot' | 'system' | 'chat';
  id: number;
}

let logIdCounter = 0;

export interface GameStore {
  connectionStatus: 'disconnected' | 'connected' | 'in_lobby' | 'in_game';
  setConnectionStatus: (status: GameStore['connectionStatus']) => void;
  lobbyPlayers: { id: string; name: string; className: string }[];
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
  activePuzzle: { roomId: string; puzzleId: string; description: string; options: string[] } | null;
  generationStatus: 'idle' | 'generating' | 'failed';
  generationError: string | null;
  lobbyDifficulty: 'easy' | 'medium' | 'hard';
  roomCode: string;
  scoutThreats: Record<string, Partial<Record<string, boolean>>>;
  selectedInteractableId: string | null;
  selectInteractable: (id: string | null) => void;
  pendingInteractActions: {
    interactableId: string;
    interactableName: string;
    actions: {
      id: string;
      label: string;
      locked: boolean;
      lockReason?: string;
      used: boolean;
      usedBy?: string;
    }[];
  } | null;
  mobPositions: Record<string, { mobId: string; mobName: string; x: number; y: number }>;
  mobAlert: { roomId: string; x: number; y: number } | null;
  playerPositions: Record<string, { x: number; y: number }>;
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
  activePuzzle: null,
  generationStatus: 'idle' as const,
  generationError: null,
  lobbyDifficulty: 'medium' as const,
  roomCode: '',
  scoutThreats: {},
  selectedInteractableId: null,
  pendingInteractActions: null,
  mobPositions: {},
  mobAlert: null,
  playerPositions: {},
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  selectInteractable: (id) => set({ selectedInteractableId: id }),
  setLootChoice: (itemId, choice) => set((state) => ({
    lootChoices: { ...state.lootChoices, [itemId]: choice },
  })),

  handleServerMessage: (msg: ServerMessage) => {
    switch (msg.type) {
      case 'lobby_state':
        set((state) => ({
          connectionStatus: state.gameOver ? state.connectionStatus : 'in_lobby',
          lobbyPlayers: msg.players,
          isHost: msg.hostId === msg.yourId,
          playerId: msg.yourId,
          lobbyDifficulty: msg.difficulty,
          roomCode: msg.roomCode,
        }));
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
          playerPositions: msg.playerPositions ?? {},
          mobPositions: {},
        });
        break;

      case 'room_reveal':
        set((state) => ({
          rooms: { ...state.rooms, [msg.room.id]: msg.room },
        }));
        break;

      case 'player_moved': {
        const { playerId } = get();
        const isMe = msg.playerId === playerId;
        set((state) => ({
          players: {
            ...state.players,
            [msg.playerId]: { ...state.players[msg.playerId], roomId: msg.roomId },
          },
          currentRoomId: isMe ? msg.roomId : state.currentRoomId,
          playerPositions: {
            ...state.playerPositions,
            [msg.playerId]: { x: msg.x, y: msg.y },
          },
          // Clear room-specific UI state when we move
          ...(isMe ? {
            activePuzzle: null,
            selectedInteractableId: null,
            pendingInteractActions: null,
          } : {}),
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
        set({
          gameOver: { result: msg.result },
          activeCombat: null,
          currentTurnId: null,
          pendingLoot: null,
          pendingDefendQte: null,
          combatAnim: null,
          dyingMobIds: new Set(),
        });
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

      case 'puzzle_prompt':
        set({
          activePuzzle: {
            roomId: msg.roomId,
            puzzleId: msg.puzzleId,
            description: msg.description,
            options: msg.options,
          },
        });
        break;

      case 'puzzle_result':
        set({ activePuzzle: null });
        break;

      case 'generation_status':
        set({
          generationStatus: msg.status,
          generationError: msg.reason ?? null,
        });
        break;

      case 'scout_result':
        set((state) => ({
          scoutThreats: { ...state.scoutThreats, [(msg as any).roomId]: (msg as any).adjacentThreats },
        }));
        break;

      case 'interact_actions':
        set({
          selectedInteractableId: msg.interactableId,
          pendingInteractActions: {
            interactableId: msg.interactableId,
            interactableName: msg.interactableName,
            actions: msg.actions,
          },
        });
        break;

      case 'interact_result':
        set((state) => ({
          textLog: [
            ...state.textLog,
            { message: msg.narration, logType: 'narration' as const, id: ++logIdCounter },
          ],
          selectedInteractableId: null,
          pendingInteractActions: null,
        }));
        break;

      case 'interactable_state':
        set((state) => {
          const roomId = state.currentRoomId;
          const room = state.rooms[roomId];
          if (!room?.interactables) return {};
          const updatedInteractables = room.interactables.map(i => {
            if (i.instanceId !== msg.interactableId) return i;
            return {
              ...i,
              usedActions: { ...i.usedActions, [msg.actionId]: msg.usedBy },
            };
          });
          return {
            rooms: {
              ...state.rooms,
              [roomId]: { ...room, interactables: updatedInteractables },
            },
          };
        });
        break;

      case 'mob_spawn':
        set((state) => ({
          mobPositions: {
            ...state.mobPositions,
            [msg.roomId]: { mobId: msg.mobId, mobName: msg.mobName, x: msg.x, y: msg.y },
          },
        }));
        break;

      case 'mob_position':
        set((state) => {
          const existing = state.mobPositions[msg.roomId];
          if (!existing) return {};
          return {
            mobPositions: {
              ...state.mobPositions,
              [msg.roomId]: { ...existing, x: msg.x, y: msg.y },
            },
          };
        });
        break;

      case 'mob_despawn':
        set((state) => {
          const { [msg.roomId]: _, ...rest } = state.mobPositions;
          return { mobPositions: rest };
        });
        break;

      case 'mob_alert':
        set({ mobAlert: { roomId: msg.roomId, x: msg.x, y: msg.y } });
        setTimeout(() => useGameStore.setState({ mobAlert: null }), 800);
        break;

      case 'player_position': {
        const isLocal = msg.playerId === get().playerId;
        set((state) => ({
          playerPositions: {
            ...state.playerPositions,
            [msg.playerId]: { x: msg.x, y: msg.y },
          },
          ...(isLocal ? { selectedInteractableId: null, pendingInteractActions: null } : {}),
        }));
        break;
      }
    }
  },

  reset: () => set(initialState),
}));
