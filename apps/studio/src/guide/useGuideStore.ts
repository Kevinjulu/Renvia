import { create } from "zustand";
import { tourFor, type GuideTopicId, type TourStep } from "./catalog";
import { markTourFinished, readGuidePersistence, writeGuidePersistence } from "./persistence";

export type GuideMode = "idle" | "tour" | "legend";

interface GuideState {
  mode: GuideMode;
  tourId: string | null;
  stepIndex: number;
  inspectId: GuideTopicId | null;
  hotspotId: GuideTopicId | null;
  /** Mirrors the saved flag so hints disappear the moment they are finished. */
  firstRunHintsDone: boolean;
  finishFirstRunHints: () => void;
  startTour: (tourId?: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  openLegend: (topicId?: GuideTopicId) => void;
  closeLegend: () => void;
  toggleLegend: () => void;
  inspect: (id: GuideTopicId | null) => void;
  openHotspot: (id: GuideTopicId | null) => void;
  exit: () => void;
}

export function currentTourStep(): TourStep | null {
  const { mode, stepIndex, tourId } = useGuideStore.getState();
  if (mode !== "tour") return null;
  return tourFor(tourId).steps[stepIndex] ?? null;
}

/** Called with the tour's id when a tour is finished or skipped; the beta tour reports it to the server. */
const finishListeners = new Set<(tourId: string) => void>();
export function onTourFinished(listener: (tourId: string) => void): () => void {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}
function finishTour(tourId: string) {
  markTourFinished(tourId);
  for (const listener of finishListeners) listener(tourId);
}

export const useGuideStore = create<GuideState>((set, get) => ({
  mode: "idle",
  tourId: null,
  stepIndex: 0,
  inspectId: null,
  hotspotId: null,
  firstRunHintsDone: readGuidePersistence().firstRunHintsDone,
  finishFirstRunHints: () => {
    if (get().firstRunHintsDone) return;
    writeGuidePersistence({ firstRunHintsDone: true });
    set({ firstRunHintsDone: true });
  },
  startTour: (tourId = "orientation") =>
    set({
      mode: "tour",
      tourId,
      stepIndex: 0,
      inspectId: null,
      hotspotId: null,
    }),
  nextStep: () => {
    const { mode, stepIndex, tourId } = get();
    if (mode !== "tour") return;
    const last = tourFor(tourId).steps.length - 1;
    if (stepIndex >= last) {
      if (tourId) finishTour(tourId);
      set({ mode: "idle", tourId: null, stepIndex: 0 });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },
  prevStep: () => {
    const { mode, stepIndex } = get();
    if (mode !== "tour" || stepIndex === 0) return;
    set({ stepIndex: stepIndex - 1 });
  },
  skipTour: () => {
    const { tourId } = get();
    if (tourId) finishTour(tourId);
    set({ mode: "idle", tourId: null, stepIndex: 0, inspectId: null });
  },
  openLegend: (topicId) =>
    set({
      mode: "legend",
      tourId: null,
      stepIndex: 0,
      inspectId: topicId ?? "control.uploads",
      hotspotId: null,
    }),
  closeLegend: () => set({ mode: "idle", inspectId: null }),
  toggleLegend: () => {
    const { mode } = get();
    if (mode === "legend") {
      set({ mode: "idle", inspectId: null });
      return;
    }
    get().openLegend();
  },
  inspect: (id) => set({ inspectId: id, hotspotId: null }),
  openHotspot: (id) => set({ hotspotId: id, inspectId: id && get().mode === "legend" ? id : get().inspectId }),
  exit: () => set({ mode: "idle", tourId: null, stepIndex: 0, inspectId: null, hotspotId: null }),
}));

export function shouldAutoStartOrientation(): boolean {
  return !readGuidePersistence().orientationDone;
}
