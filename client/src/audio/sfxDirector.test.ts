import { describe, it, expect } from 'vitest';
import type { ServerMessage, Room, Player, CombatState } from '@caverns/shared';
import { soundsFor, bedFor, OTHER_STEP_VOLUME, type DirectorState, type SfxCue } from './sfxDirector.js';

const room = (id: string, extra: Partial<Room> = {}): Room =>
  ({ id, type: 'chamber', name: id, description: '', exits: {}, ...extra }) as Room;
const player = (id: string, roomId: string, extra: Partial<Player> = {}): Player =>
  ({ id, roomId, gold: 0, keychain: [], ...extra }) as unknown as Player;
const combat: CombatState = {
  roomId: 'r1', turnOrder: [], currentTurnId: 'me', roundNumber: 1,
  participants: [
    { id: 'me', type: 'player', name: 'Me', hp: 10, maxHp: 10, initiative: 5 },
    { id: 'rat', type: 'mob', name: 'Rat', hp: 5, maxHp: 5, initiative: 3 },
  ] as CombatState['participants'],
};
function state(extra: Partial<DirectorState> = {}): DirectorState {
  return {
    playerId: 'me',
    players: { me: player('me', 'r1'), ally: player('ally', 'r1'), far: player('far', 'r2') },
    rooms: {
      r1: room('r1', { biomeId: 'fungal', tileGrid: { width: 2, height: 1, tiles: [['floor', 'water']] } }),
      r2: room('r2', { biomeId: 'bone' }),
    },
    currentRoomId: 'r1',
    torchFuel: 10,
    activeCombat: null,
    ...extra,
  };
}
const ids = (cues: SfxCue[]) => cues.flatMap((c) => (c.kind === 'sfx' ? [c.id] : []));
const run = (msg: unknown, before = state(), after = before) => soundsFor(msg as ServerMessage, before, after);

describe('exploration', () => {
  it('steps: own at full volume, wet on water, allies quieter, other rooms silent', () => {
    expect(run({ type: 'player_position', playerId: 'me', roomId: 'r1', x: 0, y: 0 })).toEqual([{ kind: 'sfx', id: 'step' }]);
    expect(ids(run({ type: 'player_position', playerId: 'me', roomId: 'r1', x: 1, y: 0 }))).toEqual(['step_wet']);
    expect(run({ type: 'player_position', playerId: 'ally', roomId: 'r1', x: 0, y: 0 })).toEqual([{ kind: 'sfx', id: 'step', volume: OTHER_STEP_VOLUME, limitKey: 'step:other' }]);
    expect(run({ type: 'player_position', playerId: 'far', roomId: 'r2', x: 0, y: 0 })).toEqual([]);
  });
  it('entering a room plays room_enter and switches the bed to its biome', () => {
    const after = state({ players: { ...state().players, me: player('me', 'r2') } });
    expect(run({ type: 'player_moved', playerId: 'me', roomId: 'r2', x: 0, y: 0 }, state(), after))
      .toEqual([{ kind: 'sfx', id: 'room_enter' }, { kind: 'bed', id: 'amb_bone' }]);
    expect(run({ type: 'player_moved', playerId: 'ally', roomId: 'r2', x: 0, y: 0 })).toEqual([]);
  });
  it('bedFor falls back to the starter bed', () => {
    expect(bedFor(room('x'))).toBe('amb_starter');
    expect(bedFor(room('x', { biomeId: 'nonsense' }))).toBe('amb_starter');
    expect(bedFor(undefined)).toBe('amb_starter');
    expect(bedFor(room('x', { biomeId: 'volcanic' }))).toBe('amb_volcanic');
  });
  it('locked exit, unlock and tile hazard use the structured tags', () => {
    expect(ids(run({ type: 'error', message: 'x', code: 'exit_locked' }))).toEqual(['exit_blocked']);
    expect(ids(run({ type: 'error', message: 'x' }))).toEqual([]);
    expect(ids(run({ type: 'text_log', message: 'x', logType: 'system', event: 'unlock' }))).toEqual(['unlock']);
    expect(ids(run({ type: 'text_log', message: 'x', logType: 'combat', event: 'hazard', playerId: 'me' }))).toEqual(['hazard_tick']);
    expect(ids(run({ type: 'text_log', message: 'x', logType: 'combat', event: 'hazard', playerId: 'ally' }))).toEqual([]);
  });
  it('mob alert only in my room', () => {
    expect(ids(run({ type: 'mob_alert', roomId: 'r1', mobId: 'm', x: 0, y: 0 }))).toEqual(['mob_alert']);
    expect(ids(run({ type: 'mob_alert', roomId: 'r2', mobId: 'm', x: 0, y: 0 }))).toEqual([]);
  });
  it('interact outcomes map to their stingers', () => {
    const r = (type: string) => ids(run({ type: 'interact_result', interactableId: 'i', actionId: 'a', narration: '', outcome: { type } }));
    expect(r('loot')).toEqual(['interact_loot']);
    expect(r('hazard')).toEqual(['interact_hazard']);
    expect(r('secret')).toEqual(['interact_secret']);
    expect(r('reveal_room')).toEqual(['interact_secret']);
    expect(r('intel')).toEqual(['interact_flavor']);
    expect(r('flavor')).toEqual(['interact_flavor']);
  });
  it('torch pickup is mine only; torch_out when fuel hits zero', () => {
    expect(ids(run({ type: 'torch_pickup', playerId: 'me', position: { x: 0, y: 0 }, fuel: 60 }))).toEqual(['torch_pickup']);
    expect(ids(run({ type: 'torch_pickup', playerId: 'ally', position: { x: 0, y: 0 }, fuel: 60 }))).toEqual([]);
    const out = run({ type: 'player_position', playerId: 'me', roomId: 'r1', x: 0, y: 0 }, state({ torchFuel: 1 }), state({ torchFuel: 0 }));
    expect(ids(out)).toEqual(['step', 'torch_out']);
  });
  it('gold up, key gained and my level-up', () => {
    const before = state();
    const richer = state({ players: { ...before.players, me: player('me', 'r1', { gold: 5 }) } });
    expect(ids(run({ type: 'gold_update', playerId: 'me', gold: 5 }, before, richer))).toEqual(['gold']);
    expect(ids(run({ type: 'gold_update', playerId: 'me', gold: 0 }, richer, before))).toEqual([]);
    const keyed = state({ players: { ...before.players, me: player('me', 'r1', { keychain: ['k'] }) } });
    expect(ids(run({ type: 'player_update', player: keyed.players.me }, before, keyed))).toEqual(['key_pickup']);
    expect(ids(run({ type: 'level_up', playerId: 'me', newLevel: 2 }))).toEqual(['level_up']);
    expect(ids(run({ type: 'level_up', playerId: 'ally', newLevel: 2 }))).toEqual([]);
  });
  it('dungeon lifecycle: preload on entry, bed on start, silence and un-duck on return', () => {
    expect(run({ type: 'dungeon_entered', dungeonSessionId: 'd' })).toEqual([{ kind: 'preload' }]);
    expect(run({ type: 'game_start' })).toEqual([{ kind: 'bed', id: 'amb_fungal' }]);
    expect(run({ type: 'dungeon_returned' })).toEqual([{ kind: 'bed', id: null }, { kind: 'duck', on: false }]);
  });
  it('puzzle prompt pings', () => {
    expect(ids(run({ type: 'puzzle_prompt' }))).toEqual(['puzzle_ping']);
  });
});

describe('combat', () => {
  const inFight = state({ activeCombat: combat });
  const act = (extra: object) => ids(run({ type: 'combat_action_result', actorId: 'me', actorName: 'Me', ...extra }, inFight, inFight));
  it('the arena start the server actually sends ducks the bed and plays the stinger', () => {
    expect(run({ type: 'arena_combat_start', combat, tileGrid: { width: 1, height: 1, tiles: [['floor']] }, positions: {} }))
      .toEqual([{ kind: 'sfx', id: 'combat_start' }, { kind: 'duck', on: true }]);
  });
  it('start ducks the bed; end un-ducks with the result stinger', () => {
    expect(run({ type: 'combat_start', combat })).toEqual([{ kind: 'sfx', id: 'combat_start' }, { kind: 'duck', on: true }]);
    expect(run({ type: 'combat_end', result: 'victory' })).toEqual([{ kind: 'duck', on: false }, { kind: 'sfx', id: 'victory' }]);
    expect(run({ type: 'combat_end', result: 'wipe' })).toEqual([{ kind: 'duck', on: false }, { kind: 'sfx', id: 'wipe' }]);
    expect(run({ type: 'combat_end', result: 'flee' })).toEqual([{ kind: 'duck', on: false }]);
  });
  it('melee: hit, crit, miss, and mob hits', () => {
    expect(act({ action: 'attack', targetId: 'rat', damage: 3 })).toEqual(['melee_hit']);
    expect(act({ action: 'attack', targetId: 'rat', damage: 6, critMultiplier: 2 })).toEqual(['melee_crit']);
    expect(act({ action: 'attack', targetId: 'rat', damage: 0 })).toEqual(['melee_miss']);
    expect(act({ action: 'attack', actorId: 'rat', targetId: 'me', damage: 2 })).toEqual(['mob_hit']);
    expect(act({ action: 'attack', actorId: 'rat', targetId: 'me', defendQte: true, pendingDamage: 2 })).toEqual([]);
  });
  it('guns: shot, miss, last round clicks dry, reload', () => {
    expect(act({ action: 'shoot', targetId: 'rat', hit: true, damage: 4, ammo: 2 })).toEqual(['gun_shot']);
    expect(act({ action: 'shoot', targetId: 'rat', hit: false, ammo: 2 })).toEqual(['gun_miss']);
    expect(act({ action: 'shoot', targetId: 'rat', hit: true, damage: 4, ammo: 0 })).toEqual(['gun_shot', 'dry_click']);
    expect(act({ action: 'reload', ammo: 6 })).toEqual(['reload']);
  });
  it('defend, heal, ability, flee', () => {
    expect(act({ action: 'defend' })).toEqual(['defend']);
    expect(act({ action: 'use_item', healing: 5 })).toEqual(['heal']);
    expect(act({ action: 'use_item_effect', itemEffectHealing: 3 })).toEqual(['heal']);
    expect(act({ action: 'use_item' })).toEqual([]);
    expect(act({ action: 'use_ability', abilityId: 'x' })).toEqual(['ability_generic']);
    expect(act({ action: 'flee', fled: true })).toEqual(['flee']);
  });
  it('downs: mob death vs player down, deduplicated', () => {
    expect(act({ action: 'attack', targetId: 'rat', damage: 9, targetDowned: true, downedIds: ['rat'] })).toEqual(['melee_hit', 'mob_death']);
    expect(act({ action: 'attack', actorId: 'rat', targetId: 'me', damage: 9, targetDowned: true })).toEqual(['mob_hit', 'player_down']);
  });
});
