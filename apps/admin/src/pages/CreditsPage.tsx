import { Link, useSearchParams } from "react-router-dom";
import type { CreditLedgerReason } from "@renvia/types";
import { Wallet } from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, Table } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatCreditReason } from "../lib/labels";
import { formatDateTime, formatNumber } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

const REASONS: { value: CreditLedgerReason | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "admin_grant", label: "Admin" },
  { value: "signup_bonus", label: "Signup" },
  { value: "render", label: "Render" },
  { value: "render_refund", label: "Render refund" },
  { value: "segment", label: "Segment" },
  { value: "segment_refund", label: "Segment refund" },
  { value: "purchase", label: "Purchase" },
  { value: "initial_grant", label: "Initial" },
];

export function CreditsPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const reason = (params.get("reason") ?? "") as CreditLedgerReason | "";
  const offset = Number(params.get("offset") ?? 0);

  const { data, error, loading, reload } = useLoad(
    () => api.listCredits({ reason: reason || undefined, limit: PAGE_SIZE, offset }),
    [api, reason, offset],
  );

  return (
    <>
      <PageHeader title="Credits" description="Global credit ledger — grants, spends, and refunds." />
      <Card
        icon={Wallet}
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "entry" : "entries"}` : "Ledger"}
        actions={
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1" role="group" aria-label="Filter by reason">
            {REASONS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={reason === option.value}
                onClick={() => setParams(option.value ? { reason: option.value } : {})}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  reason === option.value ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.entries.length === 0 ? (
          <EmptyState icon={Wallet}>No credit activity{reason ? ` for “${formatCreditReason(reason)}”` : ""}.</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["Date", "User", "Change", "Reason", "Note"]}>
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="transition hover:bg-surface">
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(entry.createdAt)}</td>
                    <td className="px-5 py-3">
                      <Link to={`/users/${entry.userId}`} className="text-primary hover:text-blueprint">
                        {entry.userEmail}
                      </Link>
                    </td>
                    <td className={`px-5 py-3 font-medium tabular-nums ${entry.amount > 0 ? "text-emerald-700" : "text-primary"}`}>
                      {entry.amount > 0 ? "+" : ""}
                      {formatNumber(entry.amount)}
                    </td>
                    <td className="px-5 py-3 text-secondary">{formatCreditReason(entry.reason)}</td>
                    <td className="max-w-[280px] px-5 py-3 text-xs text-muted">
                      {entry.note || <span className="text-faint">—</span>}
                      {entry.actorEmail && <span className="mt-0.5 block text-faint">by {entry.actorEmail}</span>}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onChange={(next) => setParams({ ...(reason ? { reason } : {}), ...(next ? { offset: String(next) } : {}) })}
              />
            </div>
          )
        )}
      </Card>
    </>
  );
}
