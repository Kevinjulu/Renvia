import { create } from "zustand";

/** The render a report is about, when it was opened from one. */
export interface FeedbackTarget {
  renderId: string;
  projectId: string;
  resultImageUrl: string | null;
  sourceImageUrl: string | null;
}

interface FeedbackState {
  open: boolean;
  target: FeedbackTarget | null;
  /** A report's thread open in the Beta Program area. */
  threadId: string | null;
  openReport: (target?: FeedbackTarget | null) => void;
  closeReport: () => void;
  openThread: (id: string | null) => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  open: false,
  target: null,
  threadId: null,
  openReport: (target = null) => set({ open: true, target }),
  closeReport: () => set({ open: false, target: null }),
  openThread: (threadId) => set({ threadId }),
}));
