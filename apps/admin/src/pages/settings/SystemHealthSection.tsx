import { Shield } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import { HealthRow, SettingsCard } from "./components";

export function SystemHealthSection({ data }: { data: AdminSettings }) {
  return (
    <SettingsCard icon={Shield} title="System health" hint="Read-only — no secrets shown" accent="emerald">
      <ul className="space-y-2.5">
        <HealthRow ok={data.health.falKeyConfigured} label="fal API key" detail={data.health.falKeyConfigured ? "Configured" : "Missing FAL_KEY"} />
        <HealthRow
          ok={data.health.storageConfigured}
          label="Object storage"
          detail={data.health.storageConfigured ? "Configured" : "Missing STORAGE_* settings"}
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
    </SettingsCard>
  );
}
