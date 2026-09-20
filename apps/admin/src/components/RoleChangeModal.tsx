import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, Shield, ShieldOff } from "lucide-react";
import type { AdminUser } from "@renvia/types";
import { Button } from "./ui";
import { ApiError, useAdminApi } from "../lib/api";

type RoleAction = "promote" | "demote";

interface RoleChangeModalProps {
  user: AdminUser;
  action: RoleAction;
  onClose: () => void;
  onDone: () => void;
}

const PROMOTE_CONSEQUENCES = [
  "Full access to this admin dashboard (users, credits, settings, audit).",
  "Unlimited free renders and selections — not charged credits.",
  "Can grant credits, disable accounts, and promote or demote other admins.",
  "Exempt from daily limits and maintenance pauses.",
];

const DEMOTE_CONSEQUENCES = [
  "Lose access to this admin dashboard immediately.",
  "Start spending credits on renders and selections again.",
  "Subject to daily limits and maintenance pauses like any other user.",
];

/**
 * Deliberate role change: review consequences, then type the user's email to unlock confirm.
 * Accidental clicks alone can't promote or demote anyone.
 */
export function RoleChangeModal({ user, action, onClose, onDone }: RoleChangeModalProps) {
  const api = useAdminApi();
  const titleId = useId();
  const confirmId = useId();
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promoting = action === "promote";
  const emailMatch = typed.trim().toLowerCase() === user.email.trim().toLowerCase();
  const canSubmit = emailMatch && ack && !saving && !(promoting && user.disabled);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateUser(user.id, {
        role: promoting ? "admin" : "user",
        confirmEmail: typed.trim(),
      });
      onDone();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : reason instanceof Error
            ? reason.message
            : "Couldn't update role",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-lg rounded-2xl border border-hairline bg-canvas p-6 shadow-lift"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              promoting ? "bg-blueprint-soft text-blueprint" : "bg-rose-50 text-rose-600"
            }`}
          >
            {promoting ? <Shield size={18} /> : <ShieldOff size={18} />}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-primary">
              {promoting ? "Promote to admin" : "Remove admin access"}
            </h2>
            <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
          </div>
        </div>

        <div
          className={`mt-5 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${
            promoting ? "border-[#e8d5c4] bg-[#f8ebe3]/70 text-[#8a3d14]" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {promoting
              ? "This is a privileged action. The new admin can manage every account and spend on the fal budget without credit charges."
              : "They will lose dashboard access immediately. Make sure another admin remains."}
          </span>
        </div>

        {promoting && user.disabled && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
            This account is disabled. Enable it first, then promote.
          </p>
        )}

        <div className="mt-5">
          <p className="text-sm font-medium text-primary">What changes</p>
          <ul className="mt-2 space-y-2">
            {(promoting ? PROMOTE_CONSEQUENCES : DEMOTE_CONSEQUENCES).map((item) => (
              <li key={item} className="flex gap-2 text-sm text-secondary">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-hairline px-3.5 py-3 transition hover:bg-surface">
          <input
            type="checkbox"
            checked={ack}
            onChange={(event) => setAck(event.target.checked)}
            className="mt-0.5 size-4 accent-[#2F6FED]"
          />
          <span className="text-sm text-primary">
            I understand these privileges and am deliberately{" "}
            {promoting ? "appointing this person as an admin" : "removing their admin access"}.
          </span>
        </label>

        <label className="mt-4 block text-sm" htmlFor={confirmId}>
          <span className="font-medium text-primary">
            Type <span className="font-semibold text-blueprint">{user.email}</span> to confirm
          </span>
          <input
            id={confirmId}
            type="email"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={user.email}
            className={`mt-1.5 w-full rounded-xl border bg-surface px-3 py-2.5 text-sm outline-none transition focus:bg-canvas focus:ring-2 ${
              typed.length > 0 && !emailMatch
                ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
                : emailMatch
                  ? "border-emerald-300 focus:border-emerald-400 focus:ring-emerald-200"
                  : "border-hairline focus:border-blueprint focus:ring-blueprint/15"
            }`}
          />
          {typed.length > 0 && !emailMatch && (
            <span className="mt-1 block text-xs text-rose-600">Email doesn’t match yet.</span>
          )}
        </label>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant={promoting ? "primary" : "danger"} disabled={!canSubmit}>
            {saving
              ? promoting
                ? "Promoting…"
                : "Removing…"
              : promoting
                ? "Promote to admin"
                : "Remove admin"}
          </Button>
        </div>
      </form>
    </div>
  );
}
