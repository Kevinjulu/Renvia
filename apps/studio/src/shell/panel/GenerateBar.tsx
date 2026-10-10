import { useCallback, useEffect, useState } from "react";
import {
  baseCreditCostForRender,
  renderRouteFor,
  suggestedEditPartForPrompt,
  type CreateRenderResponse,
  type RenderBudgetResponse,
  type MeResponse,
} from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { limitRefusal, type LimitRefusal } from "../../components/LimitDialog";
import { reportLimit, useLimitDialogStore } from "../../lib/useLimitDialog";
import { refreshAccount, useAccountStore } from "../../lib/useAccountStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { buildStrokeMask, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { useEditDraft } from "../../canvas/hooks/useEditDraft";
import { queueRender, RenderNotConfirmedError } from "../../canvas/utils/queueRender";
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

const SLOW_STATUS = "Renvia is responding slowly — checking whether your render started…";
const NOT_CONFIRMED_STATUS =
  "Renvia didn't confirm it in time. Check the results panel before trying again — clicking again with the same settings won't charge twice.";

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
  const prompt = useGenerationSettingsStore((state) => state.prompt);
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
  // Edits only ever change a finished render open in the viewer.
  const draft = useEditDraft();
  const editRender = draft.render;

  const remainingUsd = budget ? Math.max(0, budget.budgetUsd - budget.spentUsd) : 0;
  const renderImageCount = filled.length * count;
  const imageCount = isEdit ? 1 : renderImageCount;
  // The source kind (photo or line drawing) is detected by the server; both cost the same.
  const costSettings = isEdit
    ? draft.costSettings
    : {
        referenceImageUrls,
        fidelity: referenceImageUrls.length > 0 ? { mode: fidelityMode, protectedFeatures: protectedGeometry } : undefined,
      };
  const route = renderRouteFor(costSettings);
  // A two-pass edit's environment pass runs on the single-image edit model.
  const estimateUsd = budget ? imageCount * budget.pricing[route] + (isEdit && draft.passes > 1 ? budget.pricing.edit : 0) : 0;
  const isOverBudget = budget !== null && budget.mode !== "mock" && estimateUsd > remainingUsd;
  const creditsPerImage = me?.creditsPerImage ?? 1;
  const creditsNeeded = imageCount * baseCreditCostForRender(costSettings) * creditsPerImage;
  const creditBalance = me?.creditBalance ?? 0;
  const isOutOfCredits = me !== null && !isAdmin && creditsNeeded > creditBalance;
  const isDisabled = me?.disabled ?? false;
  const isMaintenance = Boolean(me?.maintenanceRenders) && !isAdmin;
  const hasTarget = isEdit ? editRender !== null : filled.length > 0;
  const editProblem = isEdit ? draft.problem : null;

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
  const canSubmit = hasTarget && !isSubmitting && !editProblem;

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
      settings.setEditMethod("prompt");
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
        return Array.from({ length: count }, (_, variation) =>
          queueRender(
            apiClient.createRender,
            {
              projectId,
              sourceImageUrl: node.imageUrl,
              prompt: prompt.trim(),
              aspectRatio,
              style,
              viewKey: view.id,
              viewLabel: view.label,
              generationSettings: { ...generationSettings, seed: seedUses++ === 0 ? generationSettings.seed : undefined },
            },
            { slot: `${view.id}#${variation}`, onSlow: () => setStatus(SLOW_STATUS) },
          ),
        );
      });
      const results = await Promise.allSettled(requests);
      const queued = results.filter(
        (result): result is PromiseFulfilledResult<CreateRenderResponse> => result.status === "fulfilled",
      );
      queued.forEach(({ value }) => addJob(value.job));

      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const unconfirmed = rejected.filter(({ reason }) => reason instanceof RenderNotConfirmedError).length;
      const blocking = rejected.map(({ reason }) => limitRefusal(reason)).find(Boolean);
      if (blocking) showLimit(blocking);
      const refusal = rejected
        .map(({ reason }) => refusalMessage(errorCode(reason), me?.maintenanceMessage))
        .find(Boolean);
      if (refusal) {
        setStatus(`${refusal} ${queued.length} of ${results.length} renders queued.`);
      } else if (unconfirmed > 0) {
        setStatus(results.length > 1 ? `${queued.length} of ${results.length} renders queued. ${NOT_CONFIRMED_STATUS}` : NOT_CONFIRMED_STATUS);
      } else if (rejected.length > 0) {
        setStatus(`Couldn't queue ${rejected.length} of ${results.length} renders. Try again in a moment.`);
      } else if (seed !== null && results.length > 1) {
        setStatus("Look kept for the first image; the rest are fresh takes.");
      } else {
        // Clears the "responding slowly" note once everything got through.
        setStatus(null);
      }
    } finally {
      setIsSubmitting(false);
      refreshAfterSubmit();
    }
  };

  const handleEditApply = async () => {
    if (!editRender?.resultImageUrl || draft.problem) return;
    const sourceImageUrl = editRender.resultImageUrl;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const edit = { ...draft.edit };
      // A selected area limits the edit; Whole image sends no mask at all.
      if (draft.hasArea) {
        const naturalSize = await loadImageSize(sourceImageUrl);
        const mask = naturalSize ? await buildStrokeMask(renderStrokes, naturalSize) : null;
        if (!mask) throw new Error("Couldn't read the selected area");
        const { publicUrl } = await apiClient.uploadImage(new File([mask], "mask.png", { type: "image/png" }));
        edit.maskImageUrl = publicUrl;
      }

      // "style" tells the model what look to preserve: the style this render was made in.
      const generationSettings = {
        // The Edit tab's own strength control — the Render tab's styleInfluence and
        // preserveStructure never reach an edit (see engine.ts).
        editInfluence,
        referenceImageUrls: draft.references.length > 0 ? draft.references : undefined,
        seed: seed ?? undefined,
        edit,
      };
      const { job } = await queueRender(
        apiClient.createRender,
        {
          projectId,
          sourceImageUrl,
          prompt: draft.prompt,
          aspectRatio,
          style: editRender.style,
          viewKey: editRender.viewKey ?? undefined,
          viewLabel: editRender.viewLabel ?? undefined,
          generationSettings,
        },
        {
          slot: `edit:${editRender.id}`,
          // The mask is re-uploaded each click, so it can't tell a repeat apart; the painted area can.
          signature: JSON.stringify({ prompt: draft.prompt, ...generationSettings, edit: draft.edit, area: draft.hasArea ? renderStrokes.length : 0 }),
          onSlow: () => setStatus(SLOW_STATUS),
        },
      );
      setStatus(null);
      addJob(job);
      useRenderEditStore.getState().setAwaitingJob(job.id);
    } catch (error) {
      if (error instanceof RenderNotConfirmedError) {
        setStatus(NOT_CONFIRMED_STATUS);
        return;
      }
      reportLimit(error);
      const code = errorCode(error);
      const refusal = code === "invalid_edit" && error instanceof ApiError ? error.detail : refusalMessage(code, me?.maintenanceMessage);
      setStatus(refusal ? `${refusal} The edit wasn't applied.` : "Couldn't apply the edit. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
      refreshAfterSubmit();
    }
  };

  const scope = isEdit ? (draft.passes > 1 ? "2 steps" : draft.hasArea ? "Selected area" : "1 edit") : plural(imageCount, "image");
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
      {editProblem && hasTarget && !status && <p className="mt-2 text-xs text-muted">{editProblem}</p>}
      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
    </div>
  );
}
