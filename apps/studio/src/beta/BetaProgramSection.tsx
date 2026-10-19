import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BetaMission } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { daysLeft, refreshBeta, useBetaStore } from "./useBetaStore";
import { BetaInvitationBanner } from "./BetaInvitationBanner";
import { MyReports } from "./feedback/MyReports";
import { useFeedbackStore } from "./feedback/useFeedbackStore";

/** A labelled figure with a bar showing how much of it is used up or done. */
function StatCard({ label, value, of, detail, percent, tone = "blueprint" }: { label: string; value: string | number; of?: string | number; detail?: string; percent: number; tone?: "blueprint" | "emerald" | "amber" }) {
  const bar = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-blueprint";
  return (
    <div className="rounded-2xl border border-hairline bg-white px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-primary">
        {value}
        {of !== undefined && <span className="text-sm font-normal text-faint"> / {of}</span>}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="presentation">
        <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      {detail && <p className="mt-1.5 text-xs text-muted">{detail}</p>}
    </div>
  );
}

function MissionRow({ mission, onComplete, busy }: { mission: BetaMission; onComplete: () => void; busy: boolean }) {
  const done = Boolean(mission.completedAt);
  return (
    <li className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${done ? "border-hairline bg-surface-muted/40" : "border-hairline bg-white"}`}>
      <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-hairline-strong text-transparent"}`}>✓</span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${done ? "text-muted line-through" : "text-primary"}`}>
          {mission.title}
          {!mission.required && <span className="ml-2 text-xs font-normal text-faint">optional</span>}
        </p>
        {mission.instructions && <p className="mt-0.5 text-xs text-muted">{mission.instructions}</p>}
        {!done && mission.kind !== "manual" && (
          <p className="mt-1 text-xs text-faint">
            Verified automatically · {mission.count} of {mission.target}
          </p>
        )}
      </div>
      {!done && mission.kind === "manual" && (
        <button type="button" disabled={busy} onClick={onComplete} className="shrink-0 rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium text-secondary hover:bg-surface-muted disabled:opacity-50">
          Mark done
        </button>
      )}
    </li>
  );
}

/** The tester's Beta Program area: credits and dates, missions, announcements and how they pay. */
export function BetaProgramSection() {
  const api = useApiClient();
  const tester = useBetaStore((state) => state.tester);
  const loaded = useBetaStore((state) => state.loaded);
  const payWithOwnCredits = useBetaStore((state) => state.payWithOwnCredits);
  const setPayWithOwnCredits = useBetaStore((state) => state.setPayWithOwnCredits);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const openReport = useFeedbackStore((state) => state.openReport);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Missions verify against what the tester has done since the last load.
  useEffect(() => {
    void refreshBeta(api.getBetaMe);
  }, [api]);

  // Reading the area counts as reading the announcements in it.
  const unread = tester?.unreadAnnouncements ?? 0;
  useEffect(() => {
    if (unread === 0) return;
    const timeout = window.setTimeout(() => {
      void api.markBetaAnnouncementsSeen().then(() => refreshBeta(api.getBetaMe)).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [api, unread]);

  if (!loaded) return <p className="text-sm text-muted">Loading your beta program…</p>;
  if (!tester) {
    return (
      <div className="space-y-4">
        <BetaInvitationBanner />
        <p className="text-sm text-muted">You're not part of a beta program right now. If you've been invited, accept the invitation above or open the link you were sent.</p>
      </div>
    );
  }

  const complete = async (missionId: string) => {
    setBusy(missionId);
    try {
      await api.completeBetaMission(missionId);
      await refreshBeta(api.getBetaMe);
    } catch {
      setNotice("Couldn't save that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const missionsDone = tester.missions.filter((mission) => mission.completedAt).length;
  const requiredLeft = tester.missions.filter((mission) => mission.required && !mission.completedAt).length;
  const endDate = new Date(tester.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const left = daysLeft(tester.endsAt);
  const totalDays = Math.max(1, daysLeft(tester.endsAt, new Date(tester.enrolledAt).getTime()));
  const creditPercent = tester.credits.granted > 0 ? (tester.credits.remaining / tester.credits.granted) * 100 : 0;
  const missionPercent = tester.missions.length > 0 ? (missionsDone / tester.missions.length) * 100 : 0;
  const quick = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium";

  return (
    <div className="space-y-6">
      {notice && <div className="feature-notice" role="status">{notice}</div>}
      {!tester.running && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {tester.status === "suspended"
            ? "Your beta access is paused. Your projects and beta credits are safe; we'll be in touch."
            : "Beta rendering is paused for now. Your projects, missions and announcements are still here."}
        </div>
      )}

      <section className="relative overflow-hidden rounded-2xl border border-blueprint/20 bg-gradient-to-br from-blueprint-soft via-white to-white px-5 py-5 sm:px-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(#2F6FED14_1px,transparent_1px),linear-gradient(90deg,#2F6FED14_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tester.running ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${tester.running ? "bg-emerald-500" : "bg-amber-500"}`} />
                {tester.running ? "Active" : "Paused"}
              </span>
              <span className="text-xs text-muted">{left} {left === 1 ? "day" : "days"} left · ends {endDate}</span>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold text-primary">{tester.program.name}</h2>
            {tester.program.description && <p className="mt-1 max-w-2xl text-sm text-secondary">{tester.program.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openReport()} className={`${quick} bg-primary text-white hover:opacity-90`}>Report a problem</button>
            <button type="button" onClick={() => openReport(null, "suggestion")} className={`${quick} border border-hairline bg-white text-secondary hover:bg-surface-muted`}>Share an idea</button>
            <button type="button" onClick={() => navigate("/dashboard")} className={`${quick} border border-hairline bg-white text-secondary hover:bg-surface-muted`}>Open a project →</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Beta credits" value={tester.credits.remaining} of={tester.credits.granted} percent={creditPercent} tone={creditPercent < 20 ? "amber" : "blueprint"} detail={creditPercent < 20 ? "Running low — your own credits can take over below." : "Every render in the beta uses these first."} />
        <StatCard label="Time left" value={`${left} ${left === 1 ? "day" : "days"}`} percent={(left / totalDays) * 100} tone={left <= 3 ? "amber" : "blueprint"} detail={`Access ends ${endDate}`} />
        <StatCard label="Missions" value={missionsDone} of={tester.missions.length} percent={missionPercent} tone="emerald" detail={tester.missions.length === 0 ? "None yet" : requiredLeft > 0 ? `${requiredLeft} required still to do` : "All required missions done"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-primary">Your missions</h2>
              {tester.missions.length > 0 && <span className="text-xs text-faint">{Math.round(missionPercent)}% complete</span>}
            </div>
            {tester.missions.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">No missions yet. Use Ramah Studio as you normally would, and report anything that looks wrong.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {tester.missions.map((mission) => (
                  <MissionRow key={mission.id} mission={mission} busy={busy === mission.id} onComplete={() => void complete(mission.id)} />
                ))}
              </ul>
            )}
          </section>

          <MyReports />
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-hairline bg-white px-4 py-4">
            <h2 className="font-display text-base font-semibold text-primary">Giving great feedback</h2>
            <ul className="mt-2 space-y-2 text-sm text-secondary">
              <li><strong className="font-medium text-primary">Feedback button</strong> — top right of every project, or press <kbd className="rounded border border-hairline px-1 text-xs">Shift</kbd> + <kbd className="rounded border border-hairline px-1 text-xs">F</kbd>.</li>
              <li><strong className="font-medium text-primary">Flag a render</strong> — the flag on any render lets you pin, box or draw on the exact spot.</li>
              <li><strong className="font-medium text-primary">Paste a screenshot</strong> — Ctrl+V in the form attaches it.</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-hairline bg-white px-4 py-4">
            <h2 className="font-display text-base font-semibold text-primary">Announcements</h2>
            {tester.announcements.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing yet. Updates from the Ramah Studio team will appear here.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {tester.announcements.map((announcement) => (
                  <li key={announcement.id} className={`rounded-xl border px-3.5 py-3 ${announcement.severity === "important" ? "border-amber-200 bg-amber-50" : "border-hairline bg-surface-muted/40"}`}>
                    <p className="text-sm font-medium text-primary">
                      {announcement.title}
                      {announcement.unread && <span className="ml-2 rounded-full bg-blueprint px-1.5 py-0.5 text-[10px] font-semibold text-white">New</span>}
                    </p>
                    {announcement.body && <p className="mt-1 whitespace-pre-line text-sm text-secondary">{announcement.body}</p>}
                    <p className="mt-1 text-xs text-faint">{new Date(announcement.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-hairline bg-white px-4 py-4">
            <label className="flex cursor-pointer items-center justify-between gap-4 text-sm text-primary">
              <span>
                <strong className="font-medium">Pay with my own credits</strong>
                <span className="mt-0.5 block text-xs text-muted">
                  Off: renders use beta credits, and stop when they run out. On: renders use your own credits instead. Resets when you sign in again.
                </span>
              </span>
              <input
                type="checkbox"
                checked={payWithOwnCredits}
                onChange={(event) => {
                  setPayWithOwnCredits(event.target.checked);
                  void refreshAccount(api.getMe);
                }}
              />
            </label>
          </section>

          <button type="button" onClick={() => setWelcomeOpen(true)} className="w-full rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">Replay the welcome</button>
        </aside>
      </div>
    </div>
  );
}
