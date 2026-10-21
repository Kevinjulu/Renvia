import { confirmDialog } from "../../components/dialogs";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, ShieldCheck, UserPlus } from "lucide-react";
import type { AdminUser } from "@renvia/types";
import { Button, Card, Pill, Skeleton } from "../../components/ui";
import { useAdminApi } from "../../lib/api";
import { useAdmin } from "../../lib/useAdmin";
import { useLoad } from "../../lib/useLoad";
import { inputClass } from "../settings/components";
import { betaCan, errorText, ROUTINE_REASON } from "../beta/shared";

const ENROLLMENT_TONE = { active: "emerald", suspended: "amber", completed: "neutral", revoked: "red" } as const;

/**
 * An account's beta program: where they've tested, open invitations, and inviting them to a
 * program from here. Their projects, plan and own credits are never touched by any of it.
 */
export function UserBetaPanel({ user, projectCount }: { user: AdminUser; projectCount: number }) {
  const api = useAdminApi();
  const can = betaCan(useAdmin());
  const status = useLoad(() => api.getUserBetaStatus(user.id), [api, user.id], 30_000);
  const programs = useLoad(() => api.listBetaPrograms(), [api]);
  const [programId, setProgramId] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [cohort, setCohort] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const live = status.data?.enrollments.find((row) => row.status === "active" || row.status === "suspended") ?? null;
  const pending = useMemo(() => status.data?.invitations.filter((row) => row.state === "pending") ?? [], [status.data]);
  // Programs they could join now: not ended, a place free, and not already theirs.
  const open = useMemo(
    () =>
      (programs.data?.programs ?? []).filter(
        (program) =>
          program.status !== "ended" &&
          new Date(program.endsAt).getTime() > Date.now() &&
          program.capacity.free > 0 &&
          !status.data?.enrollments.some((row) => row.programId === program.id) &&
          !pending.some((row) => row.programId === program.id),
      ),
    [programs.data, status.data, pending],
  );
  const chosen = open.find((program) => program.id === programId) ?? open[0] ?? null;
  const creditsValue = credits ?? chosen?.creditsPerTester ?? 0;

  const invite = async () => {
    if (!chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.inviteBetaTester(chosen.id, {
        kind: "existing_user",
        userId: user.id,
        creditsOverride: creditsValue === chosen.creditsPerTester ? null : creditsValue,
        cohort: cohort.trim() || null,
      });
      setMessage({ tone: "ok", text: `Invited to ${chosen.name}. They'll see the invitation next time they open the Studio.` });
      setCredits(null);
      setCohort("");
      status.reload();
      programs.reload();
    } catch (reason) {
      setMessage({ tone: "error", text: errorText(reason, "Couldn't send the invitation") });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!(await confirmDialog({ title: "Revoke this invitation?", message: "Its place is released and it disappears from their Studio.", confirmLabel: "Revoke", danger: true }))) return;
    try {
      await api.revokeBetaInvitation(id, ROUTINE_REASON);
      status.reload();
      programs.reload();
    } catch (reason) {
      setMessage({ tone: "error", text: errorText(reason, "Couldn't revoke the invitation") });
    }
  };

  return (
    <Card title="Beta program" icon={FlaskConical} actions={live ? <Pill tone="emerald">Testing now</Pill> : pending.length ? <Pill tone="blue">Invited</Pill> : undefined}>
      {status.data === null && !status.error ? (
        <Skeleton className="h-24" />
      ) : status.error ? (
        <p className="text-sm text-rose-600">{status.error}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {status.data!.enrollments.length === 0 && pending.length === 0 && (
              <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">Never part of a beta program.</p>
            )}
            {status.data!.enrollments.length > 0 && (
              <ul className="space-y-2">
                {status.data!.enrollments.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline px-4 py-3">
                    <div className="min-w-0">
                      <Link to={`/beta/${row.programId}`} className="text-sm font-medium text-primary hover:underline">{row.programName}</Link>
                      <p className="text-xs text-muted">
                        Joined {new Date(row.enrolledAt).toLocaleDateString()} · until {new Date(row.endsAt).toLocaleDateString()} · {row.creditsGranted} beta credits granted{row.cohort ? ` · ${row.cohort}` : ""}
                      </p>
                    </div>
                    <Pill tone={ENROLLMENT_TONE[row.status]}>{row.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <ul className="space-y-2">
                {pending.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blueprint/25 bg-blueprint-soft/50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary">Invited to {row.programName}</p>
                      <p className="text-xs text-muted">Sent {new Date(row.createdAt).toLocaleDateString()}{row.createdByEmail ? ` by ${row.createdByEmail}` : ""} · open until {new Date(row.expiresAt).toLocaleDateString()}</p>
                    </div>
                    {can.manageTesters && <Button variant="ghost" onClick={() => void revoke(row.id)}>Revoke</Button>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-2 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
              <ShieldCheck size={15} className="mt-px shrink-0" />
              <p>
                Joining a beta never touches their {projectCount} project{projectCount === 1 ? "" : "s"}, {user.renderCount} render{user.renderCount === 1 ? "" : "s"}, plan or {user.creditBalance} credits. Beta credits are added on top and spent first; only unused beta credits expire when the program ends.
              </p>
            </div>
          </div>

          {can.manageTesters && !live && (
            <div className="rounded-2xl border border-hairline bg-surface p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-primary"><UserPlus size={15} /> Invite to a beta</p>
              {programs.data === null ? (
                <Skeleton className="mt-3 h-20" />
              ) : open.length === 0 ? (
                <p className="mt-2 text-xs text-muted">No program has a free place for them right now. <Link to="/beta" className="font-medium text-blueprint hover:underline">Open Beta Management</Link></p>
              ) : (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm text-primary">
                    Program
                    <select className={inputClass()} value={chosen?.id ?? ""} onChange={(event) => { setProgramId(event.target.value); setCredits(null); }}>
                      {open.map((program) => <option key={program.id} value={program.id}>{program.name} · {program.capacity.free} free</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-primary">
                    Beta credits
                    <input type="number" min={0} max={chosen?.maxCreditsPerTester} className={inputClass()} value={creditsValue} onChange={(event) => setCredits(Number(event.target.value))} />
                    {chosen && <span className="mt-1 block text-xs text-faint">Default {chosen.creditsPerTester}, at most {chosen.maxCreditsPerTester}</span>}
                  </label>
                  <label className="block text-sm text-primary">
                    Cohort <span className="text-faint">(optional)</span>
                    <input className={inputClass()} value={cohort} maxLength={60} onChange={(event) => setCohort(event.target.value)} />
                  </label>
                  <Button variant="primary" className="w-full" disabled={busy || !chosen || user.disabled} onClick={() => void invite()}>{busy ? "Inviting…" : "Send invitation"}</Button>
                  {user.disabled && <p className="text-xs text-amber-700">Enable the account before inviting it.</p>}
                </div>
              )}
              {message && <p className={`mt-3 text-xs ${message.tone === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
