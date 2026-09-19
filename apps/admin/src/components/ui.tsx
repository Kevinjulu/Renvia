import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, TrendingDown, TrendingUp } from "lucide-react";
import type { RenderStatus } from "@renvia/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  icon: Icon,
  actions,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-2xl border border-hairline bg-canvas shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-muted text-muted">
                <Icon size={15} strokeWidth={2} />
              </span>
            )}
            {title && <h2 className="text-sm font-semibold text-primary">{title}</h2>}
          </div>
          {actions}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

type StatAccent = "blue" | "amber" | "emerald" | "rose" | "neutral";

const STAT_ACCENTS: Record<StatAccent, { chip: string; ring: string }> = {
  blue: { chip: "bg-blueprint-soft text-blueprint", ring: "before:bg-blueprint" },
  amber: { chip: "bg-glow-soft text-[#8a5a17]", ring: "before:bg-glow" },
  emerald: { chip: "bg-emerald-50 text-emerald-600", ring: "before:bg-emerald-500" },
  rose: { chip: "bg-rose-50 text-rose-600", ring: "before:bg-rose-500" },
  neutral: { chip: "bg-surface-muted text-muted", ring: "before:bg-hairline-strong" },
};

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "neutral",
  trend,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  accent?: StatAccent;
  trend?: { value: string; direction: "up" | "down" | "flat"; good?: boolean };
}) {
  const tone = STAT_ACCENTS[accent];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-hairline bg-canvas p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:opacity-0 before:transition-opacity hover:before:opacity-100 ${tone.ring}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
        {Icon && (
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone.chip}`}>
            <Icon size={17} strokeWidth={2} />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums leading-none tracking-tight text-primary">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {trend && trend.direction !== "flat" && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
              (trend.good ?? trend.direction === "up") ? "text-emerald-600" : "text-rose-500"
            }`}
          >
            {trend.direction === "up" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {trend.value}
          </span>
        )}
        {detail && <div className="text-xs text-muted">{detail}</div>}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<RenderStatus, { dot: string; text: string; bg: string }> = {
  succeeded: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 ring-emerald-600/15" },
  failed: { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50 ring-rose-600/15" },
  processing: { dot: "bg-blueprint animate-pulse", text: "text-blueprint", bg: "bg-blueprint-soft ring-blueprint/15" },
  pending: { dot: "bg-faint", text: "text-muted", bg: "bg-surface-muted ring-hairline-strong" },
};

export function StatusBadge({ status }: { status: RenderStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "red" | "amber" | "emerald" }) {
  const tones = {
    neutral: "bg-surface-muted text-secondary ring-hairline",
    blue: "bg-blueprint-soft text-blueprint ring-blueprint/15",
    red: "bg-rose-50 text-rose-700 ring-rose-600/15",
    amber: "bg-glow-soft text-[#8a5a17] ring-glow/25",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  icon: Icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: LucideIcon }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-white shadow-sm hover:bg-ink-800 active:scale-[0.98]",
    secondary: "border border-hairline bg-canvas text-primary shadow-card hover:border-hairline-strong hover:bg-surface",
    danger: "border border-rose-200 bg-canvas text-rose-700 hover:bg-rose-50",
    ghost: "text-muted hover:bg-surface-muted hover:text-primary",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" />
        {children}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-muted text-faint">
        <Icon size={20} />
      </span>
      <p className="text-sm text-faint">{children}</p>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-5 text-sm text-muted">
      <span className="tabular-nums">
        {from}–{to} of <span className="font-medium text-secondary">{total}</span>
      </span>
      <div className="flex gap-2">
        <Button icon={ChevronLeft} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button disabled={to >= total} onClick={() => onChange(offset + limit)} className="flex-row-reverse">
          <ChevronRight size={16} strokeWidth={2} />
          Next
        </Button>
      </div>
    </div>
  );
}

/** Table shell with the admin app's header styling. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-faint">
            {head.map((label) => (
              <th key={label} scope="col" className="px-5 py-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">{children}</tbody>
      </table>
    </div>
  );
}
