import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useApiClient } from "../lib/apiClient";
import { onTourFinished } from "../guide/useGuideStore";
import { BetaWelcomeModal } from "./BetaWelcomeModal";
import { refreshBeta, useBetaStore } from "./useBetaStore";
import { takePendingJoinToken } from "./joinToken";
import { FeedbackDrawer } from "./feedback/FeedbackDrawer";
import { ReportThread } from "./feedback/ReportThread";
import { useFeedbackStore } from "./feedback/useFeedbackStore";
import { BetaInvitationModal } from "./BetaInvitationModal";
import { dismissedInvitations, invitationToPrompt, useInvitationPrompt } from "./invitationPrompt";

/**
 * Wires the beta program into the signed-in app: loads the tester's state once the account has,
 * records a finished beta tour on the server (so it holds across devices), returns someone who
 * signed in from an invitation link to that link, and shows the welcome on a first visit, the
 * report drawer and report threads. Invited non-testers get the invitation instead.
 */
export function BetaBridge() {
  const api = useApiClient();
  const navigate = useNavigate();
  const welcomeOpen = useBetaStore((state) => state.welcomeOpen);
  const hasTester = useBetaStore((state) => state.tester !== null);
  const reportOpen = useFeedbackStore((state) => state.open);
  const threadId = useFeedbackStore((state) => state.threadId);
  const openThread = useFeedbackStore((state) => state.openThread);
  const invitations = useBetaStore((state) => state.invitations);
  const promptId = useInvitationPrompt((state) => state.openId);
  const openPrompt = useInvitationPrompt((state) => state.open);
  const prompted = useRef(false);
  const reportKey = useFeedbackStore((state) => `${state.target?.renderId ?? "general"}:${state.kind ?? ""}`);

  useEffect(() => {
    void refreshBeta(api.getBetaMe);
  }, [api]);

  useEffect(() => {
    const token = takePendingJoinToken();
    if (token) navigate(`/beta/join?t=${encodeURIComponent(token)}`, { replace: true });
  }, [navigate]);

  useEffect(
    () =>
      onTourFinished((tourId) => {
        if (tourId !== "beta" || !useBetaStore.getState().tester) return;
        void api.markBetaTourComplete().then(() => refreshBeta(api.getBetaMe)).catch(() => undefined);
      }),
    [api],
  );

  // Someone with an account who's been invited sees the invitation once per visit, until they
  // join or set it aside with "Not now" (it stays on the dashboard either way).
  useEffect(() => {
    if (hasTester || prompted.current || invitations.length === 0) return;
    const next = invitationToPrompt(invitations, dismissedInvitations());
    prompted.current = true;
    if (next) openPrompt(next.id);
  }, [hasTester, invitations, openPrompt]);

  const invitation = promptId ? invitations.find((item) => item.id === promptId) ?? null : null;
  if (!hasTester) return invitation ? <BetaInvitationModal invitation={invitation} /> : null;
  return (
    <>
      {welcomeOpen && <BetaWelcomeModal />}
      {/* Keyed so each report opens with a fresh form. */}
      {reportOpen && <FeedbackDrawer key={reportKey} />}
      {threadId && <ReportThread id={threadId} onClose={() => openThread(null)} />}
    </>
  );
}
