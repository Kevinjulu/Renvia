import { create } from "zustand";
import type { RenderJob } from "@renvia/types";

export type ClientRenderJob = RenderJob;
export type PreviewMode = "render" | "compare" | "source";

/** Any image opened full-size on the canvas that isn't a render job — a source, a reference, an upload. */
export interface PreviewImage {
  url: string;
  title: string;
  /** Shown under the title, e.g. which view the image belongs to. */
  caption?: string;
}

interface RenderJobsState {
  jobs: ClientRenderJob[];
  activeJobId: string | null;
  /** Render shown full-size over the canvas; null when the canvas itself is showing. */
  previewJobId: string | null;
  /** Plain image shown full-size over the canvas; never set at the same time as `previewJobId`. */
  previewImage: PreviewImage | null;
  previewMode: PreviewMode;
  favoriteIds: Set<string>;
  setJobs: (jobs: ClientRenderJob[]) => void;
  addJob: (job: ClientRenderJob) => void;
  updateJob: (id: string, patch: Partial<RenderJob>) => void;
  removeJob: (id: string) => void;
  setActiveJob: (id: string | null) => void;
  /** Opens a render full-size (or closes the viewer with null); `mode` defaults to the plain render. */
  setPreviewJob: (id: string | null, mode?: PreviewMode) => void;
  /** Opens any image full-size over the canvas (or closes the viewer with null). */
  setPreviewImage: (image: PreviewImage | null) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  toggleFavorite: (id: string) => void;
}

export const useRenderJobsStore = create<RenderJobsState>((set) => ({
  jobs: [],
  activeJobId: null,
  previewJobId: null,
  previewImage: null,
  previewMode: "render",
  favoriteIds: new Set(),
  setJobs: (jobs) => set({ jobs, previewJobId: null, previewImage: null }),
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
  setPreviewJob: (id, mode = "render") =>
    set(
      id
        ? { previewJobId: id, activeJobId: id, previewMode: mode, previewImage: null }
        : { previewJobId: null, previewMode: "render", previewImage: null },
    ),
  setPreviewImage: (previewImage) => set({ previewImage, previewJobId: null, previewMode: "render" }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  toggleFavorite: (id) =>
    set((state) => {
      const next = new Set(state.favoriteIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { favoriteIds: next };
    }),
}));
