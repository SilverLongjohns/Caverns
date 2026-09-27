import { create } from 'zustand';
import { readIntroEnv, shouldPlayIntro } from './introState.js';

export interface IntroStore {
  /** The cutscene is mounted (gate, playing or fading). */
  active: boolean;
  /** Menu music is held back so the intro owns the soundstage. */
  musicHold: boolean;
  /** Replays skip the dead-TV gate: the click that asked for the replay already unlocked audio. */
  gateless: boolean;
  releaseMusic(): void;
  finish(): void;
  replay(): void;
}

export function createIntroStore(initialActive: boolean) {
  return create<IntroStore>((set) => ({
    active: initialActive,
    musicHold: initialActive,
    gateless: false,
    releaseMusic: () => set({ musicHold: false }),
    finish: () => set({ active: false, musicHold: false, gateless: false }),
    replay: () => set({ active: true, musicHold: true, gateless: true }),
  }));
}

export const useIntroStore = createIntroStore(typeof window !== 'undefined' && shouldPlayIntro(readIntroEnv()));
