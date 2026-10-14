/**
 * What to tell a customer about a failed render. The stored message is often a model
 * provider's own text (a validation detail, a safety-filter notice), which reads as noise or
 * alarm; this maps the failures the engine produces to plain words: what happened, and what to
 * do about it. Every failed render's credits are refunded server-side, so the copy can say so.
 */
export interface RenderFailure {
  /** Short headline: what went wrong. */
  title: string;
  /** One or two sentences: why, and what to do next. */
  detail: string;
  /** The credits came back (true for every failure the engine records). */
  refunded: boolean;
  /** Running it again unchanged has a fair chance of working. */
  retryable: boolean;
}

const KNOWN: { match: RegExp; failure: Omit<RenderFailure, "refunded"> & { refunded?: boolean } }[] = [
  { match: /^cancelled$/i, failure: { title: "Cancelled", detail: "You stopped this one before it finished.", retryable: true } },
  {
    match: /timed out/i,
    failure: { title: "Took too long", detail: "The AI service didn't finish in time. This usually clears up on its own, so try again.", retryable: true },
  },
  {
    match: /never submitted/i,
    failure: { title: "Didn't start", detail: "The request never reached the AI service. Try again.", retryable: true },
  },
  {
    match: /no longer available/i,
    failure: { title: "No longer available", detail: "This render was removed or can't be loaded any more.", retryable: false, refunded: false },
  },
  {
    match: /safety|flagged|nsfw|content (policy|moderation)|not allowed/i,
    failure: {
      title: "Blocked by the safety filter",
      detail: "The AI service's filter stopped this result. Try a different prompt or reference image.",
      retryable: false,
    },
  },
  {
    match: /too small|minimum dimensions|image_too_small/i,
    failure: {
      title: "An image is too small",
      detail: "One of the images is under 256 pixels on a side. Use a bigger version of it (512 pixels or more works best).",
      retryable: false,
    },
  },
  {
    match: /too large|exceeds|maximum (dimensions|size)|payload/i,
    failure: { title: "An image is too large", detail: "One of the images is bigger than the AI service accepts. Use a smaller copy of it.", retryable: false },
  },
  {
    match: /image not found|couldn.t read|unsupported|cannot identify|invalid image|decode|isn't one of our uploads|corrupt/i,
    failure: {
      title: "Couldn't open an image",
      detail: "One of the images couldn't be read. Upload it again, or pick a different one.",
      retryable: false,
    },
  },
  {
    match: /returned no image|without dimensions/i,
    failure: { title: "No image came back", detail: "The AI finished without producing a picture. Try again; it usually works on a second go.", retryable: true },
  },
  {
    match: /download|storage|upload|bucket/i,
    failure: { title: "Couldn't save the result", detail: "The image was made but couldn't be stored. Try again.", retryable: true },
  },
  {
    match: /rate limit|too many requests|overloaded|unavailable|busy|capacity|\b5\d\d\b|\b429\b/i,
    failure: { title: "The AI service is busy", detail: "It couldn't take this request just now. Wait a minute and try again.", retryable: true },
  },
];

const GENERIC: Omit<RenderFailure, "refunded"> = {
  title: "Something went wrong",
  detail: "This one didn't work out. Try again, and if it keeps happening, try a different image or prompt.",
  retryable: true,
};

/** A plain-words account of a failed render, or an export's own explanation when it has one. */
export function describeRenderFailure(errorMessage: string | null | undefined): RenderFailure {
  const raw = errorMessage?.trim() ?? "";
  // High-resolution export limits are already written for people; keep them as they are.
  if (/already (4k|8k) or larger/i.test(raw)) return { title: "Already high resolution", detail: raw, refunded: true, retryable: false };
  const known = KNOWN.find((entry) => entry.match.test(raw))?.failure ?? GENERIC;
  return { refunded: true, ...known };
}

const REFUNDED = "Your credits were refunded.";

/** The failure as one line, for places with room for a single sentence. */
export function friendlyRenderError(errorMessage: string | null | undefined): string {
  const failure = describeRenderFailure(errorMessage);
  return [`${failure.title}.`, failure.detail, failure.refunded ? REFUNDED : ""].filter(Boolean).join(" ");
}
