import { useState } from "react";
import { useUser } from "@clerk/react";

/**
 * Renvia moved to a new database on 11 October 2026 after the old one was locked by its host.
 * Accounts that existed before then don't see their earlier projects, renders or credits until
 * that data is copied across. This explains it to them; people who signed up afterwards have
 * nothing missing, so they never see it. Remove the component once the restore is done.
 */
const MOVED_AT = Date.parse("2026-10-11T18:00:00Z");

const dismissKey = (userId: string) => `renvia:restore-notice-dismissed:${userId}`;

function wasDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function RestoreNotice() {
  const { user } = useUser();
  const [dismissed, setDismissed] = useState(false);
  if (!user?.createdAt || user.createdAt.getTime() >= MOVED_AT) return null;
  if (dismissed || wasDismissed(user.id)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(user.id), "1");
    } catch {
      // Private mode or storage blocked: it just shows again next visit.
    }
  };

  return (
    <section className="restore-notice" role="status" aria-labelledby="restore-notice-title">
      <span className="restore-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
          <path d="M3.5 3.5v3.2h3.2" />
          <path d="M10 6.5V10l2.3 1.4" />
        </svg>
      </span>
      <div className="restore-notice-body">
        <h2 id="restore-notice-title">Your earlier work is on its way back</h2>
        <p>
          We've moved Renvia to new infrastructure after a database issue with our provider. Your account works as normal, but projects, renders and credits from
          before 11 October aren't showing yet.
        </p>
        <ul>
          <li><strong>Nothing has been lost.</strong> We're restoring it, and it will reappear in your account automatically.</li>
          <li><strong>Keep working.</strong> Anything you create now is saved as usual and stays alongside your restored history.</li>
          <li><strong>Your credits are safe.</strong> Your earlier balance comes back with the rest of your data.</li>
        </ul>
        <p className="restore-notice-thanks">Thank you for bearing with us. We're sorry for the disruption.</p>
      </div>
      <button type="button" className="restore-notice-dismiss" onClick={dismiss}>Got it</button>
    </section>
  );
}
