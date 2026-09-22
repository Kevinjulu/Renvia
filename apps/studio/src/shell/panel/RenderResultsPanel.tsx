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
import { filledBuildingViews } from "../../canvas/buildingViews";
import { useDownloadDialogStore } from "../../canvas/hooks/useDownloadDialogStore";
import { jobProgress } from "../../canvas/utils/renderProgress";
import { useArchitectureFact } from "./useArchitectureFact";

function timeAgo(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
  const updateJob = useRenderJobsStore((state) => state.updateJob);
  const openDownload = useDownloadDialogStore((state) => state.open);
  const applyRenderSettings = useGenerationSettingsStore((state) => state.applyRenderSettings);
  const setSeed = useGenerationSettingsStore((state) => state.setSeed);

  const [isPromoting, setIsPromoting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seedCopied, setSeedCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const hasInFlight = jobs.some((job) => job.status === "pending" || job.status === "processing");

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(interval);
  }, [hasInFlight]);

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

  const filledCount = filledBuildingViews(views, nodes).length;
  const favoriteCount = jobs.filter((item) => item.isFavorite).length;

  // Switching renders drops a half-finished remove confirmation.
  useEffect(() => {
    setConfirmingRemove(false);
    setActionError(null);
  }, [activeJob?.id]);

  const handleToggleFavorite = async () => {
    if (!activeJob) return;
    const next = !activeJob.isFavorite;
    updateJob(activeJob.id, { isFavorite: next });
    setActionError(null);
    try {
      await apiClient.updateRender(activeJob.id, { isFavorite: next });
    } catch {
      updateJob(activeJob.id, { isFavorite: !next });
      setActionError("Couldn't save the star. Try again.");
    }
  };

  const handleRemove = async () => {
    if (!activeJob) return;
    setIsRemoving(true);
    setActionError(null);
    try {
      await apiClient.hideRender(activeJob.id);
      removeJob(activeJob.id);
    } catch {
      setActionError("Couldn't remove this render. Try again.");
    } finally {
      setIsRemoving(false);
      setConfirmingRemove(false);
    }
  };

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

  if (!activeJob) {
    return (
      <aside className="rp-panel" data-guide="results.panel">
        <header className="rp-head">
          <strong>Renders</strong>
        </header>
        <div className="rp-empty">
          <span className="rp-empty-art" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <rect x="7" y="11" width="34" height="26" rx="4" />
              <path d="m7 31 9-8 7 6 6-5 12 9" />
              <circle cx="31" cy="19" r="3" />
            </svg>
          </span>
          <strong>{filledCount ? "Ready when you are" : "No renders yet"}</strong>
          <p>
            {filledCount
              ? `${filledCount} ${filledCount === 1 ? "elevation is" : "elevations are"} ready. Press Generate and your renders will land here.`
              : "Upload an elevation, then press Generate. Finished renders land here."}
          </p>
          <ol>
            <li className={filledCount ? "is-done" : ""}>Upload an elevation</li>
            <li>Pick a style and add direction</li>
            <li>Generate, then edit or download</li>
          </ol>
        </div>
      </aside>
    );
  }

  const job = activeJob;
  const inFlight = job.status === "pending" || job.status === "processing";
  const succeeded = job.status === "succeeded" && Boolean(job.resultImageUrl);
  const starred = job.isFavorite;
  const progress = Math.round(jobProgress(job, now));
  const fact = useArchitectureFact(inFlight);
  const parent = job.settings?.edit
    ? jobs.find((item) => item.status === "succeeded" && item.resultImageUrl === job.sourceImageUrl)
    : undefined;
  const references = job.settings?.referenceImageUrls ?? [];
  const tags = [
    job.settings?.edit
      ? job.settings.edit.maskImageUrl
        ? "Area edit"
        : "Edit"
      : job.settings?.sourceType === "drawing"
        ? "From drawing"
        : "From photo",
    job.style,
    formatAspectRatio(job.aspectRatio),
  ].filter((tag): tag is string => Boolean(tag));
  const detailsSummary = [
    parent ? "Edited from a render" : "Source",
    references.length ? `${references.length} ${references.length === 1 ? "reference" : "references"}` : null,
    job.seed != null ? `Seed ${job.seed}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const history = starredOnly ? jobs.filter((item) => item.isFavorite) : jobs;

  return (
    <aside className="rp-panel" data-guide="results.panel">
      <header className="rp-head">
        <strong>Renders</strong>
        <span>{jobs.length}</span>
      </header>

      <div className="rp-scroll">
        <figure className={`rp-hero is-${job.status}`}>
          <img src={job.resultImageUrl ?? job.sourceImageUrl} alt="" />
          <button
            type="button"
            className="rp-hero-open"
            onClick={() =>
              succeeded
                ? setPreviewJob(previewJobId === job.id ? null : job.id)
                : viewImage(job.sourceImageUrl, "Source image", job.viewLabel ?? undefined)
            }
            aria-label={succeeded ? (previewJobId === job.id ? "Back to canvas" : "View full size") : "View the source image full size"}
          >
            {succeeded && (
              <span>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
                </svg>
                {previewJobId === job.id ? "Showing on canvas" : "View full size"}
              </span>
            )}
          </button>
          <div className="rp-hero-tools">
            <button
              type="button"
              className={starred ? "is-on" : ""}
              title={starred ? "Unstar" : "Star"}
              aria-label={starred ? "Unstar" : "Star"}
              aria-pressed={starred}
              onClick={() => void handleToggleFavorite()}
            >
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7l4.1-1.4Z" />
              </svg>
            </button>
            <button
              type="button"
              title={job.resultImageUrl ? "Download" : "Download source"}
              aria-label={job.resultImageUrl ? "Download" : "Download source"}
              onClick={() => openDownload(job.id)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" />
              </svg>
            </button>
            <button
              type="button"
              className="is-danger"
              title="Remove from history"
              aria-label="Remove from history"
              aria-expanded={confirmingRemove}
              disabled={inFlight}
              onClick={() => setConfirmingRemove((open) => !open)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.5 7.5v4M9.5 7.5v4M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
              </svg>
            </button>
          </div>
          {confirmingRemove && (
            <div className="rp-confirm" role="alertdialog" aria-label="Remove this render?">
              <p>Remove this render from your history? This can't be undone.</p>
              <div>
                <button type="button" onClick={() => setConfirmingRemove(false)}>
                  Cancel
                </button>
                <button type="button" className="is-danger" disabled={isRemoving} onClick={() => void handleRemove()}>
                  {isRemoving ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          )}
          {inFlight && (
            <figcaption className="rp-progress">
              <span>
                {job.status === "pending" ? "Queued" : "Rendering"}… <b>{progress}%</b>
              </span>
              <i>
                <em style={{ width: `${progress}%` }} />
              </i>
              <small key={fact}>{fact}</small>
            </figcaption>
          )}
          {job.status === "failed" && (
            <figcaption className="rp-failed">
              <strong>Render failed</strong>
              <span>{job.errorMessage ?? "Something went wrong. Try again."}</span>
            </figcaption>
          )}
        </figure>

        {actionError && <p className="rp-toast">{actionError}</p>}

        <div className="rp-meta">
          <p className="rp-title">
            <strong>{[job.settings?.edit ? "Edit" : "Render", job.viewLabel].filter(Boolean).join(" · ")}</strong>
            <span>{timeAgo(job.createdAt, now)}</span>
          </p>
          <div className="rp-tags">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>

        <div className="rp-actions">
          {job.status === "failed" ? (
            <button type="button" className="rp-btn is-primary" disabled={isRetrying} onClick={() => void handleRetry()}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8A5 5 0 1 1 11.5 4.4M13 2.5v3.5H9.5" />
              </svg>
              {isRetrying ? "Retrying…" : "Retry with same settings"}
            </button>
          ) : (
            <button type="button" className="rp-btn is-primary" disabled={!succeeded} onClick={() => startRenderEdit(job.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10.5 2.5 13.5 5.5 6 13H3v-3Z" />
              </svg>
              Edit this render
            </button>
          )}
          <div className="rp-actions-row">
            <button type="button" className="rp-btn" onClick={handleUsePromptAndSettings} title="Load this render's prompt and settings into the panel">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 2.5V6H9.5M13 8a5 5 0 0 1-8.5 3.5L3 10m0 3.5V10h3.5" />
              </svg>
              Reuse settings
            </button>
            <button
              type="button"
              className="rp-btn"
              disabled={!succeeded || isPromoting}
              onClick={() => void handleSetAsBase()}
              title="Put this render on the canvas as the new base image"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2 14 5 8 8 2 5Z" />
                <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
              </svg>
              {isPromoting ? "Setting…" : "Set as base"}
            </button>
          </div>
        </div>

        <section className="rp-prompt">
          <div className="rp-section-head">
            <strong>Prompt</strong>
            {job.prompt && (
              <button type="button" onClick={handleCopyPrompt}>
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <p className={job.prompt ? "" : "is-empty"}>{job.prompt || "No prompt — rendered from style and settings."}</p>
        </section>

        <section className={`rp-details ${detailsOpen ? "is-open" : ""}`}>
          <button type="button" className="rp-details-toggle" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
            <span>
              <strong>Details</strong>
              <small>{detailsSummary}</small>
            </span>
            <svg className="cp-caret" width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {detailsOpen && (
            <div className="rp-details-body">
              <div className="rp-thumbs">
                <p>{parent ? "Edited from" : "Source"}</p>
                <div>
                  <button
                    type="button"
                    title={parent ? "Open the render this edit was made from" : "View the source image full size"}
                    onClick={() =>
                      parent ? setPreviewJob(parent.id) : viewImage(job.sourceImageUrl, "Source image", job.viewLabel ?? undefined)
                    }
                  >
                    <img src={job.sourceImageUrl} alt="" />
                  </button>
                </div>
              </div>
              {references.length > 0 && (
                <div className="rp-thumbs">
                  <p>References</p>
                  <div>
                    {references.map((url) => (
                      <button key={url} type="button" title="View this reference full size" onClick={() => viewImage(url, "Reference image")}>
                        <img src={url} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {job.seed != null && (
                <div className="rp-seed">
                  <span>
                    Seed <b>{job.seed}</b>
                  </span>
                  <button type="button" onClick={handleCopySeed}>
                    {seedCopied ? "Copied" : "Copy"}
                  </button>
                  <button type="button" onClick={handleReuseSeed} title="Lock this seed for the next render">
                    Reuse
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {jobs.length > 1 && (
          <section className="rp-history">
            <div className="rp-section-head">
              <strong>History</strong>
              {favoriteCount > 0 && (
                <button type="button" className={starredOnly ? "is-on" : ""} aria-pressed={starredOnly} onClick={() => setStarredOnly((on) => !on)}>
                  ★ Starred
                </button>
              )}
            </div>
            <div className="rp-grid">
              {history.map((item) => {
                const running = item.status === "pending" || item.status === "processing";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`is-${item.status} ${item.id === job.id ? "is-active" : ""}`}
                    onClick={() => setActiveJob(item.id)}
                    onDoubleClick={() => {
                      if (item.status === "succeeded" && item.resultImageUrl) setPreviewJob(item.id);
                    }}
                    title={[item.viewLabel, item.prompt].filter(Boolean).join(": ") || "Render"}
                  >
                    <img src={item.resultImageUrl ?? item.sourceImageUrl} alt="" />
                    {running && <i className="rp-spinner" aria-label="Rendering" />}
                    {item.status === "failed" && <em>Failed</em>}
                    {item.isFavorite && <b aria-label="Starred">★</b>}
                  </button>
                );
              })}
            </div>
            {history.length === 0 && <p className="rp-grid-empty">No starred renders yet.</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
