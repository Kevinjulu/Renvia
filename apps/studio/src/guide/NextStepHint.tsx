import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { renderableBuildingViews } from "../canvas/buildingViews";
import { NEXT_STEP_COPY, nextStudioStep, type NextStudioStep } from "./nextStep";
import { readGuidePersistence } from "./persistence";
import { useGuideStore } from "./useGuideStore";

/**
 * The control a first-time user should use next, or null when no hint should show: hints wait
 * for the orientation tour, stay on the Render tab, skip projects that already have renders,
 * and stop for good once the first render is queued or the user hides them.
 */
export function useNextStepHint(): NextStudioStep | null {
  const hintsDone = useGuideStore((state) => state.firstRunHintsDone);
  const guideMode = useGuideStore((state) => state.mode);
  const activeTab = useCanvasStore((state) => state.activeTab);
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const skippedViewIds = useCanvasStore((state) => state.skippedViewIds);
  const hasPrompt = useGenerationSettingsStore((state) => state.prompt.trim().length > 0);
  const hasReference = useGenerationSettingsStore((state) => state.referenceImageUrls.length > 0);
  const hasRenders = useRenderJobsStore((state) => state.jobs.length > 0);

  // The tour's flag is read on render: the tour ends by returning guideMode to "idle".
  if (hintsDone || guideMode !== "idle" || activeTab !== "render" || hasRenders) return null;
  if (!readGuidePersistence().orientationDone) return null;
  const hasElevation = renderableBuildingViews(views, nodes, skippedViewIds).length > 0;
  return nextStudioStep({ hasElevation, hasReference, hasPrompt });
}

/** The class that makes a suggested control pulse. */
export function nextStepClass(active: boolean): string {
  return active ? "next-step-target" : "";
}

export function NextStepCallout({ step }: { step: NextStudioStep }) {
  const finish = useGuideStore((state) => state.finishFirstRunHints);
  const copy = NEXT_STEP_COPY[step];
  return (
    <div className="next-step-callout" role="status" aria-live="polite">
      <span className="next-step-dot" aria-hidden="true" />
      <div className="next-step-copy">
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
      </div>
      <button type="button" onClick={finish} aria-label="Hide tips">
        Hide tips
      </button>
    </div>
  );
}
