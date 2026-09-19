import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useSession, useUser } from "@clerk/react";
import type { CreditLedgerEntry, CreditLedgerReason } from "@renvia/types";
import { useApiClient } from "../../lib/apiClient";
import { formatRelativeTime } from "../../lib/relativeTime";
import { MIN_PASSWORD_LENGTH } from "../../lib/finishAuth";
import { FREE_CREDIT_ALLOWANCE, planLabel, useAccountStore } from "../../lib/useAccountStore";
import { PasswordStrength } from "../auth/PasswordStrength";
import { Avatar } from "./Avatar";

export type AccountTab = "profile" | "security" | "plan";

const TABS: { id: AccountTab; label: string; hint: string }[] = [
  { id: "profile", label: "Profile", hint: "Name and photo" },
  { id: "security", label: "Security", hint: "Password and devices" },
  { id: "plan", label: "Plan & credits", hint: "Balance and billing" },
];

const LEDGER_LABEL: Record<CreditLedgerReason, string> = {
  signup_bonus: "Welcome credits",
  initial_grant: "Starting credits",
  admin_grant: "Credits added by Renvia",
  render: "Render",
  render_refund: "Refund for a failed render",
  purchase: "Credit purchase",
};

type ClerkSession = Awaited<ReturnType<NonNullable<ReturnType<typeof useUser>["user"]>["getSessions"]>>[number];

/** Clerk API errors carry the readable text in `errors[0].longMessage`. */
function errorMessage(error: unknown, fallback: string): string {
  const first = (error as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0];
  return first?.longMessage ?? first?.message ?? fallback;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="account-section">
      <header>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

function Notice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  return <p className={`account-notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

function ProfileTab() {
  const { user } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (!user) return null;

  const name = user.fullName || user.primaryEmailAddress?.emailAddress || "You";
  const dirty = firstName.trim() !== (user.firstName ?? "") || lastName.trim() !== (user.lastName ?? "");

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      setNotice({ tone: "success", text: "Your name was updated." });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Couldn't save your name. Try again.") });
    } finally {
      setSaving(false);
    }
  };

  const setPhoto = async (file: File | null) => {
    if (file && file.size > 10 * 1024 * 1024) {
      setNotice({ tone: "error", text: "Choose an image under 10 MB." });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      await user.setProfileImage({ file });
      await user.reload();
      setNotice({ tone: "success", text: file ? "Profile photo updated." : "Profile photo removed." });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Couldn't update your photo. Try again.") });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Section title="Profile photo" description="Shown on your account menu and anywhere you collaborate.">
        <div className="account-photo-row">
          <Avatar name={name} imageUrl={user.hasImage ? user.imageUrl : null} size={64} />
          <div className="account-photo-actions">
            <button type="button" className="account-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : user.hasImage ? "Change photo" : "Upload photo"}
            </button>
            {user.hasImage && (
              <button type="button" className="account-button is-ghost" disabled={uploading} onClick={() => void setPhoto(null)}>
                Remove
              </button>
            )}
            <small>PNG or JPG, up to 10 MB.</small>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (file) void setPhoto(file);
            }}
          />
        </div>
      </Section>

      <Section title="Name">
        <form className="account-form" onSubmit={(event) => void saveName(event)}>
          <div className="account-field-row">
            <label className="account-field">
              <span>First name</span>
              <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
            </label>
            <label className="account-field">
              <span>Last name</span>
              <input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
            </label>
          </div>
          <div className="account-form-actions">
            <button type="submit" className="account-button is-primary" disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </Section>

      <Section title="Email" description="Used to sign in and for render notifications.">
        <div className="account-readonly">
          <span>{user.primaryEmailAddress?.emailAddress ?? "No email on file"}</span>
          {user.primaryEmailAddress?.verification?.status === "verified" && <em>Verified</em>}
        </div>
      </Section>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </>
  );
}

function describeSession(session: ClerkSession): string {
  const activity = session.latestActivity;
  const device = activity?.browserName ? `${activity.browserName}${activity.deviceType ? ` on ${activity.deviceType}` : ""}` : "Unknown device";
  return device;
}

function describeLocation(session: ClerkSession): string {
  const { city, country, ipAddress } = session.latestActivity ?? {};
  const place = [city, country].filter(Boolean).join(", ");
  return [place, ipAddress].filter(Boolean).join(" · ") || "Location unavailable";
}

function SecurityTab() {
  const { user } = useUser();
  const { session: currentSession } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [sessions, setSessions] = useState<ClerkSession[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    user
      ?.getSessions()
      .then((list) => setSessions(list.filter((session) => session.status === "active")))
      .catch(() => setSessions([]));
  }, [user]);

  if (!user) return null;
  const hasPassword = user.passwordEnabled;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await user.updatePassword({
        newPassword,
        currentPassword: hasPassword ? currentPassword : undefined,
        signOutOfOtherSessions: signOutOthers,
      });
      setCurrentPassword("");
      setNewPassword("");
      setNotice({ tone: "success", text: hasPassword ? "Password changed." : "Password set — you can now sign in with email and password." });
      if (signOutOthers) setSessions((list) => list?.filter((session) => session.id === currentSession?.id) ?? null);
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Couldn't update your password. Try again.") });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (target: ClerkSession | "others") => {
    const targets = target === "others" ? (sessions ?? []).filter((session) => session.id !== currentSession?.id) : [target];
    setRevoking(target === "others" ? "others" : target.id);
    try {
      await Promise.all(targets.map((session) => session.revoke()));
      const revoked = new Set(targets.map((session) => session.id));
      setSessions((list) => list?.filter((session) => !revoked.has(session.id)) ?? null);
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "Couldn't sign that device out. Try again.") });
    } finally {
      setRevoking(null);
    }
  };

  const otherCount = (sessions ?? []).filter((session) => session.id !== currentSession?.id).length;

  return (
    <>
      <Section
        title={hasPassword ? "Change password" : "Set a password"}
        description={hasPassword ? "Use at least 15 characters." : "You sign in with a connected account. Add a password to sign in with email too."}
      >
        <form className="account-form" onSubmit={(event) => void savePassword(event)}>
          {hasPassword && (
            <label className="account-field">
              <span>Current password</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            </label>
          )}
          <label className="account-field">
            <span>New password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <PasswordStrength password={newPassword} />
          <label className="account-check">
            <input type="checkbox" checked={signOutOthers} onChange={(event) => setSignOutOthers(event.target.checked)} />
            Sign out of all other devices
          </label>
          <div className="account-form-actions">
            <button type="submit" className="account-button is-primary" disabled={saving || tooShort || !newPassword || (hasPassword && !currentPassword)}>
              {saving ? "Saving…" : hasPassword ? "Update password" : "Set password"}
            </button>
          </div>
        </form>
      </Section>

      {user.externalAccounts.length > 0 && (
        <Section title="Connected accounts" description="Sign-in methods linked to your Renvia account.">
          <ul className="account-list">
            {user.externalAccounts.map((account) => (
              <li key={account.id}>
                <span className="account-list-icon">{account.providerTitle().slice(0, 1)}</span>
                <div>
                  <strong>{account.providerTitle()}</strong>
                  <small>{account.emailAddress || account.accountIdentifier()}</small>
                </div>
                <em>Connected</em>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Active devices" description="Places where you're currently signed in.">
        {sessions === null ? (
          <div className="account-list-loading" aria-label="Loading devices" />
        ) : (
          <ul className="account-list">
            {sessions.map((session) => {
              const isCurrent = session.id === currentSession?.id;
              return (
                <li key={session.id}>
                  <span className="account-list-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {session.latestActivity?.isMobile ? <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></> : <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8 20h8M12 16.5V20" /></>}
                    </svg>
                  </span>
                  <div>
                    <strong>
                      {describeSession(session)}
                      {isCurrent && <b className="account-pill">This device</b>}
                    </strong>
                    <small>{describeLocation(session)}</small>
                  </div>
                  {!isCurrent && (
                    <button type="button" className="account-button is-ghost is-small" disabled={revoking !== null} onClick={() => void revoke(session)}>
                      {revoking === session.id ? "Signing out…" : "Sign out"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {otherCount > 0 && (
          <button type="button" className="account-button is-danger-ghost" disabled={revoking !== null} onClick={() => void revoke("others")}>
            {revoking === "others" ? "Signing out…" : `Sign out of ${otherCount} other ${otherCount === 1 ? "device" : "devices"}`}
          </button>
        )}
      </Section>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </>
  );
}

function PlanTab({ onNavigate }: { onNavigate: (path: string) => void }) {
  const me = useAccountStore((state) => state.me);
  const isAdmin = me?.role === "admin";
  const credits = me?.creditBalance ?? 0;
  const used = Math.max(0, FREE_CREDIT_ALLOWANCE - credits);
  const percent = Math.min(100, Math.round((credits / FREE_CREDIT_ALLOWANCE) * 100));
  const apiClient = useApiClient();
  const setMe = useAccountStore((state) => state.setMe);
  const [entries, setEntries] = useState<CreditLedgerEntry[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  useEffect(() => {
    apiClient
      .getMyCredits()
      .then((result) => {
        setEntries(result.entries);
        if (me && me.creditBalance !== result.creditBalance) setMe({ ...me, creditBalance: result.creditBalance });
      })
      .catch(() => {
        setHistoryFailed(true);
        setEntries([]);
      });
    // Load once per open; apiClient is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberSince = me ? new Date(me.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;

  return (
    <>
      <div className="account-plan-card">
        <div>
          <p>Current plan</p>
          <h3>{planLabel(me)}</h3>
          {memberSince && <small>Member since {memberSince}</small>}
        </div>
        {!isAdmin && (
          <button type="button" className="account-button is-primary" onClick={() => onNavigate("/billing")}>
            Upgrade plan
          </button>
        )}
      </div>

      <Section title="Credit balance" description="Each rendered or edited image uses 1 credit. Failed renders are refunded automatically.">
        {isAdmin ? (
          <div className="account-readonly">
            <span>Admin accounts render without using credits.</span>
          </div>
        ) : (
          <div className="account-credit-panel">
            <div className="account-credit-figures">
              <div>
                <b>{credits}</b>
                <small>credits left</small>
              </div>
              <div>
                <b>{used}</b>
                <small>used of {FREE_CREDIT_ALLOWANCE} free</small>
              </div>
            </div>
            <div className="account-credits-meter is-large" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </div>
            <button type="button" className="account-button" onClick={() => onNavigate("/billing")}>
              Buy more credits
            </button>
          </div>
        )}
      </Section>

      <Section title="Credit history" description="Your most recent credit activity.">
        {entries === null ? (
          <div className="account-list-loading" aria-label="Loading credit history" />
        ) : entries.length === 0 ? (
          <div className="account-readonly">
            <span>{historyFailed ? "Credit history is unavailable right now." : "No credit activity yet."}</span>
          </div>
        ) : (
          <ul className="account-list account-ledger">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{LEDGER_LABEL[entry.reason]}</strong>
                  <small>{entry.note || formatRelativeTime(entry.createdAt)}</small>
                </div>
                <b className={entry.amount < 0 ? "is-spent" : "is-added"}>
                  {entry.amount > 0 ? "+" : ""}
                  {entry.amount}
                </b>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

interface AccountDialogProps {
  initialTab?: AccountTab;
  onClose: () => void;
}

/** "Manage account" — Renvia's own replacement for Clerk's UserProfile modal. */
export function AccountDialog({ initialTab = "profile", onClose }: AccountDialogProps) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const goTo = (path: string) => {
    onClose();
    navigate(path);
  };

  const active = TABS.find((item) => item.id === tab)!;

  return (
    <div className="account-dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        tabIndex={-1}
        className="account-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <nav className="account-dialog-nav" aria-label="Account sections">
          <p className="account-dialog-eyebrow">Account</p>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? "is-active" : ""}
              aria-current={item.id === tab ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>

        <div className="account-dialog-body">
          <header className="account-dialog-header">
            <div>
              <h2 id="account-dialog-title">{active.label}</h2>
              <p>{active.hint}</p>
            </div>
            <button type="button" className="account-dialog-close" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </header>
          <div className="account-dialog-content">
            {tab === "profile" && <ProfileTab />}
            {tab === "security" && <SecurityTab />}
            {tab === "plan" && <PlanTab onNavigate={goTo} />}
          </div>
        </div>
      </div>
    </div>
  );
}
