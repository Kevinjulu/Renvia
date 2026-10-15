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

/**
 * The audit note every beta change records. The audit log already keeps who changed what, with the
 * before and after values, so nothing asks the operator to type a reason.
 */
export const ROUTINE_REASON = "Changed in Beta Management";

/** A yes/no check before an action that can't be undone; returns the audit note, or null if cancelled. */
export function confirmAction(message: string): string | null {
  return window.confirm(message) ? ROUTINE_REASON : null;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** A timestamp as the yyyy-mm-dd a date input shows, in the operator's own time zone. */
export function toDateInput(iso: string | Date): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** A program starts at the beginning of its first day and ends at the end of its last, locally. */
export function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

export function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59.999`);
}

/** Calendar days from a start day to an end day, both included (the API counts the same way). */
export function programDays(startDay: string, endDay: string): number {
  return Math.ceil((endOfDay(endDay).getTime() - startOfDay(startDay).getTime()) / DAY_MS);
}

/** "Starts in 3 days", "12 days left", "Ended": where a program is in its schedule. */
export function scheduleLabel(startsAt: string, endsAt: string, now = Date.now()): string {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (now < start) {
    const days = Math.ceil((start - now) / DAY_MS);
    return days <= 1 ? "Starts within a day" : `Starts in ${days} days`;
  }
  if (now >= end) return "Ended";
  const left = Math.ceil((end - now) / DAY_MS);
  return left <= 1 ? "Last day" : `${left} days left`;
}
