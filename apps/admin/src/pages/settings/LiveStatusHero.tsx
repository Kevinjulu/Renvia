import { AlertTriangle } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { Gauge } from "../../components/charts";
import { Pill } from "../../components/ui";
import { formatDateTime, formatRelative, formatUsd } from "../../lib/format";
import { MODE_LABEL } from "./constants";

/** What is in effect right now: engine mode, budget use, maintenance, and where each value comes from. */
export function LiveStatusHero({ data, budget, spent, remaining, ratio, criticalRatio, maintenanceOn }: { data: AdminSettings; budget: number; spent: number; remaining: number; ratio: number; criticalRatio: number; maintenanceOn: boolean }) {
  const warning = data.budgetWarningPercent / 100;
  const nearlyOut = ratio >= criticalRatio;
  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">In effect now</p>
        <Pill tone={data.effectiveMode === "prod" ? "amber" : data.effectiveMode === "dev" ? "blue" : "neutral"}>{MODE_LABEL[data.effectiveMode]}</Pill>
        {data.falMode === null && <span className="text-xs text-faint">mode from environment</span>}
        {maintenanceOn && <Pill tone="red">Maintenance on</Pill>}
        <span className="ml-auto text-xs text-faint">Changed {formatRelative(data.updatedAt)}{data.updatedByEmail ? ` by ${data.updatedByEmail}` : ""}</span>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
        <div className="flex flex-col items-center">
          <Gauge ratio={ratio} warning={warning} critical={criticalRatio} label="fal spend against budget" size={220} />
          <p className="-mt-1 text-center text-xs text-muted">of budget used</p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          <Tile label="Spent" value={formatUsd(spent)} detail={`of ${formatUsd(budget)}`} />
          <Tile label="Remaining" value={formatUsd(remaining)} detail="before renders pause" tone={nearlyOut ? "text-rose-700" : undefined} />
          <Tile label="Alerts at" value={`${data.budgetWarningPercent}% / ${data.budgetCriticalPercent}%`} detail="warning / critical" />
          <Tile
            label="Mode override"
            value={data.falMode ? MODE_LABEL[data.falMode] : "None"}
            detail={data.envMode ? `Env default: ${data.envMode}` : "No FAL_MODE env set"}
          />
          <Tile
            label="Budget override"
            value={data.falBudgetUsd === null ? "None" : formatUsd(data.falBudgetUsd)}
            detail={data.envBudgetUsd !== null ? `Env default: ${formatUsd(data.envBudgetUsd)}` : "No FAL_BUDGET_USD env set"}
          />
          <Tile
            label="Job rules"
            value={`${data.stuckTimeoutMinutes}m stuck`}
            detail={`${data.creditsPerImage} credit${data.creditsPerImage === 1 ? "" : "s"}/image · changed ${formatDateTime(data.updatedAt)}`}
          />
        </div>
      </div>

      {(data.effectiveMode === "prod" || nearlyOut || maintenanceOn) && (
        <div className={`flex items-start gap-2 border-t px-5 py-3 text-sm ${maintenanceOn || nearlyOut ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {maintenanceOn
            ? data.maintenanceMessage?.trim() || "Maintenance is on — non-admin renders and/or segmentations are paused."
            : nearlyOut
              ? "Budget is nearly exhausted — new paid renders will be blocked soon."
              : "Production mode is live — every successful render spends fal credit."}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-hairline bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1.5 truncate text-lg font-bold tabular-nums tracking-tight ${tone ?? "text-primary"}`}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted" title={detail}>{detail}</p>
    </div>
  );
}
