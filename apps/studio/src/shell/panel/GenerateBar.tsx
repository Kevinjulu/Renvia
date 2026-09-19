import { useCallback, useEffect, useState } from "react";
import {
  renderRouteFor,
  type CreateRenderResponse,
  type RenderBudgetResponse,
  type RenderEditSettings,
} from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { useSelectionToolStore } from "../../canvas/hooks/useSelectionToolStore";
import { filledBuildingViews, nodeForView } from "../../canvas/buildingViews";
import { loadImageSize } from "../../canvas/utils/placeImageNode";
import { buildSelectionMask } from "../../canvas/utils/buildSelectionMask";

const COUNT_OPTIONS = [1, 2, 3, 4];

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function isBudgetError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

interface GenerateBarProps {
  projectId: string;
}

export function GenerateBar({ projectId }: GenerateBarProps) {
  const apiClient = useApiClient();
  const activeTab = useCanvasStore((state) => state.activeTab);
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const prompt = useGenerationSettingsStore((state) => state.prompt);
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const editMode = useGenerationSettingsStore((state) => state.editMode);
  const editAction = useGenerationSettingsStore((state) => state.editAction);
  const selectionMode = useGenerationSettingsStore((state) => state.selectionMode);
  const resolution = useGenerationSettingsStore((state) => state.resolution);
  const style = useGenerationSettingsStore((state) => state.style);
  const sourceType = useGenerationSettingsStore((state) => state.sourceType);
  const styleInfluence = useGenerationSettingsStore((state) => state.styleInfluence);
  const preserveStructure = useGenerationSettingsStore((state) => state.preserveStructure);
  const referenceImageUrls = useGenerationSettingsStore((state) => state.referenceImageUrls);
  const selection = useSelectionToolStore((state) => state.selection);
  const selectionNodeId = useSelectionToolStore((state) => state.targetNodeId);
  const addJob = useRenderJobsStore((state) => state.addJob);
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [budget, setBudget] = useState<RenderBudgetResponse | null>(null);

  const refreshBudget = useCallback(() => {
    apiClient
      .getRenderBudget()
      .then(setBudget)
      .catch(() => setBudget(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(refreshBudget, [refreshBudget]);

  const isEdit = activeTab === "edit";
  const filled = filledBuildingViews(views, nodes);
  const editNode = nodeForView(nodes, activeViewId);
  const editView = views.find((view) => view.id === activeViewId);
  // A selection only applies to the image it was drawn on.
  const editSelection = selection && editNode && selectionNodeId === editNode.id ? selection : null;

  const remainingUsd = budget ? Math.max(0, budget.budgetUsd - budget.spentUsd) : 0;
  const renderImageCount = filled.length * count;
  const imageCount = isEdit ? 1 : renderImageCount;
  const route = isEdit
    ? renderRouteFor({ referenceImageUrls, edit: { mode: editMode } })
    : renderRouteFor({ sourceType, referenceImageUrls });
  const estimateUsd = budget ? imageCount * budget.pricing[route] : 0;
  const isOverBudget = budget !== null && budget.mode !== "mock" && estimateUsd > remainingUsd;
  const hasTarget = isEdit ? Boolean(editNode) : filled.length > 0;
  const canSubmit = hasTarget && !isSubmitting && !isOverBudget;

  const viewWord = filled.length === 1 ? "view" : "views";
  const buttonLabel = (() => {
    if (isSubmitting) return isEdit ? "Applying…" : "Queuing…";
    if (isOverBudget) return "Over render budget";
    if (isEdit) return "Apply edit";
    if (filled.length === 0) return "Generate";
    if (count === 1) return `Generate ${filled.length} ${viewWord}`;
    return `Generate ${filled.length} ${viewWord} × ${count}`;
  })();

  const handleGenerate = async () => {
    if (filled.length === 0) return;
    setIsSubmitting(true);
    setStatus(null);
    const generationSettings = {
      sourceType,
      styleInfluence,
      preserveStructure,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    };
    try {
      const requests = filled.flatMap((view) => {
        const node = nodeForView(nodes, view.id);
        if (!node) return [];
        return Array.from({ length: count }, () =>
          apiClient.createRender({
            projectId,
            sourceImageUrl: node.imageUrl,
            prompt: prompt.trim(),
            resolution,
            style,
            viewKey: view.id,
            viewLabel: view.label,
            generationSettings,
          }),
        );
      });
      const results = await Promise.allSettled(requests);
      const queued = results.filter(
        (result): result is PromiseFulfilledResult<CreateRenderResponse> => result.status === "fulfilled",
      );
      queued.forEach(({ value }) => addJob(value.job));

      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected.some(({ reason }) => isBudgetError(reason))) {
        setStatus(`Render budget reached — ${queued.length} of ${results.length} queued.`);
      } else if (rejected.length > 0) {
        setStatus(`Couldn't queue ${rejected.length} of ${results.length} renders. Try again in a moment.`);
      }
    } finally {
      setIsSubmitting(false);
      refreshBudget();
    }
  };

  const handleEditApply = async () => {
    if (!editNode) return;
    const action = editMode === "prompt" ? undefined : (editAction ?? undefined);
    if (!editPrompt.trim() && referenceImageUrls.length === 0) {
      setStatus("Describe an edit or attach a reference first.");
      return;
    }
    if (selectionMode === "manual" && !editSelection) {
      setStatus("Draw a selection on the image first, or switch to Auto select.");
      return;
    }

    setIsSubmitting(true);
    setStatus(null);
    try {
      const edit: RenderEditSettings = { mode: editMode, action };
      if (editSelection) {
        const naturalSize = await loadImageSize(editNode.imageUrl);
        const mask = await buildSelectionMask(editSelection, editNode, naturalSize);
        const { publicUrl } = await apiClient.uploadImage(new File([mask], "mask.png", { type: "image/png" }));
        edit.maskImageUrl = publicUrl;
      }

      const { job } = await apiClient.createRender({
        projectId,
        sourceImageUrl: editNode.imageUrl,
        prompt: editPrompt.trim(),
        resolution,
        style,
        viewKey: editView?.id,
        viewLabel: editView?.label,
        generationSettings: {
          styleInfluence,
          preserveStructure,
          referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          edit,
        },
      });
      addJob(job);
    } catch (error) {
      setStatus(isBudgetError(error) ? "Render budget reached — edit not applied." : "Couldn't apply the edit. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
      refreshBudget();
    }
  };

  const costLine = (() => {
    if (!budget || !hasTarget) return null;
    if (budget.mode === "mock") {
      return `Mock mode · ${imageCount} placeholder ${imageCount === 1 ? "image" : "images"}, no credit used`;
    }
    const scope = isEdit ? (editSelection ? "Selected area" : "1 edit") : `${imageCount} ${imageCount === 1 ? "image" : "images"}`;
    return `${scope} ≈ ${formatUsd(estimateUsd)} · ${formatUsd(remainingUsd)} left`;
  })();

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            if (isEdit) void handleEditApply();
            else void handleGenerate();
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7l4.1-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          {buttonLabel}
        </button>
        {!isEdit && (
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            aria-label="Number of variations per view"
            className="rounded-lg border border-hairline px-2 py-2.5 text-sm text-primary"
          >
            {COUNT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
      </div>
      {costLine && <p className={`mt-2 text-xs ${isOverBudget ? "text-red-500" : "text-muted"}`}>{costLine}</p>}
      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
    </div>
  );
}
