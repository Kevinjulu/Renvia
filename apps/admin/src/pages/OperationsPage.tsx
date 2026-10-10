import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, ListTodo, ShieldAlert } from "lucide-react";
import { Card, EmptyState, ErrorNote } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

export function OperationsPage() {
  const api = useAdminApi(); const { data, error, reload, lastUpdated } = useLoad(() => api.getOperationsQueue(), [api], 20_000); const nav = navForPath("/operations");
  return <><PageHero title={nav.title} description={nav.description} image={nav.banner} actions={lastUpdated ? <span className="text-xs text-white/70">Updated {formatRelative(lastUpdated.toISOString())}</span> : undefined} />{error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}{!data ? null : <div className="grid gap-6 lg:grid-cols-3"><Card title="Assigned incidents" icon={ShieldAlert}>{data.assignedIncidents.length ? <ul className="space-y-3">{data.assignedIncidents.map((item) => <li key={item.id}><Link to="/incidents" className="font-medium text-blueprint hover:underline">{item.title}</Link><p className="text-xs text-muted">{item.severity} · {item.status} · {formatRelative(item.updatedAt)}</p></li>)}</ul> : <EmptyState icon={ShieldAlert}>No incidents assigned to you.</EmptyState>}</Card><Card title="Pending approvals" icon={ClipboardCheck}>{data.pendingApprovals.length ? <ul className="space-y-3">{data.pendingApprovals.map((item) => <li key={item.id}><Link to="/approvals" className="font-medium capitalize text-blueprint hover:underline">{item.action.replaceAll("_", " ")}</Link><p className="text-xs text-muted">{item.requestedBy} · {item.reason}</p></li>)}</ul> : <EmptyState icon={ClipboardCheck}>No approvals you can review.</EmptyState>}</Card><Card title="Failed jobs · last 7 days" icon={AlertTriangle}>{data.failedJobs.length ? <ul className="space-y-3">{data.failedJobs.map((item) => <li key={item.id}><Link to={`/${item.type === "render" ? "renders" : "segmentations"}?detail=${item.id}`} className="font-medium text-blueprint hover:underline">{item.label}</Link><p className="text-xs text-muted">{item.type} · {formatRelative(item.createdAt)}</p></li>)}</ul> : <EmptyState icon={ListTodo}>No failed jobs in the last 7 days.</EmptyState>}</Card></div>}</>;
}
