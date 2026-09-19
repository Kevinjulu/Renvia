import { Link } from "react-router-dom";
import { AlertTriangle, BarChart3, Coins, Cpu, ImageIcon, Trophy, Users, Wallet } from "lucide-react";
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
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Users"
              value={formatNumber(data.users.total)}
              icon={Users}
              accent="blue"
              trend={data.users.newLast7Days > 0 ? { value: `${data.users.newLast7Days} this week`, direction: "up" } : undefined}
              detail={data.users.disabled ? `${data.users.disabled} disabled` : "All active"}
            />
            <StatCard
              label="Renders"
              value={formatNumber(data.renders.total)}
              icon={ImageIcon}
              accent="emerald"
              detail={`${formatNumber(data.renders.today)} today`}
            />
            <StatCard
              label="Failure rate"
              value={formatPercent(data.renders.failureRate)}
              icon={AlertTriangle}
              accent={data.renders.failureRate >= 0.1 ? "rose" : "neutral"}
              detail={`${data.renders.byStatus.failed} failed · ${data.renders.byStatus.processing + data.renders.byStatus.pending} in flight`}
            />
            <StatCard
              label="Credits held"
              value={formatNumber(data.credits.outstanding)}
              icon={Coins}
              accent="amber"
              detail={`${formatNumber(data.credits.granted)} granted · ${formatNumber(data.credits.spent)} spent`}
            />
          </div>

          <Card
            title="fal spend"
            icon={Wallet}
            actions={<Pill tone={data.spend.mode === "prod" ? "amber" : "neutral"}>{MODE_LABEL[data.spend.mode]}</Pill>}
          >
            <BudgetMeter spent={data.spend.spentUsd} budget={data.spend.budgetUsd} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Renders per day · last 14 days" icon={BarChart3} className="lg:col-span-2">
              {data.daily.every((day) => day.renders === 0) ? (
                <EmptyState icon={BarChart3}>No renders in the last 14 days.</EmptyState>
              ) : (
                <DailyChart days={data.daily} />
              )}
            </Card>

            <Card title="Top users" icon={Trophy}>
              {data.topUsers.length === 0 ? (
                <EmptyState icon={Users}>No renders yet.</EmptyState>
              ) : (
                <ul className="space-y-1">
                  {data.topUsers.map((user, index) => (
                    <li key={user.id}>
                      <Link
                        to={`/users/${user.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface"
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${
                            index === 0 ? "bg-glow-soft text-[#8a5a17]" : index === 1 ? "bg-surface-muted text-secondary" : index === 2 ? "bg-glow-soft/60 text-[#a06a1f]" : "bg-surface-muted text-faint"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-primary">{user.email}</span>
                        <span className="shrink-0 text-right text-xs tabular-nums">
                          <span className="block font-medium text-primary">{formatNumber(user.renders)}</span>
                          <span className="text-faint">{formatUsd(user.spentUsd)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Spend by model" icon={Cpu}>
            {data.spend.byModel.length === 0 ? (
              <EmptyState icon={Cpu}>No spend yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {data.spend.byModel.map((row) => (
                  <li key={row.model} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs text-secondary">{formatModel(row.model)}</span>
                    <span className="tabular-nums text-muted">
                      {formatNumber(row.renders)} renders · <span className="font-medium text-primary">{formatUsd(row.spentUsd)}</span>
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
  const tone = ratio >= 0.9 ? "bg-rose-500" : ratio >= 0.7 ? "bg-glow" : "bg-accent-sheen";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-bold tabular-nums text-primary">
          {formatUsd(spent)} <span className="text-base font-normal text-muted">of {formatUsd(budget)}</span>
        </p>
        <p className="text-sm tabular-nums text-muted">{formatUsd(Math.max(0, budget - spent))} left</p>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent}
        aria-label="fal spend against budget"
      >
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">
        Estimated from model prices. Renders stop with “budget used up” once spend reaches the cap.
      </p>
    </div>
  );
}
