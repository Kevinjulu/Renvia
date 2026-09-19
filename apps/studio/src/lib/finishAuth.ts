import type { NavigateFunction } from "react-router-dom";
import { AUTH_ROUTES } from "./authRoutes";

/** Matches the Clerk instance's password policy (auth_password.min_length). */
export const MIN_PASSWORD_LENGTH = 15;

interface Finalizable {
  finalize: (params?: {
    navigate?: (params: { decorateUrl: (url: string) => string }) => void | Promise<unknown>;
  }) => Promise<{ error: unknown }>;
}

/**
 * Activates a completed sign-in/sign-up and goes to the app. `decorateUrl` lets Clerk
 * route through its domain to refresh cookies in browsers that restrict them (Safari
 * ITP, Edge tracking prevention) — the decorated URL is then absolute and needs a full
 * page load instead of client-side navigation.
 */
export function finishAuth(resource: Finalizable, navigate: NavigateFunction) {
  return resource.finalize({
    navigate: ({ decorateUrl }) => {
      const destination = decorateUrl(AUTH_ROUTES.afterAuth);
      if (destination.startsWith("http")) {
        window.location.assign(destination);
        return;
      }
      navigate(destination, { replace: true });
    },
  });
}
