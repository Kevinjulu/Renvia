import { AccountMenu } from "../components/account/AccountMenu";

export function DashboardTopBar() {
  return (
    <header className="dashboard-topbar">
      <div className="dashboard-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input aria-label="Search" placeholder="Search projects, files, or tools..." />
        <kbd>⌘&nbsp; K</kbd>
      </div>
      <button type="button" className="dashboard-icon-button" aria-label="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></svg></button>
      <AccountMenu />
    </header>
  );
}
