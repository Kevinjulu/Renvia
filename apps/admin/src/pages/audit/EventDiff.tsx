import type { AdminAuditAction } from "@renvia/types";
import { formatNumber } from "../../lib/format";
import { asRecord, formatSettingValue } from "./helpers";

export function EventDiff({ detail, action }: { detail: Record<string, unknown> | null; action: AdminAuditAction }) {
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
