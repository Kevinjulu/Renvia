import {
  editPassCount,
  editRequestProblem,
  hasEnvironmentChange,
  type EditEnvironment,
  type EditMethod,
  type EditMode,
  type RenderEditSettings,
} from "@renvia/types";
import { useGenerationSettingsStore } from "./useGenerationSettingsStore";
import { hasSelection, useRenderEditStore } from "./useRenderEditStore";
import { useRenderJobsStore } from "./useRenderJobsStore";
import { areasForRequest, useSelectionAreas } from "../utils/selectionAreas";

/** The older `mode` the API still records next to `method`. */
function modeFor(method: EditMethod, hasArea: boolean): EditMode {
  if (method === "prompt") return "prompt";
  return hasArea ? "element" : "building";
}

/** The environment without unset fields, or undefined when nothing changes. */
function cleanEnvironment(environment: EditEnvironment): EditEnvironment | undefined {
  return hasEnvironmentChange(environment) ? environment : undefined;
}

/**
 * The edit the Edit tab currently describes, as the API will receive it, plus what's missing
 * and how many passes it takes. The panel's summary and the Apply button both read this, so
 * they can never disagree about what will happen.
 */
export function useEditDraft() {
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const method = useGenerationSettingsStore((state) => state.editMethod);
  const referenceUrl = useGenerationSettingsStore((state) => state.editReferenceUrl);
  const scope = useGenerationSettingsStore((state) => state.editScope);
  const environment = useGenerationSettingsStore((state) => state.editEnvironment);
  const targetJobId = useRenderEditStore((state) => state.targetJobId);
  const areaPainted = useRenderEditStore((state) => hasSelection(state.strokes));
  const { areas } = useSelectionAreas();
  const render = useRenderJobsStore((state) => state.jobs.find((job) => job.id === targetJobId && job.resultImageUrl) ?? null);

  const hasArea = scope === "selection" && areaPainted;
  const prompt = method === "reference" ? "" : editPrompt.trim();
  const references = method !== "prompt" && referenceUrl ? [referenceUrl] : [];
  const edit: RenderEditSettings = {
    mode: modeFor(method, hasArea),
    method,
    environment: cleanEnvironment(environment),
    // Areas and their tags only mean something alongside the selection they describe.
    ...(hasArea && areas.length > 0 ? { selectionAreas: areasForRequest(areas) } : {}),
  };
  // Checks need to know a mask will be sent; the real URL only exists once it's uploaded on Apply.
  const checked: RenderEditSettings = hasArea ? { ...edit, maskImageUrl: "selection" } : edit;

  const problem = !render
    ? "Open a finished render to edit it."
    : scope === "selection" && !areaPainted
      ? "Select the area on the render, or switch to Whole image."
      : editRequestProblem({ edit: checked, prompt, referenceCount: references.length });

  return {
    render,
    edit,
    prompt,
    references,
    hasArea,
    /** What the selected areas are, as tagged, without repeats; empty without a selection. */
    selectionLabels: hasArea ? [...new Set(areas.flatMap((area) => (area.label ? [area.label] : [])))] : [],
    /** How many separate areas are selected. */
    areaCount: hasArea ? areas.length : 0,
    problem,
    passes: editPassCount(checked),
    /** Settings for pricing the edit (the mask placeholder included). */
    costSettings: { referenceImageUrls: references, edit: checked },
  };
}
