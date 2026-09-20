import { useEffect } from "react";
import type { LimitCode, MeResponse } from "@renvia/types";
import { ApiError } from "../lib/apiClient";

/** A refusal the studio can explain, lifted out of an ApiError. */
export interface LimitRefusal {
  code: LimitCode;
  /** Operator copy from the server, when they wrote any. */
  message: string | null;
  limit: number | null;
  used: number | null;
}

const KNOWN_CODES: LimitCode[] = [
  "insufficient_credits",
  "daily_limit_reached",
  "monthly_limit_reached",
  "budget_exhausted",
  "maintenance",
  "account_disabled",
  "project_limit_reached",
  "prompt_too_long",
  "too_many_references",
  "upload_too_large",
];

/** Returns the refusal an error represents, or null when it's an ordinary failure. */
export function limitRefusal(error: unknown): LimitRefusal | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  const code = KNOWN_CODES.find((candidate) => candidate === error.code);
  if (!code) return null;
  return { code, message: error.detail, limit: error.limit, used: error.used };
}

type Glyph = "coins" | "clock" | "pause" | "ban" | "ruler";

interface Copy {
  title: string;
  body: string;
  icon: Glyph;
  /** Amber for "wait and it clears", rose for "you're blocked". */
  tone: "amber" | "rose";
}

/** The studio draws its own icons rather than pulling in an icon package. */
const GLYPH_PATHS: Record<Glyph, string> = {
  coins: "M8 4.5c3 0 5.5.9 5.5 2s-2.5 2-5.5 2-5.5-.9-5.5-2 2.5-2 5.5-2Zm5.5 2v5c0 1.1-2.5 2-5.5 2s-5.5-.9-5.5-2v-5",
  clock: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Zm0 3v3.4l2.3 1.4",
  pause: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM6.6 5.9v4.2m2.8-4.2v4.2",
  ban: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Zm-4.4 1.8 8.8 8.8",
  ruler: "M2.2 9.4 9.4 2.2l4.4 4.4-7.2 7.2-4.4-4.4Zm2.6-2.6 1.4 1.4m1.2-3 1.4 1.4m1.2-3 1.4 1.4",
};

function GlyphIcon({ name }: { name: Glyph }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={GLYPH_PATHS[name]} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Built-in wording. The operator's copy, when they wrote any, replaces `body` —
 * the title, icon and next-step line stay so the dialog still reads as one thing.
 */
function copyFor(refusal: LimitRefusal, me: MeResponse | null): Copy {
  const perImage = me?.creditsPerImage ?? 1;
  switch (refusal.code) {
    case "insufficient_credits":
      return {
        title: "You're out of credits",
        body: `Each render costs ${perImage} ${perImage === 1 ? "credit" : "credits"}, and your balance can't cover the next one.`,
        icon: "coins",
        tone: "rose",
      };
    case "daily_limit_reached":
      return {
        title: "That's today's limit",
        body: "You've used today's allowance. It resets at midnight UTC.",
        icon: "clock",
        tone: "amber",
      };
    case "monthly_limit_reached":
      return {
        title: "That's this month's limit",
        body: "You've used this month's allowance. It resets on the 1st.",
        icon: "clock",
        tone: "amber",
      };
    case "budget_exhausted":
      return {
        title: "Rendering is paused",
        body: "The shared render budget is used up, so no new renders can start right now.",
        icon: "pause",
        tone: "rose",
      };
    case "maintenance":
      return {
        title: "Paused for maintenance",
        body: "New renders and selections are paused while we work on the pipeline. Nothing you've made is affected.",
        icon: "pause",
        tone: "amber",
      };
    case "account_disabled":
      return {
        title: "This account is disabled",
        body: "You can still open your projects, but you can't start new renders.",
        icon: "ban",
        tone: "rose",
      };
    case "project_limit_reached":
      return {
        title: "You've hit the project limit",
        body: "Delete a project you're done with, or ask for a higher limit.",
        icon: "ruler",
        tone: "amber",
      };
    case "prompt_too_long":
      return {
        title: "That prompt is too long",
        body: "Trim it down and try again — shorter prompts usually render closer to what you want anyway.",
        icon: "ruler",
        tone: "amber",
      };
    case "too_many_references":
      return {
        title: "Too many reference images",
        body: "Remove a reference or two and try again.",
        icon: "ruler",
        tone: "amber",
      };
    case "upload_too_large":
      return {
        title: "That image is too large",
        body: "Resize or re-export it smaller, then upload again.",
        icon: "ruler",
        tone: "amber",
      };
  }
}

/** The "12 of 12 today" line, when the server told us both numbers. */
function usageLine(refusal: LimitRefusal): string | null {
  const { code, limit, used } = refusal;
  if (limit === null || used === null) return null;
  switch (code) {
    case "daily_limit_reached":
      return `${used} of ${limit} used today`;
    case "monthly_limit_reached":
      return `${used} of ${limit} used this month`;
    case "insufficient_credits":
      return `Balance ${used} · this render needs ${limit}`;
    case "project_limit_reached":
      return `${used} of ${limit} projects`;
    case "prompt_too_long":
      return `${used} characters · ${limit} allowed`;
    case "too_many_references":
      return `${used} references · ${limit} allowed`;
    case "upload_too_large":
      return `${used} MB · ${limit} MB allowed`;
    default:
      return null;
  }
}

/** Refusals where the user's credit balance is worth showing alongside the reason. */
const ALLOWANCE_CODES: LimitCode[] = [
  "insufficient_credits",
  "daily_limit_reached",
  "monthly_limit_reached",
  "budget_exhausted",
  "maintenance",
];

const TONE = {
  amber: { chip: "bg-amber-50 text-amber-700", rule: "border-amber-200" },
  rose: { chip: "bg-red-50 text-red-600", rule: "border-red-200" },
} as const;

export function LimitDialog({
  refusal,
  me,
  onDismiss,
  onViewCredits,
}: {
  refusal: LimitRefusal;
  me: MeResponse | null;
  onDismiss: () => void;
  /** Omitted when credits aren't what's blocking them. */
  onViewCredits?: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  const copy = copyFor(refusal, me);
  const tone = TONE[copy.tone];
  const usage = usageLine(refusal);
  const showCredits = onViewCredits && refusal.code === "insufficient_credits";
  // The balance is context for an allowance problem, noise for a malformed request.
  const showBalance = me !== null && ALLOWANCE_CODES.includes(refusal.code);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4" onClick={onDismiss}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="limit-dialog-title"
        className="w-full max-w-md rounded-xl border border-hairline bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone.chip}`}>
            <GlyphIcon name={copy.icon} />
          </span>
          <div className="min-w-0">
            <h2 id="limit-dialog-title" className="font-display text-base font-semibold text-primary">
              {copy.title}
            </h2>
            <p className="mt-1.5 text-sm text-muted">{refusal.message ?? copy.body}</p>
          </div>
        </div>

        {(usage || showBalance) && (
          <dl className={`mt-4 space-y-1.5 border-t pt-3 text-xs ${tone.rule}`}>
            {usage && (
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Where you stand</dt>
                <dd className="tabular-nums text-secondary">{usage}</dd>
              </div>
            )}
            {showBalance && (
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Credit balance</dt>
                <dd className="tabular-nums text-secondary">
                  {me.role === "admin" ? "Unlimited (admin)" : me.creditBalance}
                </dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-5 flex justify-end gap-2.5">
          {showCredits && (
            <button
              type="button"
              onClick={onViewCredits}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted"
            >
              View credits
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
