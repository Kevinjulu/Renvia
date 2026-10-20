import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { formatRelative } from "../lib/format";

/**
 * Slim page header shared by every admin page: title, one-line purpose, an optional live
 * indicator with refresh, and the page's own actions. It replaces the tall photo banner so the
 * numbers start above the fold.
 */
export function PageTop({ title, description, lastUpdated, loading, onRefresh, actions }: {
  title: string;
  description?: string;
  lastUpdated?: Date | null;
  loading?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-xs text-muted">{description}</p>}
        {lastUpdated !== undefined && (
          <p className="mt-1 flex items-center gap-2 text-xs text-faint">
            <span className="relative flex h-2 w-2" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            {lastUpdated ? `Live · updated ${formatRelative(lastUpdated.toISOString())}` : "Loading…"}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onRefresh && (
          <button type="button" onClick={onRefresh} aria-label="Refresh" className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3 py-2 text-xs font-medium text-secondary transition hover:text-primary">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>
    </header>
  );
}

/** Light-surface action link for PageTop (the old hero actions were white-on-photo). */
export const pageActionClass = "inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3 py-2 text-xs font-medium text-secondary transition hover:text-primary";
