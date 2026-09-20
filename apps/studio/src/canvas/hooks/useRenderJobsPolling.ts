import { useEffect, useRef } from "react";
import { useApiClient } from "../../lib/apiClient";
import { useRenderJobsStore } from "./useRenderJobsStore";
import { useRenderEditStore } from "./useRenderEditStore";

const POLL_INTERVAL_MS = 2500;

/** Polls every non-terminal render job until it succeeds or fails. */
export function useRenderJobsPolling() {
  const apiClient = useApiClient();
  const jobs = useRenderJobsStore((state) => state.jobs);
  const updateJob = useRenderJobsStore((state) => state.updateJob);

  const pendingIds = jobs
    .filter((job) => job.status === "pending" || job.status === "processing")
    .map((job) => job.id)
    .join(",");

  useEffect(() => {
    if (!pendingIds) return;

    let cancelled = false;
    const poll = () => {
      pendingIds.split(",").forEach((id) => {
        apiClient
          .getRender(id)
          .then(({ job }) => {
            if (!cancelled) updateJob(id, job);
          })
          .catch(() => {
            // Transient network/API errors are retried on the next tick.
          });
      });
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds]);
}

/**
 * Shows a render on the canvas as soon as it finishes, so the result is what the user sees
 * instead of a thumbnail they have to click. Only renders that were watched running in this
 * session open on their own — renders already finished when the project loaded don't — and an
 * edit in progress keeps the viewer it owns.
 */
export function useAutoShowFinishedRender() {
  const jobs = useRenderJobsStore((state) => state.jobs);
  const running = useRef(new Set<string>());

  useEffect(() => {
    for (const job of jobs) {
      if (job.status === "pending" || job.status === "processing") {
        running.current.add(job.id);
        continue;
      }
      if (!running.current.delete(job.id)) continue;
      if (job.status !== "succeeded" || !job.resultImageUrl) continue;

      const { targetJobId, awaitingJobId } = useRenderEditStore.getState();
      // An edit in progress owns the viewer: it swaps itself into Compare when it lands.
      if (targetJobId || awaitingJobId === job.id) continue;
      useRenderJobsStore.getState().setPreviewJob(job.id);
    }
  }, [jobs]);
}
