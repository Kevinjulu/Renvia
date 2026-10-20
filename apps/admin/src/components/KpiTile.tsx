import type { ReactNode } from "react";

type Tone = "default" | "good" | "warn" | "bad";
const VALUE_TONE: Record<Tone, string> = { default: "text-primary", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700" };

/** Compact stat tile: label, one number, one line of context. Two per row on a phone. */
export function KpiTile({ label, value, detail, tone = "default" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-2xl border border-hairline bg-canvas p-3 shadow-card sm:p-4">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-2 truncate text-[22px] font-bold leading-none tabular-nums tracking-tight sm:text-[26px] ${VALUE_TONE[tone]}`}>{value}</p>
      {detail && <p className="mt-1.5 truncate text-xs text-muted">{detail}</p>}
    </div>
  );
}
