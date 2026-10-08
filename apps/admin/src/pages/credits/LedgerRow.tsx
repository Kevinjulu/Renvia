import { Link } from "react-router-dom";
import type { AdminCreditEntry } from "@renvia/types";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ImageIcon, Scan } from "lucide-react";
import { Pill } from "../../components/ui";
import { formatCreditReason } from "../../lib/labels";
import { formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { REASON_TONE } from "./helpers";
import { Detail } from "./parts";

export function LedgerRow({ entry, open, onToggle }: { entry: AdminCreditEntry; open: boolean; onToggle: () => void }) {
  const inbound = entry.amount > 0;

  return (
    <li className="border-t border-hairline first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-3.5 text-left transition hover:bg-surface"
      >
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
            inbound ? "bg-emerald-50 text-emerald-700" : "bg-[#f8ebe3] text-[#8a3d14]"
          }`}
        >
          {inbound ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={`/users/${entry.userId}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-medium text-primary hover:text-blueprint"
            >
              {entry.userEmail}
            </Link>
            <Pill tone={REASON_TONE[entry.reason] ?? "neutral"}>{formatCreditReason(entry.reason)}</Pill>
          </span>
          <span className="mt-1 block truncate text-xs text-muted">
            {entry.note || (entry.actorEmail ? `by ${entry.actorEmail}` : formatRelative(entry.createdAt))}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`text-base font-semibold tabular-nums ${inbound ? "text-emerald-700" : "text-primary"}`}>
            {inbound ? "+" : ""}
            {formatNumber(entry.amount)}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-faint">
            {formatRelative(entry.createdAt)}
            <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-hairline bg-surface px-5 py-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="When">{formatDateTime(entry.createdAt)}</Detail>
            <Detail label="User">
              <Link to={`/users/${entry.userId}`} className="text-primary hover:text-blueprint">
                {entry.userEmail}
              </Link>
            </Detail>
            <Detail label="Reason">{formatCreditReason(entry.reason)}</Detail>
            <Detail label="Actor">{entry.actorEmail || "—"}</Detail>
            <Detail label="Note" className="sm:col-span-2">
              {entry.note || "—"}
            </Detail>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.renderId && (
              <Link
                to={`/renders?detail=${entry.renderId}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-surface"
              >
                <ImageIcon size={13} /> Related render
              </Link>
            )}
            {entry.segmentationId && (
              <Link
                to={`/segmentations?detail=${entry.segmentationId}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-surface"
              >
                <Scan size={13} /> Related segmentation
              </Link>
            )}
            <Link
              to={`/users/${entry.userId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-800"
            >
              Open user
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
