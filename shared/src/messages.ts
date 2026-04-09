import type {
  Direction,
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

export interface MoveMessage {
  type: 'move';
  direction: Direction;
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

export interface InteractMessage {
  type: 'interact';
  interactableId: string;
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

export type ClientMessage =
  | JoinLobbyMessage
  | StartGameMessage
  | SetDifficultyMessage
  | MoveMessage
  | CombatActionMessage
  | LootChoiceMessage
  | ReviveMessage
  | EquipItemMessage
  | DropItemMessage
  | UseConsumableMessage
  | DefendResultMessage
  | PuzzleAnswerMessage
  | InteractMessage
  | InteractActionMessage
  | ChatMessage;

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
}

export interface RoomRevealMessage {
  type: 'room_reveal';
  room: Room;
}

export interface PlayerMovedMessage {
  type: 'player_moved';
  playerId: string;
  roomId: string;
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

export interface ErrorMessage {
  type: 'error';
  message: string;
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
  | ErrorMessage;
