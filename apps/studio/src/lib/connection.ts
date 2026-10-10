import { create } from "zustand";

/**
 * A request that never got an answer from the API: the browser is offline, the request timed
 * out, or the network dropped it. Distinct from an ApiError, which is an answer.
 */
export class ConnectionError extends Error {
  readonly reason: "offline" | "timeout" | "network";

  constructor(reason: "offline" | "timeout" | "network") {
    super(
      reason === "offline"
        ? "You're offline"
        : reason === "timeout"
          ? "The request took too long to answer"
          : "Couldn't reach the server",
    );
    this.reason = reason;
    this.name = "ConnectionError";
  }
}

interface ConnectionState {
  /** The browser's own view: false means no network at all. */
  online: boolean;
  /** False after a request to the API went unanswered, until one gets through again. */
  apiReachable: boolean;
}

export const useConnectionStore = create<ConnectionState>(() => ({
  // Only an explicit false means offline; environments without the flag count as online.
  online: typeof navigator === "undefined" || navigator.onLine !== false,
  apiReachable: true,
}));

/** Any answer from the API, refusal or not, proves it's reachable. */
export function markApiReachable() {
  if (!useConnectionStore.getState().apiReachable) useConnectionStore.setState({ apiReachable: true });
}

export function markApiUnreachable() {
  if (useConnectionStore.getState().apiReachable) useConnectionStore.setState({ apiReachable: false });
}

/** Turns a fetch failure (a TypeError, or an abort from our timeout) into a ConnectionError. */
export function connectionErrorFrom(error: unknown, timedOut: boolean): ConnectionError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return new ConnectionError("offline");
  if (timedOut) return new ConnectionError("timeout");
  return error instanceof ConnectionError ? error : new ConnectionError("network");
}

/** True for failures that say nothing about our code: they're the network's, not a bug. */
export function isConnectionError(error: unknown): error is ConnectionError {
  return error instanceof ConnectionError;
}
