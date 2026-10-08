import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { Button, ErrorNote, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import type { Draft, FieldErrors } from "./settings/types";
import { toDraft, validateDraft } from "./settings/draft";
import { diffChanges, isDangerous } from "./settings/diff";
import { ConfirmSaveModal } from "./settings/components";
import { LiveStatusHero } from "./settings/LiveStatusHero";
import { CreditsLimitsSection } from "./settings/CreditsLimitsSection";
import { EngineBudgetSection } from "./settings/EngineBudgetSection";
import { MaintenanceSection } from "./settings/MaintenanceSection";
import { InputLimitsSection } from "./settings/InputLimitsSection";
import { BlockedMessagesSection } from "./settings/BlockedMessagesSection";
import { StuckDetectionSection } from "./settings/StuckDetectionSection";
import { SystemHealthSection } from "./settings/SystemHealthSection";
import { ModelsSection } from "./settings/ModelsSection";
import { ExemptionsSection } from "./settings/ExemptionsSection";
import { RecentChangesSection } from "./settings/RecentChangesSection";

export function SettingsPage() {
  const api = useAdminApi();
  const { data, error, loading, reload } = useLoad(() => api.getSettings(), [api]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  const changes = useMemo(() => (data && draft ? diffChanges(data, draft) : []), [data, draft]);
  const dirty = changes.length > 0;

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data || !draft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
    setFieldErrors({});
  };

  const attemptSave = (event: FormEvent) => {
    event.preventDefault();
    const result = validateDraft(draft);
    if (!result.body) {
      setFieldErrors(result.errors);
      setStatus({ tone: "error", text: "Fix the highlighted fields before saving." });
      return;
    }
    if (changes.length === 0) return;
    setConfirmOpen(true);
  };

  const save = async () => {
    const result = validateDraft(draft);
    if (!result.body) return;
    setConfirmOpen(false);
    setSaving(true);
    try {
      const saved = await api.updateSettings(result.body);
      setDraft(toDraft(saved));
      setStatus({ tone: "ok", text: "Settings saved. They apply to the next request — no redeploy needed." });
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't save settings" });
    } finally {
      setSaving(false);
    }
  };

  const budget = data.effectiveBudgetUsd;
  const spent = data.spentUsd;
  const remaining = Math.max(0, budget - spent);
  const ratio = budget > 0 ? Math.min(1, spent / budget) : spent > 0 ? 1 : 0;
  const warningRatio = data.budgetWarningPercent / 100;
  const criticalRatio = data.budgetCriticalPercent / 100;
  const meterTone = ratio >= criticalRatio ? "bg-rose-500" : ratio >= warningRatio ? "bg-[#c45c26]" : "bg-emerald-500";
  const maintenanceOn = data.maintenanceRenders || data.maintenanceSegments;

  const nav = navForPath("/settings");

  return (
    <>
      <PageHero
        title={nav.title}
        description={nav.description}
        image={nav.banner}
        actions={
          <Link
            to="/audit?action=settings.update"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            <ScrollText size={15} />
            Audit trail
          </Link>
        }
      />

      <form onSubmit={attemptSave} className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {/* Live ops hero */}
        <LiveStatusHero data={data} budget={budget} spent={spent} remaining={remaining} ratio={ratio} criticalRatio={criticalRatio} meterTone={meterTone} maintenanceOn={maintenanceOn} />

        <div className="grid gap-6 lg:grid-cols-2">
          <CreditsLimitsSection draft={draft} fieldErrors={fieldErrors} update={update} />

          <EngineBudgetSection data={data} draft={draft} fieldErrors={fieldErrors} update={update} />

          <MaintenanceSection draft={draft} fieldErrors={fieldErrors} update={update} />

          <InputLimitsSection draft={draft} fieldErrors={fieldErrors} update={update} />

          <BlockedMessagesSection draft={draft} fieldErrors={fieldErrors} update={update} />

          <StuckDetectionSection draft={draft} fieldErrors={fieldErrors} update={update} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <SystemHealthSection data={data} />

          <ModelsSection data={data} />

          <ExemptionsSection />
        </div>

        {/* Sticky save bar when dirty */}
        {(dirty || status) && (
          <div className="sticky bottom-4 z-20 rounded-2xl border border-hairline bg-canvas/95 p-4 shadow-lift backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                {dirty ? (
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {changes.length} {changes.length === 1 ? "change" : "changes"} ready to save
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                      {changes.map((change) => (
                        <li key={change.key}>
                          <span className="text-faint">{change.label}:</span> {change.from} → {change.to}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  status && (
                    <p role="status" className={`text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>
                      {status.text}
                    </p>
                  )
                )}
              </div>
              <Button
                type="button"
                onClick={() => {
                  setDraft(toDraft(data));
                  setFieldErrors({});
                  setStatus(null);
                }}
                disabled={!dirty || saving}
              >
                Reset
              </Button>
              <Button type="submit" variant="primary" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Review & save"}
              </Button>
            </div>
          </div>
        )}

        {/* Recent settings changes */}
        <RecentChangesSection data={data} />
      </form>

      {confirmOpen && (
        <ConfirmSaveModal
          changes={changes}
          dangerous={isDangerous(data, draft)}
          saving={saving}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
