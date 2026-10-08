import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Cpu, X } from "lucide-react";
import { ErrorNote, Pill, Skeleton, StatusBadge } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { formatDateTime, formatModel, formatNumber, formatRelative, formatUsd } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { useAdmin } from "../../lib/useAdmin";
import { DetailField } from "../../components/DetailField";

export function RenderDetailDrawer({ renderId, onClose }: { renderId: string; onClose: () => void }) {
  const api = useAdminApi();
  const me = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api.getRender(renderId), [api, renderId]);
  const render = data?.render;
  const [copied, setCopied] = useState(false);
  const [recovering, setRecovering] = useState<"refresh" | "cancel" | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const copyId = async () => {
    if (!render) return;
    try {
      await navigator.clipboard.writeText(render.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const recover = async (action: "refresh" | "cancel") => {
    if (!render) return;
    if (action === "cancel" && !window.confirm("Cancel this in-flight render? The customer will receive the normal credit refund.")) return;
    setRecovering(action); setRecoveryError(null);
    try {
      if (action === "refresh") await api.refreshRender(render.id);
      else await api.cancelRender(render.id);
      reload();
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : "Render recovery failed");
    } finally { setRecovering(null); }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/40 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close detail" onClick={onClose} />
      <aside
        role="dialog"
        aria-labelledby="render-detail-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-hairline bg-canvas shadow-lift"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Render</p>
            <h2 id="render-detail-title" className="mt-0.5 truncate text-lg font-semibold text-primary">
              {render ? (render.kind === "edit" ? "Edit" : "Render") : "Loading…"}
            </h2>
            {render && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{render.id}</p>}
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
          {error && !render && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
          {!render && !error && (
            <div className="space-y-4">
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}
          {render && (
            <div className="space-y-6">
              {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}

              <div className="grid grid-cols-2 gap-3">
                <a
                  href={render.sourceImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-hairline bg-surface-muted"
                >
                  <img src={render.sourceImageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                  <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted">Source</p>
                </a>
                <a
                  href={render.resultImageUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`block overflow-hidden rounded-xl border border-hairline bg-surface-muted ${render.resultImageUrl ? "" : "pointer-events-none"}`}
                >
                  {render.resultImageUrl ? (
                    <img src={render.resultImageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <div className="grid aspect-[4/3] place-items-center text-xs text-faint">No result</div>
                  )}
                  <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted">Result</p>
                </a>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={render.status} />
                <Pill tone={render.kind === "edit" ? "amber" : "neutral"}>{render.kind === "edit" ? "Edit" : "Render"}</Pill>
                {render.stuck && <Pill tone="red">Stuck</Pill>}
              </div>

              {render.errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
                  {render.errorMessage}
                </div>
              )}
              {recoveryError && <ErrorNote>{recoveryError}</ErrorNote>}

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <DetailField label="User">
                  <Link to={`/users/${render.userId}`} className="text-primary hover:text-blueprint">
                    {render.userEmail}
                  </Link>
                </DetailField>
                <DetailField label="Project">
                  <Link to={`/projects?detail=${render.projectId}`} className="text-primary hover:text-blueprint">
                    {render.projectName}
                  </Link>
                </DetailField>
                <DetailField label="Model">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Cpu size={12} /> {formatModel(render.model)}
                  </span>
                </DetailField>
                <DetailField label="Aspect ratio">{render.aspectRatio}</DetailField>
                <DetailField label="Style">{render.style}</DetailField>
                <DetailField label="View">{render.viewLabel || "—"}</DetailField>
                <DetailField label="Cost">{formatUsd(render.costUsd)}</DetailField>
                <DetailField label="Credits">{formatNumber(render.creditsCharged)}</DetailField>
                <DetailField label="Seed">
                  <span className="font-mono text-xs">{render.seed ?? "—"}</span>
                </DetailField>
                <DetailField label="Created">{formatDateTime(render.createdAt)}</DetailField>
                <DetailField label="Updated">{formatRelative(render.updatedAt)}</DetailField>
                <DetailField label="fal request">
                  <span className="break-all font-mono text-xs">{render.falRequestId || "—"}</span>
                </DetailField>
              </dl>

              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Prompt</p>
                <p className="whitespace-pre-wrap rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
                  {render.prompt || "No prompt"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/users/${render.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Open user
                </Link>
                <Link
                  to={`/projects?detail=${render.projectId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  Open project
                </Link>
                <button
                  type="button"
                  onClick={() => void copyId()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied ID" : "Copy ID"}
                </button>
                {(["admin", "support"] as const).includes(me.role as "admin" | "support") && (render.status === "pending" || render.status === "processing") && <>
                  <button type="button" disabled={recovering !== null} onClick={() => void recover("refresh")} className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface disabled:opacity-50">
                    {recovering === "refresh" ? "Refreshing…" : "Refresh provider status"}
                  </button>
                  <button type="button" disabled={recovering !== null} onClick={() => void recover("cancel")} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                    {recovering === "cancel" ? "Cancelling…" : "Cancel and refund"}
                  </button>
                </>}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
