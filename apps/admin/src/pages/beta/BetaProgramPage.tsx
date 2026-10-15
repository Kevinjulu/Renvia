import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Users } from "lucide-react";
import { STUDIO_FEATURES, type AdminBetaProgramDetailResponse, type AdminBetaInvitationCreated, type BetaMissionRule, type StudioFeatureKey } from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton, StatCard, Table } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { formatUsd } from "../../lib/format";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { inputClass } from "../settings/components";
import { askReason, betaCan, endOfDay, errorText, programDays, PROGRAM_STATUS_TONE, scheduleLabel, startOfDay, toDateInput } from "./shared";

type Detail = AdminBetaProgramDetailResponse;
type Tab = "testers" | "invitations" | "missions" | "announcements" | "settings" | "insights";
const TABS: { key: Tab; label: string }[] = [
  { key: "testers", label: "Testers" },
  { key: "invitations", label: "Invitations" },
  { key: "missions", label: "Missions" },
  { key: "announcements", label: "Announcements" },
  { key: "settings", label: "Settings" },
  { key: "insights", label: "Insights" },
];

/** One program: capacity, spend, testers, invitations, missions, announcements and settings. */
export function BetaProgramPage() {
  const { id = "" } = useParams();
  const api = useAdminApi();
  const can = betaCan(useAdmin());
  const { data, error, reload } = useLoad(() => api.getBetaProgram(id), [api, id]);
  const [tab, setTab] = useState<Tab>("testers");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /** Runs an action, reports how it went, and reloads the program. */
  const run = async (action: () => Promise<unknown>, done: string) => {
    setStatus(null);
    try {
      const result = await action();
      setStatus({ tone: "ok", text: result && typeof result === "object" && "pendingApproval" in result ? "Waiting for a second admin in Approvals." : done });
      reload();
    } catch (reason) {
      setStatus({ tone: "error", text: errorText(reason, "That didn't work") });
    }
  };

  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-64" />;
  const { program } = data;
  const used = program.budgetUsd > 0 ? program.spentUsd / program.budgetUsd : 1;

  const changeStatus = (next: "active" | "paused" | "ended", verb: string) => {
    const reason = askReason(`Why ${verb} ${program.name}?${next === "ended" ? " Every tester is completed and their beta credits expire." : ""}`);
    if (reason) void run(() => api.setBetaProgramStatus(program.id, next, reason), `Program ${next === "active" ? "running" : next}.`);
  };
  const changeBudget = () => {
    const value = window.prompt(`New Fal budget in USD (now ${formatUsd(program.budgetUsd)}). This never changes the global cap.`, String(program.budgetUsd));
    if (value === null) return;
    const budgetUsd = Number(value);
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0) return setStatus({ tone: "error", text: "Enter a dollar amount" });
    const reason = askReason("Why change the budget?");
    if (reason) void run(() => api.setBetaBudget(program.id, Math.round(budgetUsd * 100) / 100, reason), `Budget set to ${formatUsd(budgetUsd)}.`);
  };

  return (
    <div>
      <Link to="/beta" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> All programs</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-[26px] font-bold tracking-tight text-primary">{program.name}</h1><Pill tone={PROGRAM_STATUS_TONE[program.status]}>{program.status}</Pill></div>
          <p className="text-sm text-muted">{new Date(program.startsAt).toLocaleDateString()} – {new Date(program.endsAt).toLocaleDateString()} · {scheduleLabel(program.startsAt, program.endsAt)} · {program.slug}</p>
        </div>
        {can.managePrograms && program.status !== "ended" && (
          <div className="flex flex-wrap gap-2">
            {(program.status === "draft" || program.status === "paused") && <Button variant="primary" onClick={() => changeStatus("active", "start")}>{program.status === "draft" ? "Start program" : "Resume"}</Button>}
            {program.status === "active" && <Button onClick={() => changeStatus("paused", "pause")}>Pause</Button>}
            <Button onClick={changeBudget}>Change budget</Button>
            <Button onClick={() => setTab("settings")}>Change dates</Button>
            <Button variant="danger" onClick={() => changeStatus("ended", "end")}>End</Button>
          </div>
        )}
      </div>

      {status && <p className={`mb-4 rounded-xl px-3 py-2 text-sm ${status.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{status.text}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Testers" value={`${program.capacity.active + program.capacity.suspended} / ${program.maxTesters}`} detail={`${program.capacity.suspended} suspended · ${program.capacity.free} free`} icon={Users} accent="blue" />
        <StatCard label="Pending invites" value={program.capacity.pendingSlots} detail="Each holds a place" accent="neutral" />
        <StatCard label="Fal spend" value={formatUsd(program.spentUsd)} detail={`of ${formatUsd(program.budgetUsd)} · warns at ${program.budgetWarningPercent}%`} accent={used >= 1 ? "rose" : used * 100 >= program.budgetWarningPercent ? "amber" : "emerald"} />
        <StatCard label="Credits granted" value={program.creditsGranted} detail={`${program.creditsPerTester} each · ceiling ${program.maxCreditsPerTester}`} accent="neutral" />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-hairline">
        {TABS.map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === item.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-primary"}`}>{item.label}</button>
        ))}
      </div>

      {tab === "testers" && <TestersTab data={data} can={can} run={run} />}
      {tab === "invitations" && <InvitationsTab data={data} can={can} run={run} reload={reload} />}
      {tab === "missions" && <MissionsTab data={data} can={can} run={run} />}
      {tab === "announcements" && <AnnouncementsTab data={data} can={can} run={run} />}
      {tab === "settings" && <SettingsTab data={data} can={can} run={run} />}
      {tab === "insights" && <InsightsTab data={data} />}
    </div>
  );
}

type Can = ReturnType<typeof betaCan>;
type Run = (action: () => Promise<unknown>, done: string) => Promise<void>;

const ENROLLMENT_TONE = { active: "emerald", suspended: "amber", completed: "neutral", revoked: "red" } as const;

function TestersTab({ data, can, run }: { data: Detail; can: Can; run: Run }) {
  const api = useAdminApi();
  const [selected, setSelected] = useState<string[]>([]);
  const live = data.enrollments.filter((row) => row.status === "active" || row.status === "suspended");
  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));

  const lifecycle = (id: string, email: string, status: "active" | "suspended" | "completed" | "revoked", verb: string) => {
    const reason = askReason(`Why ${verb} ${email}?${status === "completed" || status === "revoked" ? " Their beta credits expire; their own credits are untouched." : ""}`);
    if (reason) void run(() => api.setBetaEnrollmentStatus(id, status, reason), `${email}: ${status}.`);
  };
  const extend = (id: string, email: string, current: string) => {
    const value = window.prompt(`New end date for ${email} (YYYY-MM-DD), or blank to follow the program.`, current.slice(0, 10));
    if (value === null) return;
    const reason = askReason("Why change their end date?");
    if (reason) void run(() => api.extendBetaEnrollment(id, value ? new Date(`${value}T23:59:59Z`).toISOString() : null, reason), `${email}'s end date changed.`);
  };
  const grant = (ids: string[]) => {
    const value = window.prompt(`Beta credits to grant to ${ids.length} tester${ids.length === 1 ? "" : "s"} (does not raise the budget)`, "10");
    if (!value) return;
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 1) return;
    const note = askReason("Note for the ledger");
    if (note) void run(() => api.grantBetaCredits(data.program.id, { enrollmentIds: ids, amount, note, idempotencyKey: crypto.randomUUID() }), `Granted ${amount} credits.`);
  };

  if (data.enrollments.length === 0) return <EmptyState icon={Users}>No testers yet. Invite people from the Invitations tab.</EmptyState>;
  return (
    <Card actions={can.grantCredits && selected.length > 0 ? <Button variant="primary" onClick={() => grant(selected)}>Grant credits to {selected.length}</Button> : undefined}>
      <Table head={["", "Tester", "Status", "Beta credits", "Ends", "Onboarding", ""]}>
        {data.enrollments.map((row) => {
          const isLive = row.status === "active" || row.status === "suspended";
          return (
            <tr key={row.id}>
              <td className="px-5 py-3">{can.grantCredits && isLive && <input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.email}`} />}</td>
              <td className="px-5 py-3"><Link to={`/users/${row.userId}`} className="font-medium text-primary hover:underline">{row.email}</Link>{row.cohort && <p className="text-xs text-faint">{row.cohort}</p>}</td>
              <td className="px-5 py-3"><Pill tone={ENROLLMENT_TONE[row.status]}>{row.status}</Pill></td>
              <td className="px-5 py-3 tabular-nums">{row.betaCredits} <span className="text-faint">/ {row.creditsGranted}</span></td>
              <td className="px-5 py-3 text-xs">{new Date(row.endsAt).toLocaleDateString()}{row.endsAtOverride && <span className="text-blueprint"> · extended</span>}</td>
              <td className="px-5 py-3 text-xs text-muted">{row.tourCompletedAt ? "Tour done" : row.welcomeSeenAt ? "Welcomed" : "Not yet"}</td>
              <td className="px-5 py-3 text-right">
                {isLive && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {can.manageTesters && row.status === "active" && <Button variant="ghost" onClick={() => lifecycle(row.id, row.email, "suspended", "suspend")}>Suspend</Button>}
                    {can.manageTesters && row.status === "suspended" && <Button variant="ghost" onClick={() => lifecycle(row.id, row.email, "active", "reactivate")}>Reactivate</Button>}
                    {can.manageTesters && <Button variant="ghost" onClick={() => extend(row.id, row.email, row.endsAt)}>Extend</Button>}
                    {can.grantCredits && <Button variant="ghost" onClick={() => grant([row.id])}>Top up</Button>}
                    {can.manageTesters && <Button variant="ghost" onClick={() => lifecycle(row.id, row.email, "completed", "complete")}>Complete</Button>}
                    {can.manageTesters && <Button variant="danger" onClick={() => lifecycle(row.id, row.email, "revoked", "revoke")}>Revoke</Button>}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      <p className="mt-3 text-xs text-faint">{live.length} current testers. Suspending freezes beta credits; completing or revoking expires them. Testers keep their projects, plan and own credits.</p>
    </Card>
  );
}

function InvitationsTab({ data, can, run, reload }: { data: Detail; can: Can; run: Run; reload: () => void }) {
  const api = useAdminApi();
  const [mode, setMode] = useState<"email" | "bulk" | "link">("email");
  const [email, setEmail] = useState("");
  const [emails, setEmails] = useState("");
  const [places, setPlaces] = useState(1);
  const [cohort, setCohort] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [created, setCreated] = useState<{ email: string; link: string; sent: boolean }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const linkFor = (result: AdminBetaInvitationCreated) => result.joinUrl ?? (STUDIO_ORIGIN ? `${STUDIO_ORIGIN}${result.joinPath}` : result.joinPath);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const common = { cohort: cohort.trim() || null };
      if (mode === "bulk") {
        const list = emails.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
        const { results } = await api.inviteBetaTestersBulk(data.program.id, { emails: list, sendEmail, ...common });
        setCreated(results.flatMap((result) => (result.ok ? [{ email: result.email, link: linkFor(result), sent: result.emailSent }] : [])));
        const failed = results.filter((result) => !result.ok) as { email: string; error: string }[];
        if (failed.length) setError(failed.map((item) => `${item.email}: ${item.error}`).join(" · "));
      } else {
        const result = await api.inviteBetaTester(data.program.id, mode === "email" ? { kind: "email", email, sendEmail, ...common } : { kind: "link", maxRedemptions: places, ...common });
        setCreated([{ email: mode === "email" ? (result.invitation.userEmail ?? email) : `Link · ${places} place${places === 1 ? "" : "s"}`, link: linkFor(result), sent: result.emailSent }]);
        setEmail("");
      }
      reload();
    } catch (reason) {
      setError(errorText(reason, "Couldn't create the invitation"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (id: string) => {
    const reason = askReason("Why revoke this invitation? Its place is released.");
    if (reason) void run(() => api.revokeBetaInvitation(id, reason), "Invitation revoked.");
  };

  return (
    <div className="space-y-5">
      {can.manageTesters && data.program.status !== "ended" && (
        <Card title={`Invite testers · ${data.program.capacity.free} places free`}>
          <div className="mb-3 flex gap-2">
            {(["email", "bulk", "link"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-full px-3 py-1 text-xs font-medium ${mode === item ? "bg-primary text-white" : "bg-surface-muted text-secondary"}`}>{item === "email" ? "One person" : item === "bulk" ? "Several emails" : "Shareable link"}</button>
            ))}
          </div>
          <form onSubmit={(event) => void submit(event)} className="grid gap-3 md:grid-cols-2">
            {mode === "email" && <label className="text-sm text-primary md:col-span-2">Email<input type="email" required className={inputClass()} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="architect@studio.com" /></label>}
            {mode === "bulk" && <label className="text-sm text-primary md:col-span-2">Emails (one per line, or separated by commas)<textarea required rows={4} className={inputClass()} value={emails} onChange={(event) => setEmails(event.target.value)} /></label>}
            {mode === "link" && <label className="text-sm text-primary">Places on this link<input type="number" min={1} max={100} className={inputClass()} value={places} onChange={(event) => setPlaces(Number(event.target.value))} /></label>}
            <label className="text-sm text-primary">Cohort (optional)<input className={inputClass()} value={cohort} onChange={(event) => setCohort(event.target.value)} placeholder="architects" /></label>
            {mode !== "link" && <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Send a Clerk invitation email to new addresses</label>}
            <p className="text-xs text-faint md:col-span-2">An address that already has a Renvia account is invited to that account and accepts in the Studio; nobody gets a second account. Each invitation holds a place until it's used, revoked or expires.</p>
            {error && <p className="text-sm text-rose-600 md:col-span-2">{error}</p>}
            <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Inviting…" : "Create invitation"}</Button></div>
          </form>
          {created.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">Copy these links now — they won't be shown again.</p>
              {created.some((item) => item.link.startsWith("/")) && <p className="text-xs text-amber-800">Put your Studio address in front of each link (set STUDIO_URL on the API to get full links and invitation emails).</p>}
              <ul className="mt-2 space-y-1.5">
                {created.map((item) => (
                  <li key={item.link} className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-900">{item.email}{item.sent ? " · emailed" : ""}</span>
                    <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs">{item.link}</code>
                    <Button variant="ghost" icon={Copy} onClick={() => void navigator.clipboard.writeText(item.link)}>Copy</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      <Card title="Invitations">
        {data.invitations.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <Table head={["For", "Kind", "State", "Used", "Expires", ""]}>
            {data.invitations.map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-3">{row.email ?? row.userEmail ?? "Anyone with the link"}{row.cohort && <p className="text-xs text-faint">{row.cohort}</p>}</td>
                <td className="px-5 py-3 text-xs">{row.kind.replace("_", " ")}</td>
                <td className="px-5 py-3"><Pill tone={row.state === "pending" ? "blue" : row.state === "redeemed" ? "emerald" : "neutral"}>{row.state}</Pill></td>
                <td className="px-5 py-3 tabular-nums text-xs">{row.redemptions} / {row.maxRedemptions}</td>
                <td className="px-5 py-3 text-xs">{new Date(row.expiresAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right">{can.manageTesters && row.state === "pending" && <Button variant="ghost" onClick={() => revoke(row.id)}>Revoke</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Optional Studio address for full links when the API has no STUDIO_URL; otherwise the path is shown. */
const STUDIO_ORIGIN = (import.meta.env.VITE_STUDIO_URL as string | undefined)?.replace(/\/$/, "") ?? null;

const RULE_KINDS: { value: BetaMissionRule["kind"]; label: string }[] = [
  { value: "render_succeeded", label: "Finish renders" },
  { value: "selection_succeeded", label: "Use auto-select" },
  { value: "feedback_submitted", label: "Send reports" },
  { value: "manual", label: "Tester ticks it" },
];

function ruleSummary(rule: BetaMissionRule): string {
  if (rule.kind === "manual") return "Ticked by the tester";
  const what = rule.kind === "render_succeeded" ? `finished ${rule.jobTypes?.join("/") ?? "any"} render` : rule.kind === "selection_succeeded" ? "successful selection" : "report";
  return `Verified: ${rule.count} ${what}${rule.count === 1 ? "" : "s"}`;
}

function MissionsTab({ data, can, run }: { data: Detail; can: Can; run: Run }) {
  const api = useAdminApi();
  const [form, setForm] = useState({ title: "", instructions: "", kind: "render_succeeded" as BetaMissionRule["kind"], count: 1, jobType: "", required: true });
  const testers = data.enrollments.filter((row) => row.status !== "revoked").length;

  const add = (event: FormEvent) => {
    event.preventDefault();
    const rule: BetaMissionRule =
      form.kind === "manual" ? { kind: "manual" }
      : form.kind === "render_succeeded" ? { kind: "render_succeeded", count: form.count, ...(form.jobType ? { jobTypes: [form.jobType] } : {}) }
      : { kind: form.kind, count: form.count };
    void run(() => api.createBetaMission(data.program.id, { title: form.title, instructions: form.instructions, rule, required: form.required, position: data.missions.length }), "Mission added.");
    setForm((current) => ({ ...current, title: "", instructions: "" }));
  };

  return (
    <div className="space-y-5">
      <Card title="Missions">
        {data.missions.length === 0 ? <p className="text-sm text-muted">No missions yet.</p> : (
          <ul className="divide-y divide-hairline">
            {data.missions.map((mission) => (
              <li key={mission.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{mission.title} {!mission.required && <span className="text-xs text-faint">optional</span>}</p>
                  <p className="text-xs text-muted">{ruleSummary(mission.rule)} · {mission.completions} of {testers} done</p>
                </div>
                {can.managePrograms && <Button variant="ghost" onClick={() => window.confirm(`Remove "${mission.title}"? Its progress is removed too.`) && void run(() => api.deleteBetaMission(mission.id), "Mission removed.")}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can.managePrograms && (
        <Card title="Add a mission">
          <form onSubmit={add} className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-primary md:col-span-2">Title<input required className={inputClass()} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Render a reference image" /></label>
            <label className="text-sm text-primary md:col-span-2">Instructions<textarea rows={2} className={inputClass()} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
            <label className="text-sm text-primary">How it completes<select className={inputClass()} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as BetaMissionRule["kind"] })}>{RULE_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {form.kind !== "manual" && <label className="text-sm text-primary">How many<input type="number" min={1} max={100} className={inputClass()} value={form.count} onChange={(event) => setForm({ ...form, count: Number(event.target.value) })} /></label>}
            {form.kind === "render_succeeded" && (
              <label className="text-sm text-primary">Kind of render<select className={inputClass()} value={form.jobType} onChange={(event) => setForm({ ...form, jobType: event.target.value })}>
                <option value="">Any</option>
                {["photo", "drawing", "references", "fidelity", "edit", "edit-references", "upscale"].map((type) => <option key={type} value={type}>{type}</option>)}
              </select></label>
            )}
            <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} /> Required</label>
            <div className="md:col-span-2"><Button type="submit" variant="primary">Add mission</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}

function AnnouncementsTab({ data, can, run }: { data: Detail; can: Can; run: Run }) {
  const api = useAdminApi();
  const [form, setForm] = useState({ title: "", body: "", severity: "info" as "info" | "important" });
  return (
    <div className="space-y-5">
      {can.manageTesters && (
        <Card title="Post an announcement">
          <form onSubmit={(event) => { event.preventDefault(); void run(() => api.createBetaAnnouncement(data.program.id, form), "Announcement posted."); setForm({ title: "", body: "", severity: "info" }); }} className="grid gap-3">
            <label className="text-sm text-primary">Title<input required className={inputClass()} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="text-sm text-primary">Message<textarea rows={3} className={inputClass()} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.severity === "important"} onChange={(event) => setForm({ ...form, severity: event.target.checked ? "important" : "info" })} /> Important (highlighted for testers)</label>
            <div><Button type="submit" variant="primary">Post to testers</Button></div>
          </form>
        </Card>
      )}
      <Card title="Announcements">
        {data.announcements.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="divide-y divide-hairline">
            {data.announcements.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{item.title} {item.severity === "important" && <Pill tone="amber">important</Pill>}</p>
                  {item.body && <p className="whitespace-pre-line text-xs text-muted">{item.body}</p>}
                  <p className="text-xs text-faint">{new Date(item.publishedAt).toLocaleString()}</p>
                </div>
                {can.manageTesters && <Button variant="ghost" onClick={() => window.confirm("Withdraw this announcement?") && void run(() => api.deleteBetaAnnouncement(item.id), "Announcement withdrawn.")}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-sm text-primary">{label}{children}</label>;
}

function SettingsTab({ data, can, run }: { data: Detail; can: Can; run: Run }) {
  const api = useAdminApi();
  const { program } = data;
  const [form, setForm] = useState({
    name: program.name,
    description: program.description,
    maxTesters: program.maxTesters,
    creditsPerTester: program.creditsPerTester,
    maxCreditsPerTester: program.maxCreditsPerTester,
    budgetWarningPercent: program.budgetWarningPercent,
    dailyRenderLimit: program.dailyRenderLimit ?? "",
    concurrentRenderLimit: program.concurrentRenderLimit ?? "",
    downloadsUnlocked: program.downloadsUnlocked,
    featureGrants: program.featureGrants,
    heading: program.welcome?.heading ?? "",
    body: program.welcome?.body ?? "",
    benefits: program.welcome?.benefits.join("\n") ?? "",
    expectations: program.welcome?.expectations.join("\n") ?? "",
  });
  const editable = can.managePrograms && program.status !== "ended";
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10);
  const limit = (value: number | string) => (value === "" ? null : Number(value));
  const toggleGrant = (key: StudioFeatureKey) => setForm((current) => ({ ...current, featureGrants: current.featureGrants.includes(key) ? current.featureGrants.filter((item) => item !== key) : [...current.featureGrants, key] }));

  const save = (event: FormEvent) => {
    event.preventDefault();
    const reason = askReason("Why change these settings?");
    if (!reason) return;
    void run(
      () =>
        api.updateBetaProgram(program.id, {
          reason,
          name: form.name,
          description: form.description,
          maxTesters: form.maxTesters,
          creditsPerTester: form.creditsPerTester,
          maxCreditsPerTester: form.maxCreditsPerTester,
          budgetWarningPercent: form.budgetWarningPercent,
          dailyRenderLimit: limit(form.dailyRenderLimit),
          concurrentRenderLimit: limit(form.concurrentRenderLimit),
          downloadsUnlocked: form.downloadsUnlocked,
          featureGrants: form.featureGrants,
          welcome: form.heading.trim() ? { heading: form.heading.trim(), body: form.body.trim(), benefits: lines(form.benefits), expectations: lines(form.expectations) } : null,
        }),
      "Settings saved.",
    );
  };

  return (
    <div className="space-y-5">
    <ScheduleCard data={data} can={can} run={run} />
    <Card title="Program settings">
      <form onSubmit={save}>
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><input className={inputClass()} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Maximum testers"><input type="number" min={1} className={inputClass()} value={form.maxTesters} onChange={(event) => setForm({ ...form, maxTesters: Number(event.target.value) })} /></Field>
          <div className="md:col-span-2"><Field label="Description (testers see this)"><textarea rows={2} className={inputClass()} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div>
          <Field label="Welcome credits per tester"><input type="number" min={0} className={inputClass()} value={form.creditsPerTester} onChange={(event) => setForm({ ...form, creditsPerTester: Number(event.target.value) })} /></Field>
          <Field label="Most credits one tester can receive"><input type="number" min={0} className={inputClass()} value={form.maxCreditsPerTester} onChange={(event) => setForm({ ...form, maxCreditsPerTester: Number(event.target.value) })} /></Field>
          <Field label="Budget warning (%)"><input type="number" min={1} max={99} className={inputClass()} value={form.budgetWarningPercent} onChange={(event) => setForm({ ...form, budgetWarningPercent: Number(event.target.value) })} /></Field>
          <Field label="Daily render limit (blank = plan's)"><input type="number" min={1} className={inputClass()} value={form.dailyRenderLimit} onChange={(event) => setForm({ ...form, dailyRenderLimit: event.target.value })} /></Field>
          <Field label="Renders at once (blank = plan's)"><input type="number" min={1} max={100} className={inputClass()} value={form.concurrentRenderLimit} onChange={(event) => setForm({ ...form, concurrentRenderLimit: event.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.downloadsUnlocked} onChange={(event) => setForm({ ...form, downloadsUnlocked: event.target.checked })} /> Testers can download renders</label>
          <div className="md:col-span-2">
            <p className="text-sm text-primary">Features unlocked beyond the tester's plan (operator switches still apply)</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {STUDIO_FEATURES.map((feature) => (
                <label key={feature.key} className="flex items-center gap-1.5 text-xs text-secondary"><input type="checkbox" checked={form.featureGrants.includes(feature.key)} onChange={() => toggleGrant(feature.key)} /> {feature.label}</label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 border-t border-hairline pt-4"><p className="text-sm font-semibold text-primary">Welcome modal</p><p className="text-xs text-faint">Leave the heading blank to use the Studio's default welcome.</p></div>
          <Field label="Heading"><input className={inputClass()} value={form.heading} onChange={(event) => setForm({ ...form, heading: event.target.value })} /></Field>
          <Field label="Body"><textarea rows={2} className={inputClass()} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></Field>
          <Field label="Benefits (one per line)"><textarea rows={4} className={inputClass()} value={form.benefits} onChange={(event) => setForm({ ...form, benefits: event.target.value })} /></Field>
          <Field label="What we ask (one per line)"><textarea rows={4} className={inputClass()} value={form.expectations} onChange={(event) => setForm({ ...form, expectations: event.target.value })} /></Field>
          {editable && <div className="md:col-span-2"><Button type="submit" variant="primary">Save settings</Button></div>}
        </fieldset>
      </form>
    </Card>
    </div>
  );
}

/**
 * When the program runs. The start can move only until it has started (testers' access counts from
 * it); the end can move any time, which extends or shortens it for every tester without their own
 * date. Neither changes credits or the budget.
 */
function ScheduleCard({ data, can, run }: { data: Detail; can: Can; run: Run }) {
  const api = useAdminApi();
  const { program } = data;
  const [startDay, setStartDay] = useState(toDateInput(program.startsAt));
  const [endDay, setEndDay] = useState(toDateInput(program.endsAt));
  const started = program.status !== "draft" && new Date(program.startsAt).getTime() <= Date.now();
  const editable = can.managePrograms && program.status !== "ended";
  const changed = startDay !== toDateInput(program.startsAt) || endDay !== toDateInput(program.endsAt);
  const valid = Boolean(startDay && endDay) && endOfDay(endDay) > startOfDay(startDay);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const reason = askReason("Why change the program dates?");
    if (!reason) return;
    const body: Record<string, unknown> = { reason };
    if (!started && startDay !== toDateInput(program.startsAt)) body.startsAt = startOfDay(startDay).toISOString();
    if (endDay !== toDateInput(program.endsAt)) body.endsAt = endOfDay(endDay).toISOString();
    void run(() => api.updateBetaProgram(program.id, body), "Dates saved.");
  };

  return (
    <Card title="Schedule">
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-primary">
          Starts on
          <input type="date" className={inputClass()} value={startDay} disabled={!editable || started} onChange={(event) => setStartDay(event.target.value)} />
          <span className="mt-1 block text-xs text-faint">{started ? "Already started; it can't move now." : "Beta rendering opens on this day."}</span>
        </label>
        <label className="text-sm text-primary">
          Ends on (last day of access)
          <input type="date" className={inputClass(valid ? undefined : "invalid")} value={endDay} min={startDay} disabled={!editable} onChange={(event) => setEndDay(event.target.value)} />
          <span className="mt-1 block text-xs text-faint">Moving it extends or shortens the program for everyone without their own date.</span>
        </label>
        <p className="text-xs text-muted md:col-span-2">
          {valid ? `${programDays(startDay, endDay)} days · ${scheduleLabel(startOfDay(startDay).toISOString(), endOfDay(endDay).toISOString())}` : "The end must be after the start."}
          {" "}Credits and the budget don't change with the dates.
        </p>
        {editable && <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={!changed || !valid}>Save dates</Button></div>}
      </form>
    </Card>
  );
}

function InsightsTab({ data }: { data: Detail }) {
  const api = useAdminApi();
  const { data: feedback } = useLoad(() => api.listBetaFeedback({ programId: data.program.id }), [api, data.program.id]);
  const testers = data.enrollments.filter((row) => row.status !== "revoked");
  const remaining = testers.reduce((sum, row) => sum + row.betaCredits, 0);
  const missionSlots = data.missions.length * testers.length;
  const missionsDone = data.missions.reduce((sum, mission) => sum + mission.completions, 0);
  const onboarded = testers.filter((row) => row.tourCompletedAt).length;
  const counts = feedback?.counts ?? {};
  const totalReports = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const open = totalReports - (counts.resolved ?? 0) - (counts.duplicate ?? 0) - (counts.expected ?? 0) - (counts.declined ?? 0) - (counts.cannot_reproduce ?? 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Beta credits spent" value={data.program.creditsGranted - remaining} detail={`${remaining} still with testers`} accent="blue" />
      <StatCard label="Cost per credit spent" value={data.program.creditsGranted - remaining > 0 ? formatUsd(data.program.spentUsd / (data.program.creditsGranted - remaining)) : "—"} detail="Budgeted fal cost" accent="neutral" />
      <StatCard label="Mission completion" value={missionSlots ? `${Math.round((missionsDone / missionSlots) * 100)}%` : "—"} detail={`${missionsDone} of ${missionSlots}`} accent="emerald" />
      <StatCard label="Finished the tour" value={`${onboarded} / ${testers.length}`} accent="neutral" />
      <StatCard label="Reports" value={totalReports} detail={`${open} open`} accent={open > 0 ? "amber" : "neutral"} />
      <StatCard label="Waiting to verify" value={counts.ready_to_verify ?? 0} detail="Fixes testers haven't confirmed" accent="neutral" />
      <div className="sm:col-span-2 lg:col-span-3"><Link to={`/beta-feedback?programId=${data.program.id}`} className="text-sm font-medium text-blueprint hover:underline">Open this program's feedback inbox →</Link></div>
    </div>
  );
}
