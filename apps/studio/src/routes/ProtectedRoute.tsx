import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useApiClient } from "../lib/apiClient";
import { AppLoader } from "../components/loading/AppLoader";

export function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const apiClient = useApiClient();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    setSynced(false);
    apiClient.getMe().finally(() => setSynced(true));
    // apiClient is a new object each render; only re-sync when sign-in state actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (!isLoaded || (isSignedIn && !synced)) {
    return <AppLoader />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
