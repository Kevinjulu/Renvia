import type { BetaAnnotations, BetaFeedbackCategory, BetaFeedbackStatus, BetaProgramStatus, MeResponse } from "@renvia/types";
import { ApiError } from "../../lib/api";

/** Mirrors the API's beta permissions, only to hide controls; the API checks every request. */
export function betaCan(me: MeResponse) {
  const role = me.role;
  return {
    managePrograms: role === "admin",
    manageTesters: role === "support" || role === "admin",
    grantCredits: role === "billing" || role === "admin",
    triage: role === "support" || role === "admin",
  };
}

export const PROGRAM_STATUS_TONE: Record<BetaProgramStatus, "neutral" | "blue" | "amber" | "emerald"> = {
  draft: "neutral",
  active: "emerald",
  paused: "amber",
  ended: "neutral",
};

export const FEEDBACK_STATUS_LABEL: Record<BetaFeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  investigating: "Investigating",
  fix_in_progress: "Fix in progress",
  ready_to_verify: "Ready to verify",
  resolved: "Resolved",
  duplicate: "Duplicate",
  expected: "Expected",
  cannot_reproduce: "Can't reproduce",
  declined: "Declined",
};

export const CATEGORY_LABEL: Record<BetaFeedbackCategory, string> = {
  architecture_changed: "Structure changed",
  materials_wrong: "Wrong materials",
  render_failed: "Render failed",
  render_stuck: "Render stuck",
  edit_wrong: "Edit wrong",
  ui_problem: "Studio UI",
  billing_credits: "Credits/billing",
  other: "Other",
};

/** Asks for the audit reason every beta change records; null when the operator cancels. */
export function askReason(question: string, fallback = ""): string | null {
  const answer = window.prompt(question, fallback);
  if (answer === null) return null;
  return answer.trim() || null;
}

export function errorText(reason: unknown, fallback: string): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

const pct = (value: number) => `${value * 100}%`;

/** A tester's marks drawn over the render they reported, at the exact image-relative spots. */
export function AnnotatedImage({ src, annotations }: { src: string; annotations: BetaAnnotations | null }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-hairline bg-surface-muted">
      <img src={src} alt="Reported render" className="block w-full" />
      {annotations && (
        <>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {annotations.boxes.map((box, index) => (
              <rect key={`b${index}`} x={box.x * 1000} y={box.y * 1000} width={box.w * 1000} height={box.h * 1000} fill="rgba(239,68,68,0.12)" stroke="#ef4444" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            ))}
            {annotations.strokes.map((stroke, index) => (
              <polyline key={`s${index}`} points={stroke.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {annotations.pins.map((pin, index) => (
            <span
              key={`p${index}`}
              title={pin.label}
              className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-red-500 text-[11px] font-bold text-white shadow"
              style={{ left: pct(pin.x), top: pct(pin.y) }}
            >
              {index + 1}
            </span>
          ))}
        </>
      )}
    </div>
  );
}
