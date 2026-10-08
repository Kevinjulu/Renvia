import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass } from "./components";

export function CreditsLimitsSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-glow-soft text-[#8a5a17]">
          <Coins size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Credits & limits</h2>
          <p className="text-xs text-muted">Signup grants, per-job costs, and daily caps</p>
        </div>
      </div>
      <div className="space-y-5">
        <Field
          label="Signup bonus"
          hint="Credits every new account gets once. Existing users are unchanged."
          error={fieldErrors.signupBonusCredits}
        >
          <input
            type="number"
            min={0}
            max={1000}
            value={draft.signupBonusCredits}
            onChange={(event) => update({ signupBonusCredits: event.target.value })}
            className={inputClass(fieldErrors.signupBonusCredits)}
          />
        </Field>
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
    </section>
  );
}
