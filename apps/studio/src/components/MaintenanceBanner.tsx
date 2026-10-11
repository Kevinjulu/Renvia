import { useState } from "react";
import { useAccountStore } from "../lib/useAccountStore";

/** Announce a scheduled window this far ahead of its start. */
const ANNOUNCE_MS = 24 * 60 * 60 * 1000;

const SCOPE_TEXT = { all: "Rendering and auto select", renders: "Rendering", selections: "Auto select" } as const;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Tells customers about scheduled maintenance before it starts and while it runs, so a refused
 * render is never the first they hear of it. Admins aren't paused, but see it too.
 */
export function MaintenanceBanner() {
  const window = useAccountStore((state) => state.me?.upcomingMaintenance ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!window) return null;
  const startsIn = new Date(window.startsAt).getTime() - Date.now();
  if (startsIn > ANNOUNCE_MS) return null;
  const key = `${window.startsAt}|${window.endsAt}`;
  if (dismissed === key) return null;
  const running = startsIn <= 0;

  return (
    <div className="connection-banner maintenance-banner" role="status" aria-live="polite">
      <span className="connection-banner-dot" aria-hidden="true" />
      <span>
        {running
          ? `${SCOPE_TEXT[window.scope]} is paused for maintenance until ${formatWhen(window.endsAt)}.`
          : `${SCOPE_TEXT[window.scope]} pauses for maintenance ${formatWhen(window.startsAt)} – ${formatWhen(window.endsAt)}.`}
        {window.message ? ` ${window.message}` : ""}
      </span>
      <button type="button" onClick={() => setDismissed(key)}>Dismiss</button>
    </div>
  );
}
