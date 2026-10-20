import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Inbox, MessageSquare } from "lucide-react";
import type { AdminBetaFeedbackDetail, BetaFeedbackCategory, BetaFeedbackStatus, BetaSeverity } from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton } from "../../components/ui";
import { PageTop } from "../../components/PageTop";
import { useAdminApi } from "../../lib/api";
import { formatRelative } from "../../lib/format";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { inputClass } from "../settings/components";
import { AnnotatedImage, betaCan, CATEGORY_LABEL, errorText, FEEDBACK_STATUS_LABEL } from "./shared";

const STATUS_TABS: (BetaFeedbackStatus | "")[] = ["", "new", "triaged", "investigating", "fix_in_progress", "ready_to_verify", "resolved"];
const SEVERITY_TONE: Record<BetaSeverity, "neutral" | "blue" | "amber" | "red"> = { low: "neutral", medium: "blue", high: "amber", critical: "red" };

/** The beta Feedback Inbox: every tester report, triaged in one place. */
export function BetaFeedbackPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const programId = params.get("programId") ?? "";
  const status = params.get("status") ?? "";
  const category = params.get("category") ?? "";
  const [selected, setSelected] = useState<string | null>(params.get("id"));
  const { data: programs } = useLoad(() => api.listBetaPrograms(), [api]);
  const { data, error, loading, reload, lastUpdated } = useLoad(() => api.listBetaFeedback({ programId: programId || undefined, status: status || undefined, category: category || undefined }), [api, programId, status, category], 60_000);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageTop title="Tester feedback" description="Every tester report with their marks on the render, diagnostics and thread: triage, reply and resolve." lastUpdated={lastUpdated ?? null} loading={loading} onRefresh={reload} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((item) => (
          <button key={item || "all"} type="button" onClick={() => setFilter("status", item)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === item ? "bg-primary text-white" : "bg-surface-muted text-secondary"}`}>
            {item ? FEEDBACK_STATUS_LABEL[item] : "All"}
            {item && data?.counts[item] ? ` · ${data.counts[item]}` : ""}
          </button>
        ))}
        <select className="ml-auto rounded-xl border border-hairline bg-canvas px-3 py-1.5 text-sm" value={programId} onChange={(event) => setFilter("programId", event.target.value)} aria-label="Program">
          <option value="">All programs</option>
          {programs?.programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
        </select>
        <select className="rounded-xl border border-hairline bg-canvas px-3 py-1.5 text-sm" value={category} onChange={(event) => setFilter("category", event.target.value)} aria-label="Category">
          <option value="">Every category</option>
          {(Object.keys(CATEGORY_LABEL) as BetaFeedbackCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABEL[key]}</option>)}
        </select>
      </div>

      {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card bodyClassName="p-0">
          {!data && !error && <Skeleton className="m-5 h-40" />}
          {data && data.feedback.length === 0 && <div className="p-5"><EmptyState icon={Inbox}>No reports here.</EmptyState></div>}
          <ul className="divide-y divide-hairline">
            {data?.feedback.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => setSelected(row.id)} className={`block w-full px-5 py-3 text-left hover:bg-surface ${selected === row.id ? "bg-surface" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-faint">BETA-{row.number}</span>
                    <Pill tone={SEVERITY_TONE[row.severity ?? row.severityReported]}>{row.severity ?? row.severityReported}</Pill>
                    {row.knownIssue && <Pill tone="amber">known</Pill>}
                    {row.plusOnes > 0 && <span className="text-xs text-faint">+{row.plusOnes}</span>}
                    <span className="ml-auto text-xs text-faint">{formatRelative(row.updatedAt)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-primary">{row.title}</p>
                  <p className="text-xs text-muted">{row.testerEmail} · {CATEGORY_LABEL[row.category]} · {FEEDBACK_STATUS_LABEL[row.status]}{row.assigneeEmail ? ` · ${row.assigneeEmail}` : ""}</p>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected ? <Triage id={selected} onChanged={reload} siblings={data?.feedback ?? []} /> : <Card><EmptyState icon={MessageSquare}>Select a report to triage it.</EmptyState></Card>}
      </div>
    </div>
  );
}

function Triage({ id, onChanged, siblings }: { id: string; onChanged: () => void; siblings: { id: string; number: number; title: string; programId: string }[] }) {
  const api = useAdminApi();
  const me = useAdmin();
  const can = betaCan(me);
  const [report, setReport] = useState<AdminBetaFeedbackDetail | null>(null);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<"result" | "source">("result");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReport(null);
    setError("");
    api.getBetaFeedback(id).then((detail) => {
      setReport(detail);
      setImage(detail.annotations?.image ?? "result");
    }).catch((reason) => setError(errorText(reason, "Couldn't load the report")));
  }, [api, id]);

  const act = async (action: () => Promise<AdminBetaFeedbackDetail>, clear = false) => {
    setBusy(true);
    setError("");
    try {
      setReport(await action());
      if (clear) setMessage("");
      onChanged();
    } catch (reason) {
      setError(errorText(reason, "That didn't work"));
    } finally {
      setBusy(false);
    }
  };

  if (error && !report) return <ErrorNote>{error}</ErrorNote>;
  if (!report) return <Skeleton className="h-96" />;
  const src = image === "source" ? report.render?.sourceImageUrl : report.render?.resultImageUrl ?? report.render?.sourceImageUrl;
  const marksOnThis = report.annotations && report.annotations.image === image ? report.annotations : null;
  const duplicateCandidates = siblings.filter((row) => row.id !== report.id && row.programId === report.programId);

  return (
    <Card title={`BETA-${report.number} · ${report.title}`}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          {report.testerEmail} · {CATEGORY_LABEL[report.category]} · {report.kind.replace("_", " ")} · reported {formatRelative(report.createdAt)}
          {report.duplicateOf && <> · duplicate of BETA-{report.duplicateOf.number}</>}
          {report.duplicates > 0 && <> · {report.duplicates} duplicates</>}
        </p>

        {report.render && src && (
          <div>
            <div className="mb-2 flex gap-2">
              {(["result", "source"] as const).map((kind) => (
                <button key={kind} type="button" onClick={() => setImage(kind)} className={`rounded-full px-3 py-1 text-xs font-medium ${image === kind ? "bg-primary text-white" : "bg-surface-muted text-secondary"}`}>{kind === "result" ? "Render" : "Source"}</button>
              ))}
              <span className="ml-auto text-xs text-faint">{report.render.status} · {report.render.jobType} · {report.render.model}</span>
            </div>
            <AnnotatedImage src={src} annotations={marksOnThis} />
          </div>
        )}
        {report.description && <p className="whitespace-pre-line text-sm text-secondary">{report.description}</p>}
        {report.attachmentUrl && <a href={report.attachmentUrl} target="_blank" rel="noreferrer"><img src={report.attachmentUrl} alt="Tester's screenshot" className="max-h-56 rounded-xl border border-hairline" /></a>}
        {report.diagnostics && (
          <details className="rounded-xl border border-hairline bg-surface px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-primary">Diagnostics (from Ramah Studio's records)</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-secondary">{JSON.stringify(report.diagnostics, null, 2)}</pre>
          </details>
        )}

        {can.triage && (
          <div className="grid gap-3 rounded-xl border border-hairline p-3 sm:grid-cols-2">
            <label className="text-xs text-muted">Status
              <select className={inputClass()} value={report.status} disabled={busy || report.status === "duplicate"} onChange={(event) => void act(() => api.updateBetaFeedback(report.id, { status: event.target.value }))}>
                {(Object.keys(FEEDBACK_STATUS_LABEL) as BetaFeedbackStatus[]).filter((item) => item !== "duplicate" || report.status === "duplicate").map((item) => <option key={item} value={item}>{FEEDBACK_STATUS_LABEL[item]}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">Severity (tester said {report.severityReported})
              <select className={inputClass()} value={report.severity ?? ""} disabled={busy} onChange={(event) => void act(() => api.updateBetaFeedback(report.id, { severity: event.target.value || null }))}>
                <option value="">Not set</option>
                {(["low", "medium", "high", "critical"] as const).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button variant="ghost" disabled={busy || report.assigneeId === me.id} onClick={() => void act(() => api.updateBetaFeedback(report.id, { assigneeId: me.id }))}>{report.assigneeEmail ? `Owner: ${report.assigneeEmail}` : "Assign to me"}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => {
                const title = report.knownIssue ? null : window.prompt("Title testers will see for this known issue", report.title);
                if (!report.knownIssue && title === null) return;
                void act(() => api.updateBetaFeedback(report.id, report.knownIssue ? { knownIssue: false } : { knownIssue: true, knownIssueTitle: title?.trim() || null }));
              }}>{report.knownIssue ? "Unmark known issue" : "Mark as known issue"}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => {
                const url = window.prompt("GitHub issue URL", report.githubUrl ?? "");
                if (url !== null) void act(() => api.updateBetaFeedback(report.id, { githubUrl: url.trim() || null }));
              }}>{report.githubUrl ? "GitHub linked" : "Link GitHub"}</Button>
              {report.status !== "duplicate" && duplicateCandidates.length > 0 && (
                <select className="rounded-xl border border-hairline bg-canvas px-2 py-1.5 text-xs" value="" disabled={busy} onChange={(event) => event.target.value && window.confirm("Mark this as a duplicate? The tester is told, and the original gains their +1.") && void act(() => api.markBetaFeedbackDuplicate(report.id, event.target.value))} aria-label="Duplicate of">
                  <option value="">Duplicate of…</option>
                  {duplicateCandidates.map((row) => <option key={row.id} value={row.id}>BETA-{row.number} · {row.title}</option>)}
                </select>
              )}
            </div>
          </div>
        )}

        <ol className="space-y-2">
          {report.comments.map((comment) => {
            const plusOne = (comment.detail as { plusOne?: boolean } | null)?.plusOne;
            return (
              <li key={comment.id} className={`rounded-xl px-3 py-2 text-sm ${comment.visibility === "internal" ? "border border-dashed border-hairline-strong bg-surface" : comment.kind === "request_info" ? "bg-amber-50" : comment.fromTeam ? "bg-blueprint-soft" : "bg-surface-muted"}`}>
                <p className="text-xs text-faint">
                  {comment.authorEmail ?? "Someone"} · {comment.visibility === "internal" ? "internal" : comment.fromTeam ? "to tester" : "tester"}
                  {comment.kind === "status_change" && ` · status → ${FEEDBACK_STATUS_LABEL[(comment.detail as { status?: BetaFeedbackStatus } | null)?.status ?? "new"]}`}
                  {comment.kind === "request_info" && " · question"} · {formatRelative(comment.createdAt)}
                </p>
                {plusOne ? <p className="text-primary">+1 — has this too</p> : comment.body && <p className="whitespace-pre-line text-primary">{comment.body}</p>}
              </li>
            );
          })}
        </ol>

        {can.triage && (
          <div className="space-y-2">
            <textarea className={inputClass()} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Reply to the tester, or write an internal note…" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button disabled={busy || !message.trim()} onClick={() => void act(() => api.commentBetaFeedback(report.id, message.trim(), "internal"), true)}>Internal note</Button>
              <Button disabled={busy || !message.trim()} onClick={() => void act(() => api.requestBetaFeedbackInfo(report.id, message.trim()), true)}>Ask the tester</Button>
              <Button variant="primary" disabled={busy || !message.trim()} onClick={() => void act(() => api.commentBetaFeedback(report.id, message.trim(), "tester"), true)}>Reply</Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Card>
  );
}
