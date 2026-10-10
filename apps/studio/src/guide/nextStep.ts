/**
 * First-run hints: which control a new user should use next. Worked out from what is already on
 * the page rather than from recorded clicks, so it stays right after a reload or when steps are
 * done out of order.
 */
export type NextStudioStep = "upload" | "reference" | "generate";

export interface NextStepState {
  /** At least one elevation has an image and is switched on. */
  hasElevation: boolean;
  hasReference: boolean;
  hasPrompt: boolean;
}

export function nextStudioStep({ hasElevation, hasReference, hasPrompt }: NextStepState): NextStudioStep {
  if (!hasElevation) return "upload";
  // References are suggested over prompting: they steer materials and light more reliably.
  // A prompt alone is still enough to generate.
  if (!hasReference && !hasPrompt) return "reference";
  return "generate";
}

/** Generate needs something to go on besides the elevation: a prompt or a reference image. */
export function hasRenderDirection({ hasReference, hasPrompt }: Pick<NextStepState, "hasReference" | "hasPrompt">): boolean {
  return hasReference || hasPrompt;
}

export const NEXT_STEP_COPY: Record<NextStudioStep, { title: string; body: string }> = {
  upload: {
    title: "Start here",
    body: "Upload an elevation or a photo of the building.",
  },
  reference: {
    title: "Next: add a reference image",
    body: "Show the look you want. References guide materials, light and setting better than a prompt.",
  },
  generate: {
    title: "Ready to render",
    body: "Press Generate. Your render lands in the panel on the right.",
  },
};
