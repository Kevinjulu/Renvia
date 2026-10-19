import { useEffect, useState } from "react";
import type { BetaFeedbackDetail, BetaFeedbackStatus } from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { refreshBeta } from "../useBetaStore";
import { AnnotationMarks } from "./AnnotationLayer";
import { CATEGORY_LABELS } from "./FeedbackDrawer";

export const STATUS_LABELS: Record<BetaFeedbackStatus, string> = {
  new: "Sent",
  triaged: "Seen by the team",
  investigating: "Looking into it",
  fix_in_progress: "Fix in progress",
  ready_to_verify: "Please check the fix",
  resolved: "Resolved",
  duplicate: "Already reported",
  expected: "Working as intended",
  cannot_reproduce: "Couldn't reproduce",
  declined: "Not planned",
};

/** One report and its conversation with the team: answer questions, confirm a fix, add detail. */
export function ReportThread({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApiClient();
  const [report, setReport] = useState<BetaFeedbackDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getBetaFeedback(id).then(setReport).catch(() => setError("Couldn't load this report."));
    // Opening a report reads its replies.
    void api.markBetaRepliesSeen().then(() => refreshBeta(api.getBetaMe)).catch(() => undefined);
  }, [api, id]);

  const act = async (action: () => Promise<BetaFeedbackDetail>) => {
    setBusy(true);
    setError("");
    try {
      setReport(await action());
      setReply("");
      void refreshBeta(api.getBetaMe);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.detail ? failure.detail : "Couldn't send that. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const image = report?.annotations?.image === "source" ? report.sourceImageUrl : report?.resultImageUrl ?? report?.sourceImageUrl;

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-primary/30" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Report" className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blueprint">{report ? `BETA-${report.number} · ${STATUS_LABELS[report.status]}` : "Report"}</p>
            <h2 className="font-display text-lg font-semibold text-primary">{report?.title ?? "Loading…"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-muted" aria-label="Close">✕</button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {report && (
            <>
              <p className="text-xs text-faint">{CATEGORY_LABELS[report.category]} · sent {new Date(report.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
              {image && (
                <div className="relative overflow-hidden rounded-lg border border-hairline">
                  <img src={image} alt="The render you reported" className="block w-full" />
                  {report.annotations && <AnnotationMarks annotations={report.annotations} />}
                </div>
              )}
              {report.description && <p className="whitespace-pre-line text-sm text-secondary">{report.description}</p>}
              {report.attachmentUrl && (
                <a href={report.attachmentUrl} target="_blank" rel="noreferrer" className="block">
                  <img src={report.attachmentUrl} alt="Your screenshot" className="max-h-48 rounded-lg border border-hairline" />
                </a>
              )}

              {report.status === "ready_to_verify" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-medium text-emerald-900">We think this is fixed. Is it?</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void act(() => api.confirmBetaFix(id, true, reply.trim() || undefined))} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">Yes, it's fixed</button>
                    <button type="button" disabled={busy} onClick={() => void act(() => api.confirmBetaFix(id, false, reply.trim() || undefined))} className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-secondary disabled:opacity-60">No, still happening</button>
                  </div>
                </div>
              )}

              <ol className="space-y-2.5">
                {report.comments.map((comment) => (
                  <li key={comment.id} className={`rounded-xl px-4 py-2.5 text-sm ${comment.kind === "request_info" ? "border border-amber-200 bg-amber-50" : comment.fromTeam ? "bg-surface-muted" : "border border-hairline"}`}>
                    <p className="text-xs font-medium text-faint">
                      {comment.fromTeam ? "Ramah Studio team" : "You"}
                      {comment.kind === "request_info" && " · question for you"}
                      {comment.kind === "status_change" && comment.status && ` · ${STATUS_LABELS[comment.status]}`}
                      {" · "}
                      {new Date(comment.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </p>
                    {comment.body && <p className="mt-0.5 whitespace-pre-line text-primary">{comment.body}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{error}</p>}
        </div>
        {report && (
          <footer className="space-y-2 border-t border-hairline px-5 py-4">
            <textarea className="w-full rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:border-blueprint" rows={3} maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={report.awaitingTester ? "Answer the team…" : "Add more detail…"} />
            <div className="flex justify-end">
              <button type="button" disabled={busy || !reply.trim()} onClick={() => void act(() => api.replyBetaFeedback(id, reply.trim()))} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}
