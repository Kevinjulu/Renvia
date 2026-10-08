import { Link } from "react-router-dom";
import { X } from "lucide-react";

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
