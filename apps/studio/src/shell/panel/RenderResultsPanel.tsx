import { useEffect, useState } from "react";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { useRenderJobsStore, type ClientRenderJob } from "../../canvas/hooks/useRenderJobsStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { nodeToPersistedData, setImageAsBaseNode } from "../../canvas/utils/placeImageNode";
import { useAutoShowFinishedRender, useRenderJobsPolling } from "../../canvas/hooks/useRenderJobsPolling";
import { startRenderEdit } from "../../canvas/hooks/useRenderEditStore";
import { viewImage } from "../../canvas/utils/viewImage";
import { formatAspectRatio } from "../../canvas/utils/aspectRatio";
import { buildRetryRequest } from "../../canvas/utils/retryRender";
import { useApiClient } from "../../lib/apiClient";
import { reportLimit } from "../../lib/useLimitDialog";
import { filledBuildingViews, nodeForView } from "../../canvas/buildingViews";
import { useGuideStore } from "../../guide/useGuideStore";

const PROGRESS_CEILING = 92;

function jobProgress(job: ClientRenderJob, now: number): number {
  if (job.status === "succeeded" || job.status === "failed") return 100;
  const anchor = job.status === "processing" ? job.updatedAt : job.createdAt;
  const elapsedSeconds = Math.max(0, (now - new Date(anchor).getTime()) / 1000);
  const base = job.status === "pending" ? 6 : 15;
  return Math.min(PROGRESS_CEILING, base + (PROGRESS_CEILING - base) * (1 - Math.exp(-elapsedSeconds / 18)));
}

function downloadImage(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function RenderResultsPanel() {
  useRenderJobsPolling();
  useAutoShowFinishedRender();
  const apiClient = useApiClient();

  const nodes = useCanvasStore((state) => state.nodes);
  const views = useCanvasStore((state) => state.views);
  const selectView = useCanvasStore((state) => state.selectView);
  const jobs = useRenderJobsStore((state) => state.jobs);
  const addJob = useRenderJobsStore((state) => state.addJob);
  const activeJobId = useRenderJobsStore((state) => state.activeJobId);
  const setActiveJob = useRenderJobsStore((state) => state.setActiveJob);
  const previewJobId = useRenderJobsStore((state) => state.previewJobId);
  const setPreviewJob = useRenderJobsStore((state) => state.setPreviewJob);
  const removeJob = useRenderJobsStore((state) => state.removeJob);
  const favoriteIds = useRenderJobsStore((state) => state.favoriteIds);
  const toggleFavorite = useRenderJobsStore((state) => state.toggleFavorite);
  const applyRenderSettings = useGenerationSettingsStore((state) => state.applyRenderSettings);
  const setSeed = useGenerationSettingsStore((state) => state.setSeed);
  const guideOpen = useGuideStore((state) => state.mode !== "idle");

  const [dismissed, setDismissed] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seedCopied, setSeedCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const hasInFlight = jobs.some((job) => job.status === "pending" || job.status === "processing");

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(interval);
  }, [hasInFlight]);

  useEffect(() => {
    if (jobs.length > 0) setDismissed(false);
  }, [jobs.length]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!seedCopied) return;
    const timeout = setTimeout(() => setSeedCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [seedCopied]);

  const filled = filledBuildingViews(views, nodes);
  const previewUrl = nodeForView(nodes, filled[0]?.id ?? "")?.imageUrl ?? nodes[0]?.imageUrl ?? null;
  const isEmpty = filled.length === 0 && jobs.length === 0;

  if ((isEmpty && !guideOpen) || (dismissed && !guideOpen)) return null;

  const handleCopyPrompt = () => {
    if (!activeJob) return;
    void navigator.clipboard.writeText(activeJob.prompt).then(() => setCopied(true));
  };

  const handleUsePromptAndSettings = () => {
    if (!activeJob) return;
    applyRenderSettings(activeJob);
  };

  const handleRetry = async () => {
    if (!activeJob) return;
    const projectId = useCanvasStore.getState().projectId;
    if (!projectId) return;
    setIsRetrying(true);
    try {
      const { job } = await apiClient.createRender(buildRetryRequest(activeJob, projectId));
      addJob(job);
    } catch (error) {
      reportLimit(error);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReuseSeed = () => {
    if (activeJob?.seed != null) setSeed(activeJob.seed);
  };

  const handleCopySeed = () => {
    if (activeJob?.seed == null) return;
    void navigator.clipboard.writeText(String(activeJob.seed)).then(() => setSeedCopied(true));
  };

  const handleSetAsBase = async () => {
    if (!activeJob?.resultImageUrl) return;
    if (activeJob.viewKey) selectView(activeJob.viewKey);
    setIsPromoting(true);
    try {
      const { kind, node } = await setImageAsBaseNode(activeJob.resultImageUrl);
      const projectId = useCanvasStore.getState().projectId;
      if (!projectId) return;

      if (kind === "created") {
        await apiClient.createCanvasNode({ id: node.id, projectId, type: node.type, data: nodeToPersistedData(node) });
      } else {
        await apiClient.updateCanvasNode(node.id, { data: nodeToPersistedData(node) });
      }
    } catch (error) {
      console.error("Failed to save canvas node", error);
    } finally {
      setIsPromoting(false);
    }
  };

  return (
    <div className="flex h-full shrink-0" data-guide="results.panel">
      {jobs.length > 1 && (
        <div className="flex w-16 shrink-0 flex-col gap-2 overflow-y-auto border-l border-hairline bg-surface p-2">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => {
                if (job.status === "succeeded" && job.resultImageUrl) {
                  setPreviewJob(job.id);
                  return;
                }
                setActiveJob(job.id);
                viewImage(job.sourceImageUrl, "Source image", job.viewLabel ?? undefined);
              }}
              title={[job.viewLabel, job.prompt].filter(Boolean).join(": ") || "Render"}
              className={`relative aspect-square shrink-0 overflow-hidden rounded-lg border bg-white ${
                job.id === activeJob?.id ? "border-blueprint" : "border-hairline hover:border-hairline-strong"
              }`}
            >
              {job.resultImageUrl ? (
                <img src={job.resultImageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <img src={job.sourceImageUrl} alt="" className="h-full w-full object-cover opacity-40" />
              )}
              {(job.status === "pending" || job.status === "processing") && (
                <span className="absolute inset-0 flex items-center justify-center bg-white/50">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-blueprint border-t-transparent" />
                </span>
              )}
              {job.status === "failed" && (
                <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[10px] font-medium text-red-500">
                  Failed
                </span>
              )}
              {job.viewLabel && (
                <span className="absolute bottom-0 inset-x-0 truncate bg-black/55 px-1 py-0.5 text-[8px] font-medium text-white">
                  {job.viewLabel}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex h-full w-[300px] flex-col gap-4 overflow-y-auto border-l border-hairline bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary">
            {isEmpty
              ? "Past renders"
              : activeJob
              ? [activeJob.settings?.edit ? "Edit" : "Render", activeJob.viewLabel].filter(Boolean).join(" · ")
              : "Uploaded views"}
          </p>
          <div className="flex items-center gap-3 text-faint">
            {activeJob && (
              <>
                <button
                  type="button"
                  title={favoriteIds.has(activeJob.id) ? "Unstar" : "Star"}
                  onClick={() => toggleFavorite(activeJob.id)}
                  className={favoriteIds.has(activeJob.id) ? "text-blueprint" : "hover:text-primary"}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill={favoriteIds.has(activeJob.id) ? "currentColor" : "none"} aria-hidden="true">
                    <path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7l4.1-1.4Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  title={activeJob.resultImageUrl ? "Download" : "Download source"}
                  onClick={() => downloadImage(activeJob.resultImageUrl ?? activeJob.sourceImageUrl)}
                  className="hover:text-primary"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2v8m0 0 3-3m-3 3L5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Remove from history"
                  onClick={() => removeJob(activeJob.id)}
                  className="hover:text-red-500"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.5 7.5v4M9.5 7.5v4M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
            <button type="button" title="Close panel" onClick={() => setDismissed(true)} className="hover:text-primary">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {isEmpty ? (
          <div className="guide-results-empty">
            <p>Finished visualizations land here after Generate.</p>
            <p>Download them, reuse a prompt, set one as the new base, or start a regional edit from a result.</p>
          </div>
        ) : !activeJob ? (
          <>
            {previewUrl && (
              <button
                type="button"
                title="View full size on canvas"
                onClick={() => viewImage(previewUrl, "Uploaded view")}
                className="block w-full overflow-hidden rounded-lg border border-hairline transition-colors hover:border-blueprint"
              >
                <img src={previewUrl} alt="Uploaded elevation" className="aspect-[4/3] w-full object-cover" />
              </button>
            )}
            <p className="text-xs text-muted">
              {filled.length === 1
                ? "1 elevation uploaded → 1 render. Generate to queue it here."
                : `${filled.length} elevations uploaded. Generate to queue them here.`}
            </p>
          </>
        ) : (
          <>
            <div className="group relative overflow-hidden rounded-lg border border-hairline bg-surface-muted">
              <img
                src={activeJob.resultImageUrl ?? activeJob.sourceImageUrl}
                alt=""
                className={`aspect-[4/3] w-full object-cover ${
                  activeJob.status !== "succeeded" ? "opacity-40 blur-[1px]" : ""
                }`}
              />
              {!(activeJob.status === "succeeded" && activeJob.resultImageUrl) && (
                <button
                  type="button"
                  onClick={() => viewImage(activeJob.sourceImageUrl, "Source image", activeJob.viewLabel ?? undefined)}
                  aria-label="View the source image full size"
                  className="absolute inset-0 focus-visible:outline-none"
                />
              )}
              {activeJob.status === "succeeded" && activeJob.resultImageUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewJob(previewJobId === activeJob.id ? null : activeJob.id)}
                  aria-label={previewJobId === activeJob.id ? "Back to canvas" : "View full size on canvas"}
                  className="absolute inset-0 flex items-end justify-end bg-black/0 p-2 transition-colors hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-primary opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {previewJobId === activeJob.id ? "Showing on canvas" : "View full size"}
                  </span>
                </button>
              )}
              {(activeJob.status === "pending" || activeJob.status === "processing") && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/60 to-transparent p-3">
                  <p className="text-xs font-medium text-white">Generating render…</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/30">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-500 ease-out"
                      style={{ width: `${jobProgress(activeJob, now)}%` }}
                    />
                  </div>
                </div>
              )}
              {activeJob.status === "failed" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/80">
                  <p className="text-xs font-medium text-red-500">
                    {activeJob.errorMessage ?? "Render failed"}
                  </p>
                </div>
              )}
            </div>

            <div>
              {activeJob.prompt ? (
                <>
                  <p className="line-clamp-4 text-sm text-secondary">{activeJob.prompt}</p>
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className="mt-1.5 flex items-center gap-1 text-xs font-medium text-blueprint hover:underline"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <rect x="4.5" y="4.5" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
                      <path d="M2.5 9.5V2.5a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.1" />
                    </svg>
                    {copied ? "Copied" : "Copy prompt"}
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted">No prompt — rendered from style and settings.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                activeJob.viewLabel,
                activeJob.settings?.edit
                  ? activeJob.settings.edit.maskImageUrl
                    ? "Area edit"
                    : "Edit"
                  : activeJob.settings?.sourceType === "drawing"
                    ? "From drawing"
                    : "From photo",
                activeJob.style,
                formatAspectRatio(activeJob.aspectRatio),
              ].filter(Boolean).map((tag) => (
                <span key={tag} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-secondary">
                  {tag}
                </span>
              ))}
            </div>

            {activeJob.seed != null && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-2.5 py-1.5">
                <span className="text-xs text-muted">
                  Seed <span className="font-medium tabular-nums text-secondary">{activeJob.seed}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleCopySeed} className="text-xs font-medium text-blueprint hover:underline">
                    {seedCopied ? "Copied" : "Copy"}
                  </button>
                  <button type="button" onClick={handleReuseSeed} className="text-xs font-medium text-blueprint hover:underline">
                    Reuse
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const parent = activeJob.settings?.edit
                ? jobs.find((job) => job.status === "succeeded" && job.resultImageUrl === activeJob.sourceImageUrl)
                : undefined;
              const thumb = <img src={activeJob.sourceImageUrl} alt="" className="h-full w-full object-cover" />;
              return (
                <div>
                  <p className="text-xs font-medium text-muted">{parent ? "Edited from" : "Source"}</p>
                  {parent ? (
                    <button
                      type="button"
                      title="Open the render this edit was made from"
                      onClick={() => setPreviewJob(parent.id)}
                      className="mt-1.5 block h-14 w-14 overflow-hidden rounded-md border border-hairline transition-colors hover:border-blueprint"
                    >
                      {thumb}
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="View the source image full size"
                      onClick={() => viewImage(activeJob.sourceImageUrl, "Source image", activeJob.viewLabel ?? undefined)}
                      className="mt-1.5 block h-14 w-14 overflow-hidden rounded-md border border-hairline transition-colors hover:border-blueprint"
                    >
                      {thumb}
                    </button>
                  )}
                </div>
              );
            })()}

            {(activeJob.settings?.referenceImageUrls?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-muted">References</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {activeJob.settings!.referenceImageUrls!.map((url) => (
                    <button
                      key={url}
                      type="button"
                      title="View this reference full size"
                      onClick={() => viewImage(url, "Reference image")}
                      className="block h-14 w-14 overflow-hidden rounded-md border border-hairline transition-colors hover:border-blueprint"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-2">
              {activeJob.status === "failed" && (
                <button
                  type="button"
                  disabled={isRetrying}
                  onClick={() => void handleRetry()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 8A5 5 0 1 1 11.5 4.4M13 2.5v3.5H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {isRetrying ? "Retrying…" : "Retry with same settings"}
                </button>
              )}
              <button
                type="button"
                disabled={activeJob.status !== "succeeded" || !activeJob.resultImageUrl}
                onClick={() => startRenderEdit(activeJob.id)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M10.5 2.5 13.5 5.5 6 13H3v-3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                Edit this render
              </button>
              <button
                type="button"
                onClick={handleUsePromptAndSettings}
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-primary transition-colors hover:border-hairline-strong"
              >
                Use prompt and settings
              </button>
              <button
                type="button"
                disabled={activeJob.status !== "succeeded" || isPromoting}
                onClick={() => void handleSetAsBase()}
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-primary transition-colors hover:border-hairline-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPromoting ? "Setting as base…" : "Set as base for render"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
