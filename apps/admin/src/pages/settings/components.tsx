import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "../../components/ui";
import { type ChangeItem, asRecord, stringify } from "./diff";

type CardTone = "default" | "caution" | "danger";
type CardAccent = "blue" | "amber" | "emerald" | "rose" | "neutral";

const ACCENT_CHIP: Record<CardAccent, string> = {
  blue: "bg-blueprint-soft text-blueprint",
  amber: "bg-glow-soft text-[#8a5a17]",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-600",
  neutral: "bg-surface-muted text-muted",
};

const TONE_STYLES: Record<CardTone, { frame: string; badge: string }> = {
  default: { frame: "border-hairline", badge: "" },
  caution: { frame: "border-amber-300", badge: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  danger: { frame: "border-rose-300", badge: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

/**
 * The one frame every settings section uses: icon, title, hint, and an optional badge and warning
 * line. "caution" and "danger" mark controls that spend money or pause the product, so they can't
 * be mistaken for an ordinary input limit.
 */
export function SettingsCard({ icon: Icon, title, hint, accent = "neutral", tone = "default", badge, warning, bodyClassName = "p-5", children }: {
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  accent?: CardAccent;
  tone?: CardTone;
  badge?: string;
  warning?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-canvas shadow-card ${styles.frame}`}>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${ACCENT_CHIP[tone === "danger" ? "rose" : tone === "caution" ? "amber" : accent]}`}>
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {badge && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${styles.badge}`}>{badge}</span>}
      </div>
      {warning && (
        <p className={`flex items-start gap-2 border-b px-5 py-2.5 text-xs font-medium ${tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span>{warning}</span>
        </p>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-hairline px-3.5 py-3 transition hover:bg-surface">
      <span>
        <span className="block text-sm font-medium text-primary">{label}</span>
        <span className="mt-0.5 block text-xs text-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 accent-[#2F6FED]"
      />
    </label>
  );
}

export function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {ok ? (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <XCircle size={15} className="mt-0.5 shrink-0 text-rose-500" />
      )}
      <span>
        <span className="block font-medium text-primary">{label}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </li>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-primary">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      )}
    </label>
  );
}

export function inputClass(error?: string) {
  return `mt-1 w-full rounded-xl border bg-surface px-3 py-2 text-sm tabular-nums outline-none transition focus:bg-canvas focus:ring-2 ${
    error
      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
      : "border-hairline focus:border-blueprint focus:ring-blueprint/15"
  }`;
}

export function ChangeSnippet({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return null;
  const before = asRecord(detail.before);
  const after = asRecord(detail.after);
  if (!before || !after) return null;
  const keys = Object.keys(after);
  if (keys.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-faint">
      {keys
        .slice(0, 3)
        .map((key) => `${key}: ${stringify(before[key])} → ${stringify(after[key])}`)
        .join(" · ")}
      {keys.length > 3 ? ` · +${keys.length - 3} more` : ""}
    </p>
  );
}

export function ConfirmSaveModal({
  changes,
  dangerous,
  saving,
  onCancel,
  onConfirm,
}: {
  changes: ChangeItem[];
  dangerous: string | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div role="dialog" aria-labelledby="settings-confirm-title" className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift">
        <h2 id="settings-confirm-title" className="text-lg font-semibold text-primary">
          Confirm settings changes
        </h2>
        <p className="mt-1 text-sm text-muted">These apply immediately to new requests and studio sessions.</p>

        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-hairline bg-surface p-3">
          {changes.map((change) => (
            <li key={change.key} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-muted">{change.label}</span>
              <span className="text-right tabular-nums text-primary">
                <span className="text-faint line-through">{change.from}</span>
                <span className="mx-1.5 text-faint">→</span>
                <span className="font-medium">{change.to}</span>
              </span>
            </li>
          ))}
        </ul>

        {dangerous && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {dangerous}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant={dangerous ? "danger" : "primary"} onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : dangerous ? "Confirm anyway" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
