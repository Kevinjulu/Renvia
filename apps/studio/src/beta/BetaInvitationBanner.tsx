import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, useApiClient } from "../lib/apiClient";
import { refreshAccount } from "../lib/useAccountStore";
import { refreshBeta, useBetaStore } from "./useBetaStore";

/** Beta invitations addressed to this account, accepted right here — no link needed. */
export function BetaInvitationBanner() {
  const api = useApiClient();
  const navigate = useNavigate();
  const invitations = useBetaStore((state) => state.invitations);
  const setWelcomeOpen = useBetaStore((state) => state.setWelcomeOpen);
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
        <div key={invitation.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-blueprint/30 bg-blueprint-soft px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">You're invited to {invitation.programName}</p>
            <p className="text-xs text-secondary">
              {invitation.credits} beta credits · until {new Date(invitation.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. Your account, plan and credits stay as they are.
            </p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void accept(invitation.id)} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {busy === invitation.id ? "Joining…" : "Join the beta"}
          </button>
        </div>
      ))}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
