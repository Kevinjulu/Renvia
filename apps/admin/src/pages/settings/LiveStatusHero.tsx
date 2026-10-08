import { AlertTriangle } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { Pill } from "../../components/ui";
import { formatDateTime, formatRelative, formatUsd } from "../../lib/format";
import { MODE_LABEL } from "./constants";
import { HeroMeta } from "./components";

export function LiveStatusHero({ data, budget, spent, remaining, ratio, criticalRatio, meterTone, maintenanceOn }: { data: AdminSettings; budget: number; spent: number; remaining: number; ratio: number; criticalRatio: number; meterTone: string; maintenanceOn: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
      <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-hairline p-6 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">In effect now</p>
            <Pill tone={data.effectiveMode === "prod" ? "amber" : data.effectiveMode === "dev" ? "blue" : "neutral"}>
              {MODE_LABEL[data.effectiveMode]}
            </Pill>
            {data.falMode === null && <span className="text-xs text-faint">via env</span>}
            {maintenanceOn && <Pill tone="red">Maintenance</Pill>}
          </div>
          <p className="mt-3 font-display text-3xl font-bold tracking-tight text-primary">
            {formatUsd(spent)}
            <span className="ml-2 text-lg font-normal text-muted">of {formatUsd(budget)}</span>
          </p>
          <p className="mt-1 text-sm text-muted">{formatUsd(remaining)} remaining before renders pause</p>

          <div className="mt-5">
            <div
              className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-valuenow={spent}
              aria-valuemin={0}
              aria-valuemax={budget || spent || 1}
              aria-label="fal spend against budget"
            >
              <div className={`h-full rounded-full transition-all ${meterTone}`} style={{ width: `${ratio * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-faint">
              Alerts at {data.budgetWarningPercent}% / {data.budgetCriticalPercent}% · stuck after {data.stuckTimeoutMinutes}m ·{" "}
              {data.creditsPerImage} credit{data.creditsPerImage === 1 ? "" : "s"}/image
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-1">
          <HeroMeta
            label="Override mode"
            value={data.falMode ? MODE_LABEL[data.falMode] : "None"}
            detail={data.envMode ? `Env default: ${data.envMode}` : "No FAL_MODE env set"}
          />
          <HeroMeta
            label="Override budget"
            value={data.falBudgetUsd === null ? "None" : formatUsd(data.falBudgetUsd)}
            detail={data.envBudgetUsd !== null ? `Env default: ${formatUsd(data.envBudgetUsd)}` : "No FAL_BUDGET_USD env set"}
          />
          <HeroMeta
            label="Last changed"
            value={formatRelative(data.updatedAt)}
            detail={data.updatedByEmail ? `by ${data.updatedByEmail}` : formatDateTime(data.updatedAt)}
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      </div>
      {(data.effectiveMode === "prod" || ratio >= criticalRatio || maintenanceOn) && (
        <div className="flex items-start gap-2 border-t border-hairline bg-[#f8ebe3]/60 px-5 py-3 text-sm text-[#8a3d14]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {maintenanceOn
            ? data.maintenanceMessage?.trim() ||
              "Maintenance is on — non-admin renders and/or segmentations are paused."
            : data.effectiveMode === "prod"
              ? "Production mode is live — every successful render spends fal credit."
              : "Budget is nearly exhausted — new paid renders will be blocked soon."}
        </div>
      )}
    </section>
  );
}
