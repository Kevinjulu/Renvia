import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useApiClient } from "../lib/apiClient";
import { AppLoader } from "../components/loading/AppLoader";
import { loadCreditHistory, refreshAccount, useAccountStore } from "../lib/useAccountStore";
import { useLimitDialogStore } from "../lib/useLimitDialog";
import { LimitDialog } from "../components/LimitDialog";
import { AccountDialog } from "../components/account/AccountDialog";

export function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const apiClient = useApiClient();
  const [synced, setSynced] = useState(false);
  const me = useAccountStore((state) => state.me);
  const refusal = useLimitDialogStore((state) => state.refusal);
  const creditsOpen = useLimitDialogStore((state) => state.creditsOpen);
  const dismiss = useLimitDialogStore((state) => state.dismiss);
  const setCreditsOpen = useLimitDialogStore((state) => state.setCreditsOpen);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    setSynced(false);
    refreshAccount(apiClient.getMe).finally(() => {
      setSynced(true);
      // Fills the granted-credits total for the credit meters; not needed to render the app.
      loadCreditHistory(apiClient.getMyCredits).catch(() => undefined);
    });
    // apiClient is a new object each render; only re-sync when sign-in state actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (!isLoaded || (isSignedIn && !synced)) {
    return <AppLoader />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Outlet />
      {refusal && (
        <LimitDialog
          refusal={refusal}
          me={me}
          onDismiss={dismiss}
          onViewCredits={() => {
            dismiss();
            setCreditsOpen(true);
          }}
        />
      )}
      {creditsOpen && <AccountDialog initialTab="plan" onClose={() => setCreditsOpen(false)} />}
    </>
  );
}
