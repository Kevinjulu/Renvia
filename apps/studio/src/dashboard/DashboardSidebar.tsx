import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { MARKETING_URL } from "../lib/env";
import type { RecentlyViewedEntry } from "../lib/localCollections";

export type DashboardView = "home" | "all" | "favorites";

interface DashboardSidebarProps {
  view: DashboardView;
  onChangeView: (view: DashboardView) => void;
  recentlyViewed: RecentlyViewedEntry[];
}

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" as const, "aria-hidden": true };

function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6.3 14V9.5h3.4V14" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="2.5" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="2.5" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="8.8" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="8.8" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg {...ICON_PROPS} fill={filled ? "currentColor" : "none"}>
      <path d="M8 2.3 9.8 6l4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.6l4-.6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.3l2.2 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}>
      <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="6.5" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 6.5h11.6M8 6.5V14" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 6.5c0-2-1.2-3-2.3-3-1 0-1.7.7-1.7 1.6 0 1 .8 1.4 1.5 1.4Zm0 0c0-2 1.2-3 2.3-3 1 0 1.7.7 1.7 1.6 0 1-.8 1.4-1.5 1.4Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6.3a4 4 0 0 1 8 0v3l1.2 2H2.8l1.2-2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 2.5 9.1 6 12.5 7 9.1 8l-1.1 3.5L6.9 8 3.5 7l3.4-1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function LearnIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.3 4h4.3a1.8 1.8 0 0 1 1.8 1.8v7A1.4 1.4 0 0 0 7 11.5H2.3Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M13.7 4H9.4a1.8 1.8 0 0 0-1.8 1.8v7A1.4 1.4 0 0 1 9 11.5h4.7Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 10.2v.01M8 8.2c0-1.3 1.4-1.2 1.4-2.4 0-1.1-.7-1.5-1.4-1.5s-1.4.4-1.4 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SidebarLink({
  icon,
  label,
  active,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-surface-2 font-medium text-primary" : "text-secondary hover:bg-surface-muted hover:text-primary"
      }`}
    >
      <span className={active ? "text-primary" : "text-faint"}>{icon}</span>
      {label}
    </button>
  );
}

function StubLink({ icon, label }: { icon: JSX.Element; label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className="flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-faint/70"
    >
      <span className="text-faint/70">{icon}</span>
      {label}
    </button>
  );
}

export function DashboardSidebar({ view, onChangeView, recentlyViewed }: DashboardSidebarProps) {
  const [recentExpanded, setRecentExpanded] = useState(true);
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-hairline bg-white px-3 py-4">
      <div className="px-1.5">
        <Logo wordmarkClassName="text-base" />
      </div>

      <nav className="mt-8 flex flex-col gap-0.5">
        <SidebarLink icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => onChangeView("home")} />
      </nav>

      <p className="mb-1 mt-6 px-2.5 font-mono text-[10px] uppercase tracking-wide text-faint">Projects</p>
      <nav className="flex flex-col gap-0.5">
        <SidebarLink icon={<GridIcon />} label="All projects" active={view === "all"} onClick={() => onChangeView("all")} />
        <SidebarLink icon={<StarIcon />} label="Favorites" active={view === "favorites"} onClick={() => onChangeView("favorites")} />

        <button
          type="button"
          onClick={() => setRecentExpanded((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-secondary transition-colors hover:bg-surface-muted hover:text-primary"
        >
          <ChevronIcon expanded={recentExpanded} />
          <span className="text-faint">
            <ClockIcon />
          </span>
          Recently viewed
        </button>
        {recentExpanded && (
          <div className="ml-4 flex flex-col gap-0.5 border-l border-hairline pl-3">
            {recentlyViewed.length === 0 ? (
              <p className="px-2.5 py-1 text-xs text-faint">Nothing yet</p>
            ) : (
              recentlyViewed.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => navigate(`/project/${entry.id}`)}
                  className="truncate rounded-lg px-2.5 py-1 text-left text-sm text-secondary transition-colors hover:bg-surface-muted hover:text-primary"
                  title={entry.name}
                >
                  {entry.name}
                </button>
              ))
            )}
          </div>
        )}
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col gap-0.5 border-t border-hairline pt-3">
        <StubLink icon={<GiftIcon />} label="Get free credits" />
        <StubLink icon={<BellIcon />} label="Notifications" />
        <a
          href={`${MARKETING_URL}/blog`}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-secondary transition-colors hover:bg-surface-muted hover:text-primary"
        >
          <span className="text-faint">
            <SparkleIcon />
          </span>
          What&apos;s new
        </a>
        <button
          type="button"
          onClick={() => navigate("/help/getting-started")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-secondary transition-colors hover:bg-surface-muted hover:text-primary"
        >
          <span className="text-faint">
            <LearnIcon />
          </span>
          Learn
        </button>
        <StubLink icon={<SupportIcon />} label="Support" />
      </nav>
    </div>
  );
}
