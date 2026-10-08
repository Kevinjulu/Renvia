import { useState, type FormEvent } from "react";
import type { AdminUser } from "@renvia/types";
import { Check, X } from "lucide-react";
import { Button } from "../../components/ui";
import { ApiError, useAdminApi } from "../../lib/api";
import { formatNumber } from "../../lib/format";

export function GrantCreditsModal({ users, onClose, onDone }: { users: AdminUser[]; onClose: () => void; onDone: () => void }) {
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
