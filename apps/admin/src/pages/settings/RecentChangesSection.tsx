import { Link } from "react-router-dom";
import { ScrollText, Settings } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { EmptyState } from "../../components/ui";
import { formatDateTime, formatRelative } from "../../lib/format";
import { ChangeSnippet } from "./components";

export function RecentChangesSection({ data }: { data: AdminSettings }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-primary">Recent settings changes</h2>
        </div>
        <Link to="/audit?action=settings.update" className="text-xs font-medium text-muted hover:text-blueprint">
          View all
        </Link>
      </div>
      {data.recentChanges.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={ScrollText}>No settings changes recorded yet.</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {data.recentChanges.map((change) => (
            <li key={change.id} className="flex items-start gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-primary">{change.summary}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {change.actorEmail} · {formatRelative(change.createdAt)}
                </p>
                <ChangeSnippet detail={change.detail} />
              </div>
              <time className="shrink-0 text-xs text-faint">{formatDateTime(change.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
