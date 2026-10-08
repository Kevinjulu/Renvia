export function SummaryCell({
  label,
  value,
  detail,
  active,
  onClick,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  active?: boolean;
  onClick: () => void;
  accent?: "amber" | "blue";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`bg-canvas p-5 text-left transition hover:bg-surface ${active ? "ring-2 ring-inset ring-blueprint/30" : ""}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${
          accent === "amber" ? "text-[#8a3d14]" : accent === "blue" ? "text-blueprint" : "text-primary"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </button>
  );
}
