import { HandleSSOCallback } from "@clerk/react";
import { useNavigate } from "react-router-dom";
import { AUTH_ROUTES } from "../lib/authRoutes";

export function SsoCallbackRoute() {
  const navigate = useNavigate();

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 text-primary">
      <div className="text-center" role="status" aria-live="polite">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="mt-4 text-sm text-muted">Finishing your secure sign-in…</p>
      </div>

      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => {
          const destination = decorateUrl(AUTH_ROUTES.afterAuth);
          if (destination.startsWith("http")) {
            window.location.assign(destination);
            return;
          }
          navigate(destination, { replace: true });
        }}
        navigateToSignIn={() => navigate(AUTH_ROUTES.signIn, { replace: true })}
        navigateToSignUp={() => navigate(AUTH_ROUTES.signUp, { replace: true })}
      />
    </main>
  );
}
