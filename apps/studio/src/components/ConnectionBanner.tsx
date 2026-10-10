import { useCallback, useEffect, useState } from "react";
import { markApiReachable, useConnectionStore } from "../lib/connection";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
/** How often to check whether the API is back once a request has gone unanswered. */
const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;

/** One unauthenticated health check; true when the API answered. */
async function probeApi(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Says so when the Studio can't reach Renvia, instead of leaving spinners running with no
 * explanation. Offline comes from the browser; "can't reach" from requests that went
 * unanswered, cleared by the next one that gets through or by a periodic health check.
 */
export function ConnectionBanner() {
  const online = useConnectionStore((state) => state.online);
  const apiReachable = useConnectionStore((state) => state.apiReachable);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const onOnline = () => useConnectionStore.setState({ online: true });
    const onOffline = () => useConnectionStore.setState({ online: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    if (await probeApi()) markApiReachable();
    setChecking(false);
  }, []);

  // While the API is unreachable but the network is up, keep checking until it answers.
  useEffect(() => {
    if (apiReachable || !online) return;
    void check();
    const interval = setInterval(() => void check(), PROBE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [apiReachable, online, check]);

  if (online && apiReachable) return null;

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span className="connection-banner-dot" aria-hidden="true" />
      {online ? (
        <>
          <span>Can't reach Renvia right now. Your renders keep running; we'll reconnect automatically.</span>
          <button type="button" onClick={() => void check()} disabled={checking}>
            {checking ? "Checking…" : "Retry now"}
          </button>
        </>
      ) : (
        <span>You're offline. Renvia will reconnect when your connection is back.</span>
      )}
    </div>
  );
}
