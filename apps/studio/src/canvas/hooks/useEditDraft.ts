import {
  editPassCount,
  editRequestNeed,
  hasEnvironmentChange,
  type EditEnvironment,
  type EditNeed,
  type EditMethod,
  type EditMode,
  type EditReference,
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
  const editReferences = useGenerationSettingsStore((state) => state.editReferences);
  const scope = useGenerationSettingsStore((state) => state.editScope);
  const environment = useGenerationSettingsStore((state) => state.editEnvironment);
  const targetJobId = useRenderEditStore((state) => state.targetJobId);
  const areaPainted = useRenderEditStore((state) => hasSelection(state.strokes));
  const { areas } = useSelectionAreas();
  const render = useRenderJobsStore((state) => state.jobs.find((job) => job.id === targetJobId && job.resultImageUrl) ?? null);

  const hasArea = scope === "selection" && areaPainted;
  const prompt = method === "reference" ? "" : editPrompt.trim();
  const attached = method !== "prompt" ? editReferences : [];
  const references = attached.map((reference) => reference.url);
  // Sent only when one carries more than the default meaning, so a lone untagged reference
  // records exactly what edits always did.
  const tags: EditReference[] = attached.map(({ target, note }) => (note.trim() ? { target, note: note.trim() } : { target }));
  const tagged = tags.some((tag) => tag.target !== "look" || tag.note);
  const edit: RenderEditSettings = {
    mode: modeFor(method, hasArea),
    method,
    environment: cleanEnvironment(environment),
    ...(tagged ? { references: tags } : {}),
    // Areas and their tags only mean something alongside the selection they describe.
    ...(hasArea && areas.length > 0 ? { selectionAreas: areasForRequest(areas) } : {}),
  };
  // Checks need to know a mask will be sent; the real URL only exists once it's uploaded on Apply.
  const checked: RenderEditSettings = hasArea ? { ...edit, maskImageUrl: "selection" } : edit;

  // What is missing and which control answers it. Without a render open there is nothing to point at.
  const missing: { need: EditNeed | "render"; message: string } | null = !render
    ? { need: "render", message: "Open a finished render to edit it." }
    : scope === "selection" && !areaPainted
      ? { need: "area", message: "Select the area on the render, or switch to Whole image." }
      : editRequestNeed({ edit: checked, prompt, referenceCount: references.length });
  const problem = missing?.message ?? null;

  return {
    render,
    edit,
    prompt,
    references,
    /** The attached references with their tags, in image order. */
    referenceTags: tags,
    hasArea,
    /** What the selected areas are, as tagged, without repeats; empty without a selection. */
    selectionLabels: hasArea ? [...new Set(areas.flatMap((area) => (area.label ? [area.label] : [])))] : [],
    /** How many separate areas are selected. */
    areaCount: hasArea ? areas.length : 0,
    problem,
    /** The control to point at when the edit can't run yet; "render" when no render is open. */
    need: missing?.need ?? null,
    passes: editPassCount(checked),
    /** Settings for pricing the edit (the mask placeholder included). */
    costSettings: { referenceImageUrls: references, edit: checked },
  };
}
