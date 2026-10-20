import { useEffect, useRef, useState } from "react";
import { useApiClient } from "../lib/apiClient";
import { refreshAccount, useAccountStore } from "../lib/useAccountStore";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
  render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "error-callback"?: () => void; "expired-callback"?: () => void }) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let scriptLoading: Promise<void> | null = null;

/** Loads Cloudflare's Turnstile script once, only when someone actually needs the check. */
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("Couldn't load the check"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Shown while this account's free monthly credits wait on a quick human check (Cloudflare
 * Turnstile). Passing it releases them straight away; the API decides whether it can.
 */
export function FreeCreditsBanner() {
  const api = useApiClient();
  const canClaim = useAccountStore((state) => state.me?.freeCredits?.canClaim === true);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !SITE_KEY || !holder.current) return;
    let widget: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile) return;
        widget = window.turnstile.render(holder.current, {
          sitekey: SITE_KEY,
          action: "claim_free_credits",
          callback: (token) => {
            setStatus(null);
            api.claimFreeCredits(token)
              .then((result) => {
                setStatus({ tone: "ok", text: result.granted ? `Done — ${result.creditBalance} credits are ready to use.` : "Done. Your free credits arrive with your next monthly allowance." });
                void refreshAccount(api.getMe);
              })
              .catch((error: unknown) => setStatus({ tone: "error", text: error instanceof Error ? error.message : "That didn't work. Please try again." }));
          },
          "error-callback": () => setStatus({ tone: "error", text: "The check couldn't load. Refresh the page to try again." }),
        });
      })
      .catch(() => setStatus({ tone: "error", text: "The check couldn't load. Check your connection and try again." }));
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [open, api]);

  if (!SITE_KEY || !canClaim || dismissed) return status?.tone === "ok" ? <div className="connection-banner" role="status">{status.text}</div> : null;

  return (
    <div className="connection-banner maintenance-banner" role="status" aria-live="polite">
      <span className="connection-banner-dot" aria-hidden="true" />
      <span>
        {open ? "Complete the quick check to release your free monthly credits." : "Your free monthly credits are waiting on a quick check that you're a person."}
        {status && <span className={status.tone === "error" ? " text-rose-700" : ""}> {status.text}</span>}
      </span>
      {open ? <div ref={holder} /> : <button type="button" onClick={() => setOpen(true)}>Get my credits</button>}
      <button type="button" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}
