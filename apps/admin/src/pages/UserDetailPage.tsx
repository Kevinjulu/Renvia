import { useState, type FormEvent } from "react";
import type { AdminUpdateUserRequest, AdminUser, UserLimits, UserUsage } from "@renvia/types";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Clock, Coins, DollarSign, Gauge, History, ImageIcon, Shield, SlidersHorizontal } from "lucide-react";
import { RenderTable } from "../components/RenderTable";
import { RoleChangeModal } from "../components/RoleChangeModal";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Pill, Skeleton, StatCard, Table } from "../components/ui";
import { ApiError, useAdminApi } from "../lib/api";
import { formatCreditReason } from "../lib/labels";
import { formatDateTime, formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { useAdmin } from "../lib/useAdmin";

export function UserDetailPage() {
  const { id = "" } = useParams();
  const api = useAdminApi();
  const me = useAdmin();
  const { data, error, reload } = useLoad(() => api.getUser(id), [api, id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleAction, setRoleAction] = useState<"promote" | "demote" | null>(null);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-64" />;

  const { user, ledger, renders, limits, usage } = data;
  const isSelf = user.id === me.id;

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const toggleDisabled = () => {
    const verb = user.disabled ? "Enable" : "Disable";
    if (!window.confirm(`${verb} ${user.email}?${user.disabled ? "" : " They won't be able to render until re-enabled."}`)) return;
    void runAction(() => api.updateUser(user.id, { disabled: !user.disabled }));
  };

  return (
    <>
      <Link to="/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition hover:text-primary">
        <ChevronLeft size={15} /> All users
      </Link>
      <PageHeader
        title={user.email}
        description={`Joined ${formatDateTime(user.createdAt)} · Clerk ${user.clerkId}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user.role === "admin" && <Pill tone="blue">Admin</Pill>}
            {user.disabled && <Pill tone="red">Disabled</Pill>}
            <Button
              icon={Shield}
              onClick={() => setRoleAction(user.role === "admin" ? "demote" : "promote")}
              disabled={busy || isSelf || (user.disabled && user.role !== "admin")}
              title={
                isSelf
                  ? "You can't change your own role"
                  : user.disabled && user.role !== "admin"
                    ? "Enable the account before promoting"
                    : undefined
              }
              variant={user.role === "admin" ? "danger" : "secondary"}
            >
              {user.role === "admin" ? "Remove admin…" : "Make admin…"}
            </Button>
            <Button
              variant={user.disabled ? "secondary" : "danger"}
              onClick={toggleDisabled}
              disabled={busy || isSelf}
              title={isSelf ? "You can't disable your own account" : undefined}
            >
              {user.disabled ? "Enable account" : "Disable account"}
            </Button>
          </div>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorNote>{actionError}</ErrorNote>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Credits"
          value={user.role === "admin" ? "Unlimited" : formatNumber(user.creditBalance)}
          icon={Coins}
          accent="amber"
          detail={user.role === "admin" ? "Admins aren't charged" : undefined}
        />
        <StatCard label="Renders" value={formatNumber(user.renderCount)} icon={ImageIcon} accent="blue" />
        <StatCard label="Spend" value={formatUsd(user.spentUsd)} icon={DollarSign} accent="emerald" />
        <StatCard label="Last render" value={<span className="text-lg">{formatRelative(user.lastRenderAt)}</span>} icon={Clock} accent="neutral" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Adjust credits" icon={SlidersHorizontal}>
          <AdjustCreditsForm userId={user.id} balance={user.creditBalance} onDone={reload} />
        </Card>

        <Card title="Credit history" icon={History} className="lg:col-span-2">
          {ledger.length === 0 ? (
            <EmptyState>No credit activity yet.</EmptyState>
          ) : (
            <Table head={["Date", "Change", "Reason", "Note"]}>
              {ledger.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(entry.createdAt)}</td>
                  <td className={`px-5 py-2.5 font-medium tabular-nums ${entry.amount > 0 ? "text-emerald-700" : "text-primary"}`}>
                    {entry.amount > 0 ? "+" : ""}
                    {formatNumber(entry.amount)}
                  </td>
                  <td className="px-5 py-2.5 text-secondary">{formatCreditReason(entry.reason)}</td>
                  <td className="px-5 py-2.5 text-xs text-muted">
                    {entry.note}
                    {entry.actorEmail && <span className="block text-faint">by {entry.actorEmail}</span>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Limits & overrides" icon={Gauge} className="mt-6">
        <LimitsPanel user={user} limits={limits} usage={usage} disabled={busy} onDone={reload} />
      </Card>

      <Card title="Recent renders" icon={ImageIcon} className="mt-6">
        {renders.length === 0 ? <EmptyState icon={ImageIcon}>No renders yet.</EmptyState> : <RenderTable renders={renders} showUser={false} />}
      </Card>

      {roleAction && (
        <RoleChangeModal
          user={user}
          action={roleAction}
          onClose={() => setRoleAction(null)}
          onDone={() => {
            setRoleAction(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/** The four caps an admin can override per user, paired with the usage they're measured against. */
const OVERRIDE_ROWS = [
  { key: "dailyRenderLimitOverride", label: "Renders per day", limit: "dailyRenders", used: "rendersToday", max: 10_000 },
  { key: "dailySegmentLimitOverride", label: "Selections per day", limit: "dailySegments", used: "segmentsToday", max: 10_000 },
  {
    key: "monthlyRenderLimitOverride",
    label: "Renders per month",
    limit: "monthlyRenders",
    used: "rendersThisMonth",
    max: 100_000,
  },
  {
    key: "monthlySegmentLimitOverride",
    label: "Selections per month",
    limit: "monthlySegments",
    used: "segmentsThisMonth",
    max: 100_000,
  },
] as const satisfies readonly {
  key: keyof AdminUpdateUserRequest;
  label: string;
  limit: keyof UserLimits;
  used: keyof UserUsage;
  max: number;
}[];

type OverrideKey = (typeof OVERRIDE_ROWS)[number]["key"];

function LimitsPanel({
  user,
  limits,
  usage,
  disabled,
  onDone,
}: {
  user: AdminUser;
  limits: UserLimits;
  usage: UserUsage;
  disabled: boolean;
  onDone: () => void;
}) {
  const api = useAdminApi();
  const toDraft = () =>
    Object.fromEntries(
      OVERRIDE_ROWS.map(({ key }) => [key, user[key] === null ? "" : String(user[key])]),
    ) as Record<OverrideKey, string>;

  const [draft, setDraft] = useState<Record<OverrideKey, string>>(toDraft);
  const [exempt, setExempt] = useState(user.limitsExempt);
  const [status, setStatus] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = user.role === "admin";
  const parsed = OVERRIDE_ROWS.map(({ key, max }) => {
    const raw = draft[key].trim();
    if (raw === "") return { key, value: null as number | null, valid: true };
    const value = Number(raw);
    return { key, value, valid: Number.isInteger(value) && value >= 0 && value <= max };
  });
  const invalid = parsed.some((entry) => !entry.valid);
  const dirty =
    exempt !== user.limitsExempt || parsed.some((entry) => entry.value !== user[entry.key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !dirty) return;
    setSaving(true);
    setStatus(null);
    try {
      const body: AdminUpdateUserRequest = { limitsExempt: exempt };
      for (const entry of parsed) body[entry.key] = entry.value;
      await api.updateUser(user.id, body);
      setStatus({ tone: "ok", text: "Limits updated — they apply to this user’s next request." });
      onDone();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn’t update limits" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {isAdmin && (
        <p className="rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-xs text-muted">
          This user is an admin, so every cap below is bypassed regardless of what you set here.
        </p>
      )}

      <label className="flex items-start gap-3 rounded-xl border border-hairline bg-surface px-3.5 py-3">
        <input
          type="checkbox"
          checked={exempt}
          onChange={(event) => setExempt(event.target.checked)}
          disabled={disabled || saving}
          className="mt-0.5 accent-[#2F6FED]"
        />
        <span>
          <span className="block text-sm font-medium text-primary">Exempt from limits</span>
          <span className="block text-xs text-muted">
            Skips daily and monthly caps and maintenance pauses. Still charged credits and still bound by the fal budget.
          </span>
        </span>
      </label>

      <ul className="divide-y divide-hairline rounded-xl border border-hairline">
        {OVERRIDE_ROWS.map((row) => {
          const effective = limits[row.limit] as number | null;
          const used = usage[row.used];
          const entry = parsed.find((candidate) => candidate.key === row.key)!;
          return (
            <li key={row.key} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary">{row.label}</p>
                <p className="text-xs text-muted">
                  Used {formatNumber(used)} of{" "}
                  {effective === null ? "unlimited" : formatNumber(effective)}
                  {user[row.key] !== null && " · override active"}
                </p>
              </div>
              <input
                type="number"
                min={0}
                max={row.max}
                placeholder="Use global"
                value={draft[row.key]}
                onChange={(event) => {
                  setDraft({ ...draft, [row.key]: event.target.value });
                  setStatus(null);
                }}
                disabled={disabled || saving}
                aria-label={`${row.label} override`}
                aria-invalid={!entry.valid}
                className={`w-32 rounded-lg border px-2.5 py-1.5 text-sm tabular-nums ${
                  entry.valid ? "border-hairline" : "border-red-400 bg-red-50"
                }`}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-faint">
        Blank inherits the global setting. 0 blocks the user entirely. Failed work is refunded and doesn’t count.
      </p>

      {status && (
        <p role="status" className={`text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>
          {status.text}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => {
            setDraft(toDraft());
            setExempt(user.limitsExempt);
            setStatus(null);
          }}
          disabled={!dirty || saving}
        >
          Reset
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || invalid || saving || disabled}>
          {saving ? "Saving…" : "Save limits"}
        </Button>
      </div>
    </form>
  );
}

function AdjustCreditsForm({ userId, balance, onDone }: { userId: string; balance: number; onDone: () => void }) {
  const api = useAdminApi();
  const [direction, setDirection] = useState<"grant" | "remove">("grant");
  const [amount, setAmount] = useState("25");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0 && value <= 10_000 && note.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setStatus(null);
    try {
      const signed = direction === "grant" ? value : -value;
      const { user } = await api.adjustCredits(userId, { amount: signed, note: note.trim() });
      setStatus({ tone: "ok", text: `Done — balance is now ${formatNumber(user.creditBalance)}.` });
      setNote("");
      onDone();
    } catch (reason) {
      const message =
        reason instanceof ApiError && reason.code === "balance_negative"
          ? `They only have ${formatNumber(balance)} credits — you can't remove more than that.`
          : reason instanceof ApiError && reason.code === "balance_cap"
            ? reason.message
            : reason instanceof Error
              ? reason.message
              : "Couldn't adjust credits";
      setStatus({ tone: "error", text: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="group" aria-label="Grant or remove">
        {(["grant", "remove"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={direction === option}
            onClick={() => setDirection(option)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium capitalize transition ${
              direction === option ? "bg-canvas text-primary shadow-card" : "text-muted hover:text-primary"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        <span className="font-medium text-primary">Credits</span>
        <input
          type="number"
          min={1}
          max={10_000}
          step={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 tabular-nums outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-primary">Reason</span>
        <input
          type="text"
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Client demo allowance"
          className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 outline-none transition focus:border-blueprint focus:bg-canvas focus:ring-2 focus:ring-blueprint/15"
        />
        <span className="mt-1 block text-xs text-faint">Shown in the user's credit history.</span>
      </label>
      {status && (
        <p role="status" className={`text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>
          {status.text}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!valid || saving} className="w-full">
        {saving ? "Saving…" : `${direction === "grant" ? "Grant" : "Remove"} ${Number.isInteger(value) && value > 0 ? formatNumber(value) : ""} credits`}
      </Button>
    </form>
  );
}
