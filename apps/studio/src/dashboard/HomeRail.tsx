import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@renvia/types";
import { MARKETING_URL } from "../lib/env";
import { formatRelativeTime } from "../lib/relativeTime";
import { ChevronRightIcon, CreditIcon, InviteIcon, LearnIcon, PencilIcon, PlusIcon, SparkleIcon } from "./icons";

const CARD = "rounded-xl border border-hairline bg-white p-4";
const CARD_TITLE = "font-display text-sm font-semibold text-primary";

function PlanCard({ credits }: { credits: number }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <p className={CARD_TITLE}>Your plan</p>
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-muted">Free</span>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-sm text-primary">
        <span className="text-blueprint">
          <CreditIcon />
        </span>
        {credits} {credits === 1 ? "credit" : "credits"} remaining
      </p>

      <button
        type="button"
        disabled
        title="Plans are coming soon"
        className="mt-3.5 flex h-[38px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Upgrade plan
        <ChevronRightIcon />
      </button>
    </div>
  );
}

const ACTION_ROW = "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors";
const ACTION_TILE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-muted text-primary";

function QuickActions({ onCreate, isCreating }: { onCreate: () => void; isCreating?: boolean }) {
  const navigate = useNavigate();

  return (
    <div className={CARD}>
      <p className={`${CARD_TITLE} mb-2.5`}>Quick actions</p>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          className={`${ACTION_ROW} text-primary hover:bg-surface-muted disabled:opacity-50`}
        >
          <span className={ACTION_TILE}>
            <PlusIcon />
          </span>
          {isCreating ? "Creating…" : "New project"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/help/getting-started")}
          className={`${ACTION_ROW} text-primary hover:bg-surface-muted`}
        >
          <span className={ACTION_TILE}>
            <LearnIcon />
          </span>
          Browse the guides
        </button>

        <a
          href={`${MARKETING_URL}/blog`}
          target="_blank"
          rel="noreferrer"
          className={`${ACTION_ROW} text-primary hover:bg-surface-muted`}
        >
          <span className={ACTION_TILE}>
            <SparkleIcon />
          </span>
          What&apos;s new
        </a>

        <button type="button" disabled title="Coming soon" className={`${ACTION_ROW} cursor-default text-faint/70`}>
          <span className={`${ACTION_TILE} text-faint/70`}>
            <InviteIcon />
          </span>
          Invite your team
        </button>
      </div>
    </div>
  );
}

interface ActivityEvent {
  key: string;
  kind: "created" | "edited";
  projectName: string;
  at: string;
}

/**
 * Activity is derived from the projects themselves — there is no activity table yet,
 * so this reports only what the project rows actually record: when each was created
 * and when it was last edited.
 */
function toActivity(projects: Project[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const project of projects) {
    events.push({ key: `${project.id}-created`, kind: "created", projectName: project.name, at: project.createdAt });

    const createdAt = new Date(project.createdAt).getTime();
    const updatedAt = new Date(project.updatedAt).getTime();
    if (updatedAt - createdAt > 60_000) {
      events.push({ key: `${project.id}-edited`, kind: "edited", projectName: project.name, at: project.updatedAt });
    }
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
}

function RecentActivity({ projects }: { projects: Project[] }) {
  const events = useMemo(() => toActivity(projects), [projects]);

  return (
    <div className={CARD}>
      <p className={CARD_TITLE}>Recent activity</p>

      {events.length === 0 ? (
        <p className="mt-3 text-xs text-faint">Nothing yet — your project history will show up here.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3.5">
          {events.map((event) => (
            <div key={event.key} className="flex gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-muted text-muted">
                {event.kind === "created" ? <PlusIcon /> : <PencilIcon />}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-[17px] text-primary">
                  {event.kind === "created" ? "You created a project" : "You edited a project"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">{event.projectName}</p>
                <p className="mt-0.5 text-[11px] text-faint">{formatRelativeTime(event.at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuoteCard() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-2 px-4 pb-[18px] pt-4">
      <svg viewBox="0 0 200 90" aria-hidden="true" className="absolute -bottom-1.5 -right-2.5 h-[86px] w-[190px] text-hairline-strong">
        <path
          d="M4 82h192M18 82V44l34-24 34 24v38M52 82V58h16v24M100 82V52l30-20 30 20v30M130 82V62h14v20"
          stroke="currentColor"
          strokeWidth="1.1"
          fill="none"
          strokeLinejoin="round"
        />
      </svg>
      <p className="relative text-sm italic leading-[21px] text-primary">“Better spaces for a brighter tomorrow.”</p>
      <p className="relative mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">— Renvia</p>
    </div>
  );
}

interface HomeRailProps {
  projects: Project[];
  onCreate: () => void;
  isCreating?: boolean;
  credits?: number;
}

export function HomeRail({ projects, onCreate, isCreating, credits = 0 }: HomeRailProps) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex">
      <PlanCard credits={credits} />
      <QuickActions onCreate={onCreate} isCreating={isCreating} />
      <RecentActivity projects={projects} />
      <QuoteCard />
    </aside>
  );
}
