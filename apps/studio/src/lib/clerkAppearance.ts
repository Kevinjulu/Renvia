/**
 * Shared Clerk `appearance` config so every Clerk-rendered surface — the
 * account dropdown, the avatar trigger, the "Manage account" modal — matches
 * Renvia's own design system instead of Clerk's stock look.
 *
 * Passed once to `<ClerkProvider>` so it cascades everywhere; individual
 * `<UserButton>` usages don't need to repeat it.
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

    // Avatar trigger button
    userButtonBox: "flex-row-reverse gap-2",
    userButtonOuterIdentifier: "text-sm font-medium text-primary",
    userButtonTrigger:
      "rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-blueprint focus-visible:ring-offset-2",
    userButtonAvatarBox: "h-8 w-8 rounded-full ring-1 ring-hairline transition-shadow hover:ring-hairline-strong",

    // The small popover that opens on click
    userButtonPopoverRootBox: "z-50",
    userButtonPopoverCard: "rounded-2xl border border-hairline shadow-xl shadow-black/[0.08]",
    userButtonPopoverMain: "px-1.5 py-1.5",
    userButtonPopoverActions: "px-1.5 pb-1.5",
    userButtonPopoverActionButton:
      "rounded-lg px-2.5 py-2 text-sm text-primary transition-colors hover:bg-surface-muted",
    userButtonPopoverActionButtonText: "text-sm font-medium",
    userButtonPopoverActionButtonIconBox: "text-secondary",
    userButtonPopoverCustomItemButton:
      "rounded-lg px-2.5 py-2 text-sm text-primary transition-colors hover:bg-surface-muted",
    userButtonPopoverCustomItemButtonIconBox: "text-secondary",
    userButtonPopoverFooter: "hidden",

    userPreviewMainIdentifier: "text-sm font-medium text-primary",
    userPreviewSecondaryIdentifier: "text-xs text-faint",
    userPreviewAvatarBox: "h-9 w-9 rounded-full",
    avatarBox: "rounded-full",

    // "Manage account" modal
    modalBackdrop: "bg-primary/40 backdrop-blur-sm",
    modalContent: "rounded-2xl border border-hairline shadow-2xl",
    card: "shadow-none",
    navbar: "border-r border-hairline bg-surface",
    navbarButton: "rounded-lg text-sm text-secondary transition-colors hover:bg-surface-muted hover:text-primary",
    navbarButtonIcon: "text-current",
    headerTitle: "font-display text-lg font-semibold text-primary",
    headerSubtitle: "text-sm text-secondary",
    profileSectionTitleText: "font-display text-sm font-semibold text-primary",
    profileSectionPrimaryButton: "rounded-lg bg-blueprint text-white transition-opacity hover:opacity-90",
    formButtonPrimary: "rounded-lg bg-blueprint text-sm font-medium text-white transition-opacity hover:opacity-90",
    formFieldInput:
      "rounded-lg border border-hairline bg-white text-sm text-primary focus:ring-2 focus:ring-blueprint",
    formFieldLabel: "text-sm font-medium text-primary",
    badge: "rounded-full bg-blueprint-soft text-blueprint",
    scrollBox: "rounded-2xl",
  },
};
