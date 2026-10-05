import { useAuth } from "@clerk/react";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

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
    reportClientError(error, { componentStack: info.componentStack ?? undefined });
  }

  override componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f7f6f2", color: "#182018" }}>
        <section style={{ width: "min(100%, 440px)", border: "1px solid #d9d8d1", borderRadius: "16px", background: "#fff", padding: "32px", boxShadow: "0 16px 50px rgba(24,32,24,.12)" }}>
          <p style={{ margin: 0, color: "#6a756a", fontSize: "13px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Renvia</p>
          <h1 style={{ margin: "12px 0 8px", fontSize: "24px" }}>This screen hit a problem</h1>
          <p style={{ margin: 0, color: "#586258", lineHeight: 1.55 }}>We’ve recorded the technical details. Your work is not intentionally discarded; reload to continue.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: "22px", border: 0, borderRadius: "10px", background: "#243326", color: "#fff", padding: "11px 16px", fontWeight: 700, cursor: "pointer" }}>Reload Renvia</button>
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
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return <ClientErrorBoundary resetKey={location.pathname}>{children}</ClientErrorBoundary>;
}
