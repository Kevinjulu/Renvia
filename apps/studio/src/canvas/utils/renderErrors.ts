/**
 * What to tell a customer about a failed render. The stored message is often a model
 * provider's own text (a validation detail, a safety-filter notice), which reads as noise or
 * alarm; this maps the failures the engine produces to plain words. Every failed render's
 * credits are refunded server-side, so the copy can say so.
 */
const REFUNDED = "Your credits were refunded.";

const KNOWN: { match: RegExp; message: string }[] = [
  { match: /^cancelled$/i, message: `You cancelled this. ${REFUNDED}` },
  { match: /timed out/i, message: `This took too long and was stopped. ${REFUNDED} Try again.` },
  { match: /never submitted/i, message: `This didn't start. ${REFUNDED} Try again.` },
  { match: /no longer available/i, message: "This render is no longer available." },
  {
    match: /safety|flagged|nsfw|content (policy|moderation)|not allowed/i,
    message: `The model's safety filter blocked this result. Try a different prompt or reference. ${REFUNDED}`,
  },
  // High-resolution export limits are already written for people; keep them as they are.
  { match: /already (4k|8k) or larger/i, message: "" },
];

/** A friendly message for a failed render, or the export's own explanation when it has one. */
export function friendlyRenderError(errorMessage: string | null | undefined): string {
  const raw = errorMessage?.trim() ?? "";
  const known = KNOWN.find((entry) => entry.match.test(raw));
  if (known) return known.message || raw;
  return `Something went wrong while making this. ${REFUNDED} Try again.`;
}
