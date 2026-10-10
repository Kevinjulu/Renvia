import { useState } from "react";
import { CheckCircle2, ClipboardCheck, History, Play, XCircle } from "lucide-react";
import type { AdminApproval, ApprovalStatus } from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill } from "../components/ui";
import { NoteDialog } from "../components/NoteDialog";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const STATUS_TONE: Record<ApprovalStatus, "amber" | "blue" | "emerald" | "red" | "neutral"> = {
  pending: "amber",
  approved: "blue",
  executed: "emerald",
  rejected: "red",
  cancelled: "neutral",
};

const ACTION_LABEL: Record<AdminApproval["action"], string> = {
  bulk_credits: "Bulk credit grant",
  role_change: "Role change",
  refund: "Refund",
  maintenance: "Maintenance",
};

type Decision = { approval: AdminApproval; kind: "approve" | "reject" };

/**
 * Approval is deliberately separate from execution: a second admin approves, then someone with
 * the action's permission executes it. The API decides who may do what; the page only shows it.
 */
export function ApprovalsPage() {
  const api = useAdminApi();
  const nav = navForPath("/approvals");
  const { data, error, reload, lastUpdated } = useLoad(() => api.listApprovals(), [api], 30_000);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirmExecute, setConfirmExecute] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const execute = async (id: string) => {
    setExecuting(id); setActionError(null);
    try { await api.executeApproval(id); setConfirmExecute(null); reload(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not execute the request."); }
    finally { setExecuting(null); }
  };

  return <>
    <PageHero title={nav.title} description={nav.description} image={nav.banner} actions={lastUpdated ? <span className="text-xs text-white/70">Updated {formatRelative(lastUpdated.toISOString())}</span> : undefined} />
    {(error || actionError) && <div className="mb-6"><ErrorNote onRetry={actionError ? () => setActionError(null) : reload}>{actionError ?? error}</ErrorNote></div>}
    {!data ? null : <div className="space-y-6">
      <Card title="Waiting on someone" icon={ClipboardCheck}>
        {data.open.length === 0 ? <EmptyState icon={CheckCircle2}>Nothing is waiting for approval or execution.</EmptyState> : <ul className="space-y-3">{data.open.map((approval) => <li key={approval.id} className="rounded-xl border border-hairline bg-surface p-4">
          <ApprovalSummary approval={approval} />
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            {approval.canApprove && <Button variant="primary" icon={CheckCircle2} onClick={() => setDecision({ approval, kind: "approve" })}>Approve</Button>}
            {approval.canReject && <Button variant="danger" icon={XCircle} onClick={() => setDecision({ approval, kind: "reject" })}>Reject</Button>}
            {approval.canExecute && (confirmExecute === approval.id
              ? <><span className="text-sm text-secondary">Run it now?</span><Button variant="primary" icon={Play} disabled={executing !== null} onClick={() => void execute(approval.id)}>{executing === approval.id ? "Executing…" : "Confirm execute"}</Button><Button variant="ghost" disabled={executing !== null} onClick={() => setConfirmExecute(null)}>Cancel</Button></>
              : <Button variant="primary" icon={Play} onClick={() => setConfirmExecute(approval.id)}>Execute</Button>)}
            {!approval.canApprove && !approval.canReject && !approval.canExecute && <p className="text-xs text-muted">{waitingOn(approval)}</p>}
          </div>
        </li>)}</ul>}
      </Card>
      <Card title="Recently closed" icon={History}>
        {data.recent.length === 0 ? <EmptyState icon={History}>No executed, rejected or cancelled requests yet.</EmptyState> : <ul className="divide-y divide-hairline">{data.recent.map((approval) => <li key={approval.id} className="py-3"><ApprovalSummary approval={approval} /></li>)}</ul>}
      </Card>
    </div>}
    {decision && <NoteDialog
      title={decision.kind === "approve" ? "Approve request" : "Reject request"}
      description={decision.approval.summary}
      label={decision.kind === "approve" ? "Approval note" : "Why are you rejecting it?"}
      required={decision.kind === "reject"}
      variant={decision.kind === "approve" ? "primary" : "danger"}
      confirmLabel={decision.kind === "approve" ? "Approve" : "Reject"}
      onConfirm={async (note) => {
        if (decision.kind === "approve") await api.approveApproval(decision.approval.id, note || undefined);
        else await api.rejectApproval(decision.approval.id, note);
        reload();
      }}
      onClose={() => setDecision(null)}
    />}
  </>;
}

function ApprovalSummary({ approval }: { approval: AdminApproval }) {
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-primary">{approval.summary}</h2><Pill tone={STATUS_TONE[approval.status]}>{approval.status}</Pill><Pill>{ACTION_LABEL[approval.action]}</Pill></div>
    <p className="mt-1 text-sm text-muted">{approval.reason}</p>
    <p className="mt-2 text-xs text-faint">
      Requested by {approval.requestedByEmail ?? "unknown"} {formatRelative(approval.createdAt)}
      {approval.decidedAt && ` · ${approval.status === "rejected" ? "rejected" : "approved"} by ${approval.decidedByEmail ?? "unknown"} ${formatRelative(approval.decidedAt)}`}
      {approval.executedAt && ` · executed ${formatRelative(approval.executedAt)}`}
    </p>
    {approval.decisionNote && <p className="mt-1 text-xs text-muted">Note: {approval.decisionNote}</p>}
  </div>;
}

/** Why this viewer has no buttons on an open request. */
function waitingOn(approval: AdminApproval): string {
  if (approval.status === "pending") return "Waiting for a second administrator to approve. You can't decide a request you made.";
  return "Approved. Waiting for someone with permission for this action to execute it.";
}
