import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Cpu, PauseCircle } from "lucide-react";
import { STUDIO_FEATURES, type AdminModel } from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatModel, formatNumber, formatPercent, formatRelative, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useAdmin } from "../lib/useAdmin";
import { useLoad } from "../lib/useLoad";
import { inputClass } from "./settings/components";

const ROUTE_LABELS: Record<string, string> = {
  photo: "Photo render",
  drawing: "Drawing render",
  references: "Reference render",
  fidelity: "Strict fidelity",
  edit: "Edit",
  "edit-references": "Edit with references",
  upscale: "Upscale / 4K / 8K",
  selection: "Auto select",
};

function formatMs(ms: number | null) {
  if (ms === null) return "—";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

const featureLabel = (key: string) => STUDIO_FEATURES.find((feature) => feature.key === key)?.label ?? key;

export function ModelsPage() {
  const api = useAdminApi();
  const me = useAdmin();
  const canManage = me.role === "admin";
  const nav = navForPath("/models");
  const { data, error, reload, lastUpdated } = useLoad(() => api.getModels(), [api], 60_000);
  const [holding, setHolding] = useState<AdminModel | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "info" | "error"; text: string } | null>(null);

  const resume = async (model: AdminModel) => {
    if (!data || !window.confirm(`Resume ${model.id}? New jobs will use it again.`)) return;
    setStatus(null);
    try {
      const result = await api.holdModel({ modelId: model.id, paused: false, message: null, expectedVersion: data.configVersion, reason: "Resumed from the Model Registry" });
      setStatus("pendingApproval" in result ? { tone: "info", text: "Resuming is waiting for a second admin in Approvals." } : { tone: "ok", text: `${model.id} resumed (Studio Control v${result.version}).` });
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't resume the model" });
    }
  };

  return (
    <>
      <PageHero
        title={nav.title}
        description={nav.description}
        image={nav.banner}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
            {data && <span>Engine mode: <strong className="text-white">{data.mode}</strong></span>}
            {lastUpdated && <span className="text-white/60">Updated {formatRelative(lastUpdated.toISOString())}</span>}
          </div>
        }
      />
      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
      {status && (
        <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${status.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : status.tone === "info" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {status.text}
        </p>
      )}

      {!data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted">
            Each route's model is set in code, because every model needs its own request format. Pausing a model stops new jobs that would use it — the Studio greys those options out — while jobs
            already running finish. Stats cover the last 7 days, counted by the model that ran each job's first pass. Engine mode and budget are in <Link to="/settings" className="text-blueprint underline">Settings</Link>.
          </p>
          <Card title="Models" icon={Cpu} bodyClassName="p-0">
            {data.models.length === 0 ? (
              <div className="p-5"><EmptyState icon={Cpu}>No models.</EmptyState></div>
            ) : (
              <ul className="divide-y divide-hairline">
                {data.models.map((model) => (
                  <li key={model.id} className={`px-5 py-4 ${model.inUse ? "" : "opacity-70"}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                          {formatModel(model.id)}
                          {model.rule.paused ? <Pill tone="red">Paused</Pill> : model.inUse ? <Pill tone="emerald">In use</Pill> : <Pill tone="neutral">Not in {data.mode} mode</Pill>}
                          <span className="text-xs font-normal text-faint">{model.provider} · {formatUsd(model.costUsd)} per image (estimate)</span>
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Serves: {[...new Set(model.serves.map((serve) => `${ROUTE_LABELS[serve.route] ?? serve.route} (${serve.mode})`))].join(", ")}
                        </p>
                        {model.inUse && model.affects.length > 0 && (
                          <p className="mt-1 text-xs text-faint">Pausing stops: {model.affects.map(featureLabel).join(", ")}</p>
                        )}
                        {model.rule.paused && model.rule.message && <p className="mt-1 text-xs text-rose-700">Customers see: “{model.rule.message}”</p>}
                      </div>
                      <dl className="grid grid-cols-4 gap-4 text-right text-xs">
                        <div><dt className="text-faint">Jobs</dt><dd className="text-sm font-semibold tabular-nums text-primary">{formatNumber(model.stats.jobs)}</dd></div>
                        <div>
                          <dt className="text-faint">Success</dt>
                          <dd className={`text-sm font-semibold tabular-nums ${model.stats.successRate !== null && model.stats.successRate < 0.9 ? "text-rose-600" : "text-primary"}`}>
                            {model.stats.successRate === null ? "—" : formatPercent(model.stats.successRate)}
                          </dd>
                        </div>
                        <div title={`${model.stats.samples} samples`}><dt className="text-faint">p50 / p95</dt><dd className="text-sm font-semibold tabular-nums text-primary">{formatMs(model.stats.p50Ms)} / {formatMs(model.stats.p95Ms)}</dd></div>
                        <div><dt className="text-faint">Spend</dt><dd className="text-sm font-semibold tabular-nums text-primary">{formatUsd(model.stats.costUsd)}</dd></div>
                      </dl>
                      {canManage && (model.inUse || model.rule.paused) ? (
                        model.rule.paused
                          ? <Button type="button" onClick={() => void resume(model)}>Resume</Button>
                          : <Button type="button" onClick={() => setHolding(model)}><PauseCircle size={14} />Pause</Button>
                      ) : null}
                    </div>
                    {model.stats.lastUsedAt && <p className="mt-2 text-[11px] text-faint">Last used {formatRelative(model.stats.lastUsedAt)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {holding && (
            <PauseDialog
              model={holding}
              onClose={() => setHolding(null)}
              onConfirm={async (message, reason) => {
                const result = await api.holdModel({ modelId: holding.id, paused: true, message, expectedVersion: data.configVersion, reason });
                setStatus("pendingApproval" in result ? { tone: "info", text: "The pause is waiting for a second admin in Approvals." } : { tone: "ok", text: `${holding.id} paused (Studio Control v${result.version}).` });
                reload();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function PauseDialog({ model, onClose, onConfirm }: { model: AdminModel; onClose: () => void; onConfirm: (message: string | null, reason: string) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(message.trim() || null, reason.trim());
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't pause the model");
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm" onMouseDown={() => !saving && onClose()}>
      <form onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pause-title" className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift">
        <h2 id="pause-title" className="text-lg font-semibold text-primary">Pause {formatModel(model.id)}</h2>
        <p className="mt-1 text-sm text-muted">
          New jobs that need it are refused{model.affects.length ? `: ${model.affects.map(featureLabel).join(", ")}` : ""}. Jobs already running finish. This publishes a new Studio Control version.
        </p>
        <label className="mt-4 block text-sm font-medium text-primary">
          Message for customers (optional)
          <input value={message} maxLength={280} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. Renders are paused while we fix a problem" className={inputClass()} />
        </label>
        <label className="mt-3 block text-sm font-medium text-primary">
          Reason
          <input autoFocus required value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Kept in the audit trail" className={inputClass()} />
        </label>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={saving || !reason.trim()}>{saving ? "Pausing…" : "Pause model"}</Button>
        </div>
      </form>
    </div>
  );
}
