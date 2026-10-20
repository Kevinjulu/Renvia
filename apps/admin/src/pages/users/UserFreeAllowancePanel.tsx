import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { AdminFreeAllowanceDecisionRequest, FreeAllowanceStatus } from "@renvia/types";
import { Button, Card, Pill, Skeleton } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { inputClass } from "../settings/components";

const STATUS: Record<FreeAllowanceStatus, { label: string; tone: "emerald" | "amber" | "red" | "neutral" | "blue" }> = {
  approved: { label: "Approved", tone: "emerald" },
  pending: { label: "Not checked yet", tone: "neutral" },
  verification_required: { label: "Needs verification", tone: "amber" },
  review_required: { label: "Needs review", tone: "amber" },
  denied: { label: "Denied", tone: "red" },
};

const KIND_LABEL = { signup: "Sign-up check", renewal: "Monthly check", evidence: "New evidence", claim: "Human check", operator: "Operator" } as const;

/**
 * Whether this account may receive the Free plan's monthly credits, why, and the decisions behind
 * it. Support can approve, send to review or have the checks run again; only an admin denies or
 * lifts a denial. A decision never touches the balance, plan or anything already granted.
 */
export function UserFreeAllowancePanel({ userId, onDone }: { userId: string; onDone: () => void }) {
  const api = useAdminApi();
  const role = useAdmin().role;
  const canReview = role === "support" || role === "admin";
  const canManage = role === "admin";
  const state = useLoad(() => api.getUserFreeAllowance(userId), [api, userId]);
  const [reason, setReason] = useState("");
  const [approvedUntil, setApprovedUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const data = state.data;
  const decide = async (decision: AdminFreeAllowanceDecisionRequest["decision"]) => {
    if (!reason.trim()) {
      setMessage({ tone: "error", text: "Add a reason first; it's kept in the audit trail." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.decideUserFreeAllowance(userId, {
        decision,
        reason: reason.trim(),
        approvedUntil: decision === "approve" && approvedUntil ? new Date(`${approvedUntil}T23:59:59`).toISOString() : null,
      });
      setReason("");
      setApprovedUntil("");
      setMessage({ tone: "ok", text: result.granted ? "Saved. Their free monthly credits were granted now." : "Saved." });
      state.reload();
      onDone();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save the decision" });
    } finally {
      setBusy(false);
    }
  };

  const status = data ? STATUS[data.status] : null;
  return (
    <Card title="Free credits" icon={ShieldCheck} className="mt-6" actions={status ? <Pill tone={status.tone}>{status.label}</Pill> : undefined}>
      {state.error ? (
        <p className="text-sm text-rose-600">{state.error}</p>
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-secondary">
              {!data.freePlan
                ? "They aren't on the Free plan, so this doesn't affect their credits now."
                : data.held
                  ? "Their Free plan's monthly credits are being withheld until this changes."
                  : data.mode === "off"
                    ? "Checks are off in Settings, so they receive the Free plan's monthly credits regardless."
                    : data.mode === "observe"
                      ? "Checks are in observe mode: recorded here, never withheld."
                      : "They receive the Free plan's monthly credits."}
            </p>
            {data.reason && <p className="text-xs text-muted">Why: {data.reason}</p>}
            <p className="text-xs text-faint">
              {data.decidedAt ? `Decided ${new Date(data.decidedAt).toLocaleString()} by ${data.decidedByEmail ?? "the checks"}` : "Approved before eligibility checks existed."}
              {data.approvedUntil ? ` · approval holds until ${new Date(data.approvedUntil).toLocaleDateString()}` : ""}
            </p>
            {data.assessments.length > 0 && (
              <ul className="space-y-2">
                {data.assessments.map((row) => (
                  <li key={row.id} className="rounded-xl border border-hairline px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-primary">{KIND_LABEL[row.kind]}: {STATUS[row.outcome].label}</span>
                      <span className="text-xs text-faint">{new Date(row.createdAt).toLocaleString()}{row.mode === "observe" ? " · observe" : ""}{row.score !== null ? ` · score ${row.score}` : ""}</span>
                    </div>
                    <p className="text-xs text-muted">{row.reason}{row.decidedByEmail ? ` — ${row.decidedByEmail}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canReview && (
            <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4">
              <label className="block text-sm text-primary">
                Reason
                <input className={inputClass()} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Confirmed a real architect by email" />
              </label>
              <label className="block text-sm text-primary">
                Approval holds until (optional)
                <input type="date" className={inputClass()} value={approvedUntil} onChange={(event) => setApprovedUntil(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy || (data.status === "denied" && !canManage)} onClick={() => void decide("approve")}>Approve</Button>
                <Button disabled={busy || (data.status === "denied" && !canManage)} onClick={() => void decide("review")}>Needs review</Button>
                <Button disabled={busy || (data.status === "denied" && !canManage)} onClick={() => void decide("reassess")}>Run checks again</Button>
                {canManage && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Deny this account's free monthly credits? Their balance and plan stay as they are.")) void decide("deny"); }}>Deny</Button>}
              </div>
              {message && <p role="status" className={`text-xs ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>{message.text}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
