import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Coins, Cpu, PauseCircle, ScrollText, Settings, Timer } from "lucide-react";
import type { AdminSettings, AdminUpdateSettingsRequest, RenderEngineMode } from "@renvia/types";
import { Button, EmptyState, ErrorNote, PageHeader, Pill, Skeleton } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const MODES: { value: RenderEngineMode | ""; label: string; hint: string }[] = [
  { value: "", label: "Use server default", hint: "Falls back to the FAL_MODE environment variable." },
  { value: "mock", label: "Mock", hint: "Free — returns the source image. Safe for UI testing." },
  { value: "dev", label: "Dev", hint: "Cheapest real model (~$0.003/image). Pipeline tests." },
  { value: "prod", label: "Production", hint: "Real models (~$0.04/image). Spends fal credit." },
];

const MODE_LABEL: Record<RenderEngineMode, string> = {
  mock: "Mock (free)",
  dev: "Dev (cheap)",
  prod: "Production",
};

interface Draft {
  signupBonusCredits: string;
  dailyRenderLimit: string;
  dailySegmentLimit: string;
  creditsPerImage: string;
  creditsPerSelection: string;
  maintenanceRenders: boolean;
  maintenanceSegments: boolean;
  maintenanceMessage: string;
  budgetWarningPercent: string;
  budgetCriticalPercent: string;
  stuckTimeoutMinutes: string;
  falMode: RenderEngineMode | "";
  falBudgetUsd: string;
}

type FieldErrors = Partial<Record<keyof Draft, string>>;

function toDraft(settings: AdminSettings): Draft {
  return {
    signupBonusCredits: String(settings.signupBonusCredits),
    dailyRenderLimit: settings.dailyRenderLimit === null ? "" : String(settings.dailyRenderLimit),
    dailySegmentLimit: settings.dailySegmentLimit === null ? "" : String(settings.dailySegmentLimit),
    creditsPerImage: String(settings.creditsPerImage),
    creditsPerSelection: String(settings.creditsPerSelection),
    maintenanceRenders: settings.maintenanceRenders,
    maintenanceSegments: settings.maintenanceSegments,
    maintenanceMessage: settings.maintenanceMessage ?? "",
    budgetWarningPercent: String(settings.budgetWarningPercent),
    budgetCriticalPercent: String(settings.budgetCriticalPercent),
    stuckTimeoutMinutes: String(settings.stuckTimeoutMinutes),
    falMode: settings.falMode ?? "",
    falBudgetUsd: settings.falBudgetUsd === null ? "" : String(settings.falBudgetUsd),
  };
}

function validateDraft(draft: Draft): { body: AdminUpdateSettingsRequest; errors: FieldErrors } | { body: null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const bonus = Number(draft.signupBonusCredits);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 1000) {
    errors.signupBonusCredits = "Whole number from 0 to 1,000.";
  }
  const renderLimit = draft.dailyRenderLimit.trim() === "" ? null : Number(draft.dailyRenderLimit);
  if (renderLimit !== null && (!Number.isInteger(renderLimit) || renderLimit < 1 || renderLimit > 10_000)) {
    errors.dailyRenderLimit = "Blank (unlimited) or 1–10,000.";
  }
  const segmentLimit = draft.dailySegmentLimit.trim() === "" ? null : Number(draft.dailySegmentLimit);
  if (segmentLimit !== null && (!Number.isInteger(segmentLimit) || segmentLimit < 1 || segmentLimit > 10_000)) {
    errors.dailySegmentLimit = "Blank (unlimited) or 1–10,000.";
  }
  const creditsPerImage = Number(draft.creditsPerImage);
  if (!Number.isInteger(creditsPerImage) || creditsPerImage < 0 || creditsPerImage > 100) {
    errors.creditsPerImage = "Whole number from 0 to 100.";
  }
  const creditsPerSelection = Number(draft.creditsPerSelection);
  if (!Number.isInteger(creditsPerSelection) || creditsPerSelection < 0 || creditsPerSelection > 100) {
    errors.creditsPerSelection = "Whole number from 0 to 100.";
  }
  const warning = Number(draft.budgetWarningPercent);
  if (!Number.isInteger(warning) || warning < 1 || warning > 99) {
    errors.budgetWarningPercent = "Whole number from 1 to 99.";
  }
  const critical = Number(draft.budgetCriticalPercent);
  if (!Number.isInteger(critical) || critical < 2 || critical > 100) {
    errors.budgetCriticalPercent = "Whole number from 2 to 100.";
  }
  if (!errors.budgetWarningPercent && !errors.budgetCriticalPercent && critical <= warning) {
    errors.budgetCriticalPercent = "Must be greater than the warning percent.";
  }
  const stuck = Number(draft.stuckTimeoutMinutes);
  if (!Number.isInteger(stuck) || stuck < 1 || stuck > 1440) {
    errors.stuckTimeoutMinutes = "Whole number from 1 to 1,440 minutes.";
  }
  const budget = draft.falBudgetUsd.trim() === "" ? null : Number(draft.falBudgetUsd);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 10_000)) {
    errors.falBudgetUsd = "Blank (env default) or $0–$10,000.";
  }
  const message = draft.maintenanceMessage.trim();
  if (message.length > 280) {
    errors.maintenanceMessage = "Keep under 280 characters.";
  }
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    body: {
      signupBonusCredits: bonus,
      dailyRenderLimit: renderLimit,
      dailySegmentLimit: segmentLimit,
      creditsPerImage,
      creditsPerSelection,
      maintenanceRenders: draft.maintenanceRenders,
      maintenanceSegments: draft.maintenanceSegments,
      maintenanceMessage: message === "" ? null : message,
      budgetWarningPercent: warning,
      budgetCriticalPercent: critical,
      stuckTimeoutMinutes: stuck,
      falMode: draft.falMode || null,
      falBudgetUsd: budget,
    },
    errors: {},
  };
}

function formatMode(value: RenderEngineMode | "" | null): string {
  if (value === "" || value === null) return "Server default";
  return MODE_LABEL[value];
}

function formatLimit(value: number | null | string): string {
  if (value === "" || value === null) return "Unlimited";
  return `${formatNumber(Number(value))}/day`;
}

function formatBudget(value: number | null | string): string {
  if (value === "" || value === null) return "Env default";
  return formatUsd(Number(value));
}

function formatOnOff(value: boolean): string {
  return value ? "On" : "Off";
}

function formatMessage(value: string | null): string {
  if (!value?.trim()) return "None";
  const trimmed = value.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

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

  return (
    <>
      <PageHeader
        title="Settings"
        description="Control credits, limits, maintenance, and spend — changes apply immediately."
        actions={
          <Link
            to="/audit?action=settings.update"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-primary shadow-card transition hover:bg-surface"
          >
            <ScrollText size={15} />
            Audit trail
          </Link>
        }
      />

      <form onSubmit={attemptSave} className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {/* Live ops hero */}
        <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-card">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-hairline p-6 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">In effect now</p>
                <Pill tone={data.effectiveMode === "prod" ? "amber" : data.effectiveMode === "dev" ? "blue" : "neutral"}>
                  {MODE_LABEL[data.effectiveMode]}
                </Pill>
                {data.falMode === null && <span className="text-xs text-faint">via env</span>}
                {maintenanceOn && <Pill tone="red">Maintenance</Pill>}
              </div>
              <p className="mt-3 font-display text-3xl font-bold tracking-tight text-primary">
                {formatUsd(spent)}
                <span className="ml-2 text-lg font-normal text-muted">of {formatUsd(budget)}</span>
              </p>
              <p className="mt-1 text-sm text-muted">{formatUsd(remaining)} remaining before renders pause</p>

              <div className="mt-5">
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-valuenow={spent}
                  aria-valuemin={0}
                  aria-valuemax={budget || spent || 1}
                  aria-label="fal spend against budget"
                >
                  <div className={`h-full rounded-full transition-all ${meterTone}`} style={{ width: `${ratio * 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-faint">
                  Alerts at {data.budgetWarningPercent}% / {data.budgetCriticalPercent}% · stuck after {data.stuckTimeoutMinutes}m ·{" "}
                  {data.creditsPerImage} credit{data.creditsPerImage === 1 ? "" : "s"}/image
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-1">
              <HeroMeta
                label="Override mode"
                value={data.falMode ? MODE_LABEL[data.falMode] : "None"}
                detail={data.envMode ? `Env default: ${data.envMode}` : "No FAL_MODE env set"}
              />
              <HeroMeta
                label="Override budget"
                value={data.falBudgetUsd === null ? "None" : formatUsd(data.falBudgetUsd)}
                detail={data.envBudgetUsd !== null ? `Env default: ${formatUsd(data.envBudgetUsd)}` : "No FAL_BUDGET_USD env set"}
              />
              <HeroMeta
                label="Last changed"
                value={formatRelative(data.updatedAt)}
                detail={data.updatedByEmail ? `by ${data.updatedByEmail}` : formatDateTime(data.updatedAt)}
                className="sm:col-span-2 lg:col-span-1"
              />
            </div>
          </div>
          {(data.effectiveMode === "prod" || ratio >= criticalRatio || maintenanceOn) && (
            <div className="flex items-start gap-2 border-t border-hairline bg-[#f8ebe3]/60 px-5 py-3 text-sm text-[#8a3d14]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {maintenanceOn
                ? data.maintenanceMessage?.trim() ||
                  "Maintenance is on — non-admin renders and/or segmentations are paused."
                : data.effectiveMode === "prod"
                  ? "Production mode is live — every successful render spends fal credit."
                  : "Budget is nearly exhausted — new paid renders will be blocked soon."}
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
            <div className="mb-5 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-glow-soft text-[#8a5a17]">
                <Coins size={17} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-primary">Credits & limits</h2>
                <p className="text-xs text-muted">Signup grants, per-job costs, and daily caps</p>
              </div>
            </div>
            <div className="space-y-5">
              <Field
                label="Signup bonus"
                hint="Credits every new account gets once. Existing users are unchanged."
                error={fieldErrors.signupBonusCredits}
              >
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={draft.signupBonusCredits}
                  onChange={(event) => update({ signupBonusCredits: event.target.value })}
                  className={inputClass(fieldErrors.signupBonusCredits)}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Credits per image"
                  hint="Charged for each render or edit."
                  error={fieldErrors.creditsPerImage}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.creditsPerImage}
                    onChange={(event) => update({ creditsPerImage: event.target.value })}
                    className={inputClass(fieldErrors.creditsPerImage)}
                  />
                </Field>
                <Field
                  label="Credits per selection"
                  hint="Stored for automatic selection when that API ships."
                  error={fieldErrors.creditsPerSelection}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.creditsPerSelection}
                    onChange={(event) => update({ creditsPerSelection: event.target.value })}
                    className={inputClass(fieldErrors.creditsPerSelection)}
                  />
                </Field>
              </div>
              <Field
                label="Daily render limit per user"
                hint="Leave blank for unlimited. Admins are exempt; failed renders don’t count."
                error={fieldErrors.dailyRenderLimit}
              >
                <input
                  type="number"
                  min={1}
                  max={10_000}
                  placeholder="Unlimited"
                  value={draft.dailyRenderLimit}
                  onChange={(event) => update({ dailyRenderLimit: event.target.value })}
                  className={inputClass(fieldErrors.dailyRenderLimit)}
                />
              </Field>
              <Field
                label="Daily segment limit per user"
                hint="Leave blank for unlimited. Applied when segment create is wired."
                error={fieldErrors.dailySegmentLimit}
              >
                <input
                  type="number"
                  min={1}
                  max={10_000}
                  placeholder="Unlimited"
                  value={draft.dailySegmentLimit}
                  onChange={(event) => update({ dailySegmentLimit: event.target.value })}
                  className={inputClass(fieldErrors.dailySegmentLimit)}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
            <div className="mb-5 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blueprint-soft text-blueprint">
                <Cpu size={17} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-primary">Engine & budget</h2>
                <p className="text-xs text-muted">Mode, spend cap, and alert thresholds</p>
              </div>
            </div>
            <div className="space-y-5">
              <fieldset>
                <legend className="text-sm font-medium text-primary">Render mode</legend>
                <div className="mt-2 space-y-2">
                  {MODES.map((mode) => (
                    <label
                      key={mode.label}
                      className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition ${
                        draft.falMode === mode.value
                          ? "border-blueprint bg-blueprint-soft/50 ring-1 ring-blueprint/20"
                          : "border-hairline hover:border-hairline-strong hover:bg-surface"
                      }`}
                    >
                      <input
                        type="radio"
                        name="falMode"
                        checked={draft.falMode === mode.value}
                        onChange={() => update({ falMode: mode.value })}
                        className="mt-1 accent-[#2F6FED]"
                      />
                      <span>
                        <span className="block text-sm font-medium text-primary">{mode.label}</span>
                        <span className="block text-xs text-muted">{mode.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field
                label="Budget cap (USD)"
                hint={`Leave blank to use the server env default. Effective now: ${formatUsd(data.effectiveBudgetUsd)}.`}
                error={fieldErrors.falBudgetUsd}
              >
                <input
                  type="number"
                  min={0}
                  max={10_000}
                  step="0.01"
                  placeholder="Server default"
                  value={draft.falBudgetUsd}
                  onChange={(event) => update({ falBudgetUsd: event.target.value })}
                  className={inputClass(fieldErrors.falBudgetUsd)}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Budget warning %"
                  hint="Overview alert when spend reaches this share of the cap."
                  error={fieldErrors.budgetWarningPercent}
                >
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={draft.budgetWarningPercent}
                    onChange={(event) => update({ budgetWarningPercent: event.target.value })}
                    className={inputClass(fieldErrors.budgetWarningPercent)}
                  />
                </Field>
                <Field
                  label="Budget critical %"
                  hint="Must be higher than warning. Critical alert + hero tone."
                  error={fieldErrors.budgetCriticalPercent}
                >
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={draft.budgetCriticalPercent}
                    onChange={(event) => update({ budgetCriticalPercent: event.target.value })}
                    className={inputClass(fieldErrors.budgetCriticalPercent)}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
            <div className="mb-5 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <PauseCircle size={17} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-primary">Maintenance</h2>
                <p className="text-xs text-muted">Pause new work for non-admins without a redeploy</p>
              </div>
            </div>
            <div className="space-y-4">
              <ToggleRow
                label="Pause renders"
                hint="Blocks create-render for non-admins."
                checked={draft.maintenanceRenders}
                onChange={(maintenanceRenders) => update({ maintenanceRenders })}
              />
              <ToggleRow
                label="Pause segmentations"
                hint="Stored now; enforced when segment create is wired."
                checked={draft.maintenanceSegments}
                onChange={(maintenanceSegments) => update({ maintenanceSegments })}
              />
              <Field
                label="Message shown in studio"
                hint="Optional. Shown when maintenance blocks a request."
                error={fieldErrors.maintenanceMessage}
              >
                <textarea
                  rows={3}
                  maxLength={280}
                  value={draft.maintenanceMessage}
                  onChange={(event) => update({ maintenanceMessage: event.target.value })}
                  placeholder="We’re upgrading the render pipeline — back shortly."
                  className={`${inputClass(fieldErrors.maintenanceMessage)} resize-y`}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
            <div className="mb-5 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-muted text-muted">
                <Timer size={17} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-primary">Stuck detection</h2>
                <p className="text-xs text-muted">How long before pending jobs count as stuck</p>
              </div>
            </div>
            <Field
              label="Stuck timeout (minutes)"
              hint="Renders (pending/processing) and segmentations (pending) older than this appear as stuck on Overview and job lists."
              error={fieldErrors.stuckTimeoutMinutes}
            >
              <input
                type="number"
                min={1}
                max={1440}
                value={draft.stuckTimeoutMinutes}
                onChange={(event) => update({ stuckTimeoutMinutes: event.target.value })}
                className={inputClass(fieldErrors.stuckTimeoutMinutes)}
              />
            </Field>
          </section>
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

function HeroMeta({
  label,
  value,
  detail,
  className = "",
}: {
  label: string;
  value: string;
  detail: string;
  className?: string;
}) {
  return (
    <div className={`bg-canvas p-5 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-2 text-base font-semibold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-hairline px-3.5 py-3 transition hover:bg-surface">
      <span>
        <span className="block text-sm font-medium text-primary">{label}</span>
        <span className="mt-0.5 block text-xs text-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 accent-[#2F6FED]"
      />
    </label>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-primary">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      )}
    </label>
  );
}

function inputClass(error?: string) {
  return `mt-1 w-full rounded-xl border bg-surface px-3 py-2 text-sm tabular-nums outline-none transition focus:bg-canvas focus:ring-2 ${
    error
      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
      : "border-hairline focus:border-blueprint focus:ring-blueprint/15"
  }`;
}

function ChangeSnippet({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return null;
  const before = asRecord(detail.before);
  const after = asRecord(detail.after);
  if (!before || !after) return null;
  const keys = Object.keys(after);
  if (keys.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-faint">
      {keys
        .slice(0, 3)
        .map((key) => `${key}: ${stringify(before[key])} → ${stringify(after[key])}`)
        .join(" · ")}
      {keys.length > 3 ? ` · +${keys.length - 3} more` : ""}
    </p>
  );
}

function ConfirmSaveModal({
  changes,
  dangerous,
  saving,
  onCancel,
  onConfirm,
}: {
  changes: ChangeItem[];
  dangerous: string | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div role="dialog" aria-labelledby="settings-confirm-title" className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift">
        <h2 id="settings-confirm-title" className="text-lg font-semibold text-primary">
          Confirm settings changes
        </h2>
        <p className="mt-1 text-sm text-muted">These apply immediately to new requests and studio sessions.</p>

        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-hairline bg-surface p-3">
          {changes.map((change) => (
            <li key={change.key} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-muted">{change.label}</span>
              <span className="text-right tabular-nums text-primary">
                <span className="text-faint line-through">{change.from}</span>
                <span className="mx-1.5 text-faint">→</span>
                <span className="font-medium">{change.to}</span>
              </span>
            </li>
          ))}
        </ul>

        {dangerous && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {dangerous}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant={dangerous ? "danger" : "primary"} onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : dangerous ? "Confirm anyway" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ChangeItem {
  key: string;
  label: string;
  from: string;
  to: string;
}

function pushIfChanged(
  items: ChangeItem[],
  key: string,
  label: string,
  from: string,
  to: string,
  changed: boolean,
) {
  if (changed) items.push({ key, label, from, to });
}

function diffChanges(settings: AdminSettings, draft: Draft): ChangeItem[] {
  const result = validateDraft(draft);
  if (!result.body) return [];
  const body = result.body;
  const items: ChangeItem[] = [];

  pushIfChanged(
    items,
    "signupBonusCredits",
    "Signup bonus",
    formatNumber(settings.signupBonusCredits),
    formatNumber(body.signupBonusCredits!),
    body.signupBonusCredits !== undefined && body.signupBonusCredits !== settings.signupBonusCredits,
  );
  pushIfChanged(
    items,
    "creditsPerImage",
    "Credits / image",
    formatNumber(settings.creditsPerImage),
    formatNumber(body.creditsPerImage!),
    body.creditsPerImage !== undefined && body.creditsPerImage !== settings.creditsPerImage,
  );
  pushIfChanged(
    items,
    "creditsPerSelection",
    "Credits / selection",
    formatNumber(settings.creditsPerSelection),
    formatNumber(body.creditsPerSelection!),
    body.creditsPerSelection !== undefined && body.creditsPerSelection !== settings.creditsPerSelection,
  );
  pushIfChanged(
    items,
    "dailyRenderLimit",
    "Daily render limit",
    formatLimit(settings.dailyRenderLimit),
    formatLimit(body.dailyRenderLimit!),
    body.dailyRenderLimit !== undefined && body.dailyRenderLimit !== settings.dailyRenderLimit,
  );
  pushIfChanged(
    items,
    "dailySegmentLimit",
    "Daily segment limit",
    formatLimit(settings.dailySegmentLimit),
    formatLimit(body.dailySegmentLimit!),
    body.dailySegmentLimit !== undefined && body.dailySegmentLimit !== settings.dailySegmentLimit,
  );
  pushIfChanged(
    items,
    "maintenanceRenders",
    "Pause renders",
    formatOnOff(settings.maintenanceRenders),
    formatOnOff(body.maintenanceRenders!),
    body.maintenanceRenders !== undefined && body.maintenanceRenders !== settings.maintenanceRenders,
  );
  pushIfChanged(
    items,
    "maintenanceSegments",
    "Pause segments",
    formatOnOff(settings.maintenanceSegments),
    formatOnOff(body.maintenanceSegments!),
    body.maintenanceSegments !== undefined && body.maintenanceSegments !== settings.maintenanceSegments,
  );
  pushIfChanged(
    items,
    "maintenanceMessage",
    "Maintenance message",
    formatMessage(settings.maintenanceMessage),
    formatMessage(body.maintenanceMessage ?? null),
    body.maintenanceMessage !== undefined && body.maintenanceMessage !== settings.maintenanceMessage,
  );
  pushIfChanged(
    items,
    "budgetWarningPercent",
    "Budget warning %",
    `${settings.budgetWarningPercent}%`,
    `${body.budgetWarningPercent!}%`,
    body.budgetWarningPercent !== undefined && body.budgetWarningPercent !== settings.budgetWarningPercent,
  );
  pushIfChanged(
    items,
    "budgetCriticalPercent",
    "Budget critical %",
    `${settings.budgetCriticalPercent}%`,
    `${body.budgetCriticalPercent!}%`,
    body.budgetCriticalPercent !== undefined && body.budgetCriticalPercent !== settings.budgetCriticalPercent,
  );
  pushIfChanged(
    items,
    "stuckTimeoutMinutes",
    "Stuck timeout",
    `${settings.stuckTimeoutMinutes}m`,
    `${body.stuckTimeoutMinutes!}m`,
    body.stuckTimeoutMinutes !== undefined && body.stuckTimeoutMinutes !== settings.stuckTimeoutMinutes,
  );
  pushIfChanged(
    items,
    "falMode",
    "Mode",
    formatMode(settings.falMode),
    formatMode(body.falMode!),
    body.falMode !== undefined && body.falMode !== settings.falMode,
  );
  pushIfChanged(
    items,
    "falBudgetUsd",
    "Budget",
    formatBudget(settings.falBudgetUsd),
    formatBudget(body.falBudgetUsd!),
    body.falBudgetUsd !== undefined && body.falBudgetUsd !== settings.falBudgetUsd,
  );
  return items;
}

function isDangerous(settings: AdminSettings, draft: Draft): string | null {
  const result = validateDraft(draft);
  if (!result.body) return null;
  const nextMode = result.body.falMode !== undefined ? result.body.falMode : settings.falMode;
  const effectiveNext: RenderEngineMode =
    nextMode === "dev" || nextMode === "prod" ? nextMode : nextMode === "mock" ? "mock" : settings.effectiveMode;
  const resolved =
    nextMode === null
      ? settings.envMode === "dev" || settings.envMode === "prod"
        ? settings.envMode
        : "mock"
      : effectiveNext;

  if (resolved === "prod" && settings.effectiveMode !== "prod") {
    return "You’re enabling production models. Every successful render will spend real fal credit.";
  }

  const nextBudget = result.body.falBudgetUsd !== undefined ? result.body.falBudgetUsd : settings.falBudgetUsd;
  if (nextBudget === 0) {
    return "Budget cap of $0 will block all paid renders immediately.";
  }
  if (typeof nextBudget === "number" && nextBudget > 0 && nextBudget < settings.spentUsd) {
    return `New budget (${formatUsd(nextBudget)}) is below current spend (${formatUsd(settings.spentUsd)}) — paid renders will pause.`;
  }

  const pausingRenders = result.body.maintenanceRenders === true && !settings.maintenanceRenders;
  const pausingSegments = result.body.maintenanceSegments === true && !settings.maintenanceSegments;
  if (pausingRenders || pausingSegments) {
    return `You’re turning on maintenance — non-admin ${[
      pausingRenders ? "renders" : null,
      pausingSegments ? "segmentations" : null,
    ]
      .filter(Boolean)
      .join(" & ")} will be blocked immediately.`;
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  return String(value);
}
