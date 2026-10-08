import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">{children}</div>
    </div>
  );
}

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
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

export function ScopeChip({ label, to, onClear }: { label: string; to: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-primary shadow-card">
      <Link to={to} className="hover:text-blueprint">
        {label}
      </Link>
      <button type="button" onClick={onClear} className="grid h-5 w-5 place-items-center rounded-md text-muted hover:bg-surface-muted" aria-label="Clear filter">
        <X size={12} />
      </button>
    </span>
  );
}

export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 text-primary">{children}</dd>
    </div>
  );
}
