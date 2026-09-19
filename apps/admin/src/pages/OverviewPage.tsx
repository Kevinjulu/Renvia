import { Link } from "react-router-dom";
import { DailyChart } from "../components/DailyChart";
import { Card, EmptyState, ErrorNote, PageHeader, Pill, Skeleton, StatCard } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatModel, formatNumber, formatPercent, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const MODE_LABEL = { mock: "Mock (free)", dev: "Dev (cheap model)", prod: "Production" } as const;

export function OverviewPage() {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getOverview(), [api]);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;

  return (
    <>
      <PageHeader title="Overview" description="Usage, spend and credits across the whole workspace." />

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Users"
              value={formatNumber(data.users.total)}
              detail={`${data.users.newLast7Days} new this week${data.users.disabled ? ` · ${data.users.disabled} disabled` : ""}`}
            />
            <StatCard label="Renders" value={formatNumber(data.renders.total)} detail={`${data.renders.today} today`} />
            <StatCard
              label="Failure rate"
              value={formatPercent(data.renders.failureRate)}
              detail={`${data.renders.byStatus.failed} failed · ${data.renders.byStatus.processing + data.renders.byStatus.pending} in flight`}
            />
            <StatCard
              label="Credits held"
              value={formatNumber(data.credits.outstanding)}
              detail={`${formatNumber(data.credits.granted)} granted · ${formatNumber(data.credits.spent)} spent`}
            />
          </div>

          <Card title="fal spend" actions={<Pill tone={data.spend.mode === "prod" ? "amber" : "neutral"}>{MODE_LABEL[data.spend.mode]}</Pill>}>
            <BudgetMeter spent={data.spend.spentUsd} budget={data.spend.budgetUsd} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Renders per day · last 14 days" className="lg:col-span-2">
              {data.daily.every((day) => day.renders === 0) ? (
                <EmptyState>No renders in the last 14 days.</EmptyState>
              ) : (
                <DailyChart days={data.daily} />
              )}
            </Card>

            <Card title="Top users">
              {data.topUsers.length === 0 ? (
                <EmptyState>No renders yet.</EmptyState>
              ) : (
                <ul className="space-y-3">
                  {data.topUsers.map((user) => (
                    <li key={user.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link to={`/users/${user.id}`} className="truncate text-primary hover:text-blueprint">
                        {user.email}
                      </Link>
                      <span className="shrink-0 tabular-nums text-muted">
                        {formatNumber(user.renders)} · {formatUsd(user.spentUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Spend by model">
            {data.spend.byModel.length === 0 ? (
              <EmptyState>No spend yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {data.spend.byModel.map((row) => (
                  <li key={row.model} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="font-mono text-xs text-primary">{formatModel(row.model)}</span>
                    <span className="tabular-nums text-muted">
                      {formatNumber(row.renders)} renders · {formatUsd(row.spentUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/** Spend against the cap — a meter, not a chart: one value against one limit. */
function BudgetMeter({ spent, budget }: { spent: number; budget: number }) {
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 1;
  const tone = ratio >= 0.9 ? "bg-red-500" : ratio >= 0.7 ? "bg-glow" : "bg-blueprint";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums text-primary">
          {formatUsd(spent)} <span className="text-base font-normal text-muted">of {formatUsd(budget)}</span>
        </p>
        <p className="text-sm tabular-nums text-muted">{formatUsd(Math.max(0, budget - spent))} left</p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent}
        aria-label="fal spend against budget"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">
        Estimated from model prices. Renders stop with “budget used up” once spend reaches the cap.
      </p>
    </div>
  );
}
