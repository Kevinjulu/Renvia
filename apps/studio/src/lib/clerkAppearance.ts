/**
 * Shared Clerk `appearance` config, passed once to `<ClerkProvider>`. The account
 * menu and dialog are Renvia's own components now, so this only matters for any
 * Clerk-rendered surface that still appears (e.g. captcha or verification UI).
 */
export const clerkAppearance = {
  variables: {
    // The app's accent blue, not black — this drives buttons, active/checked
    // states, and default focus rings throughout the account modal.
    colorPrimary: "#2F6FED",
    colorPrimaryForeground: "#FFFFFF",
    colorDanger: "#DC2626",
    colorForeground: "#141414",
    colorMutedForeground: "#8A8A8A",
    colorBackground: "#FFFFFF",
    colorInputForeground: "#141414",
    colorInput: "#FFFFFF",
    colorBorder: "#E7E4DD",
    colorNeutral: "#141414",
    colorShadow: "#141414",
    fontFamily: "var(--font-switzer), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-switzer), system-ui, sans-serif",
    fontFamilyMono: "var(--font-mono), ui-monospace, monospace",
    borderRadius: "0.5rem",
  },
  options: {
    shimmer: true,
    // Hides Clerk's dev-mode warning banner. The instance is still running
    // on test API keys underneath — this only removes the visual reminder.
    // Switch VITE_CLERK_PUBLISHABLE_KEY to a production (pk_live_) key
    // before launch to leave dev mode for real.
    unsafe_disableDevelopmentModeWarnings: true,
  },
  elements: {
    // Clerk's own branding footer ("Secured by Clerk") — we ship custom
    // auth screens, so this doesn't belong in our UI.
    footer: "hidden",
    footerAction: "hidden",
    footerActionText: "hidden",
    footerActionLink: "hidden",
    footerPages: "hidden",
  },
};
