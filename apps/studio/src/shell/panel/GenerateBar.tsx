import { useCallback, useEffect, useState } from "react";
import {
  renderRouteFor,
  type CreateRenderResponse,
  type RenderBudgetResponse,
  type RenderEditSettings,
} from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { refreshAccount, useAccountStore } from "../../lib/useAccountStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { useSelectionToolStore } from "../../canvas/hooks/useSelectionToolStore";
import { buildStrokeMask, hasSelection, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { filledBuildingViews, nodeForView } from "../../canvas/buildingViews";
import { loadImageSize } from "../../canvas/utils/placeImageNode";
import { buildSelectionMask } from "../../canvas/utils/buildSelectionMask";

const COUNT_OPTIONS = [1, 2, 3, 4];

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** User-facing reason a request was refused, or null for a generic failure. */
function refusalMessage(code: string | null, maintenanceMessage?: string | null): string | null {
  if (code === "insufficient_credits") return "You're out of credits.";
  if (code === "budget_exhausted") return "Rendering is paused — the demo budget is used up.";
  if (code === "account_disabled") return "Your account is disabled. Contact support.";
  if (code === "daily_limit_reached") return "You've reached today's render or selection limit. Try again tomorrow.";
  if (code === "maintenance") return maintenanceMessage?.trim() || "Renders are temporarily paused for maintenance.";
  if (code === "segmentation_failed") return "Automatic selection failed. Try again or switch to Manual.";
  return null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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
  const jobs = useRenderJobsStore((state) => state.jobs);
  const editTargetJobId = useRenderEditStore((state) => state.targetJobId);
  const renderStrokes = useRenderEditStore((state) => state.strokes);
  const failedJobCount = useRenderJobsStore((state) => state.jobs.filter((job) => job.status === "failed").length);
  const me = useAccountStore((state) => state.me);
  const isAdmin = me?.role === "admin";
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [budget, setBudget] = useState<RenderBudgetResponse | null>(null);

  // The global fal budget is admin-only; everyone else sees their own credits.
  const refreshBudget = useCallback(() => {
    if (!isAdmin) return;
    apiClient
      .getRenderBudget()
      .then(setBudget)
      .catch(() => setBudget(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const refreshAfterSubmit = () => {
    refreshBudget();
    void refreshAccount(apiClient.getMe);
  };

  useEffect(refreshBudget, [refreshBudget]);

  // A failed render refunds its credits server-side; pull the new balance.
  useEffect(() => {
    if (failedJobCount > 0) void refreshAccount(apiClient.getMe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedJobCount]);

  const isEdit = activeTab === "edit";
  const filled = filledBuildingViews(views, nodes);
  const editNode = nodeForView(nodes, activeViewId);
  const editView = views.find((view) => view.id === activeViewId);
  // A selection only applies to the image it was drawn on.
  const editSelection = selection && editNode && selectionNodeId === editNode.id ? selection : null;
  // A render open in the viewer's edit mode takes over from the canvas image as the edit target.
  const editRender = jobs.find((job) => job.id === editTargetJobId && job.resultImageUrl) ?? null;
  const hasEditSelection = editRender ? hasSelection(renderStrokes) : Boolean(editSelection);

  const remainingUsd = budget ? Math.max(0, budget.budgetUsd - budget.spentUsd) : 0;
  const renderImageCount = filled.length * count;
  const imageCount = isEdit ? 1 : renderImageCount;
  const route = isEdit
    ? renderRouteFor({ referenceImageUrls, edit: { mode: editMode } })
    : renderRouteFor({ sourceType, referenceImageUrls });
  const estimateUsd = budget ? imageCount * budget.pricing[route] : 0;
  const isOverBudget = budget !== null && budget.mode !== "mock" && estimateUsd > remainingUsd;
  const creditsPerImage = me?.creditsPerImage ?? 1;
  const creditsNeeded = imageCount * creditsPerImage;
  const creditBalance = me?.creditBalance ?? 0;
  const isOutOfCredits = me !== null && !isAdmin && creditsNeeded > creditBalance;
  const isDisabled = me?.disabled ?? false;
  const isMaintenance = Boolean(me?.maintenanceRenders) && !isAdmin;
  const isSegMaintenance = Boolean(me?.maintenanceSegments) && !isAdmin;
  const hasTarget = isEdit ? Boolean(editRender ?? editNode) : filled.length > 0;
  const canSubmit = hasTarget && !isSubmitting && !isOverBudget && !isOutOfCredits && !isDisabled && !isMaintenance;

  const viewWord = filled.length === 1 ? "view" : "views";
  const buttonLabel = (() => {
    if (isSubmitting) return isEdit ? "Applying…" : "Queuing…";
    if (isDisabled) return "Account disabled";
    if (isMaintenance) return "Temporarily unavailable";
    if (isOverBudget) return "Over render budget";
    if (isOutOfCredits) return creditBalance === 0 ? "Out of credits" : "Not enough credits";
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
      const refusal = rejected
        .map(({ reason }) => refusalMessage(errorCode(reason), me?.maintenanceMessage))
        .find(Boolean);
      if (refusal) {
        setStatus(`${refusal} ${queued.length} of ${results.length} renders queued.`);
      } else if (rejected.length > 0) {
        setStatus(`Couldn't queue ${rejected.length} of ${results.length} renders. Try again in a moment.`);
      }
    } finally {
      setIsSubmitting(false);
      refreshAfterSubmit();
    }
  };

  const handleEditApply = async () => {
    const sourceImageUrl = editRender?.resultImageUrl ?? editNode?.imageUrl;
    if (!sourceImageUrl) return;
    const action = editMode === "prompt" ? undefined : (editAction ?? undefined);
    if (!editPrompt.trim() && referenceImageUrls.length === 0) {
      setStatus("Describe an edit or attach a reference first.");
      return;
    }
    if (selectionMode === "manual" && !hasEditSelection) {
      setStatus(editRender ? "Paint over the area to change first, or switch to Auto select." : "Draw a selection on the image first, or switch to Auto select.");
      return;
    }
    if (selectionMode === "auto" && !editPrompt.trim()) {
      setStatus("Describe what to select (e.g. windows), or switch to Manual.");
      return;
    }
    if (selectionMode === "auto" && isSegMaintenance) {
      setStatus(me?.maintenanceMessage?.trim() || "Automatic selections are temporarily paused for maintenance.");
      return;
    }

    setIsSubmitting(true);
    setStatus(null);
    try {
      const edit: RenderEditSettings = { mode: editMode, action };
      let maskFile: File | null = null;

      if (selectionMode === "auto") {
        const segment = await apiClient.createSegmentation({
          imageUrl: sourceImageUrl,
          prompt: editPrompt.trim(),
        });
        void refreshAccount(apiClient.getMe);
        if (!segment.objectCount || !segment.maskDataUrl) {
          setStatus("Nothing matched that selection. Try a clearer description or switch to Manual.");
          return;
        }
        const response = await fetch(segment.maskDataUrl);
        const blob = await response.blob();
        maskFile = new File([blob], "mask.png", { type: "image/png" });
      } else {
        const naturalSize = hasEditSelection ? await loadImageSize(sourceImageUrl) : null;
        const mask = !naturalSize
          ? null
          : editRender
            ? await buildStrokeMask(renderStrokes, naturalSize)
            : editSelection && editNode
              ? await buildSelectionMask(editSelection, editNode, naturalSize)
              : null;
        if (mask) maskFile = new File([mask], "mask.png", { type: "image/png" });
      }

      if (maskFile) {
        const { publicUrl } = await apiClient.uploadImage(maskFile);
        edit.maskImageUrl = publicUrl;
      }

      const { job } = await apiClient.createRender({
        projectId,
        sourceImageUrl,
        prompt: editPrompt.trim(),
        resolution,
        style,
        viewKey: editRender ? (editRender.viewKey ?? undefined) : editView?.id,
        viewLabel: editRender ? (editRender.viewLabel ?? undefined) : editView?.label,
        generationSettings: {
          styleInfluence,
          preserveStructure,
          referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          edit,
        },
      });
      addJob(job);
      if (editRender) useRenderEditStore.getState().setAwaitingJob(job.id);
    } catch (error) {
      const refusal = refusalMessage(errorCode(error), me?.maintenanceMessage);
      setStatus(refusal ? `${refusal} The edit wasn't applied.` : "Couldn't apply the edit. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
      refreshAfterSubmit();
    }
  };

  const scope = isEdit ? (hasEditSelection ? "Selected area" : "1 edit") : plural(imageCount, "image");
  const costLine = (() => {
    if (!hasTarget || !me) return null;
    if (isMaintenance) {
      return me.maintenanceMessage?.trim() || "Renders are temporarily paused for maintenance.";
    }
    if (isAdmin) {
      // Admins aren't charged credits; show the real fal spend against the global cap.
      if (!budget) return null;
      if (budget.mode === "mock") return `Admin · mock mode, ${scope.toLowerCase()} at no cost`;
      return `Admin · ${scope} ≈ ${formatUsd(estimateUsd)} · ${formatUsd(remainingUsd)} of budget left`;
    }
    return `${scope} · ${plural(creditsNeeded, "credit")} · ${plural(creditBalance, "credit")} left`;
  })();
  const costIsBlocking = isOverBudget || isOutOfCredits || isMaintenance;

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
      {costLine && <p className={`mt-2 text-xs ${costIsBlocking ? "text-red-500" : "text-muted"}`}>{costLine}</p>}
      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
    </div>
  );
}
