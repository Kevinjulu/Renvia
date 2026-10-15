import { useEffect, useState } from "react";
import type { BetaMission } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { daysLeft, refreshBeta, useBetaStore } from "./useBetaStore";
import { BetaInvitationBanner } from "./BetaInvitationBanner";

function MissionRow({ mission, onComplete, busy }: { mission: BetaMission; onComplete: () => void; busy: boolean }) {
  const done = Boolean(mission.completedAt);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-hairline px-4 py-3">
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
  const endDate = new Date(tester.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

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

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-hairline bg-white px-4 py-3">
          <p className="text-xs text-faint">Beta credits</p>
          <p className="font-display text-2xl font-semibold tabular-nums text-primary">{tester.credits.remaining}<span className="text-sm font-normal text-faint"> / {tester.credits.granted}</span></p>
        </div>
        <div className="rounded-xl border border-hairline bg-white px-4 py-3">
          <p className="text-xs text-faint">Access ends</p>
          <p className="font-display text-2xl font-semibold tabular-nums text-primary">{daysLeft(tester.endsAt)} days</p>
          <p className="text-xs text-muted">{endDate}</p>
        </div>
        <div className="rounded-xl border border-hairline bg-white px-4 py-3">
          <p className="text-xs text-faint">Missions</p>
          <p className="font-display text-2xl font-semibold tabular-nums text-primary">{missionsDone}<span className="text-sm font-normal text-faint"> / {tester.missions.length}</span></p>
        </div>
      </section>

      <section className="rounded-xl border border-hairline bg-white px-4 py-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 text-sm text-primary">
          <span>
            <strong className="font-medium">Pay with my own credits</strong>
            <span className="block text-xs text-muted">
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

      <section>
        <h2 className="font-display text-lg font-semibold text-primary">Your missions</h2>
        {tester.missions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No missions yet. Use Renvia as you normally would, and report anything that looks wrong.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tester.missions.map((mission) => (
              <MissionRow key={mission.id} mission={mission} busy={busy === mission.id} onComplete={() => void complete(mission.id)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-primary">Announcements</h2>
        {tester.announcements.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing yet. Updates from the Renvia team will appear here.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tester.announcements.map((announcement) => (
              <li key={announcement.id} className={`rounded-xl border px-4 py-3 ${announcement.severity === "important" ? "border-amber-200 bg-amber-50" : "border-hairline bg-white"}`}>
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
    </div>
  );
}
