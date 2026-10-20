import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, Gauge, ScrollText, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { Button, ErrorNote, Skeleton } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { Draft, FieldErrors } from "./settings/types";
import { toDraft, validateDraft } from "./settings/draft";
import { diffChanges, isDangerous } from "./settings/diff";
import { ConfirmSaveModal } from "./settings/components";
import { LiveStatusHero } from "./settings/LiveStatusHero";
import { CreditsLimitsSection } from "./settings/CreditsLimitsSection";
import { EngineBudgetSection } from "./settings/EngineBudgetSection";
import { MaintenanceSection } from "./settings/MaintenanceSection";
import { InputLimitsSection } from "./settings/InputLimitsSection";
import { BlockedMessagesSection } from "./settings/BlockedMessagesSection";
import { StuckDetectionSection } from "./settings/StuckDetectionSection";
import { SystemHealthSection } from "./settings/SystemHealthSection";
import { ModelsSection } from "./settings/ModelsSection";
import { ExemptionsSection } from "./settings/ExemptionsSection";
import { RecentChangesSection } from "./settings/RecentChangesSection";
import { GovernanceSection } from "./settings/GovernanceSection";
import { StorageSection } from "./settings/StorageSection";
import { FreeCreditsSection } from "./settings/FreeCreditsSection";

type GroupId = "status" | "engine" | "customers" | "safety";
const GROUPS: { id: GroupId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "status", label: "Status", hint: "What's in effect, health, history", icon: Activity },
  { id: "engine", label: "Engine & spend", hint: "Mode, budget, storage, models", icon: Gauge },
  { id: "customers", label: "Customers", hint: "Credits, free allowance, input limits", icon: Users },
  { id: "safety", label: "Safety", hint: "Maintenance, approvals, exemptions", icon: ShieldCheck },
];

/** Which group's section owns each field, so a validation error can take the operator to it. */
const FIELD_GROUP: Partial<Record<keyof Draft, GroupId>> = {
  budgetWarningPercent: "engine", budgetCriticalPercent: "engine", falBudgetUsd: "engine", falMode: "engine",
  stuckTimeoutMinutes: "engine", storageCapMb: "engine", storagePerUserMb: "engine",
  maintenanceMessage: "safety", maintenanceRenders: "safety", maintenanceSegments: "safety",
};

const ENGINE_KEYS = new Set(["falMode", "falBudgetUsd", "budgetWarningPercent", "budgetCriticalPercent", "stuckTimeoutMinutes", "storageCapMb", "storagePerUserMb"]);

/** Which group a pending change belongs to; anything not engine or maintenance is a customer-facing setting. */
function groupOfChange(key: string): GroupId {
  if (ENGINE_KEYS.has(key)) return "engine";
  if (key.startsWith("maintenance")) return "safety";
  return "customers";
}

export function SettingsPage() {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getSettings(), [api]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  const requested = params.get("group");
  const group: GroupId = GROUPS.some((item) => item.id === requested) ? (requested as GroupId) : "status";
  const showGroup = (id: GroupId) => setParams(id === "status" ? {} : { group: id }, { replace: true });

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  const changes = useMemo(() => (data && draft ? diffChanges(data, draft) : []), [data, draft]);
  const dirty = changes.length > 0;
  const pendingByGroup = useMemo(() => {
    const counts: Record<GroupId, number> = { status: 0, engine: 0, customers: 0, safety: 0 };
    for (const change of changes) counts[groupOfChange(change.key)] += 1;
    return counts;
  }, [changes]);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data || !draft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
    setFieldErrors({});
  };

  const attemptSave = (event: FormEvent) => {
    event.preventDefault();
    const result = validateDraft(draft);
    if (!result.body) {
      setFieldErrors(result.errors);
      const bad = Object.keys(result.errors) as (keyof Draft)[];
      const groups = [...new Set(bad.map((key) => FIELD_GROUP[key] ?? "customers"))];
      const names = groups.map((id) => GROUPS.find((item) => item.id === id)!.label);
      if (!groups.includes(group)) showGroup(groups[0]!);
      setStatus({ tone: "error", text: `Fix the highlighted fields before saving (${names.join(", ")}).` });
      return;
    }
    if (changes.length === 0) return;
    setConfirmOpen(true);
  };

  const save = async () => {
    const result = validateDraft(draft);
    if (!result.body) return;
    setConfirmOpen(false);
    setSaving(true);
    try {
      const saved = await api.updateSettings(result.body);
      setDraft(toDraft(saved));
      setStatus(
        saved.pendingApproval
          ? { tone: "ok", text: "Saved. The maintenance change is waiting for a second admin in Approvals; everything else applies to the next request." }
          : { tone: "ok", text: "Settings saved. They apply to the next request — no redeploy needed." },
      );
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't save settings" });
    } finally {
      setSaving(false);
    }
  };

  const budget = data.effectiveBudgetUsd;
  const spent = data.spentUsd;
  const remaining = Math.max(0, budget - spent);
  const ratio = budget > 0 ? Math.min(1, spent / budget) : spent > 0 ? 1 : 0;
  const criticalRatio = data.budgetCriticalPercent / 100;
  const maintenanceOn = data.maintenanceRenders || data.maintenanceSegments;

  // Groups stay mounted (hidden, not unmounted) so nothing typed is lost when switching.
  const panelProps = (id: GroupId) => ({ hidden: group !== id, className: "space-y-6", role: "region" as const, "aria-label": `${GROUPS.find((item) => item.id === id)!.label} settings` });

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-primary">Settings</h1>
          <p className="mt-0.5 text-xs text-muted">Live ops controls. Changes apply to the next request, with no redeploy.</p>
        </div>
        <Link
          to="/audit?action=settings.update"
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3 py-2 text-xs font-medium text-secondary transition hover:text-primary"
        >
          <ScrollText size={14} />
          Audit trail
        </Link>
      </header>

      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
        <nav aria-label="Settings groups" className="sticky top-16 z-10 -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-hairline bg-surface/90 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-24 lg:mx-0 lg:mb-0 lg:flex-col lg:self-start lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          {GROUPS.map((item) => {
            const active = item.id === group;
            const pending = pendingByGroup[item.id];
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => showGroup(item.id)}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition lg:w-full ${active ? "bg-blueprint-soft text-blueprint" : "text-secondary hover:bg-surface"}`}
              >
                <item.icon size={17} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{item.label}</span>
                  <span className="mt-0.5 hidden text-[11px] leading-tight text-muted lg:block">{item.hint}</span>
                </span>
                {pending > 0 && (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-bold leading-5 text-amber-800">
                    <span aria-hidden="true">{pending}</span>
                    <span className="sr-only">{pending} unsaved {pending === 1 ? "change" : "changes"}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          <p className="sr-only" role="status" aria-live="polite">Showing {GROUPS.find((item) => item.id === group)?.label} settings</p>
          <form onSubmit={attemptSave} className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
            <div {...panelProps("status")}>
              <LiveStatusHero data={data} budget={budget} spent={spent} remaining={remaining} ratio={ratio} criticalRatio={criticalRatio} maintenanceOn={maintenanceOn} />
              <div className="grid items-start gap-6 xl:grid-cols-2">
                <SystemHealthSection data={data} />
                <RecentChangesSection data={data} />
              </div>
            </div>

            <div {...panelProps("engine")}>
              <div className="grid items-start gap-6 xl:grid-cols-2">
                <EngineBudgetSection data={data} draft={draft} fieldErrors={fieldErrors} update={update} />
                <div className="space-y-6">
                  <StuckDetectionSection draft={draft} fieldErrors={fieldErrors} update={update} />
                  <StorageSection data={data} draft={draft} fieldErrors={fieldErrors} update={update} />
                </div>
              </div>
              <ModelsSection data={data} />
            </div>

            <div {...panelProps("customers")}>
              <div className="grid items-start gap-6 xl:grid-cols-2">
                <CreditsLimitsSection draft={draft} plans={data.planMonthlyCredits} fieldErrors={fieldErrors} update={update} pricesPublished={data.creditPricesPublished} />
                <div className="space-y-6">
                  <FreeCreditsSection data={data} draft={draft} fieldErrors={fieldErrors} update={update} />
                  <InputLimitsSection draft={draft} fieldErrors={fieldErrors} update={update} />
                </div>
              </div>
              <BlockedMessagesSection draft={draft} fieldErrors={fieldErrors} update={update} />
            </div>

            <div {...panelProps("safety")}>
              <MaintenanceSection draft={draft} fieldErrors={fieldErrors} update={update} />
              <ExemptionsSection />
            </div>

            {/* One save bar for every group, so a change made in one group is never lost in another. */}
            {(dirty || status) && (
              <div className="sticky bottom-4 z-20 rounded-2xl border border-hairline bg-canvas/95 p-4 shadow-lift backdrop-blur">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {dirty ? (
                      <div>
                        <p className="text-sm font-medium text-primary">
                          {changes.length} {changes.length === 1 ? "change" : "changes"} ready to save
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                          {changes.map((change) => (
                            <li key={change.key}>
                              <span className="text-faint">{change.label}:</span> {change.from} → {change.to}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      status && (
                        <p role={status.tone === "error" ? "alert" : "status"} className={`text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>
                          {status.text}
                        </p>
                      )
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      setDraft(toDraft(data));
                      setFieldErrors({});
                      setStatus(null);
                    }}
                    disabled={!dirty || saving}
                  >
                    Reset
                  </Button>
                  <Button type="submit" variant="primary" disabled={!dirty || saving}>
                    {saving ? "Saving…" : "Review & save"}
                  </Button>
                </div>
              </div>
            )}
          </form>

          {/* Approval rules save on their own, so they live outside the settings form. */}
          <div hidden={group !== "safety"} className="mt-6">
            <GovernanceSection />
          </div>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmSaveModal
          changes={changes}
          dangerous={isDangerous(data, draft)}
          saving={saving}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
