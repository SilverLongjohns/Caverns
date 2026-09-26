import type { CombatState, ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

type SandboxStatus = 'connecting' | 'my_turn' | 'waiting' | 'ended' | 'error';

interface SandboxEvent { t: number; type: string; detail?: unknown }

interface SandboxHook {
  status: SandboxStatus;
  error: string | null;
  playerId: string;
  currentTurnId: string | null;
  combat: CombatState | null;
  positions: Record<string, { x: number; y: number }>;
  events: SandboxEvent[];
}

declare global {
  interface Window { __cavernsSandbox?: SandboxHook }
}

const MAX_EVENTS = 500;
let sawCombat = false;

/** Publish sandbox state on window so automation can wait on it instead of sleeping. */
export function installSandboxHook(): void {
  const hook: SandboxHook = { status: 'connecting', error: null, playerId: '', currentTurnId: null, combat: null, positions: {}, events: [] };
  window.__cavernsSandbox = hook;
  const sync = (s: ReturnType<typeof useGameStore.getState>) => {
    if (s.activeCombat) sawCombat = true;
    hook.error = s.sandboxError;
    hook.playerId = s.playerId;
    hook.currentTurnId = s.currentTurnId;
    hook.combat = s.activeCombat;
    hook.positions = s.arenaPositions;
    if (s.sandboxError) hook.status = 'error';
    else if (s.gameOver || (sawCombat && !s.activeCombat)) hook.status = 'ended';
    else if (!s.activeCombat || !s.arenaGrid || s.arenaIntro) hook.status = 'connecting';
    else hook.status = s.currentTurnId === s.playerId ? 'my_turn' : 'waiting';
  };
  sync(useGameStore.getState());
  useGameStore.subscribe(sync);
}

export function recordSandboxEvent(msg: ServerMessage): void {
  const hook = window.__cavernsSandbox;
  if (!hook) return;
  if (msg.type === 'game_start') sawCombat = false;
  hook.events.push({ t: Date.now(), type: msg.type, detail: summarize(msg) });
  if (hook.events.length > MAX_EVENTS) hook.events.shift();
}

function summarize(msg: ServerMessage): unknown {
  switch (msg.type) {
    case 'combat_turn': return { currentTurnId: msg.currentTurnId, roundNumber: msg.roundNumber };
    case 'combat_end': return { result: msg.result };
    case 'sandbox_error': return { message: msg.message };
    case 'combat_action_result': {
      const r = msg as { actorId?: string; targetId?: string; damage?: number; action?: string };
      return { actorId: r.actorId, targetId: r.targetId, damage: r.damage, action: r.action };
    }
    default: return undefined;
  }
}
