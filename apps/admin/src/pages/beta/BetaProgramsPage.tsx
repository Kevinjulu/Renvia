import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Plus } from "lucide-react";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton } from "../../components/ui";
import { PageHero } from "../../components/PageHero";
import { useAdminApi } from "../../lib/api";
import { formatUsd } from "../../lib/format";
import { navForPath } from "../../lib/nav";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { inputClass } from "../settings/components";
import { betaCan, endOfDay, errorText, programDays, PROGRAM_STATUS_TONE, scheduleLabel, startOfDay, toDateInput } from "./shared";

/** Every beta program at a glance, and a new one (admins). */
export function BetaProgramsPage() {
  const api = useAdminApi();
  const can = betaCan(useAdmin());
  const nav = navForPath("/beta");
  const { data, error, reload } = useLoad(() => api.listBetaPrograms(), [api]);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHero
        title={nav.title}
        description={nav.description}
        image={nav.banner}
        actions={can.managePrograms ? <Button variant="primary" icon={Plus} onClick={() => setCreating((open) => !open)}>New program</Button> : undefined}
      />
      {creating && <CreateProgram onDone={() => { setCreating(false); reload(); }} />}
      {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
      {!data && !error && <Skeleton className="h-40" />}
      {data && data.programs.length === 0 && <EmptyState icon={FlaskConical}>No beta programs yet.</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.programs.map((program) => {
          const used = program.budgetUsd > 0 ? Math.min(1, program.spentUsd / program.budgetUsd) : 1;
          return (
            <Link key={program.id} to={`/beta/${program.id}`} className="block rounded-2xl border border-hairline bg-canvas p-5 shadow-card transition hover:shadow-card-hover">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-primary">{program.name}</h2>
                  <p className="text-xs text-faint">
                    {new Date(program.startsAt).toLocaleDateString()} – {new Date(program.endsAt).toLocaleDateString()} · {scheduleLabel(program.startsAt, program.endsAt)}
                  </p>
                </div>
                <Pill tone={PROGRAM_STATUS_TONE[program.status]}>{program.status}</Pill>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-faint">Testers</dt><dd className="text-sm font-semibold tabular-nums text-primary">{program.capacity.active + program.capacity.suspended} / {program.maxTesters}</dd></div>
                <div><dt className="text-faint">Pending</dt><dd className="text-sm font-semibold tabular-nums text-primary">{program.capacity.pendingSlots}</dd></div>
                <div><dt className="text-faint">Credits granted</dt><dd className="text-sm font-semibold tabular-nums text-primary">{program.creditsGranted}</dd></div>
              </dl>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted"><span>Fal spend</span><span className="tabular-nums">{formatUsd(program.spentUsd)} of {formatUsd(program.budgetUsd)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div className={`h-full rounded-full ${used >= 1 ? "bg-rose-500" : used * 100 >= program.budgetWarningPercent ? "bg-[#c45c26]" : "bg-emerald-500"}`} style={{ width: `${used * 100}%` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CreateProgram({ onDone }: { onDone: () => void }) {
  const api = useAdminApi();
  const today = toDateInput(new Date());
  const [form, setForm] = useState({
    name: "Ramah Studio Private Beta",
    slug: "private-beta",
    description: "",
    startDay: today,
    // 21 days including the first: today plus 20.
    endDay: toDateInput(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)),
    maxTesters: 10,
    creditsPerTester: 25,
    budgetUsd: 10,
  });
  const days = form.startDay && form.endDay ? programDays(form.startDay, form.endDay) : 0;
  const datesOk = days >= 14 && days <= 21;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { startDay, endDay, ...rest } = form;
      await api.createBetaProgram({ ...rest, startsAt: startOfDay(startDay).toISOString(), endsAt: endOfDay(endDay).toISOString(), reason: "Created from Beta Management" });
      onDone();
    } catch (reason) {
      setError(errorText(reason, "Couldn't create the program"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="New beta program" className="mb-6">
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-primary">Name<input className={inputClass()} value={form.name} onChange={(event) => set({ name: event.target.value })} required /></label>
        <label className="text-sm text-primary">Slug<input className={inputClass()} value={form.slug} onChange={(event) => set({ slug: event.target.value })} pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" required /></label>
        <label className="text-sm text-primary md:col-span-2">Description (testers see this)<textarea className={inputClass()} rows={2} value={form.description} onChange={(event) => set({ description: event.target.value })} /></label>
        <label className="text-sm text-primary">Starts on<input type="date" required className={inputClass()} value={form.startDay} min={today} onChange={(event) => set({ startDay: event.target.value })} /></label>
        <label className="text-sm text-primary">Ends on (last day testers have access)<input type="date" required className={inputClass(datesOk ? undefined : "invalid")} value={form.endDay} min={form.startDay} onChange={(event) => set({ endDay: event.target.value })} /></label>
        <p className={`text-xs md:col-span-2 ${datesOk ? "text-faint" : "text-rose-600"}`}>
          {days > 0 ? `${days} days, ${new Date(startOfDay(form.startDay)).toLocaleDateString()} to ${new Date(endOfDay(form.endDay)).toLocaleDateString()}.` : "Pick both dates."}{" "}
          {datesOk ? "Testers can join once you press Start; beta rendering opens on the start day." : "A new program runs 14–21 days. You can extend it later."}
        </p>
        <label className="text-sm text-primary">Maximum testers<input type="number" min={1} max={1000} className={inputClass()} value={form.maxTesters} onChange={(event) => set({ maxTesters: Number(event.target.value) })} /></label>
        <label className="text-sm text-primary">Beta credits per tester<input type="number" min={0} max={10000} className={inputClass()} value={form.creditsPerTester} onChange={(event) => set({ creditsPerTester: Number(event.target.value) })} /></label>
        <label className="text-sm text-primary">Fal budget (USD, at most $10 to start)<input type="number" min={0} max={10} step={0.01} className={inputClass()} value={form.budgetUsd} onChange={(event) => set({ budgetUsd: Number(event.target.value) })} /></label>
        <p className="text-xs text-faint md:col-span-2">The program starts as a draft. Start it from its page once missions and the welcome are ready. Raising the budget later is a separate, audited action.</p>
        {error && <p className="text-sm text-rose-600 md:col-span-2">{error}</p>}
        <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={saving || !datesOk}>{saving ? "Creating…" : "Create draft"}</Button></div>
      </form>
    </Card>
  );
}
