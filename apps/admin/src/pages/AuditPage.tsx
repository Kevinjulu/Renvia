import { Link, useSearchParams } from "react-router-dom";
import type { AdminAuditAction } from "@renvia/types";
import { ScrollText } from "lucide-react";
import { Card, EmptyState, ErrorNote, PageHeader, Pagination, Pill, Table } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;

const ACTIONS: { value: AdminAuditAction | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "credits.adjust", label: "Credits" },
  { value: "user.update", label: "Users" },
  { value: "settings.update", label: "Settings" },
];

const ACTION_PILL: Record<AdminAuditAction, { tone: "blue" | "amber" | "neutral"; label: string }> = {
  "credits.adjust": { tone: "amber", label: "Credits" },
  "user.update": { tone: "blue", label: "User" },
  "settings.update": { tone: "neutral", label: "Settings" },
};

export function AuditPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();
  const action = (params.get("action") ?? "") as AdminAuditAction | "";
  const offset = Number(params.get("offset") ?? 0);

  const { data, error, loading, reload } = useLoad(
    () => api.listAudit({ action: action || undefined, limit: PAGE_SIZE, offset }),
    [api, action, offset],
  );

  return (
    <>
      <PageHeader title="Audit" description="Operator actions — credit adjustments, role changes, and settings." />
      <Card
        icon={ScrollText}
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "event" : "events"}` : "Audit log"}
        actions={
          <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="group" aria-label="Filter by action">
            {ACTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={action === option.value}
                onClick={() => setParams(option.value ? { action: option.value } : {})}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  action === option.value ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.events.length === 0 ? (
          <EmptyState icon={ScrollText}>
            {action ? "No events for this filter yet." : "No admin actions recorded yet. Adjustments and settings changes will appear here."}
          </EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <Table head={["When", "Actor", "Action", "Summary"]}>
                {data.events.map((event) => {
                  const pill = ACTION_PILL[event.action];
                  return (
                    <tr key={event.id} className="align-top transition hover:bg-surface">
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(event.createdAt)}</td>
                      <td className="px-5 py-3 text-sm text-primary">{event.actorEmail}</td>
                      <td className="px-5 py-3">
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                      </td>
                      <td className="max-w-[420px] px-5 py-3">
                        <p className="text-sm text-primary">{event.summary}</p>
                        {event.targetType === "user" && event.targetId && (
                          <Link to={`/users/${event.targetId}`} className="mt-1 inline-block text-xs text-blueprint hover:underline">
                            View user
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onChange={(next) => setParams({ ...(action ? { action } : {}), ...(next ? { offset: String(next) } : {}) })}
              />
            </div>
          )
        )}
      </Card>
    </>
  );
}
