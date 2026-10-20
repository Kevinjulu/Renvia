import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import type { AdminPlanCredits } from "@renvia/types";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass, SettingsCard } from "./components";

export function CreditsLimitsSection({ draft, plans, fieldErrors, update, pricesPublished }: { draft: Draft; plans: AdminPlanCredits[]; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void; pricesPublished: boolean }) {
  return (
    <SettingsCard icon={Coins} title="Credits & limits" hint="Monthly plan credits, per-job costs, and daily caps" accent="amber">
      <div className="space-y-5">
        <Field
          label="Monthly plan credits"
          hint="Granted at the start of each user's monthly period (their signup anniversary, or a paid renewal). Unused plan credits expire then; purchased and admin credits never do. A change applies from each user's next period."
          error={fieldErrors.planMonthlyCredits}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((plan) => (
              <label key={plan.slug} className="block text-xs text-muted">
                {plan.name}
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={draft.planMonthlyCredits[plan.slug] ?? ""}
                  onChange={(event) => update({ planMonthlyCredits: { ...draft.planMonthlyCredits, [plan.slug]: event.target.value } })}
                  className={`mt-1 ${inputClass(fieldErrors.planMonthlyCredits)}`}
                />
              </label>
            ))}
          </div>
        </Field>
        {pricesPublished && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
            Credit prices are published in <Link to="/plans" className="font-medium underline">Plans &amp; Pricing</Link>, so the two per-job costs below don't apply until pricing is handed back to Settings.
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Credits per image"
            hint="Charged for each render or edit."
            error={fieldErrors.creditsPerImage}
          >
            <input
              type="number"
              min={0}
              max={100}
              value={draft.creditsPerImage}
              onChange={(event) => update({ creditsPerImage: event.target.value })}
              className={inputClass(fieldErrors.creditsPerImage)}
            />
          </Field>
          <Field
            label="Credits per selection"
            hint="Charged for each automatic selection (Auto select in studio)."
            error={fieldErrors.creditsPerSelection}
          >
            <input
              type="number"
              min={0}
              max={100}
              value={draft.creditsPerSelection}
              onChange={(event) => update({ creditsPerSelection: event.target.value })}
              className={inputClass(fieldErrors.creditsPerSelection)}
            />
          </Field>
        </div>
        <Field
          label="Daily render limit per user"
          hint="Leave blank for unlimited. Admins are exempt; failed renders don’t count."
          error={fieldErrors.dailyRenderLimit}
        >
          <input
            type="number"
            min={1}
            max={10_000}
            placeholder="Unlimited"
            value={draft.dailyRenderLimit}
            onChange={(event) => update({ dailyRenderLimit: event.target.value })}
            className={inputClass(fieldErrors.dailyRenderLimit)}
          />
        </Field>
        <Field
          label="Daily segment limit per user"
          hint="Leave blank for unlimited. Admins are exempt; failed selections don’t count."
          error={fieldErrors.dailySegmentLimit}
        >
          <input
            type="number"
            min={1}
            max={10_000}
            placeholder="Unlimited"
            value={draft.dailySegmentLimit}
            onChange={(event) => update({ dailySegmentLimit: event.target.value })}
            className={inputClass(fieldErrors.dailySegmentLimit)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Monthly render limit per user"
            hint="Blank for unlimited. Counted per UTC calendar month."
            error={fieldErrors.monthlyRenderLimit}
          >
            <input
              type="number"
              min={1}
              max={100_000}
              placeholder="Unlimited"
              value={draft.monthlyRenderLimit}
              onChange={(event) => update({ monthlyRenderLimit: event.target.value })}
              className={inputClass(fieldErrors.monthlyRenderLimit)}
            />
          </Field>
          <Field
            label="Monthly segment limit per user"
            hint="Blank for unlimited. Counted per UTC calendar month."
            error={fieldErrors.monthlySegmentLimit}
          >
            <input
              type="number"
              min={1}
              max={100_000}
              placeholder="Unlimited"
              value={draft.monthlySegmentLimit}
              onChange={(event) => update({ monthlySegmentLimit: event.target.value })}
              className={inputClass(fieldErrors.monthlySegmentLimit)}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Credit balance cap"
            hint="Blank for uncapped. Grants that would exceed it are rejected."
            error={fieldErrors.maxCreditBalance}
          >
            <input
              type="number"
              min={1}
              max={1_000_000}
              placeholder="Uncapped"
              value={draft.maxCreditBalance}
              onChange={(event) => update({ maxCreditBalance: event.target.value })}
              className={inputClass(fieldErrors.maxCreditBalance)}
            />
          </Field>
          <Field
            label="Low-credit warning at"
            hint="Studio nudges the user at or below this balance. 0 turns it off."
            error={fieldErrors.lowCreditThreshold}
          >
            <input
              type="number"
              min={0}
              max={1000}
              value={draft.lowCreditThreshold}
              onChange={(event) => update({ lowCreditThreshold: event.target.value })}
              className={inputClass(fieldErrors.lowCreditThreshold)}
            />
          </Field>
        </div>
        <p className="rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-xs text-muted">
          These are the defaults. Give one tester a different allowance from{" "}
          <Link to="/users" className="font-medium text-blueprint hover:underline">
            their user page
          </Link>
          .
        </p>
      </div>
    </SettingsCard>
  );
}
