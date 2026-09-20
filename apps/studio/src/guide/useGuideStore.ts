import { create } from "zustand";
import { ORIENTATION_TOUR, type GuideTopicId, type TourStep } from "./catalog";
import { markTourFinished, readGuidePersistence } from "./persistence";

export type GuideMode = "idle" | "tour" | "legend";

interface GuideState {
  mode: GuideMode;
  tourId: string | null;
  stepIndex: number;
  inspectId: GuideTopicId | null;
  hotspotId: GuideTopicId | null;
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

function orientationStep(): TourStep | null {
  const { mode, stepIndex } = useGuideStore.getState();
  if (mode !== "tour") return null;
  return ORIENTATION_TOUR.steps[stepIndex] ?? null;
}

export function currentTourStep(): TourStep | null {
  return orientationStep();
}

export const useGuideStore = create<GuideState>((set, get) => ({
  mode: "idle",
  tourId: null,
  stepIndex: 0,
  inspectId: null,
  hotspotId: null,
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
    const last = ORIENTATION_TOUR.steps.length - 1;
    if (stepIndex >= last) {
      if (tourId) markTourFinished(tourId);
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
    if (tourId) markTourFinished(tourId);
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
