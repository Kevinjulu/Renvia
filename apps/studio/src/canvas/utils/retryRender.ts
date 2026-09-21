import type { AspectRatio, CreateRenderRequest, RenderJob } from "@renvia/types";

/**
 * Rebuilds the request that produced this job, so a failed render can be resubmitted
 * without the user re-entering anything. Credits were already refunded for the failure,
 * so this is a fresh charge — same as clicking Generate again by hand.
 */
export function buildRetryRequest(job: RenderJob, projectId: string): CreateRenderRequest {
  return {
    projectId,
    sourceImageUrl: job.sourceImageUrl,
    prompt: job.prompt,
    aspectRatio: (job.aspectRatio as AspectRatio) || "auto",
    style: job.style,
    viewKey: job.viewKey ?? undefined,
    viewLabel: job.viewLabel ?? undefined,
    generationSettings: job.settings ?? undefined,
  };
}
