import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AdminSettings, AdminUpdateSettingsRequest, RenderEngineMode } from "@renvia/types";
import { Button, Card, ErrorNote, PageHeader, Pill, Skeleton } from "../components/ui";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatUsd } from "../lib/format";
import { useLoad } from "../lib/useLoad";

const MODES: { value: RenderEngineMode | ""; label: string; hint: string }[] = [
  { value: "", label: "Use server default", hint: "The FAL_MODE environment variable on Vercel." },
  { value: "mock", label: "Mock", hint: "Free: returns the source image. For testing the UI." },
  { value: "dev", label: "Dev", hint: "Cheapest real model (~$0.003/image). For pipeline tests." },
  { value: "prod", label: "Production", hint: "Real models (~$0.04/image). Spends fal credit." },
];

interface Draft {
  signupBonusCredits: string;
  dailyRenderLimit: string;
  falMode: RenderEngineMode | "";
  falBudgetUsd: string;
}

function toDraft(settings: AdminSettings): Draft {
  return {
    signupBonusCredits: String(settings.signupBonusCredits),
    dailyRenderLimit: settings.dailyRenderLimit === null ? "" : String(settings.dailyRenderLimit),
    falMode: settings.falMode ?? "",
    falBudgetUsd: settings.falBudgetUsd === null ? "" : String(settings.falBudgetUsd),
  };
}

/** Validates the draft; returns the request body or an error message. */
function toRequest(draft: Draft): AdminUpdateSettingsRequest | string {
  const bonus = Number(draft.signupBonusCredits);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 1000) return "Signup bonus must be a whole number from 0 to 1,000.";
  const limit = draft.dailyRenderLimit.trim() === "" ? null : Number(draft.dailyRenderLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10_000)) {
    return "Daily limit must be blank (unlimited) or a whole number from 1 to 10,000.";
  }
  const budget = draft.falBudgetUsd.trim() === "" ? null : Number(draft.falBudgetUsd);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 10_000)) {
    return "Budget cap must be blank (server default) or a dollar amount from 0 to 10,000.";
  }
  return { signupBonusCredits: bonus, dailyRenderLimit: limit, falMode: draft.falMode || null, falBudgetUsd: budget };
}

export function SettingsPage() {
  const api = useAdminApi();
  const { data, error, reload } = useLoad(() => api.getSettings(), [api]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  if (error && !data) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data || !draft) return <Skeleton className="h-96" />;

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = toRequest(draft);
    if (typeof body === "string") {
      setStatus({ tone: "error", text: body });
      return;
    }
    if (body.falMode === "prod" && data.falMode !== "prod") {
      if (!window.confirm("Switch rendering to production models? Every render will spend real fal credit.")) return;
    }
    setSaving(true);
    try {
      const saved = await api.updateSettings(body);
      setDraft(toDraft(saved));
      setStatus({ tone: "ok", text: "Settings saved. They apply to the next render — no redeploy needed." });
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't save settings" });
    } finally {
      setSaving(false);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(data));

  return (
    <>
      <PageHeader title="Settings" description={`Last changed ${formatDateTime(data.updatedAt)}.`} />
      <form onSubmit={(event) => void submit(event)} className="grid gap-6 lg:grid-cols-2">
        <Card title="Credits">
          <div className="space-y-5">
            <Field label="Signup bonus" hint="Credits every new account gets once (1 credit = 1 image).">
              <input
                type="number"
                min={0}
                max={1000}
                value={draft.signupBonusCredits}
                onChange={(event) => update({ signupBonusCredits: event.target.value })}
                className={INPUT}
              />
            </Field>
            <Field label="Daily render limit per user" hint="Leave blank for unlimited. Admins are exempt; failed renders don't count.">
              <input
                type="number"
                min={1}
                max={10_000}
                placeholder="Unlimited"
                value={draft.dailyRenderLimit}
                onChange={(event) => update({ dailyRenderLimit: event.target.value })}
                className={INPUT}
              />
            </Field>
          </div>
        </Card>

        <Card title="Rendering" actions={<Pill tone={data.effectiveMode === "prod" ? "amber" : "neutral"}>Now: {data.effectiveMode}</Pill>}>
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-primary">Render mode</legend>
              <div className="mt-2 space-y-2">
                {MODES.map((mode) => (
                  <label
                    key={mode.label}
                    className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
                      draft.falMode === mode.value ? "border-blueprint bg-blueprint-soft/40" : "border-hairline"
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
              hint={`Total estimated fal spend before rendering pauses. Leave blank for the server default. In effect now: ${formatUsd(data.effectiveBudgetUsd)}.`}
            >
              <input
                type="number"
                min={0}
                max={10_000}
                step="0.01"
                placeholder="Server default"
                value={draft.falBudgetUsd}
                onChange={(event) => update({ falBudgetUsd: event.target.value })}
                className={INPUT}
              />
            </Field>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 lg:col-span-2">
          {status && (
            <p role="status" className={`text-sm ${status.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>
              {status.text}
            </p>
          )}
          <Button onClick={() => setDraft(toDraft(data))} disabled={!dirty || saving}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </>
  );
}

const INPUT = "mt-1 w-full rounded-lg border border-hairline px-3 py-2 text-sm tabular-nums outline-none focus:border-blueprint";

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-primary">{label}</span>
      {children}
      <span className="mt-1 block text-xs text-faint">{hint}</span>
    </label>
  );
}
