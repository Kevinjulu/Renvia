import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApiClient } from "../lib/apiClient";
import { onTourFinished } from "../guide/useGuideStore";
import { BetaWelcomeModal } from "./BetaWelcomeModal";
import { refreshBeta, useBetaStore } from "./useBetaStore";
import { takePendingJoinToken } from "./joinToken";
import { FeedbackDrawer } from "./feedback/FeedbackDrawer";
import { ReportThread } from "./feedback/ReportThread";
import { useFeedbackStore } from "./feedback/useFeedbackStore";

/**
 * Wires the beta program into the signed-in app: loads the tester's state once the account has,
 * records a finished beta tour on the server (so it holds across devices), returns someone who
 * signed in from an invitation link to that link, and shows the welcome on a first visit, the
 * report drawer and report threads.
 */
export function BetaBridge() {
  const api = useApiClient();
  const navigate = useNavigate();
  const welcomeOpen = useBetaStore((state) => state.welcomeOpen);
  const hasTester = useBetaStore((state) => state.tester !== null);
  const reportOpen = useFeedbackStore((state) => state.open);
  const threadId = useFeedbackStore((state) => state.threadId);
  const openThread = useFeedbackStore((state) => state.openThread);
  const reportKey = useFeedbackStore((state) => state.target?.renderId ?? "general");

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

  if (!hasTester) return null;
  return (
    <>
      {welcomeOpen && <BetaWelcomeModal />}
      {/* Keyed so each report opens with a fresh form. */}
      {reportOpen && <FeedbackDrawer key={reportKey} />}
      {threadId && <ReportThread id={threadId} onClose={() => openThread(null)} />}
    </>
  );
}
