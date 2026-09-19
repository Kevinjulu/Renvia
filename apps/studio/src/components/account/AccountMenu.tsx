import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useClerk, useUser } from "@clerk/react";
import { AUTH_ROUTES } from "../../lib/authRoutes";
import { creditsLeftPercent, planLabel, useAccountStore } from "../../lib/useAccountStore";
import { Avatar } from "./Avatar";
import { AccountDialog, type AccountTab } from "./AccountDialog";

const ICONS: Record<string, ReactNode> = {
  profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  security: <><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></>,
  preferences: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  billing: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h3" /></>,
  activity: <><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7" /><path d="M12 17.2h.01" /></>,
  signOut: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16 6 12l4-4M6 12h10" /></>,
};

function MenuIcon({ name }: { name: keyof typeof ICONS }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

function CreditMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
    </svg>
  );
}

interface AccountMenuProps {
  /** Show the user's first name next to the avatar. Off by default to match the compact top bars. */
  showName?: boolean;
}

/** The account avatar, its dropdown, and the account settings dialog — all Renvia-drawn, no Clerk UI. */
export function AccountMenu({ showName = false }: AccountMenuProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const me = useAccountStore((state) => state.me);
  const granted = useAccountStore((state) => state.granted);
  const navigate = useNavigate();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<AccountTab | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [open]);

  if (!user) return null;

  const name = user.fullName || user.username || user.primaryEmailAddress?.emailAddress || "Your account";
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const imageUrl = user.hasImage ? user.imageUrl : null;
  const isAdmin = me?.role === "admin";
  const credits = me?.creditBalance ?? 0;
  const creditPercent = creditsLeftPercent(credits, granted);
  const isLow = !isAdmin && me !== null && credits <= 5;

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const go = (path: string) => {
    close(false);
    navigate(path);
  };

  const openDialog = (tab: AccountTab) => {
    close(false);
    setDialogTab(tab);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut({ redirectUrl: AUTH_ROUTES.signIn });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={rootRef} className="account-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`account-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar name={name} imageUrl={imageUrl} size={30} />
        {showName && <span className="account-trigger-name">{user.firstName || name}</span>}
        <svg className="account-trigger-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.75 3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label="Account" className="account-popover" onKeyDown={handleMenuKeyDown}>
          <div className="account-popover-header">
            <Avatar name={name} imageUrl={imageUrl} size={42} />
            <div className="account-popover-identity">
              <strong title={name}>{name}</strong>
              <span title={email}>{email}</span>
            </div>
            <span className={`account-plan-badge ${isAdmin ? "is-admin" : ""}`}>{planLabel(me)}</span>
          </div>

          <div className={`account-credits ${isLow ? "is-low" : ""}`}>
            <div className="account-credits-row">
              <span className="account-credits-label">
                <CreditMark /> Credits
              </span>
              <span className="account-credits-value">
                {isAdmin ? "Unlimited" : (
                  <>
                    <b>{credits}</b> left
                  </>
                )}
              </span>
            </div>
            {!isAdmin && (
              <>
                {creditPercent !== null && (
                  <div className="account-credits-meter" aria-hidden="true">
                    <span style={{ width: `${creditPercent}%` }} />
                  </div>
                )}
                <div className="account-credits-row">
                  <small>{isLow ? "Running low — top up to keep rendering." : "1 credit = 1 rendered image"}</small>
                  <button type="button" role="menuitem" className="account-credits-cta" onClick={() => go("/billing")}>
                    Get more
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="account-menu-group" role="group" aria-label="Account">
            <button type="button" role="menuitem" onClick={() => openDialog("profile")}>
              <MenuIcon name="profile" /> Profile
            </button>
            <button type="button" role="menuitem" onClick={() => openDialog("security")}>
              <MenuIcon name="security" /> Security &amp; sign-in
            </button>
            <button type="button" role="menuitem" onClick={() => openDialog("plan")}>
              <MenuIcon name="billing" /> Plan &amp; credits
            </button>
          </div>

          <div className="account-menu-group" role="group" aria-label="Workspace">
            <button type="button" role="menuitem" onClick={() => go("/settings")}>
              <MenuIcon name="preferences" /> Studio preferences
            </button>
            <button type="button" role="menuitem" onClick={() => go("/activity")}>
              <MenuIcon name="activity" /> Activity
            </button>
            <button type="button" role="menuitem" onClick={() => go("/help/getting-started")}>
              <MenuIcon name="help" /> Help center
            </button>
          </div>

          <div className="account-menu-group">
            <button type="button" role="menuitem" className="is-danger" disabled={signingOut} onClick={() => void handleSignOut()}>
              <MenuIcon name="signOut" /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}

      {dialogTab && <AccountDialog initialTab={dialogTab} onClose={() => setDialogTab(null)} />}
    </div>
  );
}
