import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Coins, FolderKanban, Search, ShieldCheck, Sparkles, UserPlus, X, XCircle } from "lucide-react";
import type { AdminBetaProgramDetailResponse, AdminUser, AdminUserSort } from "@renvia/types";
import { Button, Pill, Skeleton } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { inputClass } from "../settings/components";
import { errorText } from "./shared";
import { avatarFor, relativeTime, standingIn, type InviteStanding } from "./inviteStatus";

const PAGE = 20;
const SORTS: { value: AdminUserSort; label: string }[] = [
  { value: "lastActiveAt", label: "Recently active" },
  { value: "renderCount", label: "Most renders" },
  { value: "spentUsd", label: "Highest usage" },
  { value: "createdAt", label: "Newest accounts" },
];
const STANDING_PILL: Record<Exclude<InviteStanding, null>, { label: string; tone: "emerald" | "blue" | "neutral" }> = {
  tester: { label: "Already testing", tone: "emerald" },
  invited: { label: "Invited", tone: "blue" },
  former: { label: "Past tester", tone: "neutral" },
};

type Result = { email: string; ok: boolean; error?: string };

/**
 * Invite people who already have a Renvia account. They're invited to the account itself and
 * accept in the Studio with one click: no link, no second account, and their projects, plan and
 * own credits stay exactly as they are.
 */
export function InviteAccounts({ data, onInvited }: { data: AdminBetaProgramDetailResponse; onInvited: () => void }) {
  const api = useAdminApi();
  const { program } = data;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AdminUserSort>("lastActiveAt");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Map<string, AdminUser>>(new Map());
  const [credits, setCredits] = useState(program.creditsPerTester);
  const [cohort, setCohort] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    if (offset === 0) setUsers(null);
    api
      .listUsers({ search: query || undefined, status: "active", sort, order: "desc", limit: PAGE, offset })
      .then((response) => {
        if (cancelled) return;
        setTotal(response.total);
        setUsers((current) => (offset === 0 || !current ? response.users : [...current, ...response.users]));
      })
      .catch((reason) => !cancelled && setLoadError(errorText(reason, "Couldn't load accounts")));
    return () => {
      cancelled = true;
    };
  }, [api, query, sort, offset]);

  // A new search or sort starts from the first page.
  useEffect(() => setOffset(0), [query, sort]);

  const standing = useMemo(() => new Map((users ?? []).map((user) => [user.id, standingIn(user.id, data.enrollments, data.invitations)])), [users, data.enrollments, data.invitations]);
  const free = program.capacity.free;
  const overCapacity = selected.size > free;
  const creditsInvalid = credits < 0 || credits > program.maxCreditsPerTester;

  const toggle = (user: AdminUser) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });

  const selectable = (users ?? []).filter((user) => {
    const state = standing.get(user.id);
    return state !== "tester" && state !== "invited";
  });
  const allOnPageSelected = selectable.length > 0 && selectable.every((user) => selected.has(user.id));
  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const user of selectable) {
        if (allOnPageSelected) next.delete(user.id);
        else next.set(user.id, user);
      }
      return next;
    });

  const invite = async () => {
    setBusy(true);
    setError("");
    try {
      const { results: outcome } = await api.inviteBetaTestersBulk(program.id, {
        userIds: [...selected.keys()],
        sendEmail: false,
        cohort: cohort.trim() || null,
        creditsOverride: credits === program.creditsPerTester ? null : credits,
        expiresInDays,
      });
      setResults(outcome.map((item) => ({ email: item.email, ok: item.ok, error: item.ok ? undefined : item.error })));
      setSelected(new Map([...selected].filter(([id]) => outcome.some((item) => item.userId === id && !item.ok))));
      onInvited();
    } catch (reason) {
      setError(errorText(reason, "Couldn't send the invitations"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-hairline">
        <img src="/beta/invite-dusk.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900/90 via-ink-900/70 to-ink-900/20" />
        <div className="relative grid gap-4 px-5 py-5 text-white md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/70"><Sparkles size={14} /> Invite registered users</p>
            <h3 className="mt-1 text-lg font-semibold">Bring people who already use Renvia into {program.name}</h3>
            <p className="mt-1 max-w-xl text-sm text-white/80">They get a one-click invitation in the Studio. Their projects, renders, plan and own credits stay untouched; beta credits are added on top and only those expire when the beta ends.</p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-xs text-white/70">Places free</p>
            <p className="text-2xl font-semibold tabular-nums">{free}<span className="text-sm font-normal text-white/60"> / {program.maxTesters}</span></p>
            <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, ((program.maxTesters - free) / Math.max(1, program.maxTesters)) * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 rounded-2xl border border-hairline bg-canvas">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
            <label className="relative min-w-[220px] flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts by email" className="w-full rounded-xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:bg-canvas focus:ring-2 focus:ring-blueprint/20" />
            </label>
            <select value={sort} onChange={(event) => setSort(event.target.value as AdminUserSort)} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm">
              {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {selectable.length > 0 && <Button variant="ghost" onClick={togglePage}>{allOnPageSelected ? "Clear page" : "Select page"}</Button>}
          </div>

          {loadError ? (
            <p className="px-4 py-6 text-sm text-rose-600">{loadError}</p>
          ) : users === null ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14" />)}</div>
          ) : users.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No active accounts match “{query}”.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {users.map((user) => {
                const state = standing.get(user.id) ?? null;
                const locked = state === "tester" || state === "invited";
                const checked = selected.has(user.id);
                const avatar = avatarFor(user.email);
                return (
                  <li key={user.id}>
                    <label className={`flex items-center gap-3 px-4 py-3 transition ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface"} ${checked ? "bg-blueprint-soft/60" : ""}`}>
                      <input type="checkbox" disabled={locked} checked={checked} onChange={() => toggle(user)} className="h-4 w-4 accent-blueprint" />
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${avatar.tint}`}>{avatar.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-primary">{user.email}</span>
                          {state && <Pill tone={STANDING_PILL[state].tone}>{STANDING_PILL[state].label}</Pill>}
                          {user.role !== "user" && <Pill>{user.role}</Pill>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                          <span className="inline-flex items-center gap-1"><FolderKanban size={12} /> {user.renderCount} renders</span>
                          <span className="inline-flex items-center gap-1"><Coins size={12} /> {user.creditBalance} credits</span>
                          <span>Active {relativeTime(user.lastActiveAt)}</span>
                          <span>Joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
                        </span>
                      </span>
                      <Link to={`/users/${user.id}`} onClick={(event) => event.stopPropagation()} className="hidden shrink-0 text-xs font-medium text-blueprint hover:underline sm:inline">Profile</Link>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {users && users.length < total && (
            <div className="border-t border-hairline px-4 py-3 text-center">
              <Button variant="ghost" onClick={() => setOffset(users.length)}>Load more · {total - users.length} left</Button>
            </div>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-hairline bg-canvas p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-primary">Selected</p>
              <span className={`text-xs font-medium tabular-nums ${overCapacity ? "text-rose-600" : "text-muted"}`}>{selected.size} of {free} places</span>
            </div>
            {selected.size === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-hairline px-3 py-5 text-center text-xs text-muted">Tick accounts on the left to invite them.</p>
            ) : (
              <ul className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {[...selected.values()].map((user) => (
                  <li key={user.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted py-0.5 pl-2.5 pr-1 text-xs text-secondary">
                    <span className="truncate">{user.email}</span>
                    <button type="button" aria-label={`Remove ${user.email}`} onClick={() => toggle(user)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-hairline"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            {overCapacity && <p className="mt-2 text-xs text-rose-600">Only {free} places are free. Raise the program's tester limit in Settings, or invite fewer people.</p>}

            <div className="mt-4 space-y-3 border-t border-hairline pt-4">
              <label className="block text-sm text-primary">
                Beta credits each
                <input type="number" min={0} max={program.maxCreditsPerTester} className={inputClass(creditsInvalid ? "invalid" : undefined)} value={credits} onChange={(event) => setCredits(Number(event.target.value))} />
                <span className="mt-1 block text-xs text-faint">Program default {program.creditsPerTester}, at most {program.maxCreditsPerTester}. Added on top of their own credits.</span>
              </label>
              <label className="block text-sm text-primary">
                Cohort <span className="text-faint">(optional)</span>
                <input className={inputClass()} value={cohort} maxLength={60} onChange={(event) => setCohort(event.target.value)} placeholder="power users" />
              </label>
              <label className="block text-sm text-primary">
                Invitation open for
                <select className={inputClass()} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                  {[3, 7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
                </select>
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            <Button variant="primary" icon={UserPlus} className="mt-4 w-full" disabled={busy || selected.size === 0 || overCapacity || creditsInvalid} onClick={() => void invite()}>
              {busy ? "Inviting…" : selected.size > 1 ? `Invite ${selected.size} accounts` : "Invite account"}
            </Button>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck size={15} /> What they keep</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Every project and render, before, during and after the beta.</li>
              <li>Their plan and their own credits. Beta renders spend beta credits first and never dip into theirs unless they choose to.</li>
              <li>When the beta ends only unused beta credits expire; beta-only features go back to their plan.</li>
            </ul>
          </div>

          {results && (
            <div className="rounded-2xl border border-hairline bg-canvas p-4">
              <p className="text-sm font-semibold text-primary">Last batch</p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {results.map((item) => (
                  <li key={item.email} className="flex items-start gap-1.5">
                    {item.ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-emerald-600" /> : <XCircle size={14} className="mt-px shrink-0 text-rose-600" />}
                    <span className="min-w-0"><span className="text-primary">{item.email}</span>{item.ok ? <span className="text-muted"> · will see it next time they open the Studio</span> : <span className="text-rose-600"> · {item.error}</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
