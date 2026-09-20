import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminUser, AdminUserOrder, AdminUserSort } from "@renvia/types";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  Coins,
  MoreHorizontal,
  Search,
  Shield,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { ApiError, useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useAdmin } from "../lib/useAdmin";
import { useLoad } from "../lib/useLoad";

const PAGE_SIZE = 25;
const LOW_BALANCE = 5;

type RoleFilter = "" | "user" | "admin";
type StatusFilter = "" | "active" | "disabled";
type BalanceFilter = "" | "low" | "zero";

const SORTABLE: { key: AdminUserSort; label: string }[] = [
  { key: "createdAt", label: "Joined" },
  { key: "creditBalance", label: "Credits" },
  { key: "renderCount", label: "Renders" },
  { key: "spentUsd", label: "Spend" },
  { key: "lastRenderAt", label: "Last render" },
];

export function UsersPage() {
  const api = useAdminApi();
  const me = useAdmin();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const role = (params.get("role") ?? "") as RoleFilter;
  const status = (params.get("status") ?? "") as StatusFilter;
  const balance = (params.get("balance") ?? "") as BalanceFilter;
  const sort = (params.get("sort") ?? "createdAt") as AdminUserSort;
  const order = (params.get("order") ?? "desc") as AdminUserOrder;
  const offset = Number(params.get("offset") ?? 0);

  const [draft, setDraft] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grantTarget, setGrantTarget] = useState<AdminUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (draft === search) return;
    const timeout = setTimeout(() => {
      patchParams({ search: draft || undefined, offset: undefined });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    setSelected(new Set());
  }, [search, role, status, balance, sort, order, offset]);

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
      api.listUsers({
        search: search || undefined,
        role: role || undefined,
        status: status || undefined,
        balance: balance || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    [api, search, role, status, balance, sort, order, offset],
  );

  const pageIds = useMemo(() => data?.users.map((user) => user.id) ?? [], [data]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedUsers = useMemo(() => data?.users.filter((user) => selected.has(user.id)) ?? [], [data, selected]);

  const toggleSort = (key: AdminUserSort) => {
    if (sort === key) patchParams({ sort: key, order: order === "asc" ? "desc" : "asc" });
    else patchParams({ sort: key, order: "desc" });
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const runToggleDisabled = async (user: AdminUser) => {
    if (user.id === me.id) return;
    const verb = user.disabled ? "Enable" : "Disable";
    if (!window.confirm(`${verb} ${user.email}?`)) return;
    setBusyId(user.id);
    setActionError(null);
    try {
      await api.updateUser(user.id, { disabled: !user.disabled });
      reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Couldn't update user");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Users" description="Everyone who has signed in to the studio." />

      {actionError && (
        <div className="mb-4">
          <ErrorNote>{actionError}</ErrorNote>
        </div>
      )}

      {!data && !error ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={formatNumber(data.summary.total)} icon={Users} accent="blue" />
          <StatCard label="Admins" value={formatNumber(data.summary.admins)} icon={Shield} accent="neutral" />
          <StatCard label="Disabled" value={formatNumber(data.summary.disabled)} icon={Ban} accent={data.summary.disabled > 0 ? "rose" : "neutral"} />
          <StatCard
            label="Low balance"
            value={formatNumber(data.summary.lowBalance)}
            icon={Coins}
            accent={data.summary.lowBalance > 0 ? "amber" : "neutral"}
            detail={`Under ${LOW_BALANCE} credits`}
          />
        </div>
      ) : null}

      <Card
        title={data ? `${formatNumber(data.total)} ${data.total === 1 ? "match" : "matches"}` : "Users"}
        actions={
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search by email…"
              aria-label="Search users by email"
              className="w-64 rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
            />
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-4">
          <FilterGroup label="Role">
            {(
              [
                ["", "All"],
                ["user", "Users"],
                ["admin", "Admins"],
              ] as const
            ).map(([value, label]) => (
              <FilterChip key={label} active={role === value} onClick={() => patchParams({ role: value || undefined })}>
                {label}
              </FilterChip>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {(
              [
                ["", "All"],
                ["active", "Active"],
                ["disabled", "Disabled"],
              ] as const
            ).map(([value, label]) => (
              <FilterChip key={label} active={status === value} onClick={() => patchParams({ status: value || undefined })}>
                {label}
              </FilterChip>
            ))}
          </FilterGroup>
          <FilterGroup label="Balance">
            {(
              [
                ["", "All"],
                ["low", "Low"],
                ["zero", "Zero"],
              ] as const
            ).map(([value, label]) => (
              <FilterChip key={label} active={balance === value} onClick={() => patchParams({ balance: value || undefined })}>
                {label}
              </FilterChip>
            ))}
          </FilterGroup>
        </div>

        {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
        {data && data.users.length === 0 ? (
          <EmptyState icon={Search}>{search || role || status || balance ? "No users match these filters." : "No users yet."}</EmptyState>
        ) : (
          data && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-faint">
                      <th className="px-5 py-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={togglePage}
                          aria-label="Select all on page"
                          className="h-4 w-4 rounded border-hairline accent-[#2F6FED]"
                        />
                      </th>
                      <th className="px-5 py-3 font-medium">User</th>
                      {SORTABLE.map((column) => (
                        <th key={column.key} className="px-5 py-3 font-medium">
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className="inline-flex items-center gap-1 transition hover:text-primary"
                          >
                            {column.label}
                            {sort === column.key ? order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                          </button>
                        </th>
                      ))}
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.users.map((user) => (
                      <tr key={user.id} className="transition hover:bg-surface">
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(user.id)}
                            onChange={() => toggleOne(user.id)}
                            aria-label={`Select ${user.email}`}
                            className="h-4 w-4 rounded border-hairline accent-[#2F6FED]"
                          />
                        </td>
                        <td className="px-5 py-3">
                          <Link to={`/users/${user.id}`} className="group flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-sheen text-xs font-semibold uppercase text-white">
                              {user.email.charAt(0)}
                            </span>
                            <span className="truncate font-medium text-primary group-hover:text-blueprint">{user.email}</span>
                          </Link>
                        </td>
                        <td className="px-5 py-3 tabular-nums text-muted">{formatRelative(user.createdAt)}</td>
                        <td className="px-5 py-3 tabular-nums">
                          {user.role === "admin" ? <span className="text-faint">Unlimited</span> : formatNumber(user.creditBalance)}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{formatNumber(user.renderCount)}</td>
                        <td className="px-5 py-3 tabular-nums">{formatUsd(user.spentUsd)}</td>
                        <td className="px-5 py-3 text-muted">{formatRelative(user.lastRenderAt)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {user.role === "admin" && <Pill tone="blue">Admin</Pill>}
                            {user.disabled ? <Pill tone="red">Disabled</Pill> : <Pill tone="emerald">Active</Pill>}
                            {user.role !== "admin" && user.creditBalance < LOW_BALANCE && <Pill tone="amber">Low</Pill>}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <RowActions
                            user={user}
                            isSelf={user.id === me.id}
                            busy={busyId === user.id}
                            onGrant={() => setGrantTarget([user])}
                            onToggleDisabled={() => void runToggleDisabled(user)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          )
        )}
      </Card>

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-hairline bg-canvas px-4 py-3 shadow-lift">
          <span className="text-sm font-medium text-primary">{selected.size} selected</span>
          <Button variant="primary" icon={Coins} onClick={() => setGrantTarget(selectedUsers)} disabled={selectedUsers.length === 0}>
            Grant credits
          </Button>
          <Button variant="ghost" icon={X} onClick={() => setSelected(new Set())} aria-label="Clear selection" />
        </div>
      )}

      {grantTarget && (
        <GrantCreditsModal
          users={grantTarget}
          onClose={() => setGrantTarget(null)}
          onDone={() => {
            setGrantTarget(null);
            setSelected(new Set());
            reload();
          }}
        />
      )}
    </>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex gap-1 rounded-xl bg-surface-muted p-1">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function RowActions({
  user,
  isSelf,
  busy,
  onGrant,
  onToggleDisabled,
}: {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onGrant: () => void;
  onToggleDisabled: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for ${user.email}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-lift">
            <Link
              to={`/users/${user.id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open detail
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onGrant();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              <Coins size={14} /> Grant credits
            </button>
            <button
              type="button"
              disabled={isSelf || busy}
              title={isSelf ? "You can't disable your own account" : undefined}
              onClick={() => {
                setOpen(false);
                onToggleDisabled();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              {user.disabled ? <UserCheck size={14} /> : <Ban size={14} />}
              {user.disabled ? "Enable" : "Disable"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function GrantCreditsModal({ users, onClose, onDone }: { users: AdminUser[]; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const [amount, setAmount] = useState("25");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0 && value <= 10_000 && note.trim().length > 0;
  const bulk = users.length > 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (bulk) {
        await api.bulkGrantCredits({ userIds: users.map((user) => user.id), amount: value, note: note.trim() });
      } else {
        await api.adjustCredits(users[0]!.id, { amount: value, note: note.trim() });
      }
      onDone();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "Couldn't grant credits");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift"
        role="dialog"
        aria-labelledby="grant-credits-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="grant-credits-title" className="text-lg font-semibold text-primary">
              Grant credits
            </h2>
            <p className="mt-1 text-sm text-muted">{bulk ? `${users.length} users selected` : users[0]?.email}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-muted" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <label className="mt-5 block text-sm">
          <span className="font-medium text-primary">Credits</span>
          <input
            type="number"
            min={1}
            max={10_000}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 tabular-nums outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="font-medium text-primary">Reason</span>
          <input
            type="text"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Demo allowance"
            className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={Check} disabled={!valid || saving}>
            {saving ? "Granting…" : `Grant ${Number.isInteger(value) && value > 0 ? formatNumber(value) : ""} credits`}
          </Button>
        </div>
      </form>
    </div>
  );
}
