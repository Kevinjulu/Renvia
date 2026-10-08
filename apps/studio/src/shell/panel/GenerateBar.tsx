import { useCallback, useEffect, useState } from "react";
import {
  baseCreditCostForRender,
  renderRouteFor,
  suggestedEditPartForPrompt,
  type CreateRenderResponse,
  type RenderBudgetResponse,
  type RenderEditSettings,
  type MeResponse,
} from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { limitRefusal, type LimitRefusal } from "../../components/LimitDialog";
import { reportLimit, useLimitDialogStore } from "../../lib/useLimitDialog";
import { refreshAccount, useAccountStore } from "../../lib/useAccountStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { buildStrokeMask, hasSelection, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { nodeForView, renderableBuildingViews } from "../../canvas/buildingViews";
import { loadImageSize } from "../../canvas/utils/placeImageNode";

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
  if (code === "monthly_limit_reached") return "You've reached this month's render or selection limit.";
  if (code === "concurrency_limit_reached") return "Your current renders are still running. Wait for one to finish before starting another.";
  if (code === "maintenance") return maintenanceMessage?.trim() || "Renders are temporarily paused for maintenance.";
  if (code === "segmentation_failed") return "Automatic selection failed. Try again or switch to Manual.";
  return null;
}

/**
 * A refusal we can see coming without asking the server — the Generate button stays
 * clickable for these so the dialog can explain what's blocking them.
 */
function localRefusal(
  code: LimitRefusal["code"],
  messages: MeResponse["limitMessages"] | undefined,
  limit: number | null = null,
  used: number | null = null,
): LimitRefusal {
  return { code, message: messages?.[code] ?? null, limit, used };
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
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);
  const views = useCanvasStore((state) => state.views);
  const skippedViewIds = useCanvasStore((state) => state.skippedViewIds);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const prompt = useGenerationSettingsStore((state) => state.prompt);
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const editMode = useGenerationSettingsStore((state) => state.editMode);
  const editAction = useGenerationSettingsStore((state) => state.editAction);
  const aspectRatio = useGenerationSettingsStore((state) => state.aspectRatio);
  const style = useGenerationSettingsStore((state) => state.style);
  const styleInfluence = useGenerationSettingsStore((state) => state.styleInfluence);
  const editInfluence = useGenerationSettingsStore((state) => state.editInfluence);
  const preserveStructure = useGenerationSettingsStore((state) => state.preserveStructure);
  const fidelityMode = useGenerationSettingsStore((state) => state.fidelityMode);
  const protectedGeometry = useGenerationSettingsStore((state) => state.protectedGeometry);
  const geometryReviewedAt = useGenerationSettingsStore((state) => state.geometryReviewedAt);
  const referenceImageUrls = useGenerationSettingsStore((state) => state.referenceImageUrls);
  const seed = useGenerationSettingsStore((state) => state.seed);
  const addJob = useRenderJobsStore((state) => state.addJob);
  const jobs = useRenderJobsStore((state) => state.jobs);
  const editTargetJobId = useRenderEditStore((state) => state.targetJobId);
  const renderStrokes = useRenderEditStore((state) => state.strokes);
  const failedJobCount = useRenderJobsStore((state) => state.jobs.filter((job) => job.status === "failed").length);
  const me = useAccountStore((state) => state.me);
  const isAdmin = me?.role === "admin";
  // One image per elevation unless the user asks for more variations.
  const [count, setCount] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [budget, setBudget] = useState<RenderBudgetResponse | null>(null);
  const showLimit = useLimitDialogStore((state) => state.show);
  const setCreditsOpen = useLimitDialogStore((state) => state.setCreditsOpen);

  // The global fal budget is admin-only; everyone else sees their own credits.
  const refreshBudget = useCallback(() => {
    if (!isAdmin) return;
    apiClient
      .getRenderBudget()
      .then(setBudget)
      .catch(() => setBudget(null));
  }, [apiClient, isAdmin]);

  const refreshAfterSubmit = () => {
    refreshBudget();
    void refreshAccount(apiClient.getMe);
  };

  useEffect(refreshBudget, [refreshBudget]);

  // A failed render refunds its credits server-side; pull the new balance.
  useEffect(() => {
    if (failedJobCount > 0) void refreshAccount(apiClient.getMe);
  }, [apiClient, failedJobCount]);

  const isEdit = activeTab === "edit";
  const filled = renderableBuildingViews(views, nodes, skippedViewIds);
  const editNode = nodeForView(nodes, activeViewId);
  const editView = views.find((view) => view.id === activeViewId);
  // A render open in the viewer's edit mode takes over from the canvas image as the edit target.
  const editRender = jobs.find((job) => job.id === editTargetJobId && job.resultImageUrl) ?? null;
  // An area can only be painted on a render open in the viewer.
  const hasEditSelection = editRender ? hasSelection(renderStrokes) : false;

  const remainingUsd = budget ? Math.max(0, budget.budgetUsd - budget.spentUsd) : 0;
  const renderImageCount = filled.length * count;
  const imageCount = isEdit ? 1 : renderImageCount;
  // The source kind (photo or line drawing) is detected by the server; both cost the same.
  const costSettings = isEdit
    ? { referenceImageUrls, edit: { mode: editMode } }
    : {
        referenceImageUrls,
        fidelity: referenceImageUrls.length > 0 ? { mode: fidelityMode, protectedFeatures: protectedGeometry } : undefined,
      };
  const route = renderRouteFor(costSettings);
  const estimateUsd = budget ? imageCount * budget.pricing[route] : 0;
  const isOverBudget = budget !== null && budget.mode !== "mock" && estimateUsd > remainingUsd;
  const creditsPerImage = me?.creditsPerImage ?? 1;
  const creditsNeeded = imageCount * baseCreditCostForRender(costSettings) * creditsPerImage;
  const creditBalance = me?.creditBalance ?? 0;
  const isOutOfCredits = me !== null && !isAdmin && creditsNeeded > creditBalance;
  const isDisabled = me?.disabled ?? false;
  const isMaintenance = Boolean(me?.maintenanceRenders) && !isAdmin;
  const hasTarget = isEdit ? Boolean(editRender ?? editNode) : filled.length > 0;

  // The first reason this request would be refused, or null when it should go through.
  // The button stays enabled for these so clicking opens the dialog rather than doing nothing.
  const blocked: LimitRefusal | null = isDisabled
    ? localRefusal("account_disabled", me?.limitMessages)
    : isMaintenance
      ? localRefusal("maintenance", me?.limitMessages)
      : isOutOfCredits
        ? localRefusal("insufficient_credits", me?.limitMessages, creditsNeeded, creditBalance)
        : isOverBudget
          ? localRefusal("budget_exhausted", me?.limitMessages)
          : null;
  const canSubmit = hasTarget && !isSubmitting;

  const viewWord = filled.length === 1 ? "elevation" : "elevations";
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
    const suggestedEditPart = suggestedEditPartForPrompt(prompt);
    if (suggestedEditPart) {
      const settings = useGenerationSettingsStore.getState();
      settings.setEditPrompt(prompt);
      settings.setEditAction("change");
      setActiveTab("edit");
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    const generationSettings = {
      styleInfluence,
      preserveStructure,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      fidelity: referenceImageUrls.length > 0
        ? { mode: fidelityMode, protectedFeatures: protectedGeometry, ...(geometryReviewedAt ? { reviewedAt: geometryReviewedAt } : {}) }
        : undefined,
      seed: seed ?? undefined,
    };
    try {
      // A locked seed reproduces the same image for every view/variation it's applied to —
      // fine for one view, but "×N variations" and a locked seed contradict each other, so
      // only the first request keeps it and the rest fall back to random.
      let seedUses = 0;
      const requests = filled.flatMap((view) => {
        const node = nodeForView(nodes, view.id);
        if (!node) return [];
        return Array.from({ length: count }, () =>
          apiClient.createRender({
            projectId,
            sourceImageUrl: node.imageUrl,
            prompt: prompt.trim(),
            aspectRatio,
            style,
            viewKey: view.id,
            viewLabel: view.label,
            generationSettings: { ...generationSettings, seed: seedUses++ === 0 ? generationSettings.seed : undefined },
          }),
        );
      });
      const results = await Promise.allSettled(requests);
      const queued = results.filter(
        (result): result is PromiseFulfilledResult<CreateRenderResponse> => result.status === "fulfilled",
      );
      queued.forEach(({ value }) => addJob(value.job));

      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const blocking = rejected.map(({ reason }) => limitRefusal(reason)).find(Boolean);
      if (blocking) showLimit(blocking);
      const refusal = rejected
        .map(({ reason }) => refusalMessage(errorCode(reason), me?.maintenanceMessage))
        .find(Boolean);
      if (refusal) {
        setStatus(`${refusal} ${queued.length} of ${results.length} renders queued.`);
      } else if (rejected.length > 0) {
        setStatus(`Couldn't queue ${rejected.length} of ${results.length} renders. Try again in a moment.`);
      } else if (seed !== null && results.length > 1) {
        setStatus("Look kept for the first image; the rest are fresh takes.");
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
    setIsSubmitting(true);
    setStatus(null);
    try {
      const edit: RenderEditSettings = { mode: editMode, action };
      let maskFile: File | null = null;

      // An area painted on the render limits the edit; with nothing painted it applies to the whole image.
      if (editRender && hasEditSelection) {
        const naturalSize = await loadImageSize(sourceImageUrl);
        const mask = naturalSize ? await buildStrokeMask(renderStrokes, naturalSize) : null;
        if (mask) maskFile = new File([mask], "mask.png", { type: "image/png" });
      }

      if (maskFile) {
        const { publicUrl } = await apiClient.uploadImage(maskFile);
        edit.maskImageUrl = publicUrl;
      }

      // "style" tells the model what look to preserve — that's the style the image on screen
      // actually was rendered in, not whatever the Render tab's dropdown happens to be set to
      // right now (unrelated, and often left over from a different elevation).
      const { job } = await apiClient.createRender({
        projectId,
        sourceImageUrl,
        prompt: editPrompt.trim(),
        aspectRatio,
        style: editRender ? editRender.style : "Photorealistic",
        viewKey: editRender ? (editRender.viewKey ?? undefined) : editView?.id,
        viewLabel: editRender ? (editRender.viewLabel ?? undefined) : editView?.label,
        generationSettings: {
          // The Edit tab's own strength control — the Render tab's styleInfluence and
          // preserveStructure never reach an edit (see engine.ts).
          editInfluence,
          referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          seed: seed ?? undefined,
          edit,
        },
      });
      addJob(job);
      if (editRender) useRenderEditStore.getState().setAwaitingJob(job.id);
    } catch (error) {
      reportLimit(error);
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
  // Nudge before they run out, at the threshold the operator set.
  const lowCreditThreshold = me?.limits.lowCreditThreshold ?? 0;
  const lowCredits =
    !isAdmin && !isOutOfCredits && lowCreditThreshold > 0 && me !== null && creditBalance <= lowCreditThreshold;

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            if (blocked) {
              showLimit(blocked);
              return;
            }
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
            aria-label="Variations per elevation"
            title="Variations per elevation"
            className="rounded-lg border border-hairline px-2 py-2.5 text-sm text-primary"
          >
            {COUNT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                ×{option}
              </option>
            ))}
          </select>
        )}
      </div>
      {costLine && <p className={`mt-2 text-xs ${costIsBlocking ? "text-red-500" : "text-muted"}`}>{costLine}</p>}
      {lowCredits && (
        <p className="mt-2 text-xs text-amber-700">
          {plural(creditBalance, "credit")} left —{" "}
          <button type="button" onClick={() => setCreditsOpen(true)} className="font-medium underline">
            view credits
          </button>
        </p>
      )}
      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
    </div>
  );
}
