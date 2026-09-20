import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminAuditAction, AdminAuditEvent, AdminAuditRange } from "@renvia/types";
import {
  ChevronDown,
  Coins,
  Search,
  Settings,
  Shield,
  ScrollText,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { EmptyState, ErrorNote, Pagination, Pill, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatDay, formatNumber, formatRelative } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 30;

type ActionFilter = "" | AdminAuditAction;
type RangeFilter = "" | AdminAuditRange;

const ACTIONS: { value: ActionFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "credits.adjust", label: "Credits" },
  { value: "user.update", label: "Users" },
  { value: "settings.update", label: "Settings" },
];

const RANGES: { value: RangeFilter; label: string }[] = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const ACTION_META: Record<
  AdminAuditAction,
  { label: string; tone: "amber" | "blue" | "neutral"; icon: typeof Coins; chip: string }
> = {
  "credits.adjust": {
    label: "Credits",
    tone: "amber",
    icon: Coins,
    chip: "bg-[#f8ebe3] text-[#8a3d14]",
  },
  "user.update": {
    label: "User",
    tone: "blue",
    icon: Users,
    chip: "bg-blueprint-soft text-blueprint",
  },
  "settings.update": {
    label: "Settings",
    tone: "neutral",
    icon: Settings,
    chip: "bg-surface-muted text-secondary",
  },
};

export function AuditPage() {
  const api = useAdminApi();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const action = (params.get("action") ?? "") as ActionFilter;
  const actorId = params.get("actorId") ?? "";
  const range = (params.get("range") ?? "") as RangeFilter;
  const offset = Number(params.get("offset") ?? 0);
  const [draft, setDraft] = useState(search);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => {
      patchParams({ search: draft || undefined, offset: undefined });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    setExpanded(null);
  }, [search, action, actorId, range, offset]);

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next);
  };

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listAudit({
        search: search || undefined,
        action: action || undefined,
        actorId: actorId || undefined,
        range: range || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, action, actorId, range, offset],
  );

  const groups = useMemo(() => groupByDay(data?.events ?? []), [data]);
  const selectedActor = data?.summary.actors.find((actor) => actor.id === actorId);

  return (
    <>
      <PageHero title={navForPath("/audit").title} description={navForPath("/audit").description} image={navForPath("/audit").banner} />

      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

      {!data ? (
        <div className="space-y-6">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

          {/* Accountability strip — not a StatCard grid */}
          <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCell
                label="Events"
                value={formatNumber(data.summary.total)}
                detail={`${formatNumber(data.summary.last7Days)} in last 7 days`}
                active={!action && !range}
                onClick={() => patchParams({ action: undefined, range: undefined })}
              />
              <SummaryCell
                label="Credits"
                value={formatNumber(data.summary.byAction["credits.adjust"])}
                detail="Grants & removals"
                active={action === "credits.adjust"}
                onClick={() => patchParams({ action: action === "credits.adjust" ? undefined : "credits.adjust" })}
                accent="amber"
              />
              <SummaryCell
                label="Users"
                value={formatNumber(data.summary.byAction["user.update"])}
                detail="Role & disable"
                active={action === "user.update"}
                onClick={() => patchParams({ action: action === "user.update" ? undefined : "user.update" })}
                accent="blue"
              />
              <SummaryCell
                label="Settings"
                value={formatNumber(data.summary.byAction["settings.update"])}
                detail={
                  data.summary.lastSettingsAt ? `Last ${formatRelative(data.summary.lastSettingsAt)}` : "No changes yet"
                }
                active={action === "settings.update"}
                onClick={() => patchParams({ action: action === "settings.update" ? undefined : "settings.update" })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-5 py-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Shield size={12} />
                {formatNumber(data.summary.uniqueActors)} {data.summary.uniqueActors === 1 ? "operator" : "operators"}
              </span>
              {data.summary.lastSettingsAt && (
                <Link to="/settings" className="hover:text-blueprint">
                  Open settings
                </Link>
              )}
            </div>
          </section>

          {/* Feed */}
          <section className="rounded-2xl border border-hairline bg-canvas shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-4">
              <div className="flex items-center gap-2">
                <ScrollText size={16} className="text-muted" />
                <h2 className="text-sm font-semibold text-primary">
                  {formatNumber(data.total)} {data.total === 1 ? "event" : "events"}
                </h2>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    type="search"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Search summary, actor, target…"
                    aria-label="Search audit log"
                    className="w-56 rounded-lg border border-hairline bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
                  />
                </div>
                <FilterPills
                  options={ACTIONS}
                  value={action}
                  onChange={(value) => patchParams({ action: value || undefined })}
                />
                <FilterPills
                  options={RANGES}
                  value={range}
                  onChange={(value) => patchParams({ range: value || undefined })}
                />
              </div>
            </div>

            {data.summary.actors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Actor</span>
                <button
                  type="button"
                  onClick={() => patchParams({ actorId: undefined })}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    !actorId ? "border-primary bg-primary text-white" : "border-hairline bg-surface text-secondary hover:text-primary"
                  }`}
                >
                  All
                </button>
                {data.summary.actors.map((actor) => (
                  <button
                    key={actor.id}
                    type="button"
                    onClick={() => patchParams({ actorId: actorId === actor.id ? undefined : actor.id })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                      actorId === actor.id
                        ? "border-primary bg-primary text-white"
                        : "border-hairline bg-surface text-secondary hover:text-primary"
                    }`}
                  >
                    <UserRound size={11} />
                    {actor.email}
                    <span className={actorId === actor.id ? "text-white/70" : "text-faint"}>{formatNumber(actor.count)}</span>
                  </button>
                ))}
              </div>
            )}

            {(selectedActor || actorId) && (
              <div className="border-b border-hairline px-5 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-primary">
                  Actor {selectedActor?.email ?? `${actorId.slice(0, 8)}…`}
                  <button
                    type="button"
                    onClick={() => patchParams({ actorId: undefined })}
                    className="grid h-4 w-4 place-items-center rounded text-muted hover:bg-surface-muted"
                    aria-label="Clear actor filter"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            )}

            {data.events.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={ScrollText}>
                  {search || action || actorId || range
                    ? "No events match these filters."
                    : "No admin actions recorded yet. Adjustments and settings changes will appear here."}
                </EmptyState>
              </div>
            ) : (
              <div>
                {groups.map((group) => (
                  <div key={group.day} className="border-b border-hairline last:border-b-0">
                    <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 bg-surface/95 px-5 py-2 backdrop-blur">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{group.label}</p>
                      <p className="text-[11px] tabular-nums text-muted">
                        {formatNumber(group.entries.length)} {group.entries.length === 1 ? "event" : "events"}
                      </p>
                    </div>
                    <ul className="relative">
                      <span className="absolute bottom-3 left-[2.15rem] top-3 w-px bg-hairline" aria-hidden="true" />
                      {group.entries.map((event) => (
                        <AuditRow
                          key={event.id}
                          event={event}
                          open={expanded === event.id}
                          onToggle={() => setExpanded((current) => (current === event.id ? null : event.id))}
                          onFilterActor={() => patchParams({ actorId: event.actorId })}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="px-5">
                  <Pagination
                    offset={offset}
                    limit={PAGE_SIZE}
                    total={data.total}
                    onChange={(next) => {
                      const nextParams = new URLSearchParams(params);
                      if (next) nextParams.set("offset", String(next));
                      else nextParams.delete("offset");
                      setParams(nextParams);
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  active,
  onClick,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  active?: boolean;
  onClick: () => void;
  accent?: "amber" | "blue";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`bg-canvas p-5 text-left transition hover:bg-surface ${active ? "ring-2 ring-inset ring-blueprint/30" : ""}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${
          accent === "amber" ? "text-[#8a3d14]" : accent === "blue" ? "text-blueprint" : "text-primary"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </button>
  );
}

function FilterPills({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === option.value ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AuditRow({
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

function EventDiff({ detail, action }: { detail: Record<string, unknown> | null; action: AdminAuditAction }) {
  if (!detail) return null;

  if (action === "credits.adjust") {
    const amount = typeof detail.amount === "number" ? detail.amount : null;
    const note = typeof detail.note === "string" ? detail.note : null;
    return (
      <div className="mt-4 rounded-xl border border-hairline bg-canvas px-3.5 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Change</p>
        <p className={`mt-1 text-lg font-semibold tabular-nums ${amount !== null && amount > 0 ? "text-emerald-700" : "text-primary"}`}>
          {amount === null ? "—" : `${amount > 0 ? "+" : ""}${formatNumber(amount)} credits`}
        </p>
        {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      </div>
    );
  }

  if (action === "user.update") {
    const before = asRecord(detail.before);
    const after = asRecord(detail.after);
    const rows: { label: string; from: string; to: string }[] = [];
    if (after && "role" in after && before) {
      rows.push({ label: "Role", from: String(before.role ?? "—"), to: String(after.role) });
    }
    if (after && "disabled" in after && before) {
      rows.push({
        label: "Status",
        from: before.disabled ? "Disabled" : "Active",
        to: after.disabled ? "Disabled" : "Active",
      });
    }
    if (rows.length === 0) return null;
    return (
      <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-canvas">
        <p className="border-b border-hairline px-3.5 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Diff</p>
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="w-16 text-muted">{row.label}</span>
              <span className="text-faint line-through">{row.from}</span>
              <span className="text-faint">→</span>
              <span className="font-medium text-primary">{row.to}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (action === "settings.update") {
    const before = asRecord(detail.before);
    const after = asRecord(detail.after);
    if (!before || !after) return null;
    const keys = Object.keys(after);
    if (keys.length === 0) return null;
    return (
      <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-canvas">
        <p className="border-b border-hairline px-3.5 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Settings diff</p>
        <ul className="divide-y divide-hairline">
          {keys.map((key) => (
            <li key={key} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
              <span className="min-w-[8rem] font-mono text-xs text-muted">{key}</span>
              <span className="text-faint line-through">{formatSettingValue(before[key])}</span>
              <span className="text-faint">→</span>
              <span className="font-medium text-primary">{formatSettingValue(after[key])}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-primary">{children}</dd>
    </div>
  );
}

function groupByDay(events: AdminAuditEvent[]) {
  const map = new Map<string, AdminAuditEvent[]>();
  for (const event of events) {
    const day = event.createdAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(event);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, entries]) => ({
    day,
    label: formatDay(day),
    entries,
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatSettingValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}
