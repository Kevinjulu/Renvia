import { useAuth } from "@clerk/react";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { isConnectionError } from "../lib/connection";
import { isChunkLoadError, reloadForNewVersion } from "../lib/chunkErrors";

type AppName = "studio" | "admin";
type ReportContext = { componentStack?: string; requestId?: string | null };

let reporter: ((error: unknown, context?: ReportContext) => void) | null = null;
const recentlyReported = new Map<string, number>();

function safeText(value: unknown, limit: number) {
  const text = String(value ?? "Unknown error")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\bhttps?:\/\/[^\s)]+/gi, (url) => {
      try { return new URL(url).origin; } catch { return "[url]"; }
    })
    .trim();
  return text.slice(0, limit) || "Unknown error";
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Use for caught non-expected failures as well as the global browser handlers. */
export function reportClientError(error: unknown, context?: ReportContext) {
  // A dropped connection isn't a bug; the connection banner already tells the user. Nor is code
  // missing after a deploy: the page is just older than the server and reloads onto the new one.
  if (isConnectionError(error) || isChunkLoadError(error)) return;
  reporter?.(error, context);
}

function ClientErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return <Boundary resetKey={resetKey}>{children}</Boundary>;
}

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      reloadForNewVersion();
      return;
    }
    reportClientError(error, { componentStack: info.componentStack ?? undefined });
  }

  override componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const outdated = isChunkLoadError(error);
    return (
      <main className="app-error">
        <section>
          <p className="app-error-brand">Renvia</p>
          <h1>{outdated ? "Renvia has been updated" : "This screen hit a problem"}</h1>
          <p>
            {outdated
              ? "A new version is available. Reload to continue — your projects are saved."
              : "We've recorded what happened. Your projects are saved — reload to carry on, or go back to your projects."}
          </p>
          <div>
            <button type="button" onClick={() => window.location.reload()}>Reload Renvia</button>
            {!outdated && <a href="/dashboard">Back to projects</a>}
          </div>
        </section>
      </main>
    );
  }
}

export function AppErrorHandling({ app, children }: { app: AppName; children: ReactNode }) {
  const { getToken } = useAuth();
  const location = useLocation();

  useEffect(() => {
    reporter = (error, context) => {
      const source = error instanceof Error ? error : new Error(safeText(error, 500));
      const message = safeText(source.message, 500);
      const stack = source.stack ? safeText(source.stack, 4_000) : null;
      const key = fingerprint(`${source.name}|${message}|${stack?.split(" at ")[0] ?? ""}`);
      const now = Date.now();
      if ((recentlyReported.get(key) ?? 0) > now - 15_000) return;
      recentlyReported.set(key, now);
      if (recentlyReported.size > 50) recentlyReported.clear();
      void getToken().then((token) => {
        if (!token) return;
        return fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"}/api/errors/client`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Request-Id": crypto.randomUUID() },
          keepalive: true,
          body: JSON.stringify({ app, name: safeText(source.name, 100), message, fingerprint: key, stack, path: location.pathname, requestId: context?.requestId ?? null, componentStack: context?.componentStack ? safeText(context.componentStack, 2_000) : null }),
        }).catch(() => undefined);
      }).catch(() => undefined);
    };
    return () => { reporter = null; };
  }, [app, getToken, location.pathname]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.error ?? new Error(event.message));
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
    // Vite's signal that a code file it preloads is gone, i.e. a deploy happened since this page
    // loaded. Reloading picks up the new version; if that was just tried, the error surfaces
    // through a boundary and explains itself instead.
    const onPreloadError = (event: Event) => {
      if (reloadForNewVersion()) event.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, []);

  return <ClientErrorBoundary resetKey={location.pathname}>{children}</ClientErrorBoundary>;
}
