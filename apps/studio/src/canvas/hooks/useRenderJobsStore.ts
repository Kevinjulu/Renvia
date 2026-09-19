import { create } from "zustand";
import type { RenderJob } from "@renvia/types";

export type ClientRenderJob = RenderJob;

interface RenderJobsState {
  jobs: ClientRenderJob[];
  activeJobId: string | null;
  /** Render shown full-size over the canvas; null when the canvas itself is showing. */
  previewJobId: string | null;
  favoriteIds: Set<string>;
  setJobs: (jobs: ClientRenderJob[]) => void;
  addJob: (job: ClientRenderJob) => void;
  updateJob: (id: string, patch: Partial<RenderJob>) => void;
  removeJob: (id: string) => void;
  setActiveJob: (id: string | null) => void;
  setPreviewJob: (id: string | null) => void;
  toggleFavorite: (id: string) => void;
}

export const useRenderJobsStore = create<RenderJobsState>((set) => ({
  jobs: [],
  activeJobId: null,
  previewJobId: null,
  favoriteIds: new Set(),
  setJobs: (jobs) => set({ jobs, previewJobId: null }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs], activeJobId: job.id })),
  updateJob: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    })),
  removeJob: (id) =>
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== id),
      activeJobId: state.activeJobId === id ? (state.jobs.find((job) => job.id !== id)?.id ?? null) : state.activeJobId,
      previewJobId: state.previewJobId === id ? null : state.previewJobId,
    })),
  setActiveJob: (id) => set({ activeJobId: id }),
  setPreviewJob: (id) => set(id ? { previewJobId: id, activeJobId: id } : { previewJobId: null }),
  toggleFavorite: (id) =>
    set((state) => {
      const next = new Set(state.favoriteIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { favoriteIds: next };
    }),
}));
