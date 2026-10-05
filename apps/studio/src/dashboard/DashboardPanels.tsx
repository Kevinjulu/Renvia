import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@renvia/types";
import { creditsLeftPercent, useAccountStore } from "../lib/useAccountStore";
import { formatRelativeTime } from "../lib/relativeTime";
import { PencilIcon, PlusIcon } from "./icons";
import { toActivity } from "./projectActivity";

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

function PlanPanel() {
  const navigate = useNavigate();
  const me = useAccountStore((state) => state.me);
  const granted = useAccountStore((state) => state.granted);
  const isAdmin = me?.role === "admin";
  const balance = me?.creditBalance ?? 0;
  const percent = isAdmin ? null : creditsLeftPercent(balance, granted);
  return (
    <section className="dashboard-panel plan-panel">
      <div className="panel-heading"><h3>Your plan</h3><span>{isAdmin ? "Admin" : me?.entitlement?.plan.name ?? "Free"}</span></div>
      <p>{me === null ? "Loading credits…" : isAdmin ? <><b>Unlimited</b> credits</> : <><b>{balance}</b> {balance === 1 ? "credit" : "credits"} available</>}</p>
      {percent !== null && <div className="plan-progress" aria-hidden="true"><i><b style={{ width: `${percent}%` }} /></i><small>{percent}%</small></div>}
      <button type="button" onClick={() => navigate("/billing")}>Buy credits <span aria-hidden="true">→</span></button>
    </section>
  );
}

function ActivityPanel({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const events = useMemo(() => toActivity(projects, 4), [projects]);
  return (
    <section className="dashboard-panel activity-panel">
      <div className="panel-heading"><h3>Recent activity</h3>{events.length > 0 && <button type="button" onClick={() => navigate("/activity")}>View all →</button>}</div>
      {events.length === 0 ? <p className="activity-empty">Nothing yet — your project history will show up here.</p> : events.map((event) => (
        <div key={event.key} className="activity-item">
          <span>{event.kind === "created" ? <PlusIcon /> : <PencilIcon />}</span>
          <p><strong>{event.kind === "created" ? "You created a project" : "You edited a project"}</strong><small>{event.projectName}</small><time dateTime={event.at}>{formatRelativeTime(event.at)}</time></p>
        </div>
      ))}
    </section>
  );
}

export function DashboardPanels({ projects, onCreate, isCreating }: { projects: Project[]; onCreate: () => void; isCreating?: boolean }) {
  const navigate = useNavigate();
  return <aside className="dashboard-panels">
    <PlanPanel />
    <section className="dashboard-panel quick-panel"><h3>Quick actions</h3><button type="button" onClick={onCreate} disabled={isCreating}><span className="quick-dark"><PlusIcon /></span>{isCreating ? "Creating…" : "New project"}</button><button type="button" onClick={() => navigate("/assets?upload=1")}><span><Icon><path d="M4 10 12 4l8 6v9H4Z"/><path d="M12 8v7m-3-3 3 3 3-3"/></Icon></span>Upload file</button><button type="button" onClick={() => navigate("/templates")}><span><Icon><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></Icon></span>Browse templates</button><button type="button" onClick={() => navigate("/team")}><span><Icon><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 6a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/></Icon></span>Invite team</button></section>
    <ActivityPanel projects={projects} />
    <blockquote className="dashboard-quote">“Better spaces for a brighter tomorrow.”<span>— Renvia</span></blockquote>
  </aside>;
}
