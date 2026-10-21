import { startRenderEdit, useRenderEditStore } from "../canvas/hooks/useRenderEditStore";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { pickRenderToEdit } from "../canvas/utils/pickRenderToEdit";
import { showStudioNotice } from "../shell/StudioNotice";
import { readGuidePersistence } from "./persistence";
import { useGuideStore } from "./useGuideStore";

/** True once the person has taken, skipped or dismissed the Edit tour. */
export function editTourSeen(): boolean {
  return readGuidePersistence().toursCompleted.includes("edit");
}

/**
 * Starts the Edit tour. It points at the Edit panel's controls, which only exist while a finished
 * render is open for editing, so it opens one first; with nothing rendered yet it says why not.
 */
export function startEditTour(): boolean {
  if (useRenderEditStore.getState().targetJobId === null) {
    const { jobs, activeJobId } = useRenderJobsStore.getState();
    const render = pickRenderToEdit(jobs, activeJobId, useCanvasStore.getState().activeViewId);
    if (!render) {
      showStudioNotice("Finish a render first, then take the edit tour. Edits change a finished render.");
      return false;
    }
    startRenderEdit(render.id);
  }
  useGuideStore.getState().startTour("edit");
  return true;
}
