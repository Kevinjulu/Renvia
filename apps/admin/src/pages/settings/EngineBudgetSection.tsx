import { Cpu } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import type { Draft, FieldErrors } from "./types";
import { MODES } from "./constants";
import { Field, inputClass } from "./components";

export function EngineBudgetSection({ data, draft, fieldErrors, update }: { data: AdminSettings; draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blueprint-soft text-blueprint">
          <Cpu size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Engine & budget</h2>
          <p className="text-xs text-muted">Mode, spend cap, and alert thresholds</p>
        </div>
      </div>
      <div className="space-y-5">
        <fieldset>
          <legend className="text-sm font-medium text-primary">Render mode</legend>
          <div className="mt-2 mb-3 flex flex-wrap gap-2">
            {(
              [
                { id: "safe", label: "Safe", mode: "mock" as const, budget: "" },
                { id: "dev", label: "Dev", mode: "dev" as const, budget: "5" },
                { id: "prod", label: "Prod", mode: "prod" as const, budget: "50" },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  update({
                    falMode: preset.mode,
                    falBudgetUsd: preset.budget,
                    ...(preset.id === "safe"
                      ? { maintenanceRenders: false, maintenanceSegments: false }
                      : {}),
                  })
                }
                className="rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-primary transition hover:border-blueprint hover:bg-blueprint-soft/40"
              >
                Preset: {preset.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {MODES.map((mode) => (
              <label
                key={mode.label}
                className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition ${
                  draft.falMode === mode.value
                    ? "border-blueprint bg-blueprint-soft/50 ring-1 ring-blueprint/20"
                    : "border-hairline hover:border-hairline-strong hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="falMode"
                  checked={draft.falMode === mode.value}
                  onChange={() => update({ falMode: mode.value })}
                  className="mt-1 accent-[#2F6FED]"
                />
                <span>
                  <span className="block text-sm font-medium text-primary">{mode.label}</span>
                  <span className="block text-xs text-muted">{mode.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="Budget cap (USD)"
          hint={`Leave blank to use the server env default. Effective now: ${formatUsd(data.effectiveBudgetUsd)}.`}
          error={fieldErrors.falBudgetUsd}
        >
          <input
            type="number"
            min={0}
            max={10_000}
            step="0.01"
            placeholder="Server default"
            value={draft.falBudgetUsd}
            onChange={(event) => update({ falBudgetUsd: event.target.value })}
            className={inputClass(fieldErrors.falBudgetUsd)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Budget warning %"
            hint="Overview alert when spend reaches this share of the cap."
            error={fieldErrors.budgetWarningPercent}
          >
            <input
              type="number"
              min={1}
              max={99}
              value={draft.budgetWarningPercent}
              onChange={(event) => update({ budgetWarningPercent: event.target.value })}
              className={inputClass(fieldErrors.budgetWarningPercent)}
            />
          </Field>
          <Field
            label="Budget critical %"
            hint="Must be higher than warning. Critical alert + hero tone."
            error={fieldErrors.budgetCriticalPercent}
          >
            <input
              type="number"
              min={2}
              max={100}
              value={draft.budgetCriticalPercent}
              onChange={(event) => update({ budgetCriticalPercent: event.target.value })}
              className={inputClass(fieldErrors.budgetCriticalPercent)}
            />
          </Field>
        </div>
      </div>
    </section>
  );
}
