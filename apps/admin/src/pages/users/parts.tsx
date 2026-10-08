import type { ReactNode } from "react";

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex gap-1 rounded-xl bg-surface-muted p-1">{children}</div>
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
