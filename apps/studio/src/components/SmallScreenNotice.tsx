import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** Below this width the Studio's panels and canvas no longer fit side by side. */
const SMALL_SCREEN_QUERY = "(max-width: 900px)";
/** Dismissed once per visit: a new visit on a phone gets the reminder again. */
const DISMISSED_KEY = "renvia:small-screen-notice:dismissed";
/** Sign-in pages work fine on a phone; the notice is for the Studio itself. */
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/sso-callback"];

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function useSmallScreen(): boolean {
  const [small, setSmall] = useState(() => window.matchMedia(SMALL_SCREEN_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(SMALL_SCREEN_QUERY);
    const update = () => setSmall(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return small;
}

/**
 * Tells people on a phone or small tablet that the Studio is built for a larger screen, before
 * they find out the hard way. They can carry on anyway, or copy the link to open on a computer.
 */
export function SmallScreenNotice() {
  const small = useSmallScreen();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [copied, setCopied] = useState(false);

  if (!small || dismissed || AUTH_PATHS.some((path) => pathname.startsWith(path))) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage blocked: it stays dismissed until the page reloads.
    }
    setDismissed(true);
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <div className="small-screen-notice" role="dialog" aria-modal="true" aria-labelledby="small-screen-title">
      <div className="small-screen-card">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect x="4" y="9" width="32" height="22" rx="2.5" />
          <path d="M14 37h12M20 31v6" />
          <rect x="33" y="19" width="11" height="20" rx="2" />
          <path d="M37.5 35.5h2" />
        </svg>
        <h2 id="small-screen-title">Ramah Studio works best on a computer</h2>
        <p>
          The Studio's canvas, panels and editing tools are built for a larger screen. On a phone some controls are cramped or hard
          to reach, so you won't get the best experience here.
        </p>
        <p>For the full Studio, open Ramah Studio on a laptop or desktop.</p>
        <div className="small-screen-actions">
          <button type="button" className="is-primary" onClick={dismiss}>
            Continue anyway
          </button>
          <button type="button" onClick={copyLink}>
            {copied ? "Link copied" : "Copy link for later"}
          </button>
        </div>
      </div>
    </div>
  );
}
