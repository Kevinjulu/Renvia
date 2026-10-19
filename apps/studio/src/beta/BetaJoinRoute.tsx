import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import type { BetaInvitationPreview } from "@renvia/types";
import { AUTH_ROUTES } from "../lib/authRoutes";
import { ApiError, useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { Logo } from "../components/brand/Logo";
import { refreshBeta, useBetaStore } from "./useBetaStore";
import { rememberJoinToken } from "./joinToken";

const STATE_COPY: Record<Exclude<BetaInvitationPreview["state"], "pending">, string> = {
  redeemed: "This invitation has already been used.",
  expired: "This invitation has expired. Ask the Ramah Studio team for a new one.",
  revoked: "This invitation has been withdrawn.",
  closed: "This beta program isn't accepting testers right now.",
};

/**
 * The invitation link's landing page. Works signed out (it shows the program and sends them
 * through sign-up or sign-in, then back here) and signed in (one click to join).
 */
export function BetaJoinRoute() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApiClient();
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const [preview, setPreview] = useState<BetaInvitationPreview | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This invitation link isn't complete. Open the link from your invitation again.");
      return;
    }
    api.previewBetaInvitation(token).then(setPreview).catch(() => setError("This invitation link isn't valid."));
  }, [api, token]);

  const goAuth = (route: string) => {
    rememberJoinToken(token);
    navigate(route);
  };

  const join = async () => {
    setJoining(true);
    setError("");
    try {
      await api.acceptBetaInvitation(token);
      await Promise.all([refreshBeta(api.getBetaMe), refreshAccount(api.getMe)]);
      setWelcomeOpen(true);
      navigate("/beta", { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiError && failure.detail ? failure.detail : "Couldn't join right now. Try again in a moment.");
      setJoining(false);
    }
  };

  const open = preview?.state === "pending";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-white p-6 shadow-xl">
        <Logo className="mb-5" wordmarkClassName="text-[20px] text-primary" />
        {!preview && !error && <p className="text-sm text-muted">Checking your invitation…</p>}
        {preview && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-blueprint">Private beta</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-primary">You're invited to {preview.programName}</h1>
            {preview.programDescription && <p className="mt-2 text-sm text-muted">{preview.programDescription}</p>}
            <ul className="mt-4 space-y-1 text-sm text-secondary">
              <li>{preview.credits} beta credits, separate from anything you buy</li>
              <li>Access until {new Date(preview.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</li>
              {preview.invitedEmail && <li>For {preview.invitedEmail}</li>}
            </ul>
            {!open && preview.state !== "pending" && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{STATE_COPY[preview.state]}</p>}
          </>
        )}
        {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{error}</p>}

        {open && isLoaded && (
          <div className="mt-6 flex flex-wrap justify-end gap-2.5">
            {isSignedIn ? (
              <button type="button" disabled={joining} onClick={() => void join()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                {joining ? "Joining…" : "Join the beta"}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => goAuth(AUTH_ROUTES.signIn)} className="rounded-lg px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">
                  I have an account
                </button>
                <button type="button" onClick={() => goAuth(AUTH_ROUTES.signUp)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  Create my account
                </button>
              </>
            )}
          </div>
        )}
        {isSignedIn && (
          <button type="button" onClick={() => navigate("/dashboard")} className="mt-4 text-xs text-faint hover:text-secondary">
            Go to the dashboard
          </button>
        )}
      </div>
    </div>
  );
}
