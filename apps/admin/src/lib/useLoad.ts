import { useCallback, useEffect, useRef, useState } from "react";

interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Time the last successful response arrived; null until the first success. */
  lastUpdated: Date | null;
}

/**
 * Runs `load` whenever `deps` change and keeps the last successful result while
 * reloading, so tables don't flash empty between pages or searches.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], pollMs = 0): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // A refresh the timer asked for keeps the screen as it is; only a first load or new filters dim it.
  const background = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const quiet = background.current;
    background.current = false;
    if (!quiet) setLoading(true);
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLastUpdated(new Date());
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled && !quiet) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!pollMs) return;
    // Background tabs do not need live operational traffic. A visibility change
    // refreshes once immediately when the operator returns.
    const tick = () => { if (document.visibilityState === "visible") { background.current = true; setVersion((value) => value + 1); } };
    const timer = window.setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [pollMs]);
  return { data, error, loading, reload, lastUpdated };
}
