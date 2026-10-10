import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "./AppErrorHandling";
import { isChunkLoadError, reloadForNewVersion } from "../lib/chunkErrors";

interface RegionBoundaryProps {
  /** What crashed, in the user's words — "The results panel". */
  name: string;
  children: ReactNode;
  /** For overlays like dialogs: show nothing instead of a card when they crash. */
  silent?: boolean;
}

/**
 * Contains a crash to one part of the Studio, so the canvas, the panel and the results keep
 * working when one of them breaks. "Try again" re-mounts just that part.
 */
export class RegionBoundary extends Component<RegionBoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Missing code after a deploy isn't a bug: reload onto the new version instead of reporting.
    if (isChunkLoadError(error)) {
      reloadForNewVersion();
      return;
    }
    reportClientError(error, { componentStack: info.componentStack ?? undefined });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    const outdated = isChunkLoadError(error);
    return (
      <div className="region-error" role="alert">
        <strong>{outdated ? "Renvia has been updated" : `${this.props.name} hit a problem`}</strong>
        <p>{outdated ? "Reload to get the latest version. Your project is saved." : "The rest of the Studio still works, and your project is saved."}</p>
        <div>
          {!outdated && (
            <button type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          )}
          <button type="button" className="is-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
