import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { AccountMenu } from "../components/account/AccountMenu";
import { MARKETING_URL } from "../lib/env";
import type { RecentlyViewedEntry } from "../lib/localCollections";
import {
  AiToolsIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  CreditIcon,
  DisclosureIcon,
  GiftIcon,
  GridIcon,
  HomeIcon,
  LayersIcon,
  LearnIcon,
  SettingsIcon,
  SparkleIcon,
  StarIcon,
  TeamIcon,
  TemplateIcon,
} from "./icons";

export type DashboardView = "home" | "all" | "favorites";

interface DashboardSidebarProps {
  view: DashboardView;
  onChangeView: (view: DashboardView) => void;
  recentlyViewed: RecentlyViewedEntry[];
}

const ROW = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors";

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
      className={`${ROW} ${
        active ? "bg-primary font-medium text-white" : "text-secondary hover:bg-surface-muted hover:text-primary"
      }`}
    >
      <span className={active ? "text-white" : "text-faint"}>{icon}</span>
      {label}
    </button>
  );
}

function ExternalLink({ icon, label, href }: { icon: JSX.Element; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${ROW} text-secondary hover:bg-surface-muted hover:text-primary`}>
      <span className="text-faint">{icon}</span>
      {label}
    </a>
  );
}

function StubLink({ icon, label }: { icon: JSX.Element; label: string }) {
  return (
    <button type="button" disabled title="Coming soon" className={`${ROW} cursor-default text-faint/70`}>
      <span className="text-faint/70">{icon}</span>
      {label}
    </button>
  );
}

/** A nested row inside the Projects group — no icon, aligned to the parent's label. */
function SubLink({ label, active, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active ? "bg-surface-2 font-medium text-primary" : "text-secondary hover:bg-surface-muted hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function UpgradeCard() {
  return (
    <div className="rounded-xl border border-hairline bg-surface-muted p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-glow">
          <CreditIcon size={14} />
        </span>
        <p className="font-display text-sm font-semibold text-primary">Upgrade to Pro</p>
      </div>
      <p className="mt-1.5 text-xs leading-[17px] text-muted">Unlimited renders, 4K exports and shared team projects.</p>
      <button
        type="button"
        disabled
        title="Plans are coming soon"
        className="mt-3 flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Upgrade
        <ChevronRightIcon />
      </button>
    </div>
  );
}

export function DashboardSidebar({ view, onChangeView, recentlyViewed }: DashboardSidebarProps) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const navigate = useNavigate();

  const projectsActive = view === "all" || view === "favorites";

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-hairline bg-white px-3 py-4">
      <div className="px-1.5">
        <Logo wordmarkClassName="text-base" />
      </div>

      <nav className="mt-8 flex flex-col gap-0.5">
        <SidebarLink icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => onChangeView("home")} />

        <button
          type="button"
          onClick={() => setProjectsExpanded((expanded) => !expanded)}
          className={`${ROW} ${
            projectsActive ? "bg-primary font-medium text-white" : "text-secondary hover:bg-surface-muted hover:text-primary"
          }`}
          aria-expanded={projectsExpanded}
        >
          <span className={projectsActive ? "text-white" : "text-faint"}>
            <GridIcon />
          </span>
          <span className="flex-1">Projects</span>
          <span className={projectsActive ? "text-white/70" : "text-faint"}>
            <DisclosureIcon expanded={projectsExpanded} />
          </span>
        </button>

        {projectsExpanded && (
          <div className="ml-[21px] flex flex-col gap-0.5 border-l border-hairline pl-3">
            <SubLink label="All projects" active={view === "all"} onClick={() => onChangeView("all")} />
            <SubLink label="Favorites" active={view === "favorites"} onClick={() => onChangeView("favorites")} />

            <button
              type="button"
              onClick={() => setRecentExpanded((expanded) => !expanded)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-secondary transition-colors hover:bg-surface-muted hover:text-primary"
              aria-expanded={recentExpanded}
            >
              <DisclosureIcon expanded={recentExpanded} />
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
                    <SubLink
                      key={entry.id}
                      label={entry.name}
                      title={entry.name}
                      onClick={() => navigate(`/project/${entry.id}`)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <StubLink icon={<CompassIcon />} label="Explore" />
        <StubLink icon={<TemplateIcon />} label="Templates" />
        <StubLink icon={<LayersIcon />} label="Assets" />
        <StubLink icon={<AiToolsIcon />} label="AI tools" />
      </nav>

      <div className="mx-2.5 my-4 h-px bg-hairline" />

      <nav className="flex flex-col gap-0.5">
        <StubLink icon={<TeamIcon />} label="Team" />
        <StubLink icon={<SettingsIcon />} label="Settings" />
      </nav>

      <div className="flex-1" />

      <nav className="mb-4 flex flex-col gap-0.5">
        <StubLink icon={<GiftIcon />} label="Get free credits" />
        <ExternalLink icon={<SparkleIcon />} label="What's new" href={`${MARKETING_URL}/blog`} />
        <button
          type="button"
          onClick={() => navigate("/help/getting-started")}
          className={`${ROW} text-secondary hover:bg-surface-muted hover:text-primary`}
        >
          <span className="text-faint">
            <LearnIcon />
          </span>
          Learn
        </button>
        <StubLink icon={<StarIcon />} label="Support" />
      </nav>

      <UpgradeCard />

      <div className="mt-3.5 min-w-0 overflow-hidden border-t border-hairline pt-3.5">
        <AccountMenu showName />
      </div>
    </div>
  );
}
