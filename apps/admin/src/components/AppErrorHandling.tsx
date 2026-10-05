import { useAuth } from "@clerk/react";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

type ReportContext = { componentStack?: string; requestId?: string | null };
let reporter: ((error: unknown, context?: ReportContext) => void) | null = null;
const recentlyReported = new Map<string, number>();

function safeText(value: unknown, limit: number) {
  const text = String(value ?? "Unknown error").replace(/[\r\n\t]+/g, " ").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]").replace(/\bhttps?:\/\/[^\s)]+/gi, (url) => { try { return new URL(url).origin; } catch { return "[url]"; } }).trim();
  return text.slice(0, limit) || "Unknown error";
}
function fingerprint(value: string) { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, "0"); }
export function reportClientError(error: unknown, context?: ReportContext) { reporter?.(error, context); }

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { reportClientError(error, { componentStack: info.componentStack ?? undefined }); }
  override componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) { if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  override render() {
    if (!this.state.error) return this.props.children;
    return <main className="grid min-h-screen place-items-center bg-surface p-6 text-primary"><section className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-8 shadow-soft"><p className="text-xs font-bold uppercase tracking-widest text-muted">Renvia Admin</p><h1 className="mt-3 text-2xl font-semibold">This screen hit a problem</h1><p className="mt-2 text-sm leading-6 text-muted">We’ve recorded the technical details. Reload to continue safely.</p><button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white">Reload admin</button></section></main>;
  }
}

export function AppErrorHandling({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const location = useLocation();
  useEffect(() => {
    reporter = (error, context) => {
      const source = error instanceof Error ? error : new Error(safeText(error, 500));
      const message = safeText(source.message, 500); const stack = source.stack ? safeText(source.stack, 4_000) : null;
      const key = fingerprint(`${source.name}|${message}|${stack?.split(" at ")[0] ?? ""}`); const now = Date.now();
      if ((recentlyReported.get(key) ?? 0) > now - 15_000) return;
      recentlyReported.set(key, now); if (recentlyReported.size > 50) recentlyReported.clear();
      void getToken().then((token) => { if (!token) return; return fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"}/api/errors/client`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Request-Id": crypto.randomUUID() }, keepalive: true, body: JSON.stringify({ app: "admin", name: safeText(source.name, 100), message, fingerprint: key, stack, path: location.pathname, requestId: context?.requestId ?? null, componentStack: context?.componentStack ? safeText(context.componentStack, 2_000) : null }) }).catch(() => undefined); }).catch(() => undefined);
    };
    return () => { reporter = null; };
  }, [getToken, location.pathname]);
  useEffect(() => { const onError = (event: ErrorEvent) => reportClientError(event.error ?? new Error(event.message)); const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason); window.addEventListener("error", onError); window.addEventListener("unhandledrejection", onRejection); return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); }; }, []);
  return <Boundary resetKey={location.pathname}>{children}</Boundary>;
}
