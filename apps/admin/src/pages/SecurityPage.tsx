import { useState } from "react";
import { Link } from "react-router-dom";
import { Fingerprint, ListChecks, ShieldAlert, ShieldCheck, UserCheck, Wallet } from "lucide-react";
import type { FreeAllowanceStatus } from "@renvia/types";
import { Card, ErrorNote, Pagination, Pill, Skeleton, StatCard, Table } from "../components/ui";
import { PageTop } from "../components/PageTop";
import { useAdminApi } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE = 25;
const QUEUES: { status: Exclude<FreeAllowanceStatus, "approved" | "pending">; label: string }[] = [
  { status: "review_required", label: "Needs review" },
  { status: "verification_required", label: "Needs verification" },
  { status: "denied", label: "Denied" },
];
const MODE_LABEL = { off: "Off", observe: "Observe", enforce: "Enforce", paused: "Paused" } as const;

/**
 * Free-credit security: how the eligibility checks are working, and the accounts waiting on a
 * decision. Decisions are made on each account's page, where the evidence and history are.
 */
export function SecurityPage() {
  const api = useAdminApi();
  const overview = useLoad(() => api.getSecurityOverview(), [api], 60_000);
  const [queue, setQueue] = useState<(typeof QUEUES)[number]["status"]>("review_required");
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => api.getSecurityQueue(queue, PAGE, offset), [api, queue, offset], 60_000);
  const data = overview.data;
  const peak = Math.max(1, ...(data?.daily.map((day) => day.signups) ?? [1]));

  return (
    <>
      <PageTop title="Free-credit security" description="How the eligibility checks are working, and the accounts waiting on a decision." lastUpdated={overview.lastUpdated} loading={overview.loading} onRefresh={overview.reload} />

      {overview.error && !data ? (
        <ErrorNote onRetry={overview.reload}>{overview.error}</ErrorNote>
      ) : !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Checks" value={MODE_LABEL[data.mode]} icon={ShieldCheck} accent={data.mode === "enforce" ? "emerald" : data.mode === "paused" ? "rose" : "blue"}
              detail={data.mode === "observe" ? `${data.last7Days.wouldHold} sign-ups would have been held this week` : `${data.approvalsToday} of ${data.dailyApprovalLimit} automatic approvals used today`} />
            <StatCard label="Waiting on a decision" value={data.statuses.review_required + data.statuses.verification_required} icon={ListChecks} accent="amber"
              detail={`${data.heldFreeAccounts} Free account${data.heldFreeAccounts === 1 ? "" : "s"} held now · ${data.statuses.denied} denied`} />
            <StatCard label="Sign-ups checked (7 days)" value={data.last7Days.signups} icon={UserCheck}
              detail={`${data.last7Days.approved} approved · ${data.last7Days.verificationRequired} verification · ${data.last7Days.reviewRequired} review · ${data.last7Days.claimsPassed} cleared the human check`} />
            <StatCard label="Promotional budget" value={formatUsd(data.promo.spentUsd)} icon={Wallet}
              detail={data.promo.budgetUsd === null ? "No monthly cap" : `of ${formatUsd(data.promo.budgetUsd)} this month`} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title="Sign-ups checked, last 14 days" icon={ShieldAlert}>
              <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Daily sign-up checks, with how many were held">
                {data.daily.map((day) => (
                  <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date}: ${day.signups} checked, ${day.held} held`}>
                    <div className="flex w-full flex-1 flex-col justify-end">
                      <div className="w-full rounded-t bg-blueprint/70" style={{ height: `${(Math.max(0, day.signups - day.held) / peak) * 100}%` }} />
                      <div className="w-full bg-[#c45c26]" style={{ height: `${(day.held / peak) * 100}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums text-faint">{day.date.slice(8)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Blue: approved. Orange: held, or would have been in observe mode.</p>
            </Card>

            <Card title="Signals and setup" icon={Fingerprint}>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-2"><span className="text-muted">Browser & network signals</span><Pill tone={data.signalsEnabled && data.securityHashKeyConfigured ? "emerald" : "neutral"}>{data.signalsEnabled ? (data.securityHashKeyConfigured ? "On" : "On, key missing") : "Off"}</Pill></li>
                <li className="flex justify-between gap-2"><span className="text-muted">Browsers / networks linked</span><span className="tabular-nums text-primary">{data.links.devices} / {data.links.networks}</span></li>
                <li className="flex justify-between gap-2"><span className="text-muted">Human check (Turnstile)</span><Pill tone={data.turnstileConfigured ? "emerald" : "neutral"}>{data.turnstileConfigured ? "On" : "Not set up"}</Pill></li>
                <li className="flex justify-between gap-2"><span className="text-muted">Clerk deletion webhook</span><Pill tone={data.clerkWebhookConfigured ? "emerald" : "neutral"}>{data.clerkWebhookConfigured ? "On" : "Not set up"}</Pill></li>
                <li className="flex justify-between gap-2"><span className="text-muted">Closed accounts</span><span className="tabular-nums text-primary">{data.closedAccounts}</span></li>
              </ul>
              <p className="mt-3 text-xs text-faint">Change the mode, budget and signals on the <Link to="/settings" className="font-medium text-blueprint hover:underline">Settings</Link> page.</p>
            </Card>
          </div>
        </>
      )}

      <Card title="Review queue" icon={ListChecks} className="mt-4"
        actions={
          <div className="flex gap-1">
            {QUEUES.map((item) => (
              <button key={item.status} type="button" onClick={() => { setQueue(item.status); setOffset(0); }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${queue === item.status ? "bg-blueprint-soft text-blueprint" : "text-muted hover:bg-surface"}`}>
                {item.label}{data ? ` · ${data.statuses[item.status]}` : ""}
              </button>
            ))}
          </div>
        }>
        {list.error ? (
          <ErrorNote onRetry={list.reload}>{list.error}</ErrorNote>
        ) : !list.data ? (
          <Skeleton className="h-24" />
        ) : list.data.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">Nobody here.</p>
        ) : (
          <>
            <Table head={["Account", "Why", "Score", "Since", "Credits"]}>
              {list.data.items.map((item) => (
                <tr key={item.userId} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-3">
                    <Link to={`/users/${item.userId}`} className="font-medium text-primary hover:underline">{item.email}</Link>
                    {!item.freePlan && <span className="ml-2 text-xs text-faint">not on Free</span>}
                  </td>
                  <td className="max-w-md px-5 py-3 text-xs text-muted">{item.reason ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-secondary">{item.score ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted">{item.decidedAt ? new Date(item.decidedAt).toLocaleDateString() : "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-secondary">{item.creditBalance}</td>
                </tr>
              ))}
            </Table>
            <Pagination offset={offset} limit={PAGE} total={list.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </>
  );
}
