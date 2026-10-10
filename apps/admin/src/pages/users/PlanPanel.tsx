import { useEffect, useId, useState, type FormEvent } from "react";
import type { AdminPlanOption, AdminUserEntitlement } from "@renvia/types";
import { Button, Pill } from "../../components/ui";
import { NoteDialog } from "../../components/NoteDialog";
import { useAdminApi } from "../../lib/api";
import { formatDateTime, formatUsd } from "../../lib/format";

interface PlanPanelProps {
  userId: string;
  email: string;
  entitlement: AdminUserEntitlement | null;
  plans: AdminPlanOption[];
  /** Only admins may grant or remove plans. */
  canManage: boolean;
  onDone: () => void;
}

function planPrice(plan: AdminPlanOption): string {
  return plan.priceCents === 0 ? "Free" : `${formatUsd(plan.priceCents / 100)}/mo`;
}

/**
 * The plan in effect, the base plan underneath, and any plan an admin granted on top. A granted
 * plan never replaces the base plan, so removing it (or letting it end) simply restores the base.
 */
export function PlanPanel({ userId, email, entitlement, plans, canManage, onDone }: PlanPanelProps) {
  const api = useAdminApi();
  const [changing, setChanging] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!entitlement) return <p className="text-sm text-muted">No plan on record yet. One is created the next time they sign in.</p>;
  const override = entitlement.override;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-primary">{entitlement.planName}</span>
        {override?.active ? <Pill tone="blue">Granted by admin</Pill> : <Pill tone="neutral">{entitlement.provider ? `${entitlement.provider} subscription` : "Base plan"}</Pill>}
        <Pill tone={entitlement.status === "active" ? "emerald" : "amber"}>{entitlement.status.replace("_", " ")}</Pill>
      </div>

      {override?.active ? (
        <div className="rounded-xl border border-hairline bg-surface p-3">
          <p>
            {override.endsAt ? <>Until <strong>{formatDateTime(override.endsAt)}</strong>, then back to {entitlement.basePlanName}.</> : <>Until an admin removes it, then back to {entitlement.basePlanName}.</>}
          </p>
          <p className="mt-1 text-xs text-muted">Granted by {override.setByEmail ?? "unknown"}{override.setAt ? ` on ${formatDateTime(override.setAt)}` : ""}{override.reason ? `: ${override.reason}` : ""}</p>
        </div>
      ) : (
        <p className="text-muted">
          Their own plan.{entitlement.currentPeriodEnd ? ` Current period ends ${formatDateTime(entitlement.currentPeriodEnd)}.` : ""}
          {override && !override.active ? ` A granted ${override.planName} ended${override.endsAt ? ` ${formatDateTime(override.endsAt)}` : ""}.` : ""}
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setChanging(true)}>{override?.active ? "Change granted plan" : "Grant a plan"}</Button>
          {override?.active && <Button variant="danger" onClick={() => setRemoving(true)}>Remove granted plan</Button>}
        </div>
      ) : (
        <p className="text-xs text-faint">Only admins can grant or remove plans.</p>
      )}

      {changing && (
        <ChangePlanModal
          userId={userId}
          email={email}
          plans={plans.filter((plan) => plan.slug !== entitlement.basePlanSlug)}
          current={override?.active ? override : null}
          onClose={() => setChanging(false)}
          onDone={onDone}
        />
      )}
      {removing && override && (
        <NoteDialog
          title={`Remove ${override.planName}?`}
          description={`${email} goes back to ${entitlement.basePlanName} straight away.`}
          label="Reason"
          required
          variant="danger"
          confirmLabel="Remove plan"
          onConfirm={async (reason) => {
            await api.clearUserPlan(userId, reason);
            onDone();
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}

function ChangePlanModal({ userId, email, plans, current, onClose, onDone }: {
  userId: string;
  email: string;
  plans: AdminPlanOption[];
  current: NonNullable<AdminUserEntitlement["override"]> | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useAdminApi();
  const titleId = useId();
  const [planId, setPlanId] = useState(current?.planId ?? plans[plans.length - 1]?.id ?? "");
  const [endDate, setEndDate] = useState(current?.endsAt ? current.endsAt.slice(0, 10) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const canSubmit = Boolean(planId) && reason.trim().length > 0 && !saving && (!endDate || endDate > today);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      // The plan runs to the end of the chosen day, in the admin's time zone.
      const endsAt = endDate ? new Date(`${endDate}T23:59:59`).toISOString() : null;
      await api.setUserPlan(userId, { planId, endsAt, reason: reason.trim() });
      onDone();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't change the plan");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="text-lg font-semibold text-primary">Grant a plan</h2>
        <p className="mt-1 break-all text-sm text-muted">{email} gets this plan's limits straight away, without paying. Their own plan is kept underneath.</p>

        <fieldset className="mt-5 space-y-2">
          <legend className="text-sm font-medium text-primary">Plan</legend>
          {plans.map((plan) => (
            <label key={plan.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition ${planId === plan.id ? "border-blueprint bg-blueprint-soft" : "border-hairline hover:bg-surface"}`}>
              <span className="flex items-center gap-2.5">
                <input type="radio" name="plan" value={plan.id} checked={planId === plan.id} onChange={() => setPlanId(plan.id)} className="accent-[#2F6FED]" />
                <span className="font-medium text-primary">{plan.name}</span>
              </span>
              <span className="text-xs text-muted">{planPrice(plan)} · {plan.monthlyCredits} credits/mo</span>
            </label>
          ))}
        </fieldset>

        <label className="mt-4 block text-sm">
          <span className="font-medium text-primary">Ends on</span> <span className="text-faint">(optional)</span>
          <input type="date" min={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm outline-none focus:border-blueprint focus:bg-canvas" />
          <span className="mt-1 block text-xs text-muted">{endDate ? "They go back to their own plan after this day." : "Leave empty to keep it until an admin removes it."}</span>
        </label>

        <label className="mt-4 block text-sm">
          <span className="font-medium text-primary">Reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="e.g. Client demo account" className="mt-1.5 w-full rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm outline-none focus:border-blueprint focus:bg-canvas" />
        </label>

        <p className="mt-4 rounded-xl bg-surface px-3.5 py-2.5 text-xs text-muted">Monthly plan credits are not added yet. They arrive with the monthly credit allowance; until then, grant credits separately if needed.</p>

        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>{saving ? "Saving…" : "Grant plan"}</Button>
        </div>
      </form>
    </div>
  );
}
