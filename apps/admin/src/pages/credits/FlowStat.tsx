import { ArrowDownRight } from "lucide-react";

export function FlowStat({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
  className = "",
}: {
  label: string;
  value: string;
  icon?: typeof ArrowDownRight;
  tone: "in" | "out";
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
        {Icon && <Icon size={15} className={tone === "in" ? "text-emerald-600" : "text-[#c45c26]"} />}
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums tracking-tight ${tone === "in" ? "text-emerald-700" : "text-[#8a3d14]"}`}>
        {value}
      </p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`bg-canvas p-5 text-left transition hover:bg-surface ${active ? "ring-2 ring-inset ring-blueprint/30" : ""} ${className}`}
      >
        {content}
      </button>
    );
  }

  return <div className={`bg-canvas p-5 ${className}`}>{content}</div>;
}
