import type { RenderJob } from "@renvia/types";

type Candidate = Pick<RenderJob, "id" | "status" | "resultImageUrl" | "viewKey" | "settings">;

const isFinished = (job: Candidate) => job.status === "succeeded" && Boolean(job.resultImageUrl);

/**
 * The render the Edit tab should open on the canvas, or null when there is nothing to edit yet.
 *
 * The render selected in the results panel wins if it has finished. Otherwise the newest finished
 * render for the active view, skipping high-resolution exports (a 4K/8K export is not what anyone
 * means by "my render", and editing one is slow and costs more). A render still in progress is not
 * a render yet. `jobs` is newest first, as the jobs store keeps it.
 */
export function pickRenderToEdit(jobs: readonly Candidate[], activeJobId: string | null, activeViewId: string | null): Candidate | null {
  const selected = jobs.find((job) => job.id === activeJobId);
  if (selected && isFinished(selected)) return selected;
  return jobs.find((job) => isFinished(job) && !job.settings?.upscale && job.viewKey === activeViewId) ?? null;
}
