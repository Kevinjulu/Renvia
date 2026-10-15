import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuideStore } from "../guide/useGuideStore";
import { daysLeft, useBetaStore } from "./useBetaStore";

/**
 * The tester's Beta button in the canvas header: credits and days left at a glance, unread
 * announcements, the way into the Beta Program area, and replays of the welcome and tour.
 * Starts the beta tour on a tester's first visit to a project. Renders nothing for non-testers.
 */
export function BetaButton() {
  const navigate = useNavigate();
  const tester = useBetaStore((state) => state.tester);
  const welcomeOpen = useBetaStore((state) => state.welcomeOpen);
  const payWithOwnCredits = useBetaStore((state) => state.payWithOwnCredits);
  const setPayWithOwnCredits = useBetaStore((state) => state.setPayWithOwnCredits);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const startTour = useGuideStore((state) => state.startTour);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tourPending = Boolean(tester && !tester.tourCompletedAt);

  // First visit to a project as a tester: the beta tour, once the welcome is out of the way.
  useEffect(() => {
    if (!tourPending || welcomeOpen) return;
    const timeout = window.setTimeout(() => {
      if (useGuideStore.getState().mode === "idle") startTour("beta");
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [tourPending, welcomeOpen, startTour]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!tester) return null;
  const unread = tester.unreadAnnouncements;
  const missionsLeft = tester.missions.filter((mission) => !mission.completedAt).length;
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-secondary hover:bg-surface-muted";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        data-guide="beta.button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-blueprint/30 bg-blueprint-soft px-2.5 py-1.5 text-xs font-semibold text-blueprint"
      >
        Beta
        <span className="tabular-nums font-medium">{tester.credits.remaining} cr</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white" aria-label={`${unread} unread announcements`}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-hairline bg-white p-2 shadow-xl">
          <div className="px-3 pb-2 pt-1">
            <p className="text-sm font-semibold text-primary">{tester.program.name}</p>
            <p className="text-xs text-muted">
              {tester.credits.remaining} of {tester.credits.granted} beta credits · {daysLeft(tester.endsAt)} days left
            </p>
            {!tester.running && <p className="mt-1 text-xs text-amber-700">{tester.status === "suspended" ? "Your beta access is paused." : "Beta rendering is paused right now."}</p>}
          </div>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); navigate("/beta"); }}>
            Beta Program{missionsLeft > 0 ? ` · ${missionsLeft} missions to go` : ""}{unread > 0 ? ` · ${unread} new` : ""}
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); startTour("beta"); }}>
            Replay the beta tour
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setWelcomeOpen(true); }}>
            Replay the welcome
          </button>
          <label className="mt-1 flex cursor-pointer items-center justify-between gap-3 border-t border-hairline px-3 pb-1 pt-2.5 text-xs text-secondary">
            Pay with my own credits
            <input type="checkbox" checked={payWithOwnCredits} onChange={(event) => setPayWithOwnCredits(event.target.checked)} />
          </label>
          <p className="px-3 pb-1 text-[11px] text-faint">{payWithOwnCredits ? "Renders now use your own credits, not beta credits." : "Renders use beta credits."}</p>
        </div>
      )}
    </div>
  );
}
