import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { RenderStatus } from "@renvia/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-hairline bg-canvas ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          {title && <h2 className="text-sm font-semibold text-primary">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-canvas p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-primary">{value}</p>
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<RenderStatus, string> = {
  succeeded: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
  processing: "bg-blueprint-soft text-blueprint ring-blueprint/20",
  pending: "bg-surface-muted text-muted ring-hairline-strong",
};

export function StatusBadge({ status }: { status: RenderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "red" | "amber" }) {
  const tones = {
    neutral: "bg-surface-muted text-secondary",
    blue: "bg-blueprint-soft text-blueprint",
    red: "bg-red-50 text-red-700",
    amber: "bg-glow-soft text-[#8a5a17]",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

type ButtonVariant = "primary" | "secondary" | "danger";

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-white hover:opacity-90",
    secondary: "border border-hairline bg-canvas text-primary hover:border-hairline-strong",
    danger: "border border-red-200 bg-canvas text-red-700 hover:bg-red-50",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-faint">{children}</p>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button disabled={to >= total} onClick={() => onChange(offset + limit)}>
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
              <th key={label} scope="col" className="px-5 py-2.5 font-medium">
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
