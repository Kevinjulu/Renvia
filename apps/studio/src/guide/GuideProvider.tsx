import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { getGuideTopic } from "./catalog";
import { GuideLayer } from "./GuideLayer";
import { currentTourStep, shouldAutoStartOrientation, useGuideStore } from "./useGuideStore";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = useGuideStore((state) => state.mode);
  const stepIndex = useGuideStore((state) => state.stepIndex);
  const hotspotId = useGuideStore((state) => state.hotspotId);
  const inspectId = useGuideStore((state) => state.inspectId);
  const startTour = useGuideStore((state) => state.startTour);
  const nextStep = useGuideStore((state) => state.nextStep);
  const prevStep = useGuideStore((state) => state.prevStep);
  const skipTour = useGuideStore((state) => state.skipTour);
  const toggleLegend = useGuideStore((state) => state.toggleLegend);
  const closeLegend = useGuideStore((state) => state.closeLegend);
  const openHotspot = useGuideStore((state) => state.openHotspot);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);

  useEffect(() => {
    const requested = searchParams.get("tour") === "1";
    if (requested) {
      startTour("orientation");
      const next = new URLSearchParams(searchParams);
      next.delete("tour");
      setSearchParams(next, { replace: true });
      return;
    }
    if (!shouldAutoStartOrientation()) return;
    const timeout = window.setTimeout(() => {
      if (useGuideStore.getState().mode === "idle" && shouldAutoStartOrientation()) {
        startTour("orientation");
      }
    }, 480);
    return () => window.clearTimeout(timeout);
  }, [searchParams, setSearchParams, startTour]);

  useEffect(() => {
    if (mode !== "tour") return;
    const step = currentTourStep();
    if (step && "tab" in step && step.tab) setActiveTab(step.tab);
  }, [mode, stepIndex, setActiveTab]);

  useEffect(() => {
    if (mode !== "legend" || !inspectId) return;
    const tab = getGuideTopic(inspectId).tab;
    if (tab) setActiveTab(tab);
  }, [mode, inspectId, setActiveTab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hotspotId) {
          openHotspot(null);
          event.preventDefault();
          return;
        }
        if (mode === "tour") {
          skipTour();
          event.preventDefault();
          return;
        }
        if (mode === "legend") {
          closeLegend();
          event.preventDefault();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        if (mode === "idle") toggleLegend();
        return;
      }

      if ((event.key === "i" || event.key === "I") && mode !== "tour") {
        event.preventDefault();
        toggleLegend();
        return;
      }

      if (mode === "tour" && event.key === "ArrowRight") {
        event.preventDefault();
        nextStep();
      }
      if (mode === "tour" && event.key === "ArrowLeft") {
        event.preventDefault();
        prevStep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, hotspotId, nextStep, prevStep, skipTour, toggleLegend, closeLegend, openHotspot]);

  return (
    <>
      {children}
      <GuideLayer />
    </>
  );
}
