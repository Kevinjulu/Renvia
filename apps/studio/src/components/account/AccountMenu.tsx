import { UserButton } from "@clerk/react";

/** Same mark used for the credits pill in BillingStatus, so the two stay visually tied together. */
function CreditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
    </svg>
  );
}

function CreditsPage() {
  return (
    <div className="px-1 py-2">
      <h1 className="font-display text-lg font-semibold text-primary">Credits &amp; billing</h1>
      <p className="mt-1 text-sm text-secondary">
        See your credit balance, upgrade your plan, or buy more credits.
      </p>

      <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-hairline-strong bg-surface px-6 py-10 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blueprint-soft text-blueprint">
          <CreditIcon />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">Plans &amp; billing are coming soon</p>
          <p className="mt-1 text-xs text-faint">
            Upgrading and buying extra credits will open our pricing page once it&apos;s live.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="mt-1 cursor-not-allowed rounded-lg bg-primary/40 px-3.5 py-2 text-sm font-medium text-white"
        >
          View plans
        </button>
      </div>
    </div>
  );
}

interface AccountMenuProps {
  /** Show the user's name next to the avatar. Off by default to match the compact top bars. */
  showName?: boolean;
}

/** The account avatar, its dropdown, and the "Manage account" modal — styled to match the rest of the app. */
export function AccountMenu({ showName = false }: AccountMenuProps) {
  return (
    <UserButton showName={showName}>
      <UserButton.UserProfilePage label="Credits" url="credits" labelIcon={<CreditIcon />}>
        <CreditsPage />
      </UserButton.UserProfilePage>
    </UserButton>
  );
}
