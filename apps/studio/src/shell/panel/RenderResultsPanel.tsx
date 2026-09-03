import { useEffect, useState } from "react";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { useRenderJobsStore, type ClientRenderJob } from "../../canvas/hooks/useRenderJobsStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { nodeToPersistedData, setImageAsBaseNode } from "../../canvas/utils/placeImageNode";
import { useRenderJobsPolling } from "../../canvas/hooks/useRenderJobsPolling";
import { useApiClient } from "../../lib/apiClient";

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
  const apiClient = useApiClient();

  const nodes = useCanvasStore((state) => state.nodes);
  const jobs = useRenderJobsStore((state) => state.jobs);
  const activeJobId = useRenderJobsStore((state) => state.activeJobId);
  const setActiveJob = useRenderJobsStore((state) => state.setActiveJob);
  const removeJob = useRenderJobsStore((state) => state.removeJob);
  const favoriteIds = useRenderJobsStore((state) => state.favoriteIds);
  const toggleFavorite = useRenderJobsStore((state) => state.toggleFavorite);
  const setPrompt = useGenerationSettingsStore((state) => state.setPrompt);
  const setResolution = useGenerationSettingsStore((state) => state.setResolution);

  const [dismissed, setDismissed] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [copied, setCopied] = useState(false);
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

  if (nodes.length === 0 || dismissed) return null;

  const handleCopyPrompt = () => {
    if (!activeJob) return;
    void navigator.clipboard.writeText(activeJob.prompt).then(() => setCopied(true));
  };

  const handleUsePromptAndSettings = () => {
    if (!activeJob) return;
    setPrompt(activeJob.prompt);
    setResolution(activeJob.resolution);
  };

  const handleSetAsBase = async () => {
    if (!activeJob?.resultImageUrl) return;
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
    <div className="flex h-full shrink-0">
      {jobs.length > 1 && (
        <div className="flex w-16 shrink-0 flex-col gap-2 overflow-y-auto border-l border-hairline bg-surface p-2">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setActiveJob(job.id)}
              title={job.prompt}
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
            </button>
          ))}
        </div>
      )}

      <div className="flex h-full w-[300px] flex-col gap-4 overflow-y-auto border-l border-hairline bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary">
            {activeJob ? "Render" : "Reference image"}
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

        {!activeJob ? (
          <>
            <div className="overflow-hidden rounded-lg border border-hairline">
              <img src={nodes[0]?.imageUrl} alt="Uploaded elevation" className="aspect-[4/3] w-full object-cover" />
            </div>
            <p className="text-xs text-muted">
              Add a prompt and hit Generate to render this elevation — progress will show up here.
            </p>
          </>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-lg border border-hairline bg-surface-muted">
              <img
                src={activeJob.resultImageUrl ?? activeJob.sourceImageUrl}
                alt=""
                className={`aspect-[4/3] w-full object-cover ${
                  activeJob.status !== "succeeded" ? "opacity-40 blur-[1px]" : ""
                }`}
              />
              {(activeJob.status === "pending" || activeJob.status === "processing") && (
                <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/60 to-transparent p-3">
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
                <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                  <p className="text-xs font-medium text-red-500">
                    {activeJob.errorMessage ?? "Render failed"}
                  </p>
                </div>
              )}
            </div>

            <div>
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
            </div>

            <div className="flex flex-wrap gap-1.5">
              {["Render", activeJob.style, activeJob.resolution].map((tag) => (
                <span key={tag} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-secondary">
                  {tag}
                </span>
              ))}
            </div>

            <div>
              <p className="text-xs font-medium text-muted">Reference image</p>
              <div className="mt-1.5 h-14 w-14 overflow-hidden rounded-md border border-hairline">
                <img src={activeJob.sourceImageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-2">
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
