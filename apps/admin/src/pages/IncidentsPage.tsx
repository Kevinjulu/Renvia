import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, RefreshCw, ShieldAlert, UserRoundCheck } from "lucide-react";
import type { AdminIncident, IncidentStatus } from "@renvia/types";
import { Card, EmptyState, ErrorNote, Pill, StatCard } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const STATUSES: { value: "" | IncidentStatus; label: string }[] = [{ value: "", label: "All" }, { value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }];
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

function tone(incident: AdminIncident): "red" | "amber" | "blue" | "emerald" | "neutral" {
  if (incident.status === "resolved") return "emerald";
  if (incident.severity === "critical" || incident.severity === "high") return "red";
  if (incident.status === "acknowledged") return "blue";
  return "amber";
}

function sourcePath(incident: AdminIncident) {
  if (incident.sourceType === "render") return `/renders?detail=${incident.sourceId}`;
  if (incident.sourceType === "segmentation") return `/segmentations?detail=${incident.sourceId}`;
  return incident.sourceType === "webhook" ? "/billing" : "/";
}

export function IncidentsPage() {
  const api = useAdminApi();
  const [status, setStatus] = useState<"" | IncidentStatus>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => api.getIncidents(status || undefined), [api, status], 30_000);
  useEffect(() => { void api.syncIncidents().then(reload).catch(() => undefined); }, [api, reload]);
  const action = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setActionError(null);
    try { await work(); reload(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update incident."); }
    finally { setBusy(null); }
  };
  const resolve = (incident: AdminIncident) => {
    const note = window.prompt("Resolution note (required):");
    if (!note?.trim()) return;
    void action(`resolve:${incident.id}`, () => api.resolveIncident(incident.id, note.trim()));
  };
  const acknowledge = (incident: AdminIncident) => {
    const note = window.prompt("Acknowledgement note (optional):") ?? undefined;
    void action(`ack:${incident.id}`, () => api.acknowledgeIncident(incident.id, note));
  };
  const nav = navForPath("/incidents");
  return <>
    <PageHero title={nav.title} description={nav.description} image={nav.banner} />
    {(error || actionError) && <ErrorNote onRetry={reload}>{actionError ?? error}</ErrorNote>}
    {!data ? null : <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Open" value={data.summary.open} icon={ShieldAlert} accent={data.summary.open ? "rose" : "neutral"} />
        <StatCard label="Acknowledged" value={data.summary.acknowledged} icon={UserRoundCheck} accent={data.summary.acknowledged ? "blue" : "neutral"} />
        <StatCard label="Critical" value={data.summary.criticalOpen} icon={AlertTriangle} accent={data.summary.criticalOpen ? "rose" : "neutral"} />
        <StatCard label="Resolved" value={data.summary.resolved} icon={CheckCircle2} accent="emerald" />
        <StatCard label="Notification failures" value={data.summary.failedNotifications} icon={Bell} accent={data.summary.failedNotifications ? "amber" : "neutral"} />
      </div>
      <Card title="Needs attention" icon={ShieldAlert} actions={<div className="flex gap-2"><button type="button" onClick={() => void action("sync", () => api.syncIncidents())} disabled={busy === "sync"} className="inline-flex items-center gap-2 rounded-xl border border-hairline px-3 py-2 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"><RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} />Sync alerts</button></div>}>
        <div className="mb-4 flex flex-wrap gap-2">{STATUSES.map((item) => <button key={item.label} type="button" onClick={() => setStatus(item.value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${status === item.value ? "bg-ink-900 text-white" : "bg-surface-muted text-muted hover:text-primary"}`}>{item.label}</button>)}</div>
        {data.incidents.length === 0 ? <EmptyState icon={CheckCircle2}>No incidents in this view. Sync checks failed webhooks and failed or stuck work.</EmptyState> : <div className="space-y-3">{data.incidents.map((incident) => <article key={incident.id} className="rounded-xl border border-hairline bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-primary">{incident.title}</h2><Pill tone={tone(incident)}>{incident.severity}</Pill><Pill tone={incident.status === "resolved" ? "emerald" : incident.status === "acknowledged" ? "blue" : "amber"}>{incident.status}</Pill></div><p className="mt-1 text-sm text-muted">{incident.summary}</p><p className="mt-2 text-xs text-faint">{incident.sourceType} · seen {incident.occurrenceCount} time{incident.occurrenceCount === 1 ? "" : "s"} · last seen {formatRelative(incident.lastSeenAt)}</p></div><a href={sourcePath(incident)} className="text-xs font-medium text-blueprint underline">Open source</a></div>
          <div className="mt-4 grid gap-3 border-t border-hairline pt-3 md:grid-cols-[1fr_auto_auto_auto]"><label className="text-xs text-muted">Owner<select value={incident.ownerId ?? ""} onChange={(event) => void action(`owner:${incident.id}`, () => api.assignIncident(incident.id, event.target.value || null))} disabled={incident.status === "resolved" || busy !== null} className="mt-1 block w-full rounded-lg border border-hairline bg-canvas px-2 py-1.5 text-sm text-primary"><option value="">Unassigned</option>{data.staff.map((staff) => <option value={staff.id} key={staff.id}>{staff.email} · {staff.role}</option>)}</select></label><label className="text-xs text-muted">Severity<select value={incident.severity} onChange={(event) => void action(`severity:${incident.id}`, () => api.updateIncidentSeverity(incident.id, event.target.value as typeof incident.severity))} disabled={incident.status === "resolved" || busy !== null} className="mt-1 block rounded-lg border border-hairline bg-canvas px-2 py-1.5 text-sm text-primary">{SEVERITIES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><div className="flex flex-wrap items-end gap-2">{incident.status === "open" && <button type="button" disabled={busy !== null} onClick={() => acknowledge(incident)} className="rounded-lg bg-blueprint px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Acknowledge</button>}{incident.status !== "resolved" && incident.sourceType === "webhook" && <button type="button" disabled={busy !== null} onClick={() => void action(`replay:${incident.id}`, () => api.replayBillingWebhook(incident.sourceId))} className="rounded-lg border border-blueprint px-3 py-2 text-xs font-medium text-blueprint disabled:opacity-50">Replay webhook</button>}{incident.status !== "resolved" && incident.sourceType === "segmentation" && <button type="button" disabled={busy !== null} onClick={() => void action(`recover:${incident.id}`, () => api.recoverSegmentation(incident.sourceId))} className="rounded-lg border border-blueprint px-3 py-2 text-xs font-medium text-blueprint disabled:opacity-50">Recover selection</button>}{incident.status !== "resolved" && incident.sourceType === "render" && <button type="button" disabled={busy !== null} onClick={() => void action(`refresh:${incident.id}`, () => api.refreshRender(incident.sourceId))} className="rounded-lg border border-blueprint px-3 py-2 text-xs font-medium text-blueprint disabled:opacity-50">Refresh render</button>}{incident.status !== "resolved" && <button type="button" disabled={busy !== null} onClick={() => resolve(incident)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Resolve</button>}<button type="button" disabled={busy !== null} onClick={() => void action(`notify:${incident.id}`, () => api.notifyIncident(incident.id))} className="rounded-lg border border-hairline px-3 py-2 text-xs font-medium disabled:opacity-50">Notify</button></div></div>
          {incident.sourceType === "system" && incident.context && <details className="mt-3 rounded-lg bg-canvas p-3 text-xs text-muted"><summary className="cursor-pointer font-medium text-primary">Technical report</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">{JSON.stringify(incident.context, null, 2)}</pre></details>}
          {(incident.acknowledgement || incident.resolution || incident.events.length > 0 || incident.notifications.length > 0) && <div className="mt-3 rounded-lg bg-canvas p-3 text-xs text-muted"><p>{incident.acknowledgement && `Acknowledged by ${incident.acknowledgement.byEmail ?? "unknown"} ${formatRelative(incident.acknowledgement.at)}.`} {incident.resolution && `Resolved by ${incident.resolution.byEmail ?? "unknown"}: ${incident.resolution.note}`}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{incident.events.slice(0, 4).map((event) => <span key={event.id}>{event.action} · {event.actorEmail ?? "system"} · {formatRelative(event.createdAt)}</span>)}{incident.notifications.slice(0, 1).map((notification) => <span key={notification.id}>notification: {notification.status}{notification.failureMessage ? ` (${notification.failureMessage})` : ""}</span>)}</div></div>}
        </article>)}</div>}
      </Card>
    </div>}
  </>;
}
