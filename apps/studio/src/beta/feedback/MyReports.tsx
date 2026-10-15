import { useCallback, useEffect, useState } from "react";
import type { BetaFeedbackSummary, BetaKnownIssue } from "@renvia/types";
import { useApiClient } from "../../lib/apiClient";
import { STATUS_LABELS } from "./ReportThread";
import { useFeedbackStore } from "./useFeedbackStore";

/** The tester's reports (newest activity first) and the program's known issues. */
export function MyReports() {
  const api = useApiClient();
  const threadId = useFeedbackStore((state) => state.threadId);
  const openThread = useFeedbackStore((state) => state.openThread);
  const openReport = useFeedbackStore((state) => state.openReport);
  const reportOpen = useFeedbackStore((state) => state.open);
  const [reports, setReports] = useState<BetaFeedbackSummary[] | null>(null);
  const [issues, setIssues] = useState<BetaKnownIssue[]>([]);

  const load = useCallback(() => {
    api.listBetaFeedback().then(({ feedback }) => setReports(feedback)).catch(() => setReports([]));
    api.listBetaKnownIssues().then(({ issues: found }) => setIssues(found)).catch(() => undefined);
  }, [api]);

  // Again whenever a report or thread closes, so statuses and replies are current.
  useEffect(() => {
    if (!threadId && !reportOpen) load();
  }, [load, threadId, reportOpen]);

  return (
    <>
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-primary">Your reports</h2>
          <button type="button" onClick={() => openReport()} className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-muted">Report a problem</button>
        </div>
        {reports === null ? (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">Nothing yet. When a render looks wrong, use the Feedback button in your project (or the flag on the render) so we see exactly what you saw.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reports.map((report) => (
              <li key={report.id}>
                <button type="button" onClick={() => openThread(report.id)} className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-left hover:bg-surface-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary">{report.title}</span>
                    <span className="text-xs text-faint">BETA-{report.number} · {STATUS_LABELS[report.status]}</span>
                  </span>
                  {report.awaitingTester && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Waiting on you</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {issues.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold text-primary">Known issues</h2>
          <p className="text-xs text-muted">Problems we've confirmed and are working on. No need to report these again.</p>
          <ul className="mt-3 space-y-2">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-sm">
                <span className="min-w-0 text-primary">{issue.title}</span>
                <span className="shrink-0 text-xs text-faint">{STATUS_LABELS[issue.status]} · {issue.plusOnes + 1} affected</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
