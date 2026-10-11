import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Calculator, Coins, Package, ReceiptText } from "lucide-react";
import {
  CREDIT_PRICE_LABELS,
  STUDIO_FEATURES,
  type AdminCreditPack,
  type AdminPlan,
  type AdminPlansResponse,
  type AdminPricingSimulationRequest,
  type AdminPricingSimulationResponse,
  type CreditPrices,
} from "@renvia/types";
import { Button, Card, ErrorNote, Pill, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatDateTime, formatNumber, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useAdmin } from "../lib/useAdmin";
import { useLoad } from "../lib/useLoad";
import { inputClass } from "./settings/components";

type Status = { tone: "ok" | "info" | "error"; text: string } | null;

const PRICE_KEYS = Object.keys(CREDIT_PRICE_LABELS) as (keyof CreditPrices)[];

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return <p role="status" className={`mt-3 text-sm ${status.tone === "error" ? "text-red-600" : status.tone === "info" ? "text-amber-800" : "text-emerald-700"}`}>{status.text}</p>;
}

/** The outcome of a change that may be held for approval, as a status line. */
function outcome(result: { pendingApproval: true } | { version: number }, done: string): Status {
  return "pendingApproval" in result ? { tone: "info", text: "Waiting for a second admin in Approvals. Nothing has changed yet." } : { tone: "ok", text: done };
}

const cents = (value: number, currency = "USD") => `${currency} ${(value / 100).toFixed(2)}`;

export function PlansPage() {
  const api = useAdminApi();
  const me = useAdmin();
  const canManage = me.role === "admin";
  const nav = navForPath("/plans");
  const { data, error, reload } = useLoad(() => api.getPlans(), [api]);

  return (
    <>
      <PageHero title={nav.title} description={nav.description} image={nav.banner} actions={<Link to="/audit?action=plan.update" className="rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/20">Audit trail</Link>} />
      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
      {!data ? (
        <div className="space-y-6"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      ) : (
        <div className="space-y-6">
          <CreditPricesCard data={data} canManage={canManage} onChanged={reload} />
          <Card title="Plans" icon={ReceiptText} bodyClassName="divide-y divide-hairline">
            <p className="px-5 py-3 text-xs text-muted">
              Allowances and limits apply to everyone on the plan from their next request (credits from their next period). PayPal bills each subscriber the price on the PayPal plan they signed up to,
              so a new price needs a new PayPal plan; existing subscribers keep theirs. Which Studio features a plan gets is set in <Link to="/studio-control" className="text-blueprint underline">Studio Control</Link>.
            </p>
            {data.plans.map((plan) => <PlanEditor key={`${plan.id}:${plan.version}`} plan={plan} canManage={canManage} onChanged={reload} />)}
          </Card>
          <PacksCard packs={data.packs} canManage={canManage} onChanged={reload} />
          <SimulatorCard data={data} />
        </div>
      )}
    </>
  );
}

function CreditPricesCard({ data, canManage, onChanged }: { data: AdminPlansResponse; canManage: boolean; onChanged: () => void }) {
  const api = useAdminApi();
  const [draft, setDraft] = useState<CreditPrices>(data.creditPrices.prices);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => setDraft(data.creditPrices.prices), [data.creditPrices.prices]);
  const dirty = PRICE_KEYS.some((key) => draft[key] !== data.creditPrices.prices[key]);

  const publish = async (prices: CreditPrices | null) => {
    if (!reason.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api.publishCreditPrices({ expectedVersion: data.creditPrices.configVersion, prices, reason: reason.trim() });
      setStatus(outcome(result, prices ? "Prices published. New requests are charged these; jobs already charged keep their price." : "Pricing handed back to Settings' per-image multipliers."));
      setReason("");
      onChanged();
    } catch (failure) {
      setStatus({ tone: "error", text: failure instanceof Error ? failure.message : "Couldn't publish prices" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Credit prices" icon={Coins}>
      <p className="mb-4 text-xs text-muted">
        {data.creditPrices.source === "published"
          ? `Published in Studio Control v${data.creditPrices.configVersion}. Settings' credits-per-image and per-selection no longer apply.`
          : "Coming from Settings' credits per image and per selection. Publishing prices here replaces those multipliers with the exact amounts below."}
      </p>
      <form onSubmit={(event) => { event.preventDefault(); void publish(draft); }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRICE_KEYS.map((key) => (
            <label key={key} className="text-xs text-muted">
              {CREDIT_PRICE_LABELS[key]}
              <input type="number" min={0} max={1000} value={draft[key]} disabled={!canManage} onChange={(event) => setDraft({ ...draft, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={inputClass()} />
            </label>
          ))}
        </div>
        {canManage && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Reason (kept in the audit trail)" aria-label="Reason for the price change" className={`${inputClass()} min-w-[240px] flex-1`} />
            {data.creditPrices.source === "published" && <Button type="button" disabled={saving || !reason.trim()} onClick={() => void publish(null)}>Use Settings' multipliers</Button>}
            <Button type="submit" variant="primary" disabled={saving || !reason.trim() || (!dirty && data.creditPrices.source === "published")}>{saving ? "Publishing…" : "Publish prices"}</Button>
          </div>
        )}
        <StatusLine status={status} />
      </form>
    </Card>
  );
}

function NullableNumber({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (value: number | null) => void; disabled: boolean }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input type="number" min={1} placeholder="Unlimited" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? null : Math.max(1, Math.round(Number(event.target.value))))} className={inputClass()} />
    </label>
  );
}

function PlanEditor({ plan, canManage, onChanged }: { plan: AdminPlan; canManage: boolean; onChanged: () => void }) {
  const api = useAdminApi();
  const initial = { name: plan.name, description: plan.description, priceCents: plan.priceCents, monthlyCredits: plan.monthlyCredits, dailyRenderLimit: plan.dailyRenderLimit, monthlyRenderLimit: plan.monthlyRenderLimit, maxProjects: plan.maxProjects, concurrentRenderLimit: plan.concurrentRenderLimit, isActive: plan.isActive, paypalPlanId: plan.paypalPlanId };
  const [terms, setTerms] = useState(initial);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [showHistory, setShowHistory] = useState(false);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((key) => terms[key] !== initial[key]);
  const set = (patch: Partial<typeof terms>) => { setTerms({ ...terms, ...patch }); setStatus(null); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !reason.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api.updatePlan(plan.id, { expectedVersion: plan.version, terms, reason: reason.trim() });
      setStatus(outcome(result, "Saved."));
      onChanged();
    } catch (failure) {
      setStatus({ tone: "error", text: failure instanceof Error ? failure.message : "Couldn't save the plan" });
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-primary">{plan.name}</h3>
        <span className="text-xs text-faint">{plan.slug}</span>
        <Pill tone={plan.isActive ? "emerald" : "neutral"}>{plan.isActive ? "Active" : "Retired"}</Pill>
        <span className="text-xs text-muted">{formatNumber(plan.subscribers)} on it · {plan.interval === "month" ? `${cents(plan.priceCents, plan.currency)} / month` : "Free"}{plan.version ? ` · v${plan.version}` : ""}</span>
      </div>
      <p className="mt-1 text-xs text-faint">
        Studio features: {plan.features.filter((feature) => feature.available).length} of {plan.features.length}
        {plan.features.some((feature) => !feature.available) && ` — not ${plan.features.filter((feature) => !feature.available).map((feature) => STUDIO_FEATURES.find((item) => item.key === feature.key)?.label ?? feature.key).join(", ")}`}
      </p>
      <fieldset disabled={!canManage} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-muted">Name<input value={terms.name} maxLength={60} onChange={(event) => set({ name: event.target.value })} className={inputClass()} /></label>
        <label className="text-xs text-muted">Monthly credits<input type="number" min={0} value={terms.monthlyCredits} onChange={(event) => set({ monthlyCredits: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={inputClass()} /></label>
        <NullableNumber label="Renders per day" value={terms.dailyRenderLimit} onChange={(dailyRenderLimit) => set({ dailyRenderLimit })} disabled={!canManage} />
        <NullableNumber label="Renders per month" value={terms.monthlyRenderLimit} onChange={(monthlyRenderLimit) => set({ monthlyRenderLimit })} disabled={!canManage} />
        <NullableNumber label="Projects" value={terms.maxProjects} onChange={(maxProjects) => set({ maxProjects })} disabled={!canManage} />
        <label className="text-xs text-muted">Renders at once<input type="number" min={1} max={100} placeholder="1 (default)" value={terms.concurrentRenderLimit ?? ""} onChange={(event) => set({ concurrentRenderLimit: event.target.value === "" ? null : Math.max(1, Math.round(Number(event.target.value))) })} className={inputClass()} /></label>
        {plan.interval === "month" && (
          <>
            <label className="text-xs text-muted">Price (cents)<input type="number" min={0} value={terms.priceCents} onChange={(event) => set({ priceCents: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={inputClass()} /></label>
            <label className="text-xs text-muted">PayPal plan ID<input value={terms.paypalPlanId ?? ""} onChange={(event) => set({ paypalPlanId: event.target.value.trim() || null })} className={inputClass()} /></label>
          </>
        )}
        <label className="text-xs text-muted sm:col-span-2 lg:col-span-3">Description<input value={terms.description} maxLength={500} onChange={(event) => set({ description: event.target.value })} className={inputClass()} /></label>
        <label className="flex items-end gap-2 pb-2 text-xs text-muted"><input type="checkbox" checked={terms.isActive} onChange={(event) => set({ isActive: event.target.checked })} className="size-4 accent-[#2F6FED]" />Available to new customers</label>
      </fieldset>
      {canManage && dirty && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Reason (kept in the audit trail)" aria-label={`Reason for changing ${plan.name}`} className={`${inputClass()} min-w-[240px] flex-1`} />
          <Button type="button" onClick={() => { setTerms(initial); setStatus(null); }} disabled={saving}>Discard</Button>
          <Button type="submit" variant="primary" disabled={saving || !reason.trim()}>{saving ? "Saving…" : `Save as v${plan.version ? plan.version + 1 : 2}`}</Button>
        </div>
      )}
      <StatusLine status={status} />
      {plan.versions.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-medium text-blueprint hover:underline" onClick={() => setShowHistory((open) => !open)}>{showHistory ? "Hide" : "Show"} history ({plan.versions.length})</button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {plan.versions.map((version) => (
                <li key={version.version}>
                  <span className="font-semibold text-primary">v{version.version}</span> · {formatDateTime(version.createdAt)} · {version.createdByEmail ?? "system"} · {version.reason} — {formatNumber(version.terms.monthlyCredits)} credits/mo,{" "}
                  {version.terms.interval === "month" ? cents(version.terms.priceCents, version.terms.currency) : "free"}, {version.terms.isActive ? "active" : "retired"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

function PacksCard({ packs, canManage, onChanged }: { packs: AdminCreditPack[]; canManage: boolean; onChanged: () => void }) {
  const api = useAdminApi();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: "", name: "", priceCents: 1000, credits: 50, isActive: true, reason: "" });
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const pack = packs.find((row) => row.id === editing) ?? null;

  const startEdit = (row: AdminCreditPack) => {
    setEditing(row.id);
    setForm({ sku: row.sku, name: row.name, priceCents: row.priceCents, credits: row.credits, isActive: row.isActive, reason: "" });
    setStatus(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.reason.trim()) return;
    setSaving(true);
    setStatus(null);
    const terms = { name: form.name.trim(), priceCents: form.priceCents, credits: form.credits, isActive: form.isActive };
    try {
      const result = pack
        ? await api.updateCreditPack(pack.id, { expectedVersion: pack.version, terms, reason: form.reason.trim() })
        : await api.createCreditPack({ sku: form.sku.trim(), terms, reason: form.reason.trim() });
      setStatus(outcome(result, pack ? "Pack updated. Checkouts already started keep the price they were created at." : "Pack created."));
      setEditing(null);
      setForm({ sku: "", name: "", priceCents: 1000, credits: 50, isActive: true, reason: "" });
      onChanged();
    } catch (failure) {
      setStatus({ tone: "error", text: failure instanceof Error ? failure.message : "Couldn't save the pack" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Credit packs" icon={Package}>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead><tr className="border-b border-hairline text-xs uppercase tracking-wide text-faint"><th className="px-5 py-2">Pack</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Per credit</th><th className="px-3 py-2 text-right">Sold</th><th className="px-5 py-2" /></tr></thead>
          <tbody className="divide-y divide-hairline">
            {packs.map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-2"><span className="font-medium text-primary">{row.name}</span> <span className="text-xs text-faint">{row.sku}{row.version ? ` · v${row.version}` : ""}</span> {!row.isActive && <Pill tone="neutral">Retired</Pill>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.credits)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cents(row.priceCents, row.currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.priceCents / 100 / row.credits)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.purchases)}</td>
                <td className="px-5 py-2 text-right">{canManage && <Button type="button" onClick={() => startEdit(row)}>Edit</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2 lg:grid-cols-6">
          <p className="text-sm font-medium text-primary sm:col-span-2 lg:col-span-6">{pack ? `Edit ${pack.name}` : "New pack"}</p>
          <label className="text-xs text-muted">SKU<input required disabled={Boolean(pack)} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value.toLowerCase() })} placeholder="pack-100" className={inputClass()} /></label>
          <label className="text-xs text-muted">Name<input required value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass()} /></label>
          <label className="text-xs text-muted">Credits<input type="number" min={1} required value={form.credits} onChange={(event) => setForm({ ...form, credits: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={inputClass()} /></label>
          <label className="text-xs text-muted">Price (cents)<input type="number" min={1} required value={form.priceCents} onChange={(event) => setForm({ ...form, priceCents: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={inputClass()} /></label>
          <label className="flex items-end gap-2 pb-2 text-xs text-muted"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="size-4 accent-[#2F6FED]" />On sale</label>
          <label className="text-xs text-muted">Reason<input required value={form.reason} maxLength={300} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={inputClass()} /></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            {pack && <Button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>}
            <Button type="submit" variant="primary" disabled={saving || !form.reason.trim() || !form.name.trim() || (!pack && !form.sku.trim())}>{saving ? "Saving…" : pack ? "Save pack" : "Create pack"}</Button>
          </div>
        </form>
      )}
      <StatusLine status={status} />
    </Card>
  );
}

const USAGE_LABELS: Record<keyof AdminPricingSimulationRequest["usage"], string> = {
  renders: "Renders",
  referenceRenders: "Reference renders",
  fidelityRenders: "Strict fidelity renders",
  edits: "Edit passes",
  upscale4k: "4K outputs / upscales",
  upscale8k: "8K outputs / upscales",
  selections: "Auto selects",
};

function SimulatorCard({ data }: { data: AdminPlansResponse }) {
  const api = useAdminApi();
  const [planSlug, setPlanSlug] = useState(data.plans.find((plan) => plan.interval === "month")?.slug ?? data.plans[0]?.slug ?? "");
  const [usage, setUsage] = useState<AdminPricingSimulationRequest["usage"]>({ renders: 40, referenceRenders: 20, fidelityRenders: 5, edits: 15, upscale4k: 5, upscale8k: 1, selections: 20 });
  const [prices, setPrices] = useState<CreditPrices>(data.creditPrices.prices);
  const [result, setResult] = useState<AdminPricingSimulationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setResult(await api.simulatePricing({ planSlug, periodDays: 30, usage, prices }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't run the simulation");
    }
  };

  return (
    <Card title="Pricing simulator · one month" icon={Calculator}>
      <form onSubmit={(event) => void run(event)} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block text-xs text-muted">Plan
            <select value={planSlug} onChange={(event) => setPlanSlug(event.target.value)} className={inputClass()}>
              {data.plans.map((plan) => <option key={plan.slug} value={plan.slug}>{plan.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(USAGE_LABELS) as (keyof typeof usage)[]).map((key) => (
              <label key={key} className="text-xs text-muted">{USAGE_LABELS[key]}<input type="number" min={0} value={usage[key]} onChange={(event) => setUsage({ ...usage, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={inputClass()} /></label>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-blueprint">Try different credit prices</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {PRICE_KEYS.map((key) => (
                <label key={key} className="text-xs text-muted">{CREDIT_PRICE_LABELS[key]}<input type="number" min={0} value={prices[key]} onChange={(event) => setPrices({ ...prices, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={inputClass()} /></label>
              ))}
            </div>
          </details>
          <Button type="submit" variant="primary">Simulate</Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div>
          {!result ? (
            <p className="text-sm text-muted">Set a month of usage and simulate to see the credits it needs, what the customer pays, and the estimated provider cost.</p>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-muted">Credits needed</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(result.creditsNeeded)}</dd></div>
                <div><dt className="text-muted">Included in plan</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(result.includedCredits)}</dd></div>
                <div><dt className="text-muted">Customer pays</dt><dd className="text-lg font-semibold tabular-nums">{formatUsd(result.revenueUsd)}</dd></div>
                <div><dt className="text-muted">Provider cost (est.)</dt><dd className="text-lg font-semibold tabular-nums">{formatUsd(result.providerCostUsd)}</dd></div>
                <div className="col-span-2"><dt className="text-muted">Contribution</dt><dd className={`text-2xl font-bold tabular-nums ${result.contributionUsd < 0 ? "text-rose-600" : "text-emerald-700"}`}>{formatUsd(result.contributionUsd)}</dd></div>
              </dl>
              {result.packsNeeded && <p className="text-sm text-muted">{formatNumber(result.extraCredits)} extra credits → {result.packsNeeded.count} × {result.packsNeeded.name} ({cents(result.packsNeeded.costCents)})</p>}
              <table className="w-full text-left text-xs">
                <thead><tr className="text-faint"><th className="py-1">Action</th><th className="py-1 text-right">Count</th><th className="py-1 text-right">Credits</th></tr></thead>
                <tbody className="divide-y divide-hairline">{result.creditsByAction.map((row) => <tr key={row.action}><td className="py-1">{CREDIT_PRICE_LABELS[row.action]}</td><td className="py-1 text-right tabular-nums">{formatNumber(row.count)}</td><td className="py-1 text-right tabular-nums">{formatNumber(row.credits)}</td></tr>)}</tbody>
              </table>
              <ul className="list-disc space-y-1 pl-4 text-xs text-faint">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </div>
          )}
        </div>
      </form>
    </Card>
  );
}
