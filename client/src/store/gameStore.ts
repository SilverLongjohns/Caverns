import { create } from 'zustand';
import type {
  Player,
  Room,
  CombatState,
  Item,
  ServerMessage,
  CharacterSummary,
  AccountSummary,
  WorldSummary,
  WorldMemberSummary,
  OverworldMap,
  ShopView,
  CharacterItemsView,
} from '@caverns/shared';

export type ClientView =
  | 'connecting'
  | 'login'
  | 'world_select'
  | 'character_select'
  | 'in_world'
  | 'in_dungeon'
  | 'game_over'
  | 'generating';
import { saveSessionToken, clearSessionToken } from '../auth/sessionStorage.js';

export interface TextLogEntry {
  message: string;
  logType: 'narration' | 'combat' | 'loot' | 'system' | 'chat';
  id: number;
}

let logIdCounter = 0;

export interface GameStore {
  connectionStatus: 'disconnected' | 'connected' | 'in_game';
  setConnectionStatus: (status: GameStore['connectionStatus']) => void;
  authStatus: 'unauthenticated' | 'authenticated' | 'character_selected';
  account: AccountSummary | null;
  characters: CharacterSummary[];
  selectedCharacterId: string | null;
  worlds: WorldSummary[];
  selectedWorldId: string | null;
  worldError: string | null;
  currentWorld: { id: string; name: string } | null;
  worldMap: OverworldMap | null;
  worldMembers: WorldMemberSummary[];
  overworldPathPreview: { x: number; y: number }[];
  currentPortalMuster: { portalId: string; readyMembers: WorldMemberSummary[] } | null;
  currentDungeonSessionId: string | null;
  openStash: {
    items: (Item | null)[];
    capacity: number;
    inventory: (Item | null)[];
    consumables: (Item | null)[];
  } | null;
  stashError: string | null;
  openShop: (ShopView & { gold: number; character: CharacterItemsView }) | null;
  shopError: string | null;
  authError: string | null;
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
  mobPositions: Record<string, { mobId: string; mobName: string; x: number; y: number }[]>;
  mobAlert: { roomId: string; x: number; y: number } | null;
  playerPositions: Record<string, { x: number; y: number }>;
  levelUpGlow: boolean;
  torchFuel: number;
  torchMaxFuel: number;
  exploredTiles: Set<string>;
  handleServerMessage: (msg: ServerMessage) => void;
  setLootChoice: (itemId: string, choice: 'need' | 'greed' | 'pass') => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as const,
  authStatus: 'unauthenticated' as const,
  account: null,
  characters: [],
  selectedCharacterId: null,
  worlds: [],
  selectedWorldId: null,
  worldError: null,
  currentWorld: null,
  worldMap: null,
  worldMembers: [] as WorldMemberSummary[],
  overworldPathPreview: [] as { x: number; y: number }[],
  currentPortalMuster: null as GameStore['currentPortalMuster'],
  currentDungeonSessionId: null as string | null,
  openStash: null as GameStore['openStash'],
  stashError: null as string | null,
  openShop: null as GameStore['openShop'],
  shopError: null as string | null,
  authError: null,
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
  scoutThreats: {},
  selectedInteractableId: null,
  pendingInteractActions: null,
  mobPositions: {},
  mobAlert: null,
  playerPositions: {},
  levelUpGlow: false,
  torchFuel: 0,
  torchMaxFuel: 0,
  exploredTiles: new Set<string>(),
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
      case 'auth_result':
        saveSessionToken(msg.token);
        set({
          authStatus: 'authenticated',
          account: msg.account,
          characters: msg.characters,
          authError: null,
        });
        break;

      case 'auth_error':
        clearSessionToken();
        set({ authError: msg.reason, authStatus: 'unauthenticated' });
        break;

      case 'character_list':
        set({ characters: msg.characters });
        break;

      case 'world_list':
        set((state) => {
          const stillExists = state.selectedWorldId &&
            msg.worlds.some((w) => w.id === state.selectedWorldId);
          return {
            worlds: msg.worlds,
            selectedWorldId: stillExists ? state.selectedWorldId : null,
            worldError: null,
          };
        });
        break;

      case 'world_selected':
        set({ selectedWorldId: msg.worldId, worldError: null });
        break;

      case 'world_error':
        set({ worldError: msg.reason });
        break;

      case 'world_state':
        set({
          currentWorld: { id: msg.worldId, name: msg.worldName },
          worldMap: msg.map,
          worldMembers: msg.members,
        });
        break;

      case 'world_member_joined':
        set((state) => {
          if (state.worldMembers.some((m) => m.connectionId === msg.member.connectionId)) {
            return {};
          }
          return { worldMembers: [...state.worldMembers, msg.member] };
        });
        break;

      case 'world_member_left':
        set((state) => ({
          worldMembers: state.worldMembers.filter((m) => m.connectionId !== msg.connectionId),
        }));
        break;

      case 'overworld_tick': {
        const state = get();
        const byId = new Map(msg.steps.map((s) => [s.connectionId, s] as const));
        const members = state.worldMembers.map((m) => {
          const step = byId.get(m.connectionId);
          return step ? { ...m, pos: { x: step.x, y: step.y } } : m;
        });
        let nextPreview = state.overworldPathPreview;
        if (nextPreview.length > 0) {
          // Drop preview tiles matching any step this tick (self-progress).
          const stepKeys = new Set(msg.steps.map((s) => `${s.x},${s.y}`));
          const filtered = nextPreview.filter((p) => !stepKeys.has(`${p.x},${p.y}`));
          if (filtered.length !== nextPreview.length) nextPreview = filtered;
          if (msg.steps.some((s) => s.arrived)) nextPreview = [];
        }
        set({ worldMembers: members, overworldPathPreview: nextPreview });
        break;
      }

      case 'world_move_rejected':
        set({ overworldPathPreview: [] });
        break;

      case 'portal_muster_update':
        set((state) => {
          // Only track the muster for the portal our member is currently standing on.
          const mine = state.worldMembers.find((m) => m.characterId === state.selectedCharacterId);
          if (!mine) return {};
          const onPortal = state.worldMap?.portals.find((p) => p.x === mine.pos.x && p.y === mine.pos.y);
          if (!onPortal || onPortal.id !== msg.portalId) {
            // Muster update for a different portal — ignore unless we were already tracking it.
            if (state.currentPortalMuster?.portalId === msg.portalId && msg.readyMembers.length === 0) {
              return { currentPortalMuster: null };
            }
            return {};
          }
          if (msg.readyMembers.length === 0) return { currentPortalMuster: null };
          return { currentPortalMuster: { portalId: msg.portalId, readyMembers: msg.readyMembers } };
        });
        break;

      case 'dungeon_entered':
        set({
          currentDungeonSessionId: msg.dungeonSessionId,
          currentPortalMuster: null,
          currentWorld: null,
          worldMap: null,
          worldMembers: [],
          overworldPathPreview: [],
          openStash: null,
          stashError: null,
          openShop: null,
          shopError: null,
        });
        break;

      case 'stash_opened':
        set({
          openStash: {
            items: msg.stash.items,
            capacity: msg.stash.capacity,
            inventory: msg.character.inventory,
            consumables: msg.character.consumables,
          },
          stashError: null,
        });
        break;

      case 'stash_updated':
        set((state) => {
          if (!state.openStash) return {};
          return {
            openStash: {
              items: msg.stash.items,
              capacity: msg.stash.capacity,
              inventory: msg.character.inventory,
              consumables: msg.character.consumables,
            },
            stashError: null,
          };
        });
        break;

      case 'stash_error':
        set({ stashError: msg.reason });
        break;

      case 'shop_opened':
        set({
          openShop: {
            ...msg.shop,
            gold: msg.gold,
            character: msg.character,
          },
          shopError: null,
        });
        break;

      case 'shop_updated':
        set({
          openShop: {
            ...msg.shop,
            gold: msg.gold,
            character: msg.character,
          },
          shopError: null,
        });
        break;

      case 'shop_error':
        set({ shopError: msg.reason });
        break;

      case 'dungeon_returned':
        set({
          currentDungeonSessionId: null,
          connectionStatus: 'connected',
          players: {},
          rooms: {},
          currentRoomId: '',
          activeCombat: null,
          gameOver: null,
          textLog: [],
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
            exploredTiles: new Set<string>(),
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

      case 'gold_update':
        set((state) => {
          const player = state.players[msg.playerId];
          if (!player) return {};
          return {
            players: {
              ...state.players,
              [msg.playerId]: { ...player, gold: msg.gold },
            },
          };
        });
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
        set((state) => {
          const existing = state.mobPositions[msg.roomId] ?? [];
          return {
            mobPositions: {
              ...state.mobPositions,
              [msg.roomId]: [...existing, { mobId: msg.mobId, mobName: msg.mobName, x: msg.x, y: msg.y }],
            },
          };
        });
        break;

      case 'mob_position':
        set((state) => {
          const existing = state.mobPositions[msg.roomId];
          if (!existing) return {};
          return {
            mobPositions: {
              ...state.mobPositions,
              [msg.roomId]: existing.map(m =>
                m.mobId === msg.mobId ? { ...m, x: msg.x, y: msg.y } : m
              ),
            },
          };
        });
        break;

      case 'mob_despawn':
        set((state) => {
          const existing = state.mobPositions[msg.roomId];
          if (!existing) return {};
          const filtered = existing.filter(m => m.mobId !== msg.mobId);
          if (filtered.length === 0) {
            const { [msg.roomId]: _, ...rest } = state.mobPositions;
            return { mobPositions: rest };
          }
          return {
            mobPositions: {
              ...state.mobPositions,
              [msg.roomId]: filtered,
            },
          };
        });
        break;

      case 'mob_alert':
        set({ mobAlert: { roomId: msg.roomId, x: msg.x, y: msg.y } });
        setTimeout(() => useGameStore.setState({ mobAlert: null }), 800);
        break;

      case 'level_up': {
        if (msg.playerId === get().playerId) {
          set({ levelUpGlow: true });
          setTimeout(() => useGameStore.setState({ levelUpGlow: false }), 1500);
        }
        break;
      }

      case 'torch_pickup': {
        if (msg.playerId === get().playerId) {
          set({ torchFuel: msg.fuel, torchMaxFuel: msg.fuel });
        }
        // Update the wall tile theme to remove the torch for all players
        set((state) => {
          const roomId = state.currentRoomId;
          const room = state.rooms[roomId];
          if (!room?.tileGrid?.themes) return {};
          const newThemes = room.tileGrid.themes.map((row, y) =>
            row.map((theme, x) =>
              x === msg.position.x && y === msg.position.y && theme === 'torch' ? null : theme
            )
          );
          return {
            rooms: {
              ...state.rooms,
              [roomId]: {
                ...room,
                tileGrid: { ...room.tileGrid, themes: newThemes },
              },
            },
          };
        });
        break;
      }

      case 'player_position': {
        const isLocal = msg.playerId === get().playerId;
        set((state) => ({
          playerPositions: {
            ...state.playerPositions,
            [msg.playerId]: { x: msg.x, y: msg.y },
          },
          ...(isLocal ? {
            selectedInteractableId: null,
            pendingInteractActions: null,
            torchFuel: Math.max(0, state.torchFuel - 1),
          } : {}),
        }));
        break;
      }
    }
  },

  reset: () => set(initialState),
}));

export function selectCurrentView(state: GameStore): ClientView {
  if (state.connectionStatus === 'disconnected') return 'connecting';
  if (state.generationStatus === 'generating' || state.generationStatus === 'failed') return 'generating';
  if (state.gameOver) return 'game_over';
  if (state.connectionStatus === 'in_game') return 'in_dungeon';
  if (state.currentWorld) return 'in_world';
  if (state.authStatus === 'authenticated' && state.selectedWorldId && !state.selectedCharacterId) return 'character_select';
  if (state.authStatus === 'authenticated' && !state.selectedWorldId) return 'world_select';
  if (state.authStatus === 'unauthenticated') return 'login';
  return 'connecting';
}
