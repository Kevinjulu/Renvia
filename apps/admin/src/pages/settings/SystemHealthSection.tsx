import { Shield } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import { HealthRow } from "./components";

export function SystemHealthSection({ data }: { data: AdminSettings }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
          <Shield size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">System health</h2>
          <p className="text-xs text-muted">Read-only — no secrets shown</p>
        </div>
      </div>
      <ul className="space-y-2.5">
        <HealthRow ok={data.health.falKeyConfigured} label="fal API key" detail={data.health.falKeyConfigured ? "Configured" : "Missing FAL_KEY"} />
        <HealthRow
          ok={data.health.storageConfigured}
          label="Object storage"
          detail={data.health.storageConfigured ? "Neon storage configured" : "Missing storage env"}
        />
        <HealthRow
          ok={Boolean(data.envMode)}
          label="Env mode"
          detail={data.envMode ?? "FAL_MODE unset (falls back to mock)"}
        />
        <HealthRow
          ok={data.envBudgetUsd !== null}
          label="Env budget"
          detail={data.envBudgetUsd !== null ? formatUsd(data.envBudgetUsd) : "FAL_BUDGET_USD unset"}
        />
      </ul>
    </section>
  );
}
