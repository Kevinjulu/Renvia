import { ShieldCheck } from "lucide-react";
import type { AdminSettings, FreeAllowanceMode } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass, SettingsCard } from "./components";

const MODES: { value: FreeAllowanceMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Every Free account gets its monthly credits, as before. The checks don't run." },
  { value: "observe", label: "Observe", hint: "The checks run and are recorded on each account, but never withhold anything. Use this first." },
  { value: "enforce", label: "Enforce", hint: "Only approved accounts get the Free plan's monthly credits. Others wait for review; nothing they already have changes." },
  { value: "paused", label: "Paused", hint: "Emergency: no Free account starts a new month of credits. Paid plans, purchases and beta credits are unaffected." },
];

/**
 * Free-plan credits: whether new and renewing Free accounts must pass the eligibility checks, and
 * the monthly promotional budget that caps what jobs paid from Free credits may spend at fal.
 */
export function FreeCreditsSection({ data, draft, fieldErrors, update }: { data: AdminSettings; draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  const budget = data.promoBudgetUsd;
  const ratio = budget && budget > 0 ? Math.min(1, data.promoSpentUsd / budget) : budget === 0 ? 1 : 0;
  const tone = ratio * 100 >= data.promoCriticalPercent ? "bg-rose-500" : ratio * 100 >= data.promoWarningPercent ? "bg-[#c45c26]" : "bg-emerald-500";

  return (
    <SettingsCard icon={ShieldCheck} title="Free credits" hint="Eligibility checks and the promotional budget" accent="blue">

      <fieldset>
        <legend className="text-sm font-medium text-primary">Eligibility checks</legend>
        <div className="mt-2 space-y-2">
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition ${
                draft.freeAllowanceMode === mode.value ? "border-blueprint bg-blueprint-soft/50 ring-1 ring-blueprint/20" : "border-hairline hover:border-hairline-strong hover:bg-surface"
              }`}
            >
              <input type="radio" name="freeAllowanceMode" checked={draft.freeAllowanceMode === mode.value} onChange={() => update({ freeAllowanceMode: mode.value })} className="mt-1 accent-[#2F6FED]" />
              <span>
                <span className="block text-sm font-medium text-primary">{mode.label}</span>
                <span className="block text-xs text-muted">{mode.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          The checks use the account's email (verified, a mailbox that already had free credits elsewhere, throwaway domains) and, when switched on below, its browser and network. Decide individual accounts on their user page.
        </p>
      </fieldset>

      <label className="mt-5 flex cursor-pointer gap-3 rounded-xl border border-hairline px-3 py-2.5">
        <input type="checkbox" checked={draft.securitySignalsEnabled} onChange={(event) => update({ securitySignalsEnabled: event.target.checked })} className="mt-1 accent-[#2F6FED]" />
        <span>
          <span className="block text-sm font-medium text-primary">Use browser and network signals</span>
          <span className="block text-xs text-muted">
            Notes which accounts share a browser or a network, stored only as keyed hashes (never the browser id or IP address) and deleted after 180 and 30 days. Turn on only once the privacy notice says so.
            {!data.securityHashKeyConfigured && " SECURITY_HASH_KEY isn't set, so nothing is recorded yet."}
          </span>
        </span>
      </label>
      <p className="mt-2 text-xs text-faint">
        Human check (Cloudflare Turnstile): {data.turnstileConfigured ? "on — accounts held for verification can clear it themselves." : "off — set TURNSTILE_SECRET_KEY in the API and VITE_TURNSTILE_SITE_KEY in the Studio."}
      </p>

      <div className="mt-5">
        <Field label="Automatic approvals per day" hint="New accounts the checks may approve per UTC day. Past it, more wait for review, which caps a burst of sign-ups." error={fieldErrors.freeAllowanceDailyApprovals}>
          <input type="number" min={1} max={10000} value={draft.freeAllowanceDailyApprovals} onChange={(event) => update({ freeAllowanceDailyApprovals: event.target.value })} className={inputClass(fieldErrors.freeAllowanceDailyApprovals)} />
        </Field>
      </div>

      <div className="mt-6 mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium text-primary">Promotional budget this month</span>
        <span className="text-xs tabular-nums text-muted">
          {formatUsd(data.promoSpentUsd)} {budget === null ? "spent · no cap" : `of ${formatUsd(budget)}`}
        </span>
      </div>
      {budget !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={data.promoSpentUsd} aria-label="Promotional budget used">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
      <div className="mt-4">
        <Field
          label="Monthly promotional budget (USD)"
          hint="fal spend that jobs paid from Free-plan credits may use each UTC month, inside the global budget. When it runs out only those jobs are refused; paid and purchased usage carries on. Blank = no separate cap."
          error={fieldErrors.promoBudgetUsd}
        >
          <input type="number" min={0} max={10000} step="0.01" value={draft.promoBudgetUsd} onChange={(event) => update({ promoBudgetUsd: event.target.value })} className={inputClass(fieldErrors.promoBudgetUsd)} />
        </Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Warn at (%)" hint="Opens an incident." error={fieldErrors.promoWarningPercent}>
          <input type="number" min={1} max={99} value={draft.promoWarningPercent} onChange={(event) => update({ promoWarningPercent: event.target.value })} className={inputClass(fieldErrors.promoWarningPercent)} />
        </Field>
        <Field label="Critical at (%)" hint="Opens a second incident." error={fieldErrors.promoCriticalPercent}>
          <input type="number" min={2} max={100} value={draft.promoCriticalPercent} onChange={(event) => update({ promoCriticalPercent: event.target.value })} className={inputClass(fieldErrors.promoCriticalPercent)} />
        </Field>
      </div>
    </SettingsCard>
  );
}
