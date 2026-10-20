import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import type { AdminGovernanceResponse } from "@renvia/types";
import { Button, ErrorNote } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { Field, ToggleRow, inputClass, SettingsCard } from "./components";

type Thresholds = AdminGovernanceResponse["settings"];

interface GovernanceDraft {
  bulkCredits: string;
  /** Dollars in the form; cents on the wire. */
  refundUsd: string;
  roleChange: boolean;
  maintenance: boolean;
  studio: boolean;
  reason: string;
}

function toDraft(settings: Thresholds): GovernanceDraft {
  return {
    bulkCredits: String(settings.bulkCreditApprovalThreshold),
    refundUsd: (settings.refundApprovalThresholdCents / 100).toFixed(2),
    // Role changes and maintenance switches carry a risk of 1, so any threshold of 1 or more holds them.
    roleChange: settings.roleChangeApprovalThreshold > 0,
    maintenance: settings.maintenanceApprovalThreshold > 0,
    studio: settings.studioChangeApprovalThreshold > 0,
    reason: "",
  };
}

/**
 * When a high-risk action waits for a second admin. Saved on its own, with a reason, apart
 * from the main settings form.
 */
export function GovernanceSection() {
  const api = useAdminApi();
  const me = useAdmin();
  const { data, error, reload } = useLoad(() => api.getGovernance(), [api]);
  const [draft, setDraft] = useState<GovernanceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) setDraft(toDraft(data.settings));
  }, [data]);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data || !draft) return null;

  const bulk = Number(draft.bulkCredits);
  const refundCents = Math.round(Number(draft.refundUsd) * 100);
  const bulkError = !Number.isInteger(bulk) || bulk < 0 || bulk > 1_000_000 ? "A whole number from 0 to 1,000,000" : undefined;
  const refundError = !Number.isFinite(refundCents) || refundCents < 0 || refundCents > 10_000_000 ? "An amount from 0 to 100,000" : undefined;
  const initial = toDraft(data.settings);
  const dirty = draft.bulkCredits !== initial.bulkCredits || draft.refundUsd !== initial.refundUsd || draft.roleChange !== initial.roleChange || draft.maintenance !== initial.maintenance || draft.studio !== initial.studio;
  const canSave = me.role === "admin" && dirty && !bulkError && !refundError && draft.reason.trim().length > 0 && !saving;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.updateGovernance({
        bulkCreditApprovalThreshold: bulk,
        refundApprovalThresholdCents: refundCents,
        roleChangeApprovalThreshold: draft.roleChange ? 1 : 0,
        maintenanceApprovalThreshold: draft.maintenance ? 1 : 0,
        studioChangeApprovalThreshold: draft.studio ? 1 : 0,
        reason: draft.reason.trim(),
      });
      setStatus({ tone: "ok", text: "Approval rules saved. They apply to the next request." });
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't save approval rules" });
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<GovernanceDraft>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
  };

  return (
    <form onSubmit={(event) => void save(event)}>
      <SettingsCard
        icon={ClipboardCheck}
        title="Approval rules"
        accent="blue"
        hint={<>Which high-risk actions wait for a second admin. 0 or off turns a rule off.{data.pending.length > 0 && (<> <Link to="/approvals" className="font-medium text-blueprint hover:underline">{data.pending.length} waiting for approval</Link></>)}</>}
      >

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bulk credit grants (credits)" hint="Credits per user × users. At or above this, the grant waits for approval." error={bulkError}>
          <input type="number" min={0} max={1_000_000} value={draft.bulkCredits} onChange={(event) => update({ bulkCredits: event.target.value })} className={inputClass(bulkError)} />
        </Field>
        <Field label="Refunds (amount)" hint="In the payment's currency. At or above this, the refund waits for approval." error={refundError}>
          <input type="number" min={0} step="0.01" value={draft.refundUsd} onChange={(event) => update({ refundUsd: event.target.value })} className={inputClass(refundError)} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <ToggleRow label="Role changes need approval" hint="Promotions, demotions and staff roles." checked={draft.roleChange} onChange={(roleChange) => update({ roleChange })} />
        <ToggleRow label="Maintenance switches need approval" hint="Pausing or resuming renders and selections, and scheduling or cancelling a window. With only one admin, leave this off." checked={draft.maintenance} onChange={(maintenance) => update({ maintenance })} />
        <ToggleRow label="Studio Control changes need approval" hint="Publishing or restoring feature rules." checked={draft.studio} onChange={(studio) => update({ studio })} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label="Reason for this change" hint="Kept in the audit trail.">
            <input value={draft.reason} maxLength={300} onChange={(event) => update({ reason: event.target.value })} placeholder="e.g. Second admin onboarded" className={inputClass()} />
          </Field>
        </div>
        <Button type="button" onClick={() => { setDraft(initial); setStatus(null); }} disabled={!dirty || saving}>Reset</Button>
        <Button type="submit" variant="primary" disabled={!canSave}>{saving ? "Saving…" : "Save rules"}</Button>
      </div>
      {status && <p role="status" className={`mt-3 text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{status.text}</p>}
    </SettingsCard>
    </form>
  );
}
