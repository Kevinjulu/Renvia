import { Link } from "react-router-dom";
import type { AdminAuditEvent } from "@renvia/types";
import { ChevronDown, Coins, Settings } from "lucide-react";
import { Pill } from "../../components/ui";
import { formatDateTime, formatRelative } from "../../lib/format";
import { ACTION_META } from "./helpers";
import { Detail } from "./parts";
import { EventDiff } from "./EventDiff";

export function AuditRow({
  event,
  open,
  onToggle,
  onFilterActor,
}: {
  event: AdminAuditEvent;
  open: boolean;
  onToggle: () => void;
  onFilterActor: () => void;
}) {
  const meta = ACTION_META[event.action];
  const Icon = meta.icon;

  return (
    <li className="relative">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-4 px-5 py-3.5 text-left transition hover:bg-surface">
        <span className={`relative z-[1] mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${meta.chip}`}>
          <Icon size={15} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={meta.tone}>{meta.label}</Pill>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFilterActor();
              }}
              className="truncate text-sm font-medium text-primary hover:text-blueprint"
            >
              {event.actorEmail}
            </button>
          </span>
          <span className="mt-1 block text-sm text-secondary">{event.summary}</span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted">{formatRelative(event.createdAt)}</span>
          <ChevronDown size={12} className={`text-faint transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-hairline bg-surface px-5 py-4 pl-[4.25rem]">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="When">{formatDateTime(event.createdAt)}</Detail>
            <Detail label="Actor">
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={onFilterActor} className="text-primary hover:text-blueprint">
                  {event.actorEmail}
                </button>
                <Link to={`/users/${event.actorId}`} className="text-xs text-blueprint hover:underline">
                  Open profile
                </Link>
              </span>
            </Detail>
            <Detail label="Action">{meta.label}</Detail>
            <Detail label="Target">{event.targetType}</Detail>
          </dl>

          <EventDiff detail={event.detail} action={event.action} />

          <div className="mt-4 flex flex-wrap gap-2">
            {event.targetType === "user" && event.targetId && (
              <>
                <Link
                  to={`/users/${event.targetId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-800"
                >
                  Open user
                </Link>
                {event.action === "credits.adjust" && (
                  <Link
                    to={`/credits?userId=${event.targetId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-surface"
                  >
                    <Coins size={13} /> User ledger
                  </Link>
                )}
              </>
            )}
            {event.action === "settings.update" && (
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-surface"
              >
                <Settings size={13} /> Open settings
              </Link>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
