// Maps each delivered server message (plus what it changed in the store) to sound cues.
// Pure: the caller plays the cues. Messages reach here after the close-up gate, so sounds
// land with the visuals they belong to.
import type { ServerMessage, Room } from '@caverns/shared';
import type { GameStore } from '../store/gameStore.js';
import { isSfxId, SFX, type SfxId } from './sfxManifest.js';

export type SfxCue =
  | { kind: 'sfx'; id: SfxId; volume?: number; limitKey?: string }
  | { kind: 'bed'; id: SfxId | null }
  | { kind: 'duck'; on: boolean }
  | { kind: 'preload' };

export type DirectorState = Pick<GameStore, 'playerId' | 'players' | 'rooms' | 'currentRoomId' | 'torchFuel' | 'activeCombat'>;

export const OTHER_STEP_VOLUME = 0.4;

const sfx = (id: SfxId, volume?: number): SfxCue => (volume === undefined ? { kind: 'sfx', id } : { kind: 'sfx', id, volume });

export function bedFor(room: Room | undefined): SfxId {
  const id = `amb_${room?.biomeId ?? ''}`;
  return isSfxId(id) && SFX[id].bus === 'bed' ? id : 'amb_starter';
}

const OUTCOME_SFX: Record<string, SfxId> = {
  loot: 'interact_loot',
  hazard: 'interact_hazard',
  secret: 'interact_secret',
  reveal_room: 'interact_secret',
  intel: 'interact_flavor',
  flavor: 'interact_flavor',
};

export function soundsFor(msg: ServerMessage, before: DirectorState, after: DirectorState): SfxCue[] {
  return [...forMessage(msg, before, after), ...forDiff(before, after)];
}

function forMessage(msg: ServerMessage, before: DirectorState, after: DirectorState): SfxCue[] {
  const me = after.playerId;
  const myRoom = after.players[me]?.roomId;
  switch (msg.type) {
    case 'player_position': {
      const mine = msg.playerId === me;
      if (!mine && msg.roomId !== myRoom) return [];
      const tile = after.rooms[msg.roomId]?.tileGrid?.tiles[msg.y]?.[msg.x];
      const id: SfxId = tile === 'water' ? 'step_wet' : 'step';
      // Allies get their own limiter slot so their steps can't crowd out yours.
      return [mine ? sfx(id) : { kind: 'sfx', id, volume: OTHER_STEP_VOLUME, limitKey: `${id}:other` }];
    }
    case 'player_moved':
      if (msg.playerId !== me) return [];
      return [sfx('room_enter'), { kind: 'bed', id: bedFor(after.rooms[msg.roomId]) }];
    case 'game_start':
      return [{ kind: 'bed', id: bedFor(after.rooms[after.currentRoomId]) }];
    case 'dungeon_entered':
      return [{ kind: 'preload' }];
    case 'dungeon_returned':
      return [{ kind: 'bed', id: null }, { kind: 'duck', on: false }];
    case 'error':
      return msg.code === 'exit_locked' ? [sfx('exit_blocked')] : [];
    case 'text_log':
      if (msg.event === 'unlock') return [sfx('unlock')];
      if (msg.event === 'hazard' && msg.playerId === me) return [sfx('hazard_tick')];
      return [];
    case 'mob_alert':
      return msg.roomId === myRoom ? [sfx('mob_alert')] : [];
    case 'torch_pickup':
      return msg.playerId === me ? [sfx('torch_pickup')] : [];
    case 'interact_result': {
      const id = OUTCOME_SFX[msg.outcome.type];
      return id ? [sfx(id)] : [];
    }
    case 'puzzle_prompt':
      return [sfx('puzzle_ping')];
    case 'gold_update': {
      const was = before.players[me]?.gold;
      return msg.playerId === me && was !== undefined && msg.gold > was ? [sfx('gold')] : [];
    }
    case 'level_up':
      return msg.playerId === me ? [sfx('level_up')] : [];
    case 'arena_combat_start':
    case 'combat_start':
      return [sfx('combat_start'), { kind: 'duck', on: true }];
    case 'combat_end':
      if (msg.result === 'victory') return [{ kind: 'duck', on: false }, sfx('victory')];
      if (msg.result === 'wipe') return [{ kind: 'duck', on: false }, sfx('wipe')];
      return [{ kind: 'duck', on: false }];
    case 'combat_action_result':
      return forCombatAction(msg, before.activeCombat?.participants ?? after.activeCombat?.participants ?? []);
    default:
      return [];
  }
}

type CombatResult = Extract<ServerMessage, { type: 'combat_action_result' }>;

function forCombatAction(msg: CombatResult, participants: { id: string; type: 'player' | 'mob' }[]): SfxCue[] {
  const isMob = (id: string | undefined) => participants.find((p) => p.id === id)?.type === 'mob';
  const cues: SfxCue[] = [];
  switch (msg.action) {
    case 'attack':
      if (msg.defendQte) break; // resolved later through the defense QTE
      if (!msg.damage) cues.push(sfx('melee_miss'));
      else if ((msg.critMultiplier ?? 1) > 1) cues.push(sfx('melee_crit'));
      else cues.push(sfx(isMob(msg.actorId) ? 'mob_hit' : 'melee_hit'));
      break;
    case 'shoot':
      cues.push(sfx(msg.hit === false ? 'gun_miss' : 'gun_shot'));
      if (msg.ammo === 0) cues.push(sfx('dry_click'));
      break;
    case 'reload':
      cues.push(sfx('reload'));
      break;
    case 'defend':
      cues.push(sfx('defend'));
      break;
    case 'use_item':
    case 'use_item_effect':
      if (msg.healing || msg.itemEffectHealing) cues.push(sfx('heal'));
      break;
    case 'use_ability':
      cues.push(sfx('ability_generic'));
      break;
    case 'flee':
      cues.push(sfx('flee'));
      break;
  }
  const downed = new Set<string>(msg.downedIds ?? []);
  if (msg.targetDowned && msg.targetId) downed.add(msg.targetId);
  if (msg.actorDowned) downed.add(msg.actorId);
  for (const id of downed) cues.push(sfx(isMob(id) ? 'mob_death' : 'player_down'));
  return cues;
}

function forDiff(before: DirectorState, after: DirectorState): SfxCue[] {
  const cues: SfxCue[] = [];
  if (before.torchFuel > 0 && after.torchFuel <= 0) cues.push(sfx('torch_out'));
  const me = after.playerId;
  const keysBefore = before.players[me]?.keychain?.length;
  const keysAfter = after.players[me]?.keychain?.length ?? 0;
  if (keysBefore !== undefined && keysAfter > keysBefore) cues.push(sfx('key_pickup'));
  return cues;
}
