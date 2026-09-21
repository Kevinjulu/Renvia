import { create } from "zustand";

export type UploadStatus = "idle" | "uploading" | "done" | "error";

interface UploadProgressState {
  status: UploadStatus;
  /** 0–1 across the whole batch, not just the current file. */
  progress: number;
  begin: () => void;
  report: (progress: number) => void;
  finish: (ok: boolean) => void;
}

const SETTLE_MS = 1400;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

export const useUploadProgressStore = create<UploadProgressState>((set) => ({
  status: "idle",
  progress: 0,
  begin: () => {
    clearTimeout(settleTimer);
    set({ status: "uploading", progress: 0 });
  },
  // Never let the water drop back down when a later file starts slower.
  report: (progress) => set((state) => ({ progress: Math.max(state.progress, Math.min(1, progress)) })),
  finish: (ok) => {
    set((state) => ({ status: ok ? "done" : "error", progress: ok ? 1 : state.progress }));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => set({ status: "idle", progress: 0 }), SETTLE_MS);
  },
}));
