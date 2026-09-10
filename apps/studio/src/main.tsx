import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { clerkAppearance } from "./lib/clerkAppearance";
import { AUTH_ROUTES } from "./lib/authRoutes";
import "./styles/globals.css";
import "./styles/render-panel.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl={AUTH_ROUTES.signIn}
      signUpUrl={AUTH_ROUTES.signUp}
      signInFallbackRedirectUrl={AUTH_ROUTES.afterAuth}
      signUpFallbackRedirectUrl={AUTH_ROUTES.afterAuth}
      afterSignOutUrl={AUTH_ROUTES.signIn}
      appearance={clerkAppearance}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);
