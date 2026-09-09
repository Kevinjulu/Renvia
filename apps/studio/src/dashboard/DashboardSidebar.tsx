import { useNavigate } from "react-router-dom";
import { Logo } from "../components/brand/Logo";

export type DashboardView = "home" | "all" | "favorites";
interface DashboardSidebarProps { view: DashboardView; onChangeView: (view: DashboardView) => void; onCreate: () => void; }

const icons: Record<string, JSX.Element> = {
  home: <><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  projects: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
  explore: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></>,
  templates: <><rect x="4" y="3" width="7" height="8" rx="1"/><rect x="13" y="3" width="7" height="4" rx="1"/><rect x="4" y="13" width="7" height="8" rx="1"/><rect x="13" y="9" width="7" height="12" rx="1"/></>,
  assets: <><path d="M4 9 12 4l8 5v10H4Z"/><circle cx="12" cy="12" r="2"/></>,
  tools: <><path d="m4 20 8-8M14 5l2-2 5 5-2 2M13 6l5 5M5 5l2 2M4 8l4-4M16 16l4 4"/></>,
  team: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
};
function NavIcon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>; }
function NavItem({ name, label, active, onClick }: { name: string; label: string; active?: boolean; onClick?: () => void }) { return <button type="button" onClick={onClick} className={`dashboard-nav-item ${active ? "is-active" : ""}`}><NavIcon name={name}/><span>{label}</span></button>; }

export function DashboardSidebar({ view, onChangeView, onCreate }: DashboardSidebarProps) {
  const navigate = useNavigate();
  return (
    <aside className="dashboard-sidebar">
      <Logo className="dashboard-logo" wordmarkClassName="text-[20px] text-white" />
      <nav className="dashboard-nav">
        <NavItem name="home" label="Home" active={view === "home"} onClick={() => onChangeView("home")}/><NavItem name="projects" label="Projects" active={view === "all"} onClick={() => onChangeView("all")}/><NavItem name="explore" label="Explore"/><NavItem name="templates" label="Templates"/><NavItem name="assets" label="Assets"/><NavItem name="tools" label="AI Tools"/>
      </nav>
      <div className="dashboard-nav-divider" />
      <nav className="dashboard-nav dashboard-nav-secondary"><NavItem name="team" label="Team"/><NavItem name="settings" label="Settings"/></nav>
      <div className="dashboard-upgrade-card"><p className="dashboard-upgrade-title"><span>♛</span> Upgrade to Pro</p><p>Unlock more renders,<br/>higher resolution and<br/>team features.</p><button type="button" onClick={onCreate}>Upgrade <span>→</span></button></div>
      <div className="dashboard-user"><span className="dashboard-user-avatar">KJ</span><span><strong>Kevin Julu</strong><small>Free Plan</small></span><button type="button" aria-label="Open account menu" onClick={() => navigate("/dashboard")}>⌃</button></div>
    </aside>
  );
}
