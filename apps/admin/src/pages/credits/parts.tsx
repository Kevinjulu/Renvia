import type { ReactNode } from "react";

export function Detail({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-primary">{children}</dd>
    </div>
  );
}
