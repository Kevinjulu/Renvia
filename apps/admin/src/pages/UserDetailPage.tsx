import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreditLedgerReason } from "@renvia/types";
import { RenderTable } from "../components/RenderTable";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Pill, Skeleton, StatCard, Table } from "../components/ui";
import { ApiError, useAdminApi } from "../lib/api";
import { formatDateTime, formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { useAdmin } from "../lib/useAdmin";

const REASON_LABELS: Record<CreditLedgerReason, string> = {
  signup_bonus: "Signup bonus",
  initial_grant: "Initial grant",
  admin_grant: "Admin adjustment",
  render: "Render",
  render_refund: "Refund (failed render)",
  purchase: "Purchase",
};

export function UserDetailPage() {
  const { id = "" } = useParams();
  const api = useAdminApi();
  const me = useAdmin();
  const { data, error, reload } = useLoad(() => api.getUser(id), [api, id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-64" />;

  const { user, ledger, renders } = data;
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

  const toggleRole = () => {
    const nextRole = user.role === "admin" ? "user" : "admin";
    const message =
      nextRole === "admin"
        ? `Make ${user.email} an admin? They'll get this dashboard, free renders and control over every account.`
        : `Remove admin access from ${user.email}? They'll be charged credits again.`;
    if (!window.confirm(message)) return;
    void runAction(() => api.updateUser(user.id, { role: nextRole }));
  };

  return (
    <>
      <Link to="/users" className="mb-3 inline-block text-sm text-muted hover:text-primary">
        ← All users
      </Link>
      <PageHeader
        title={user.email}
        description={`Joined ${formatDateTime(user.createdAt)} · Clerk ${user.clerkId}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user.role === "admin" && <Pill tone="blue">Admin</Pill>}
            {user.disabled && <Pill tone="red">Disabled</Pill>}
            <Button onClick={toggleRole} disabled={busy || isSelf} title={isSelf ? "You can't change your own role" : undefined}>
              {user.role === "admin" ? "Remove admin" : "Make admin"}
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
          detail={user.role === "admin" ? "Admins aren't charged" : undefined}
        />
        <StatCard label="Renders" value={formatNumber(user.renderCount)} />
        <StatCard label="Spend" value={formatUsd(user.spentUsd)} />
        <StatCard label="Last render" value={<span className="text-lg">{formatRelative(user.lastRenderAt)}</span>} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Adjust credits">
          <AdjustCreditsForm userId={user.id} balance={user.creditBalance} onDone={reload} />
        </Card>

        <Card title="Credit history" className="lg:col-span-2">
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
                  <td className="px-5 py-2.5 text-secondary">{REASON_LABELS[entry.reason]}</td>
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

      <Card title="Recent renders" className="mt-6">
        {renders.length === 0 ? <EmptyState>No renders yet.</EmptyState> : <RenderTable renders={renders} showUser={false} />}
      </Card>
    </>
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
      <div className="flex gap-1 rounded-lg bg-surface-muted p-1" role="group" aria-label="Grant or remove">
        {(["grant", "remove"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={direction === option}
            onClick={() => setDirection(option)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize ${
              direction === option ? "bg-canvas text-primary shadow-sm" : "text-muted hover:text-primary"
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
          className="mt-1 w-full rounded-lg border border-hairline px-3 py-2 tabular-nums outline-none focus:border-blueprint"
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
          className="mt-1 w-full rounded-lg border border-hairline px-3 py-2 outline-none focus:border-blueprint"
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
