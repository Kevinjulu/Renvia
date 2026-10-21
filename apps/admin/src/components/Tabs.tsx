import type { ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Small count or marker shown after the label. */
  badge?: ReactNode;
}

/** Dashboard-style pill tabs: one page, one panel at a time, so long pages stay one screen tall. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-hairline bg-canvas p-1 shadow-card">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-sm font-medium transition ${value === tab.id ? "bg-blueprint-soft text-blueprint" : "text-muted hover:text-primary"}`}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== null && <span className="rounded-full bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-secondary">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
