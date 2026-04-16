import type {
  Direction,
  GridDirection,
  Player,
  Room,
  Item,
  Equipment,
  CombatState,
  CombatParticipant,
  OutcomeType,
} from './types.js';
import type { OverworldMap } from './overworld.js';

// === Client -> Server ===

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
  targetX?: number;  // for area abilities: the targeted tile
  targetY?: number;
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

export interface ArenaMoveMessage {
  type: 'arena_move';
  targetX: number;
  targetY: number;
}

export interface ArenaEndTurnMessage {
  type: 'arena_end_turn';
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

// === Account / character persistence ===

export interface LoginMessage {
  type: 'login';
  name: string;
}

export interface ResumeSessionMessage {
  type: 'resume_session';
  token: string;
}

export interface LogoutMessage {
  type: 'logout';
}

export interface CreateCharacterMessage {
  type: 'create_character';
  name: string;
  class: string;
  statPoints: Record<string, number>;
}

export interface SelectCharacterMessage {
  type: 'select_character';
  characterId: string;
}

export interface DeleteCharacterMessage {
  type: 'delete_character';
  characterId: string;
}

// === World membership ===

export interface ListWorldsMessage {
  type: 'list_worlds';
}

export interface CreateWorldMessage {
  type: 'create_world';
  name: string;
}

export interface JoinWorldMessage {
  type: 'join_world';
  inviteCode: string;
}

export interface SelectWorldMessage {
  type: 'select_world';
  worldId: string;
}

export interface LeaveWorldMessage {
  type: 'leave_world';
}

export interface OverworldMoveMessage {
  type: 'overworld_move';
  targetX: number;
  targetY: number;
}

export interface PortalReadyMessage {
  type: 'portal_ready';
}

export interface PortalUnreadyMessage {
  type: 'portal_unready';
}

export interface PortalEnterMessage {
  type: 'portal_enter';
}

export interface OverworldInteractMessage {
  type: 'overworld_interact';
  interactableId: string;
}

export interface StashDepositMessage {
  type: 'stash_deposit';
  from: 'inventory' | 'consumables';
  fromIndex: number;
}

export interface StashWithdrawMessage {
  type: 'stash_withdraw';
  stashIndex: number;
  to: 'inventory' | 'consumables';
}

export interface ShopBuyMessage {
  type: 'shop_buy';
  shopId: string;
  slotType: 'fixed' | 'rotating';
  index: number;
}

export interface ShopSellMessage {
  type: 'shop_sell';
  shopId: string;
  from: 'inventory' | 'consumables';
  fromIndex: number;
}

export interface ShopRerollMessage {
  type: 'shop_reroll';
  shopId: string;
}

export interface OpenCharacterPanelMessage {
  type: 'open_character_panel';
}

export interface OverworldEquipItemMessage {
  type: 'overworld_equip_item';
  inventoryIndex: number;
}

export interface OverworldDropItemMessage {
  type: 'overworld_drop_item';
  inventoryIndex: number;
}

export interface OverworldAllocateStatMessage {
  type: 'overworld_allocate_stat';
  statId: string;
  points: number;
}

export type ClientMessage =
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
  | AllocateStatMessage
  | LoginMessage
  | ResumeSessionMessage
  | LogoutMessage
  | CreateCharacterMessage
  | SelectCharacterMessage
  | DeleteCharacterMessage
  | ListWorldsMessage
  | CreateWorldMessage
  | JoinWorldMessage
  | SelectWorldMessage
  | LeaveWorldMessage
  | OverworldMoveMessage
  | PortalReadyMessage
  | PortalUnreadyMessage
  | PortalEnterMessage
  | OverworldInteractMessage
  | StashDepositMessage
  | StashWithdrawMessage
  | ShopBuyMessage
  | ShopSellMessage
  | ShopRerollMessage
  | ArenaMoveMessage
  | ArenaEndTurnMessage
  | OpenCharacterPanelMessage
  | OverworldEquipItemMessage
  | OverworldDropItemMessage
  | OverworldAllocateStatMessage;

// === Server -> Client ===

export interface CharacterSummary {
  id: string;
  name: string;
  className: string;
  level: number;
  gold: number;
  lastPlayedAt: string | null;
  inUse: boolean;
}

export interface AccountSummary {
  id: string;
  displayName: string;
}

export interface WorldSummary {
  id: string;
  name: string;
  ownerDisplayName: string;
  memberCount: number;
  isOwner: boolean;
  inviteCode: string;
}

export interface WorldListMessage {
  type: 'world_list';
  worlds: WorldSummary[];
}

export interface WorldSelectedMessage {
  type: 'world_selected';
  worldId: string;
  inviteCode: string;
}

export interface WorldErrorMessage {
  type: 'world_error';
  reason: string;
}

export interface WorldMemberSummary {
  connectionId: string;
  characterId: string;
  characterName: string;
  displayName: string;
  className: string;
  level: number;
  pos: { x: number; y: number };
}

export interface WorldStateMessage {
  type: 'world_state';
  worldId: string;
  worldName: string;
  map: OverworldMap;
  members: WorldMemberSummary[];
}

export interface WorldMemberJoinedMessage {
  type: 'world_member_joined';
  member: WorldMemberSummary;
}

export interface WorldMemberLeftMessage {
  type: 'world_member_left';
  connectionId: string;
  characterId: string;
}

export interface OverworldTickStep {
  connectionId: string;
  x: number;
  y: number;
  arrived: boolean;
}

export interface OverworldTickMessage {
  type: 'overworld_tick';
  steps: OverworldTickStep[];
}

export interface WorldMoveRejectedMessage {
  type: 'world_move_rejected';
  reason: 'unreachable' | 'out_of_bounds' | 'not_walkable';
}

export interface PortalMusterUpdateMessage {
  type: 'portal_muster_update';
  portalId: string;
  readyMembers: WorldMemberSummary[];
}

export interface DungeonEnteredMessage {
  type: 'dungeon_entered';
  dungeonSessionId: string;
}

export interface DungeonReturnedMessage {
  type: 'dungeon_returned';
}

export interface AuthResultMessage {
  type: 'auth_result';
  token: string;
  account: AccountSummary;
  characters: CharacterSummary[];
  selectedWorldId: string | null;
  selectedWorldInviteCode: string | null;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  reason: string;
}

export interface CharacterListMessage {
  type: 'character_list';
  characters: CharacterSummary[];
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

export interface ArenaCombatStartMessage {
  type: 'arena_combat_start';
  tileGrid: import('./types.js').TileGrid;
  positions: Record<string, { x: number; y: number }>;
  combat: CombatState;
}

export interface ArenaPositionsUpdateMessage {
  type: 'arena_positions_update';
  positions: Record<string, { x: number; y: number }>;
  movementRemaining: number;
  path?: { x: number; y: number }[];
  moverId: string;
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

export interface GoldUpdateMessage {
  type: 'gold_update';
  playerId: string;
  gold: number;
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

export interface StashView {
  items: (Item | null)[];
  capacity: number;
}

export interface CharacterItemsView {
  inventory: (Item | null)[];
  consumables: (Item | null)[];
}

export interface StashOpenedMessage {
  type: 'stash_opened';
  stash: StashView;
  character: CharacterItemsView;
}

export interface StashUpdatedMessage {
  type: 'stash_updated';
  stash: StashView;
  character: CharacterItemsView;
}

export interface StashErrorMessage {
  type: 'stash_error';
  reason: string;
}

export interface ShopFixedSlotView {
  consumableId: string;
  item: Item;
  price: number;
}

export interface ShopRotatingSlotView {
  item: Item | null;
  price: number | null;
}

export interface ShopView {
  shopId: string;
  name: string;
  fixed: ShopFixedSlotView[];
  rotating: ShopRotatingSlotView[];
  rerollCost: number;
  sellBackPct: number;
}

export interface ShopOpenedMessage {
  type: 'shop_opened';
  shop: ShopView;
  gold: number;
  character: CharacterItemsView;
}

export interface ShopUpdatedMessage {
  type: 'shop_updated';
  shop: ShopView;
  gold: number;
  character: CharacterItemsView;
}

export interface ShopErrorMessage {
  type: 'shop_error';
  reason: string;
}

export interface TorchPickupMessage {
  type: 'torch_pickup';
  playerId: string;
  position: { x: number; y: number };
  fuel: number;
}

export interface CharacterPanelView {
  name: string;
  className: string;
  level: number;
  xp: number;
  gold: number;
  equipment: Equipment;
  inventory: (Item | null)[];
  consumables: (Item | null)[];
  statAllocations: Record<string, number>;
  unspentStatPoints: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  maxEnergy: number;
}

export interface CharacterPanelOpenedMessage {
  type: 'character_panel_opened';
  character: CharacterPanelView;
}

export interface CharacterPanelUpdatedMessage {
  type: 'character_panel_updated';
  character: CharacterPanelView;
}

export interface CharacterPanelErrorMessage {
  type: 'character_panel_error';
  reason: string;
}

export type ServerMessage =
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
  | GoldUpdateMessage
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
  | TorchPickupMessage
  | StashOpenedMessage
  | StashUpdatedMessage
  | StashErrorMessage
  | AuthResultMessage
  | AuthErrorMessage
  | CharacterListMessage
  | WorldListMessage
  | WorldSelectedMessage
  | WorldErrorMessage
  | WorldStateMessage
  | WorldMemberJoinedMessage
  | WorldMemberLeftMessage
  | OverworldTickMessage
  | WorldMoveRejectedMessage
  | PortalMusterUpdateMessage
  | DungeonEnteredMessage
  | DungeonReturnedMessage
  | ShopOpenedMessage
  | ShopUpdatedMessage
  | ShopErrorMessage
  | ArenaCombatStartMessage
  | ArenaPositionsUpdateMessage
  | CharacterPanelOpenedMessage
  | CharacterPanelUpdatedMessage
  | CharacterPanelErrorMessage;
