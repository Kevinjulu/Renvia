import { useEffect, useRef } from "react";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { useRenderJobsStore } from "./useRenderJobsStore";
import { useRenderEditStore } from "./useRenderEditStore";

const POLL_INTERVAL_MS = 2500;
/** After this many consecutive failed polls a job is only polled every BACKOFF_TICKS ticks. */
const BACKOFF_AFTER_FAILURES = 3;
const BACKOFF_TICKS = 4;

/** Polls every non-terminal render job until it succeeds or fails. */
export function useRenderJobsPolling() {
  const apiClient = useApiClient();
  const updateJob = useRenderJobsStore((state) => state.updateJob);
  const pendingIds = useRenderJobsStore((state) =>
    state.jobs
      .filter((job) => job.status === "pending" || job.status === "processing")
      .map((job) => job.id)
      .join(","),
  );
  const inFlight = useRef(new Set<string>());
  const failures = useRef(new Map<string, number>());

  useEffect(() => {
    if (!pendingIds) return;

    let cancelled = false;
    let tick = 0;
    const poll = () => {
      tick += 1;
      pendingIds.split(",").forEach((id) => {
        // A slow response must not land after a newer one, so a job is never polled twice at once.
        if (inFlight.current.has(id)) return;
        if ((failures.current.get(id) ?? 0) >= BACKOFF_AFTER_FAILURES && tick % BACKOFF_TICKS !== 0) return;
        inFlight.current.add(id);
        apiClient
          .getRender(id)
          .then(({ job }) => {
            failures.current.delete(id);
            if (!cancelled) updateJob(id, job);
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            if (error instanceof ApiError && error.status === 404) {
              failures.current.delete(id);
              updateJob(id, { status: "failed", errorMessage: "This render is no longer available." });
              return;
            }
            failures.current.set(id, (failures.current.get(id) ?? 0) + 1);
          })
          .finally(() => inFlight.current.delete(id));
      });
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiClient, pendingIds, updateJob]);
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
