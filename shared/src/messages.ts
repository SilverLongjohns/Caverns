import type {
  Direction,
  GridDirection,
  Player,
  Room,
  Item,
  CombatState,
  CombatParticipant,
  OutcomeType,
} from './types.js';

// === Client -> Server ===

export interface JoinLobbyMessage {
  type: 'join_lobby';
  playerName: string;
  roomCode?: string;
  className?: string;
}

export interface StartGameMessage {
  type: 'start_game';
  apiKey?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface SetDifficultyMessage {
  type: 'set_difficulty';
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GridMoveMessage {
  type: 'grid_move';
  direction: GridDirection;
}

export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
  critMultiplier?: number;
  abilityId?: string;
  effectId?: string;
}

export interface LootChoiceMessage {
  type: 'loot_choice';
  itemId: string;
  choice: 'need' | 'greed' | 'pass';
}

export interface ReviveMessage {
  type: 'revive';
  targetPlayerId: string;
}

export interface EquipItemMessage {
  type: 'equip_item';
  inventoryIndex: number;
}

export interface DropItemMessage {
  type: 'drop_item';
  inventoryIndex: number;
}

export interface UseConsumableMessage {
  type: 'use_consumable';
  consumableIndex: number;
}

export interface DefendResultMessage {
  type: 'defend_result';
  damageReduction: number;
}

export interface PuzzleAnswerMessage {
  type: 'puzzle_answer';
  roomId: string;
  answerIndex: number;
}

export interface InteractActionMessage {
  type: 'interact_action';
  interactableId: string;
  actionId: string;
}

export interface ChatMessage {
  type: 'chat';
  text: string;
}

export interface DebugTeleportMessage {
  type: 'debug_teleport';
  roomId: string;
}

export interface DebugRevealAllMessage {
  type: 'debug_reveal_all';
}

export interface DebugGiveItemMessage {
  type: 'debug_give_item';
  itemId: string;
}

export interface AllocateStatMessage {
  type: 'allocate_stat';
  statId: string;
  points: number;
}

export type ClientMessage =
  | JoinLobbyMessage
  | StartGameMessage
  | SetDifficultyMessage
  | GridMoveMessage
  | CombatActionMessage
  | LootChoiceMessage
  | ReviveMessage
  | EquipItemMessage
  | DropItemMessage
  | UseConsumableMessage
  | DefendResultMessage
  | PuzzleAnswerMessage
  | InteractActionMessage
  | ChatMessage
  | DebugTeleportMessage
  | DebugRevealAllMessage
  | DebugGiveItemMessage
  | AllocateStatMessage;

// === Server -> Client ===

export interface LobbyStateMessage {
  type: 'lobby_state';
  players: { id: string; name: string; className: string }[];
  hostId: string;
  yourId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  roomCode: string;
}

export interface GenerationStatusMessage {
  type: 'generation_status';
  status: 'generating' | 'failed';
  reason?: string;
}

export interface GameStartMessage {
  type: 'game_start';
  playerId: string;
  players: Record<string, Player>;
  rooms: Record<string, Room>;
  currentRoomId: string;
  playerPositions: Record<string, { x: number; y: number }>;
}

export interface RoomRevealMessage {
  type: 'room_reveal';
  room: Room;
}

export interface PlayerMovedMessage {
  type: 'player_moved';
  playerId: string;
  roomId: string;
  x: number;
  y: number;
}

export interface CombatStartMessage {
  type: 'combat_start';
  combat: CombatState;
}

export interface CombatTurnMessage {
  type: 'combat_turn';
  currentTurnId: string;
  roundNumber: number;
}

export interface CombatActionResultMessage {
  type: 'combat_action_result';
  actorId: string;
  actorName: string;
  action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability' | 'use_item_effect';
  targetId?: string;
  targetName?: string;
  damage?: number;
  healing?: number;
  actorHp?: number;
  targetHp?: number;
  targetMaxHp?: number;
  actorDowned?: boolean;
  targetDowned?: boolean;
  fled?: boolean;
  fleeDirection?: Direction;
  critMultiplier?: number;
  defendQte?: true;
  pendingDamage?: number;
  abilityId?: string;
  abilityName?: string;
  buffsApplied?: string[];
  itemEffect?: string;
  itemEffectDamage?: number;
  itemEffectHealing?: number;
}

export interface CombatEndMessage {
  type: 'combat_end';
  result: 'victory' | 'flee' | 'wipe';
}

export interface LootPromptMessage {
  type: 'loot_prompt';
  items: Item[];
  timeout: number;
}

export interface LootResultMessage {
  type: 'loot_result';
  itemId: string;
  itemName: string;
  winnerId: string;
  winnerName: string;
}

export interface PlayerUpdateMessage {
  type: 'player_update';
  player: Player;
}

export interface GameOverMessage {
  type: 'game_over';
  result: 'victory' | 'wipe';
}

export interface TextLogMessage {
  type: 'text_log';
  message: string;
  logType: 'narration' | 'combat' | 'loot' | 'system' | 'chat';
}

export interface PuzzlePromptMessage {
  type: 'puzzle_prompt';
  roomId: string;
  puzzleId: string;
  description: string;
  options: string[];
}

export interface PuzzleResultMessage {
  type: 'puzzle_result';
  roomId: string;
  correct: boolean;
}

export interface ScoutResultMessage {
  type: 'scout_result';
  roomId: string;
  adjacentThreats: Partial<Record<Direction, boolean>>;
}

export interface InteractActionsMessage {
  type: 'interact_actions';
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
}

export interface InteractResultMessage {
  type: 'interact_result';
  interactableId: string;
  actionId: string;
  narration: string;
  outcome: {
    type: OutcomeType;
    loot?: Item;
    damage?: number;
    intel?: {
      targetRoomId: string;
      text: string;
    };
    revealedRoom?: Room;
  };
}

export interface InteractableStateMessage {
  type: 'interactable_state';
  interactableId: string;
  actionId: string;
  usedBy: string;
}

export interface MobSpawnMessage {
  type: 'mob_spawn';
  roomId: string;
  mobId: string;
  mobName: string;
  x: number;
  y: number;
}

export interface MobPositionMessage {
  type: 'mob_position';
  roomId: string;
  mobId: string;
  x: number;
  y: number;
}

export interface MobAlertMessage {
  type: 'mob_alert';
  roomId: string;
  mobId: string;
  x: number;
  y: number;
}

export interface MobDespawnMessage {
  type: 'mob_despawn';
  roomId: string;
  mobId: string;
}

export interface PlayerPositionMessage {
  type: 'player_position';
  playerId: string;
  roomId: string;
  x: number;
  y: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface LevelUpMessage {
  type: 'level_up';
  playerId: string;
  newLevel: number;
}

export interface TorchPickupMessage {
  type: 'torch_pickup';
  playerId: string;
  position: { x: number; y: number };
  fuel: number;
}

export type ServerMessage =
  | LobbyStateMessage
  | GameStartMessage
  | GenerationStatusMessage
  | RoomRevealMessage
  | PlayerMovedMessage
  | CombatStartMessage
  | CombatTurnMessage
  | CombatActionResultMessage
  | CombatEndMessage
  | LootPromptMessage
  | LootResultMessage
  | PlayerUpdateMessage
  | GameOverMessage
  | TextLogMessage
  | PuzzlePromptMessage
  | PuzzleResultMessage
  | ScoutResultMessage
  | InteractActionsMessage
  | InteractResultMessage
  | InteractableStateMessage
  | MobSpawnMessage
  | MobPositionMessage
  | MobAlertMessage
  | MobDespawnMessage
  | PlayerPositionMessage
  | ErrorMessage
  | LevelUpMessage
  | TorchPickupMessage;
