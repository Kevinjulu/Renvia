import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

export function DashboardPanels({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  return <aside className="dashboard-panels">
    <section className="dashboard-panel plan-panel"><div className="panel-heading"><h3>Your plan</h3><span>Free</span></div><p><b>0 / 10</b> renders used</p><div className="plan-progress"><i/><small>0%</small></div><button type="button" onClick={() => navigate("/billing")}>Upgrade plan <span>→</span></button></section>
    <section className="dashboard-panel quick-panel"><h3>Quick actions</h3><button type="button" onClick={onCreate}><span className="quick-dark">＋</span>New project</button><button type="button" onClick={() => navigate("/assets?upload=1")}><span><Icon><path d="M4 10 12 4l8 6v9H4Z"/><path d="M12 8v7m-3-3 3 3 3-3"/></Icon></span>Upload file</button><button type="button" onClick={() => navigate("/templates")}><span><Icon><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></Icon></span>Browse templates</button><button type="button" onClick={() => navigate("/team")}><span><Icon><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 6a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/></Icon></span>Invite team</button></section>
    <section className="dashboard-panel activity-panel"><div className="panel-heading"><h3>Recent activity</h3><button type="button" onClick={() => navigate("/activity")}>View all →</button></div><Activity icon="✎" title="You edited Project (2)" time="5 days ago"/><Activity icon="▧" title="Render completed" detail="Lakeside Villa" time="1 week ago"/><Activity icon="＋" title="You created a new project" detail="Modern Residence" time="1 week ago"/><Activity icon="⇧" title="File uploaded" detail="Apartment Interior" time="2 weeks ago"/></section>
    <blockquote className="dashboard-quote">“Better spaces for a brighter tomorrow.”<span>— Renvia</span></blockquote>
  </aside>;
}

function Activity({ icon, title, detail, time }: { icon: string; title: string; detail?: string; time: string }) { return <div className="activity-item"><span>{icon}</span><p><strong>{title}</strong>{detail && <small>{detail}</small>}<time>{time}</time></p></div>; }
