import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { STUDIO_FEATURES } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { useGuideStore } from "../guide/useGuideStore";
import { daysLeft, refreshBeta, useBetaStore } from "./useBetaStore";

const DEFAULT_EXPECTATIONS = [
  "Render real elevations you work with, and tell us when the result changes the architecture.",
  "Try editing, materials and downloads, not only the first render.",
  "Report problems from the Beta button so we see the render they happened on.",
];

/** The tester's introduction: what they get, for how long, what we ask, and what we keep. */
export function BetaWelcomeModal() {
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const tester = useBetaStore((state) => state.tester);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const startTour = useGuideStore((state) => state.startTour);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  if (!tester) return null;
  const { program, credits } = tester;
  const welcome = program.welcome;
  const inCanvas = location.pathname.startsWith("/project/");

  const close = (next?: () => void) => {
    setWelcomeOpen(false);
    if (!tester.welcomeSeenAt) void api.markBetaWelcomeSeen().then(() => refreshBeta(api.getBetaMe)).catch(() => undefined);
    next?.();
  };

  const featureBenefits = program.featureGrants.map((key) => `${STUDIO_FEATURES.find((feature) => feature.key === key)?.label ?? key} included`);
  const benefits = welcome?.benefits.length
    ? welcome.benefits
    : [`${credits.granted} beta credits to render with`, ...(program.downloadsUnlocked ? ["Downloads included while you test"] : []), ...featureBenefits, "A direct line to the Ramah Studio team"];
  const expectations = welcome?.expectations.length ? welcome.expectations : DEFAULT_EXPECTATIONS;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/50 px-4" onClick={() => close()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-welcome-title"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-hairline bg-white p-6 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-blueprint">{program.name}</p>
        <h2 id="beta-welcome-title" className="mt-1 font-display text-2xl font-semibold text-primary">
          {welcome?.heading || "Welcome to the Ramah Studio beta"}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {welcome?.body || "You're one of a small group helping shape Ramah Studio before it opens to everyone. Render your own work, push the tools, and tell us what breaks."}
        </p>

        <dl className="mt-5 grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-[11px] text-faint">Beta credits</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-primary">{credits.remaining}</dd>
          </div>
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-[11px] text-faint">Days left</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-primary">{daysLeft(tester.endsAt)}</dd>
          </div>
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-[11px] text-faint">Missions</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-primary">{tester.missions.length}</dd>
          </div>
        </dl>

        <h3 className="mt-5 text-sm font-semibold text-primary">What you get</h3>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-secondary">
          {benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
        </ul>

        <h3 className="mt-4 text-sm font-semibold text-primary">What we ask</h3>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-secondary">
          {expectations.map((expectation) => <li key={expectation}>{expectation}</li>)}
        </ul>

        <p className="mt-4 rounded-xl border border-hairline px-3 py-2.5 text-xs text-muted">
          Beta credits are separate from your own credits and are never mixed with them; when they run out we ask before using yours.
          When you send a report we keep what you wrote, your marks on the image, any screenshot you attach, and technical details of the
          render you reported. We don't record your screen or track your activity.
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={() => close(() => navigate("/beta"))} className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">
            See my missions
          </button>
          <button
            type="button"
            onClick={() => close(inCanvas ? () => startTour("beta") : undefined)}
            className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {inCanvas ? "Start the beta tour" : "Start testing"}
          </button>
        </div>
        {!inCanvas && !tester.tourCompletedAt && <p className="mt-2 text-right text-xs text-faint">A short tour starts when you open a project.</p>}
      </div>
    </div>
  );
}
