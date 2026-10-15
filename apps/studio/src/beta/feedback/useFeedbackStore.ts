import { create } from "zustand";
import type { BetaFeedbackKind } from "@renvia/types";

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
  /** The kind the form starts on, when it was opened for something specific (an idea, praise…). */
  kind: BetaFeedbackKind | null;
  /** A report's thread open in the Beta Program area. */
  threadId: string | null;
  openReport: (target?: FeedbackTarget | null, kind?: BetaFeedbackKind | null) => void;
  closeReport: () => void;
  openThread: (id: string | null) => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  open: false,
  target: null,
  kind: null,
  threadId: null,
  openReport: (target = null, kind = null) => set({ open: true, target, kind }),
  closeReport: () => set({ open: false, target: null, kind: null }),
  openThread: (threadId) => set({ threadId }),
}));
