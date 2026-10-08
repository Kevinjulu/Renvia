import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Cpu, ImageIcon, MousePointerClick, Type, X } from "lucide-react";
import { ErrorNote, Pill, Skeleton, StatusBadge } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { formatDateTime, formatModel, formatNumber, formatUsd } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { DetailField } from "./parts";

export function SegmentationDetailDrawer({ segmentationId, onClose }: { segmentationId: string; onClose: () => void }) {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getSegmentation(segmentationId), [api, segmentationId]);
  const item = data?.segmentation;
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/40 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close detail" onClick={onClose} />
      <aside
        role="dialog"
        aria-labelledby="segmentation-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-hairline bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Segmentation</p>
            <h2 id="segmentation-detail-title" className="mt-0.5 truncate text-lg font-semibold text-primary">
              {item ? (item.mode === "prompt" ? "Prompt selection" : "Click selection") : "Loading…"}
            </h2>
            {item && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{item.id}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto px-5 py-5 ${loading ? "opacity-60" : ""}`}>
          {error && !item && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
          {!item && !error && (
            <div className="space-y-4">
              <Skeleton className="h-48 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}
          {item && (
            <div className="space-y-6">
              {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

              <a
                href={item.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-hairline bg-surface-muted"
              >
                <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
              </a>

              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={item.status} />
                <Pill tone={item.mode === "prompt" ? "blue" : "neutral"}>
                  {item.mode === "prompt" ? (
                    <span className="inline-flex items-center gap-1">
                      <Type size={11} /> Prompt
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick size={11} /> Click
                    </span>
                  )}
                </Pill>
                {item.stuck && <Pill tone="red">Stuck</Pill>}
              </div>

              {item.errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{item.errorMessage}</div>
              )}

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <DetailField label="User">
                  <Link to={`/users/${item.userId}`} className="text-primary hover:text-blueprint">
                    {item.userEmail}
                  </Link>
                </DetailField>
                <DetailField label="Model">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Cpu size={12} /> {formatModel(item.model)}
                  </span>
                </DetailField>
                <DetailField label="Cost">{formatUsd(item.costUsd)}</DetailField>
                <DetailField label="Credits">{formatNumber(item.creditsCharged)}</DetailField>
                <DetailField label="Objects">{item.objectCount === null ? "—" : formatNumber(item.objectCount)}</DetailField>
                <DetailField label="Created">{formatDateTime(item.createdAt)}</DetailField>
                {item.point && (
                  <DetailField label="Click point">
                    <span className="tabular-nums">
                      {Math.round(item.point.x)}, {Math.round(item.point.y)}
                    </span>
                  </DetailField>
                )}
              </dl>

              {item.prompt && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Prompt</p>
                  <p className="whitespace-pre-wrap rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
                    {item.prompt}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/users/${item.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Open user
                </Link>
                <a
                  href={item.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  <ImageIcon size={15} /> Open image
                </a>
                <button
                  type="button"
                  onClick={() => void copyId()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied ID" : "Copy ID"}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
