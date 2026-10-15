import type { BetaFeedbackCategory, BetaFeedbackKind, RenderJob } from "@renvia/types";

/** The kinds of feedback, in the order the form and the Feedback menu show them. */
export const KINDS: { value: BetaFeedbackKind; label: string; hint: string }[] = [
  { value: "visual_quality", label: "Render looks wrong", hint: "Structure, materials or an edit came out wrong" },
  { value: "bug", label: "Something broke", hint: "An error, a stuck render or a button that does nothing" },
  { value: "usability", label: "Hard to use", hint: "Confusing, slow or hard to find" },
  { value: "suggestion", label: "Idea", hint: "Something you'd like Renvia to do" },
  { value: "praise", label: "Something great", hint: "Tell us what's working well" },
];

/** Categories that fit each kind, most likely first; the first is the default when the kind is picked. */
const CATEGORIES_BY_KIND: Record<BetaFeedbackKind, BetaFeedbackCategory[]> = {
  visual_quality: ["architecture_changed", "materials_wrong", "edit_wrong", "other"],
  bug: ["render_failed", "render_stuck", "ui_problem", "billing_credits", "other"],
  usability: ["ui_problem", "billing_credits", "other"],
  suggestion: ["other", "ui_problem"],
  praise: ["other"],
};

export function categoriesFor(kind: BetaFeedbackKind): BetaFeedbackCategory[] {
  return CATEGORIES_BY_KIND[kind];
}

/** Ideas and praise don't need a severity or the "what went wrong" question. */
export function isProblem(kind: BetaFeedbackKind): boolean {
  return kind !== "suggestion" && kind !== "praise";
}

/** Renders a tester can attach to a report: finished or failed ones, newest first, at most `limit`. */
export function reportableRenders<T extends Pick<RenderJob, "id" | "status" | "resultImageUrl" | "sourceImageUrl" | "createdAt">>(jobs: T[], limit = 8): T[] {
  return jobs
    .filter((job) => (job.status === "succeeded" && job.resultImageUrl) || (job.status === "failed" && job.sourceImageUrl))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** The category a report starts on for `kind`. */
export function defaultCategory(kind: BetaFeedbackKind): BetaFeedbackCategory {
  return CATEGORIES_BY_KIND[kind][0] ?? "other";
}
