import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ClipboardCheck, History, SlidersHorizontal } from "lucide-react";
import type {
  AdminStudioControlResponse,
  MaintenanceScope,
  MaintenanceWindow,
  StudioConfig,
  StudioFeatureDefinition,
  StudioFeatureKey,
  StudioFeatureRule,
} from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton } from "../components/ui";
import { NoteDialog } from "../components/NoteDialog";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatNumber, formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useAdmin } from "../lib/useAdmin";
import { useLoad } from "../lib/useLoad";
import { inputClass } from "./settings/components";

const GROUPS: StudioFeatureDefinition["group"][] = ["Render", "Edit", "Resolution", "Auto select"];

const SCOPE_LABELS: Record<MaintenanceScope, string> = { all: "Renders and selections", renders: "Renders only", selections: "Selections only" };

const STATE_TONES: Record<MaintenanceWindow["state"], "amber" | "blue" | "neutral" | "red"> = { active: "red", upcoming: "amber", ended: "neutral", cancelled: "neutral" };

function sameRule(a: StudioFeatureRule, b: StudioFeatureRule) {
  return a.enabled === b.enabled && a.enforcement === b.enforcement && a.rolloutPercent === b.rolloutPercent && (a.message ?? "") === (b.message ?? "")
    && JSON.stringify([...(a.allowedPlans ?? [])].sort()) === JSON.stringify([...(b.allowedPlans ?? [])].sort()) && (a.allowedPlans === null) === (b.allowedPlans === null);
}

/** How a rule reads in one line. */
function describeRule(rule: StudioFeatureRule, plans: { slug: string; name: string }[]): string {
  if (!rule.enabled) return rule.enforcement === "observe" ? "Off (observing only — still allowed)" : "Off";
  const parts = [rule.allowedPlans ? `Plans: ${rule.allowedPlans.map((slug) => plans.find((plan) => plan.slug === slug)?.name ?? slug).join(", ") || "none"}` : "All plans"];
  if (rule.rolloutPercent < 100) parts.push(`${rule.rolloutPercent}% of users`);
  if (rule.enforcement === "observe" && (rule.allowedPlans || rule.rolloutPercent < 100)) parts.push("observing only");
  return parts.join(" · ");
}

export function StudioControlPage() {
  const api = useAdminApi();
  const me = useAdmin();
  const canManage = me.role === "admin";
  const nav = navForPath("/studio-control");
  const { data, error, reload, lastUpdated } = useLoad(() => api.getStudioControl(), [api], 60_000);
  const [draft, setDraft] = useState<StudioConfig | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  // Start editing from the published config; a background refresh never overwrites unsaved edits.
  useEffect(() => {
    if (data && (draft === null || baseVersion !== data.current.version) && !dirtyAgainst(draft, data)) {
      setDraft(structuredClone(data.current.config));
      setBaseVersion(data.current.version);
    }
  }, [data, draft, baseVersion]);

  const changed = useMemo(
    () => (data && draft ? data.features.filter((feature) => !sameRule(data.current.config.features[feature.key], draft.features[feature.key])) : []),
    [data, draft],
  );

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;

  const updateRule = (key: StudioFeatureKey, patch: Partial<StudioFeatureRule>) => {
    if (!draft) return;
    setDraft({ features: { ...draft.features, [key]: { ...draft.features[key], ...patch } } });
    setStatus(null);
  };

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || baseVersion === null || changed.length === 0 || !reason.trim()) return;
    setPublishing(true);
    setStatus(null);
    try {
      const result = await api.publishStudioConfig({ expectedVersion: baseVersion, config: draft, reason: reason.trim() });
      if ("pendingApproval" in result) {
        setStatus({ tone: "info", text: "Waiting for a second admin in Approvals. Nothing has changed for customers yet." });
      } else {
        setStatus({ tone: "ok", text: `Published v${result.version}. It applies to the next request.` });
        setDraft(null);
      }
      setReason("");
      reload();
    } catch (reasonError) {
      setStatus({ tone: "error", text: reasonError instanceof Error ? reasonError.message : "Couldn't publish" });
    } finally {
      setPublishing(false);
    }
  };

  const discard = () => {
    if (!data) return;
    setDraft(structuredClone(data.current.config));
    setBaseVersion(data.current.version);
    setStatus(null);
  };

  return (
    <>
      <PageHero
        title={nav.title}
        description={nav.description}
        image={nav.banner}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
            {data && <span>In force: v{data.current.version} · {formatRelative(data.current.createdAt)}</span>}
            {lastUpdated && <span className="text-white/60">Updated {formatRelative(lastUpdated.toISOString())}</span>}
            <Link to="/audit?action=studio.publish" className="rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 font-medium text-white backdrop-blur hover:bg-white/20">Audit trail</Link>
          </div>
        }
      />

      {!data || !draft ? (
        <div className="space-y-6"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-60 rounded-2xl" /></div>
      ) : (
        <div className="space-y-6">
          {data.pendingApprovals.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <ClipboardCheck size={16} />
              <span className="flex-1">{data.pendingApprovals.length} Studio Control or maintenance change{data.pendingApprovals.length === 1 ? " is" : "s are"} waiting in Approvals.</span>
              <Link to="/approvals" className="font-medium underline">Open Approvals</Link>
            </div>
          )}
          {baseVersion !== null && baseVersion !== data.current.version && (
            <ErrorNote onRetry={discard}>Version {data.current.version} was published while you were editing v{baseVersion}. Discard your edits to continue from the latest.</ErrorNote>
          )}

          <form onSubmit={(event) => void publish(event)} className="space-y-6">
            {GROUPS.map((group) => (
              <Card key={group} title={group} icon={SlidersHorizontal} bodyClassName="divide-y divide-hairline">
                {data.features.filter((feature) => feature.group === group).map((feature) => (
                  <FeatureRow
                    key={feature.key}
                    feature={feature}
                    rule={draft.features[feature.key]}
                    published={data.current.config.features[feature.key]}
                    plans={data.plans}
                    observations={data.observations.filter((row) => row.key === feature.key)}
                    disabled={!canManage}
                    onChange={(patch) => updateRule(feature.key, patch)}
                  />
                ))}
              </Card>
            ))}

            {canManage && (changed.length > 0 || status) && (
              <div className="sticky bottom-4 z-20 rounded-2xl border border-hairline bg-canvas/95 p-4 shadow-lift backdrop-blur">
                {changed.length > 0 ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-primary">{changed.length} feature{changed.length === 1 ? "" : "s"} changed: {changed.map((feature) => feature.label).join(", ")}</p>
                      <input
                        value={reason}
                        maxLength={300}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Reason (kept in the audit trail)"
                        aria-label="Reason for publishing"
                        className={inputClass()}
                      />
                    </div>
                    <Button type="button" onClick={discard} disabled={publishing}>Discard</Button>
                    <Button type="submit" variant="primary" disabled={publishing || !reason.trim() || baseVersion !== data.current.version}>
                      {publishing ? "Publishing…" : `Publish v${data.current.version + 1}`}
                    </Button>
                  </div>
                ) : null}
                {status && (
                  <p role="status" className={`text-sm ${changed.length > 0 ? "mt-2" : ""} ${status.tone === "error" ? "text-red-600" : status.tone === "info" ? "text-amber-800" : "text-emerald-700"}`}>{status.text}</p>
                )}
              </div>
            )}
          </form>

          <MaintenanceCard data={data} canManage={canManage} onChanged={reload} />

          <Card title="Versions" icon={History} bodyClassName="p-0">
            <ul className="divide-y divide-hairline">
              {data.revisions.map((revision) => (
                <li key={revision.version} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-12 font-semibold tabular-nums text-primary">v{revision.version}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-primary">{revision.reason}</span>
                    <span className="block text-xs text-muted">
                      {revision.publishedByEmail ?? "System"} · {formatDateTime(revision.createdAt)}
                      {revision.restoredFrom ? ` · restored v${revision.restoredFrom}` : ""}
                      {revision.approvalId ? " · approved" : ""} · <code className="font-mono" title={revision.checksum}>{revision.checksum.slice(0, 10)}</code>
                    </span>
                  </span>
                  {revision.version === data.current.version ? (
                    <Pill tone="emerald">In force</Pill>
                  ) : (
                    canManage && <Button type="button" onClick={() => setRestoring(revision.version)}>Restore</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {restoring !== null && (
            <NoteDialog
              title={`Restore v${restoring}`}
              description={`Publishes v${restoring}'s rules as v${data.current.version + 1}. History is kept; nothing is deleted.`}
              label="Reason"
              confirmLabel="Restore"
              required
              onConfirm={async (note) => {
                const result = await api.restoreStudioConfig({ version: restoring, expectedVersion: data.current.version, reason: note });
                setStatus("pendingApproval" in result
                  ? { tone: "info", text: "The restore is waiting for a second admin in Approvals." }
                  : { tone: "ok", text: `Restored v${restoring} as v${result.version}.` });
                setDraft(null);
                reload();
              }}
              onClose={() => setRestoring(null)}
            />
          )}
        </div>
      )}
    </>
  );
}

/** True when the editor holds changes to the config it was loaded from. */
function dirtyAgainst(draft: StudioConfig | null, data: AdminStudioControlResponse): boolean {
  if (!draft) return false;
  return data.features.some((feature) => !sameRule(draft.features[feature.key], data.current.config.features[feature.key]));
}

function FeatureRow({
  feature,
  rule,
  published,
  plans,
  observations,
  disabled,
  onChange,
}: {
  feature: StudioFeatureDefinition;
  rule: StudioFeatureRule;
  published: StudioFeatureRule;
  plans: { slug: string; name: string }[];
  observations: AdminStudioControlResponse["observations"];
  disabled: boolean;
  onChange: (patch: Partial<StudioFeatureRule>) => void;
}) {
  const edited = !sameRule(rule, published);
  const observed7d = observations.reduce((sum, row) => sum + row.last7d, 0);
  const observed24h = observations.reduce((sum, row) => sum + row.last24h, 0);
  const restricted = rule.allowedPlans !== null;
  const togglePlan = (slug: string) => {
    const current = rule.allowedPlans ?? [];
    onChange({ allowedPlans: current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug] });
  };

  return (
    <div className={`px-5 py-4 ${edited ? "bg-blueprint-soft/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-4">
        <label className="mt-0.5 flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={rule.enabled} disabled={disabled} onChange={(event) => onChange({ enabled: event.target.checked })} className="size-4 accent-[#2F6FED]" aria-label={`${feature.label} enabled`} />
        </label>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">
            {feature.label}
            {edited && <span className="ml-2 text-[11px] font-semibold uppercase text-blueprint">edited</span>}
          </p>
          <p className="text-xs text-muted">{feature.description}</p>
          <p className="mt-1 text-xs text-faint">{describeRule(rule, plans)}</p>
          {observed7d > 0 && (
            <p className="mt-1 text-xs text-amber-800">
              Would have refused {formatNumber(observed24h)} request{observed24h === 1 ? "" : "s"} in 24 h, {formatNumber(observed7d)} in 7 days ({formatNumber(Math.max(...observations.map((row) => row.users7d)))}+ users).
            </p>
          )}
        </div>
        <select
          value={rule.enforcement}
          disabled={disabled}
          onChange={(event) => onChange({ enforcement: event.target.value as StudioFeatureRule["enforcement"] })}
          className="rounded-lg border border-hairline bg-canvas px-2 py-1.5 text-xs"
          aria-label={`${feature.label} enforcement`}
          title="Observe allows every request but logs the ones this rule would refuse"
        >
          <option value="enforce">Enforce</option>
          <option value="observe">Observe only</option>
        </select>
      </div>

      {rule.enabled && (
        <div className="mt-3 grid gap-3 pl-8 sm:grid-cols-[1fr_auto]">
          <fieldset className="flex flex-wrap items-center gap-2 text-xs" disabled={disabled}>
            <legend className="sr-only">Plans</legend>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={!restricted} onChange={(event) => onChange({ allowedPlans: event.target.checked ? null : plans.map((plan) => plan.slug) })} className="size-3.5 accent-[#2F6FED]" />
              All plans
            </label>
            {restricted && plans.map((plan) => (
              <label key={plan.slug} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1">
                <input type="checkbox" checked={rule.allowedPlans!.includes(plan.slug)} onChange={() => togglePlan(plan.slug)} className="size-3.5 accent-[#2F6FED]" />
                {plan.name}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-xs text-muted">
            Rollout
            <input
              type="number"
              min={0}
              max={100}
              value={rule.rolloutPercent}
              disabled={disabled}
              onChange={(event) => onChange({ rolloutPercent: Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))) })}
              className="w-16 rounded-lg border border-hairline bg-canvas px-2 py-1 text-right tabular-nums"
            />
            % of users
          </label>
        </div>
      )}
      {(!rule.enabled || rule.allowedPlans !== null || rule.rolloutPercent < 100) && (
        <div className="mt-3 pl-8">
          <input
            value={rule.message ?? ""}
            maxLength={280}
            disabled={disabled}
            onChange={(event) => onChange({ message: event.target.value.trim() ? event.target.value : null })}
            placeholder="Message customers see when they can't use it (optional)"
            aria-label={`${feature.label} message`}
            className={`${inputClass()} text-xs`}
          />
        </div>
      )}
    </div>
  );
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function MaintenanceCard({ data, canManage, onChanged }: { data: AdminStudioControlResponse; canManage: boolean; onChanged: () => void }) {
  const api = useAdminApi();
  const inAnHour = new Date(Date.now() + 60 * 60_000);
  const [form, setForm] = useState({ scope: "all" as MaintenanceScope, startsAt: toLocalInput(inAnHour), endsAt: toLocalInput(new Date(inAnHour.getTime() + 60 * 60_000)), message: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [cancelling, setCancelling] = useState<MaintenanceWindow | null>(null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { switches } = data.maintenance;

  const schedule = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.reason.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api.createMaintenanceWindow({
        scope: form.scope,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        message: form.message.trim() || null,
        reason: form.reason.trim(),
      });
      setStatus("pendingApproval" in result ? { tone: "info", text: "The window is waiting for a second admin in Approvals." } : { tone: "ok", text: "Maintenance scheduled." });
      setForm((current) => ({ ...current, message: "", reason: "" }));
      onChanged();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't schedule maintenance" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Maintenance windows" icon={CalendarClock}>
      {(switches.renders || switches.selections) && (
        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          The maintenance switch in <Link to="/settings" className="underline">Settings</Link> is on for {[switches.renders ? "renders" : null, switches.selections ? "selections" : null].filter(Boolean).join(" and ")}, independent of any window.
        </p>
      )}
      <p className="mb-4 text-xs text-muted">
        During a window, new renders or selections in its scope are refused; jobs already running finish. Admins and limit-exempt users aren't paused. Times are in {zone}.
      </p>

      {data.maintenance.windows.length === 0 ? (
        <EmptyState icon={CalendarClock}>No maintenance scheduled.</EmptyState>
      ) : (
        <ul className="divide-y divide-hairline">
          {data.maintenance.windows.map((window) => (
            <li key={window.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Pill tone={STATE_TONES[window.state]}>{window.state}</Pill>
              <span className="min-w-0 flex-1">
                <span className="block text-primary">{SCOPE_LABELS[window.scope]} · {formatDateTime(window.startsAt)} → {formatDateTime(window.endsAt)}</span>
                <span className="block text-xs text-muted">
                  {window.reason} · {window.createdByEmail ?? "Unknown"}
                  {window.message ? ` · “${window.message}”` : ""}
                  {window.cancelledAt ? ` · cancelled by ${window.cancelledByEmail ?? "unknown"}` : ""}
                </span>
              </span>
              {canManage && (window.state === "upcoming" || window.state === "active") && (
                <Button type="button" onClick={() => setCancelling(window)}>{window.state === "active" ? "End now" : "Cancel"}</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={(event) => void schedule(event)} className="mt-5 grid gap-3 border-t border-hairline pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-muted">
            Scope
            <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as MaintenanceScope })} className={inputClass()}>
              {Object.entries(SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            Starts
            <input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className={inputClass()} />
          </label>
          <label className="text-xs text-muted">
            Ends
            <input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className={inputClass()} />
          </label>
          <label className="text-xs text-muted">
            Reason
            <input required value={form.reason} maxLength={300} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Database upgrade" className={inputClass()} />
          </label>
          <label className="text-xs text-muted sm:col-span-2 lg:col-span-3">
            Message for customers (optional)
            <input value={form.message} maxLength={280} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Shown in the Studio before and during the window" className={inputClass()} />
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={saving || !form.reason.trim()} className="w-full">{saving ? "Scheduling…" : "Schedule"}</Button>
          </div>
          {status && <p role="status" className={`text-sm sm:col-span-2 lg:col-span-4 ${status.tone === "error" ? "text-red-600" : status.tone === "info" ? "text-amber-800" : "text-emerald-700"}`}>{status.text}</p>}
        </form>
      )}

      {cancelling && (
        <NoteDialog
          title={cancelling.state === "active" ? "End maintenance now" : "Cancel scheduled maintenance"}
          description={`${SCOPE_LABELS[cancelling.scope]}, ${formatDateTime(cancelling.startsAt)} → ${formatDateTime(cancelling.endsAt)}.`}
          label="Reason"
          confirmLabel={cancelling.state === "active" ? "End now" : "Cancel window"}
          required
          onConfirm={async (note) => {
            const result = await api.cancelMaintenanceWindow(cancelling.id, note);
            setStatus("pendingApproval" in result ? { tone: "info", text: "Waiting for a second admin in Approvals." } : { tone: "ok", text: "Window cancelled." });
            onChanged();
          }}
          onClose={() => setCancelling(null)}
        />
      )}
    </Card>
  );
}
