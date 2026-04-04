import type {
  Direction,
  Player,
  Room,
  Item,
  CombatState,
  CombatParticipant,
} from './types.js';

// === Client -> Server ===

export interface JoinLobbyMessage {
  type: 'join_lobby';
  playerName: string;
}

export interface StartGameMessage {
  type: 'start_game';
}

export interface MoveMessage {
  type: 'move';
  direction: Direction;
}

export interface CombatActionMessage {
  type: 'combat_action';
  action: 'attack' | 'defend' | 'use_item' | 'flee';
  targetId?: string;
  itemIndex?: number;
  fleeDirection?: Direction;
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

export type ClientMessage =
  | JoinLobbyMessage
  | StartGameMessage
  | MoveMessage
  | CombatActionMessage
  | LootChoiceMessage
  | ReviveMessage
  | EquipItemMessage
  | DropItemMessage;

// === Server -> Client ===

export interface LobbyStateMessage {
  type: 'lobby_state';
  players: { id: string; name: string }[];
  hostId: string;
  yourId: string;
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
  action: 'attack' | 'defend' | 'use_item' | 'flee';
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
  logType: 'narration' | 'combat' | 'loot' | 'system';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | LobbyStateMessage
  | GameStartMessage
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
  | ErrorMessage;
