import { create } from "zustand";

/**
 * The Generate in progress: how many of its renders the server has accepted, and whether the rest
 * are waiting for a free slot on the plan. Lives outside the Generate bar so switching panels
 * doesn't lose it.
 */
interface GenerateBatchState {
  active: boolean;
  total: number;
  accepted: number;
  waiting: boolean;
  /** Stops sending what's still waiting; renders already accepted keep going. */
  stop: (() => void) | null;
  begin: (total: number, stop: () => void) => void;
  progress: (progress: { total: number; accepted: number; waiting: boolean }) => void;
  end: () => void;
}

const IDLE = { active: false, total: 0, accepted: 0, waiting: false, stop: null };

export const useGenerateBatchStore = create<GenerateBatchState>((set) => ({
  ...IDLE,
  begin: (total, stop) => set({ active: true, total, accepted: 0, waiting: false, stop }),
  progress: ({ total, accepted, waiting }) => set({ total, accepted, waiting }),
  end: () => set(IDLE),
}));
