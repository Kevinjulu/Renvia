import { Link } from "react-router-dom";
import { ScrollText, Settings } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { EmptyState } from "../../components/ui";
import { formatDateTime, formatRelative } from "../../lib/format";
import { ChangeSnippet, SettingsCard } from "./components";

export function RecentChangesSection({ data }: { data: AdminSettings }) {
  return (
    <SettingsCard
      icon={Settings}
      title="Recent settings changes"
      hint={<Link to="/audit?action=settings.update" className="font-medium text-blueprint hover:underline">View all in the audit trail</Link>}
      bodyClassName="p-0"
    >
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
    </SettingsCard>
  );
}
