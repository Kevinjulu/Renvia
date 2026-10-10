import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useApiClient } from "../lib/apiClient";
import { AppLoader } from "../components/loading/AppLoader";
import { loadCreditHistory, refreshAccount, useAccountStore } from "../lib/useAccountStore";
import { useLimitDialogStore } from "../lib/useLimitDialog";
import { LimitDialog } from "../components/LimitDialog";
import { AccountDialog } from "../components/account/AccountDialog";
import { ConnectionBanner } from "../components/ConnectionBanner";

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
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Credit history only fills the granted total for the meters, so it runs alongside
    // /me instead of after it and never holds up the first render.
    loadCreditHistory(apiClient.getMyCredits).catch(() => undefined);
    // Without the account, credits, limits and costs stay blank, so keep trying until it loads.
    // The app opens after the first attempt either way; the connection banner covers an outage.
    const load = (attempt: number) => {
      void refreshAccount(apiClient.getMe).then((loaded) => {
        if (cancelled) return;
        setSynced(true);
        if (!loaded) retry = setTimeout(() => load(attempt + 1), Math.min(30_000, 2_000 * 2 ** attempt));
      });
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [apiClient, isSignedIn]);

  if (!isLoaded || (isSignedIn && !synced)) {
    return <AppLoader />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Outlet />
      <ConnectionBanner />
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
