import type { ReactNode } from "react";

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex gap-1 rounded-xl bg-surface-muted p-1">{children}</div>
    </div>
  );
}
