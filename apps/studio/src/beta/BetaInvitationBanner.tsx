import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { refreshBeta, useBetaStore } from "./useBetaStore";
import { useInvitationPrompt } from "./invitationPrompt";

/** Beta invitations addressed to this account, accepted right here — no link needed. */
export function BetaInvitationBanner() {
  const api = useApiClient();
  const navigate = useNavigate();
  const invitations = useBetaStore((state) => state.invitations);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
  const openPrompt = useInvitationPrompt((state) => state.open);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (invitations.length === 0) return null;

  const accept = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await api.acceptBetaInvitationById(id);
      await Promise.all([refreshBeta(api.getBetaMe), refreshAccount(api.getMe)]);
      setWelcomeOpen(true);
      navigate("/beta");
    } catch (failure) {
      setError(failure instanceof ApiError && failure.detail ? failure.detail : "Couldn't accept the invitation. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {invitations.map((invitation) => (
        <div key={invitation.id} className="relative overflow-hidden rounded-2xl border border-blueprint/25 bg-white shadow-sm">
          <img src="/beta/invite-dusk.jpg" alt="" className="absolute inset-y-0 right-0 hidden h-full w-2/5 object-cover sm:block" />
          <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-2/5 bg-gradient-to-r from-white via-white/40 to-transparent sm:block" />
          <div className="relative flex flex-wrap items-center gap-4 px-5 py-4 sm:pr-[42%]">
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blueprint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blueprint" /> You're invited to the private beta
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-primary">{invitation.programName}</p>
              <p className="text-xs text-secondary">
                {invitation.credits} free beta credits · until {new Date(invitation.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })} · your projects and credits stay as they are
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => openPrompt(invitation.id)} className="rounded-lg border border-hairline bg-white px-3 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">See what's included</button>
              <button type="button" disabled={busy !== null} onClick={() => void accept(invitation.id)} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                {busy === invitation.id ? "Joining…" : "Join the beta"}
              </button>
            </div>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
