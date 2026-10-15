import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { STUDIO_FEATURES, type BetaPendingInvitation } from "@renvia/types";
import { ApiError, useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { refreshBeta, useBetaStore } from "./useBetaStore";
import { daysUntil, dismissInvitation, useInvitationPrompt } from "./invitationPrompt";

const KEEPS = [
  { title: "Your projects stay put", text: "Every project, upload and render you've made stays exactly where it is." },
  { title: "Your credits are untouched", text: "Beta credits are added on top and spent first. Your own credits are only used if you switch that on." },
  { title: "Nothing to undo afterwards", text: "When the beta ends, only unused beta credits expire. Your plan carries on as before." },
];

function Check() {
  return (
    <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
      <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>
    </span>
  );
}

/** Drag to compare: the elevation drawing on the left, the Renvia render on the right. */
function BeforeAfter() {
  const [split, setSplit] = useState(52);
  return (
    <div className="relative h-full min-h-[220px] w-full select-none overflow-hidden bg-neutral-900">
      <img src="/hero/elevation-render.jpg" alt="A photoreal render of a house elevation" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        <img src="/hero/elevation-sketch.jpg" alt="The line drawing it was rendered from" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,.35)]" style={{ left: `${split}%` }}>
        <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-primary shadow-lg">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="M6 4 2 8l4 4M10 4l4 4-4 4" /></svg>
        </span>
      </div>
      <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">Drawing</span>
      <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">Renvia render</span>
      <input type="range" min={5} max={95} value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Compare the drawing and the render" className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  );
}

/**
 * The invitation, for someone who already has a Renvia account: what the program gives them,
 * that nothing they have changes, and one click to join. "Not now" leaves it on the dashboard.
 */
export function BetaInvitationModal({ invitation }: { invitation: BetaPendingInvitation }) {
  const api = useApiClient();
  const navigate = useNavigate();
  const close = useInvitationPrompt((state) => state.close);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const later = () => {
    dismissInvitation(invitation.id);
    close();
  };

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      dismissInvitation(invitation.id);
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, invitation.id, close]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await api.acceptBetaInvitationById(invitation.id);
      await Promise.all([refreshBeta(api.getBetaMe), refreshAccount(api.getMe)]);
      close();
      setWelcomeOpen(true);
      navigate("/beta");
    } catch (failure) {
      setError(failure instanceof ApiError && failure.detail ? failure.detail : "Couldn't accept the invitation. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const ends = new Date(invitation.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  const expiresIn = daysUntil(invitation.expiresAt);
  const features = (invitation.featureGrants ?? []).map((key) => STUDIO_FEATURES.find((feature) => feature.key === key)?.label ?? key);
  const perks = [
    { value: `${invitation.credits}`, label: "beta credits", note: "free, on top of yours" },
    { value: `${daysUntil(invitation.endsAt)}`, label: "days of access", note: `until ${ends}` },
    invitation.downloadsUnlocked
      ? { value: "HD", label: "downloads", note: "full resolution unlocked" }
      : { value: `${features.length || "All"}`, label: features.length === 1 ? "feature" : "features", note: features.length ? "unlocked for you" : "you already use" },
  ];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={() => !busy && later()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-invite-title"
        onClick={(event) => event.stopPropagation()}
        className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl outline-none md:grid-cols-[1.05fr_1fr]"
      >
        <div className="relative h-56 md:h-auto">
          <BeforeAfter />
          <span className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-blueprint shadow">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blueprint" /> Private beta
          </span>
        </div>

        <div className="flex max-h-[85vh] flex-col overflow-y-auto">
          <div className="px-6 pb-4 pt-6 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-wider text-blueprint">You're invited</p>
            <h2 id="beta-invite-title" className="mt-1 font-display text-2xl font-semibold leading-tight text-primary">Join {invitation.programName}</h2>
            <p className="mt-2 text-sm text-secondary">
              {invitation.programDescription || "Get early access to what we're building next, render on us, and help shape Renvia with your feedback."}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {perks.map((perk) => (
                <div key={perk.label} className="rounded-2xl border border-hairline bg-surface-muted/50 px-3 py-3 text-center">
                  <p className="font-display text-xl font-semibold tabular-nums text-primary">{perk.value}</p>
                  <p className="text-xs font-medium text-secondary">{perk.label}</p>
                  <p className="mt-0.5 text-[11px] text-faint">{perk.note}</p>
                </div>
              ))}
            </div>
            {features.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {features.map((feature) => <span key={feature} className="rounded-full bg-blueprint-soft px-2.5 py-0.5 text-[11px] font-medium text-blueprint">{feature}</span>)}
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-3.5">
              <p className="text-sm font-semibold text-primary">What happens to your account</p>
              <ul className="mt-2 space-y-2">
                {KEEPS.map((item) => (
                  <li key={item.title} className="flex gap-2.5">
                    <Check />
                    <span className="text-sm">
                      <span className="font-medium text-primary">{item.title}.</span> <span className="text-secondary">{item.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-xs text-muted">As a tester you'll get a few short missions and a Feedback button in every project. Tell us what works and what doesn't.</p>
            {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4 sm:px-7">
            <span className="text-xs text-faint">{expiresIn <= 1 ? "Invitation closes today" : `Invitation open for ${expiresIn} more days`}</span>
            <div className="flex gap-2">
              <button type="button" onClick={later} disabled={busy} className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">Not now</button>
              <button type="button" onClick={() => void accept()} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
                {busy ? "Joining…" : "Join the beta"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
